// #103: player de VGM da IDE — um só para todas as telas (tocar outra música para a anterior).
// Os comandos do arquivo viram escritas de registrador agendadas no relógio do AudioContext e
// tocam no mesmo YM2612 + PSG emulados do compositor (chipWorklet), num contexto próprio.
import { reactive, readonly } from 'vue'
import workletUrl from './chipWorklet.js?worker&url'
import { parseVgm, VgmCursor, vgmStateAt, isGzip, VGM_SAMPLE_RATE } from '../../shared/retro/vgmPlayback.js'

const LOOKAHEAD = 0.3, TICK_MS = 50, START_DELAY = 0.08
const VOLUME_KEY = 'retro-studio.vgm-volume'
const storedVolume = (() => { try { const value = Number(localStorage.getItem(VOLUME_KEY)); return Number.isFinite(value) && value >= 0 && value <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? value : .8 } catch { return .8 } })()

const state = reactive({
  status: 'idle',   // 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  key: '',          // quem está tocando (caminho do arquivo); as telas comparam com o seu
  name: '', tags: {}, error: '',
  position: 0, duration: 0, loopStart: 0, looped: false,
  volume: storedVolume
})
export const vgmPlayer = readonly(state)

let context = null, node = null, gain = null, contextReady = null
let vgm = null, cursor = null, timer = 0, frame = 0, request = 0
let originTime = 0, originSample = 0   // amostra originSample toca em originTime (relógio do áudio)
let scheduledUntil = 0                  // até que amostra do VGM já foi agendada

async function ensureContext() {
  if (context) return
  contextReady ||= (async () => {
    const created = new AudioContext({ latencyHint: 'playback' })
    try {
      await created.audioWorklet.addModule(workletUrl)
      node = new AudioWorkletNode(created, 'retro-chip', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { chips: 1 } })
      gain = created.createGain(); gain.gain.value = state.volume
      node.connect(gain).connect(created.destination)
      context = created
    } catch (error) { created.close().catch(() => {}); throw error } finally { contextReady = null }
  })()
  await contextReady
}

/** Bytes de um VGM (ou VGZ) para tocar: descompacta o gzip no próprio navegador. */
export async function vgmBytes(input) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (isGzip(bytes)) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  return bytes
}

function stopTimers() { clearInterval(timer); timer = 0; cancelAnimationFrame(frame); frame = 0 }

function schedule() {
  if (!context || !cursor || state.status !== 'playing') return
  const target = Math.min(Number.MAX_SAFE_INTEGER, originSample + Math.ceil((context.currentTime + LOOKAHEAD - originTime) * VGM_SAMPLE_RATE))
  if (target <= scheduledUntil) return
  const batch = []
  cursor.run(target, (sample, write) => { batch.push([originTime + (sample - originSample) / VGM_SAMPLE_RATE, ...write]) })
  scheduledUntil = target
  if (batch.length) node.port.postMessage({ chip: 0, batch })
  if (cursor.ended && context.currentTime > originTime + (cursor.time - originSample) / VGM_SAMPLE_RATE + .2) stop()
}

// Posição mostrada: dentro da música, voltando para o início do loop a cada volta.
function updatePosition() {
  if (!context || state.status !== 'playing') return
  const sample = originSample + Math.max(0, context.currentTime - originTime) * VGM_SAMPLE_RATE
  const total = vgm.samples, loopStart = vgm.loopOffset !== null ? vgm.samples - vgm.loopSamples : 0
  const inside = sample < total || vgm.loopOffset === null ? Math.min(sample, total) : loopStart + (sample - total) % vgm.loopSamples
  state.position = inside / VGM_SAMPLE_RATE
  state.looped = sample >= total && vgm.loopOffset !== null
  frame = requestAnimationFrame(updatePosition)
}

// Começa a tocar da amostra pedida (0 = início), com o estado dos chips daquele ponto.
function startAt(sample) {
  stopTimers()
  node.port.postMessage({ chip: 0, clear: true })
  const prepared = sample > 0 ? vgmStateAt(vgm, sample) : { writes: [], cursor: new VgmCursor(vgm) }
  cursor = prepared.cursor
  if (prepared.writes.length) node.port.postMessage({ chip: 0, writes: prepared.writes })
  originTime = context.currentTime + START_DELAY; originSample = cursor.time; scheduledUntil = cursor.time
  state.status = 'playing'
  schedule()
  timer = setInterval(schedule, TICK_MS)
  frame = requestAnimationFrame(updatePosition)
}

/**
 * Toca um VGM. key identifica a origem (caminho do arquivo) para as telas; load() devolve os
 * bytes (VGM ou VGZ) e só é chamado se ainda for o pedido mais recente.
 */
export async function playVgm({ key, name = '', load }) {
  const id = ++request
  stopTimers()
  if (node) node.port.postMessage({ chip: 0, clear: true })
  Object.assign(state, { status: 'loading', key, name, tags: {}, error: '', position: 0, duration: 0, loopStart: 0, looped: false })
  try {
    const [bytes] = await Promise.all([load().then(vgmBytes), ensureContext()])
    if (id !== request) return false
    vgm = parseVgm(bytes)
    if (!vgm.samples) throw new Error('O VGM não tem duração (arquivo vazio ou incompleto).')
    state.tags = vgm.tags
    state.duration = vgm.seconds
    state.loopStart = vgm.loopOffset !== null ? (vgm.samples - vgm.loopSamples) / VGM_SAMPLE_RATE : 0
    if (context.state === 'suspended') await context.resume()
    if (id !== request) return false
    startAt(0)
    return true
  } catch (error) {
    if (id !== request) return false
    vgm = null; cursor = null
    Object.assign(state, { status: 'error', error: error?.message || String(error) })
    return false
  }
}

export async function pauseVgm() {
  if (state.status !== 'playing' || !context) return
  stopTimers()
  state.status = 'paused'
  await context.suspend().catch(() => {})
}
export async function resumeVgm() {
  if (state.status !== 'paused' || !context) return
  await context.resume().catch(() => {})
  state.status = 'playing'
  timer = setInterval(schedule, TICK_MS)
  frame = requestAnimationFrame(updatePosition)
}
/** Vai para o ponto (segundos dentro da música) e continua tocando. */
export async function seekVgm(seconds) {
  if (!vgm || !context || !['playing', 'paused'].includes(state.status)) return
  if (context.state === 'suspended') await context.resume().catch(() => {})
  startAt(Math.max(0, Math.min(vgm.samples - 1, Math.round(seconds * VGM_SAMPLE_RATE))))
}
export function stopVgm() {
  request++
  stopTimers()
  if (node) node.port.postMessage({ chip: 0, clear: true })
  if (context?.state === 'suspended') context.resume().catch(() => {})
  vgm = null; cursor = null
  Object.assign(state, { status: 'idle', key: '', name: '', tags: {}, error: '', position: 0, duration: 0, loopStart: 0, looped: false })
}
/** Para só se quem toca for a origem informada (uma tela fechando não cala a música de outra). */
export function stopVgmIf(key) { if (state.key === key) stopVgm() }
function stop() { stopVgm() }

export function setVgmVolume(value) {
  state.volume = Math.max(0, Math.min(1, Number(value) || 0))
  if (gain) gain.gain.value = state.volume
  try { localStorage.setItem(VOLUME_KEY, String(state.volume)) } catch { /* preferência opcional */ }
}

/** Lê um .vgm/.vgz do projeto pela prévia de arquivos (confinada ao projeto). */
export async function projectVgm(projectPath, assetPath) {
  const result = await window.retroStudio?.retro?.getAssetPreview?.(projectPath, assetPath)
  if (!result?.success || !result.preview) throw new Error(result?.error || 'Não foi possível ler o VGM.')
  return new Uint8Array(await (await fetch(result.preview)).arrayBuffer())
}
