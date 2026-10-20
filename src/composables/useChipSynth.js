// #89: som do compositor — o teclado MIDI (ou o mouse/teclado do computador) toca o instrumento
// escolhido no YM2612/PSG emulados num AudioWorklet. O driver compartilhado gera as escritas de
// registrador; a mesma lógica servirá à gravação e ao VGM.
import { reactive, readonly } from 'vue'
import workletUrl from '../audio/chipWorklet.js?worker&url'
import { createChipDriver } from '../../shared/retro/chipDriver.js'
import { PRESET_INSTRUMENTS } from '../../shared/retro/chipInstruments.js'
import { onMidiEvent } from './useMidiInput.js'
import { DRUM_CHANNEL } from '../../shared/retro/drumPads.js'

const STORAGE_KEY = 'retro-studio.synth'
const BEND_RANGE = 2
const load = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch (_) { return {} } }
const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ instrument: state.instrument, octave: state.octave, volume: state.volume })) } catch (_) {} }
const stored = load()

const state = reactive({
  status: 'off',        // 'off' | 'starting' | 'on' | 'error'
  error: '',
  instrument: PRESET_INSTRUMENTS.some(item => item.id === stored.instrument) ? stored.instrument : PRESET_INSTRUMENTS[0].id,
  octave: Number.isInteger(stored.octave) && Math.abs(stored.octave) <= 3 ? stored.octave : 0,
  volume: typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1 ? stored.volume : .8,
  active: new Array(6).fill(false),   // canais FM com envelope soando no teclado ao vivo (vem do worklet)
  songActive: new Array(6).fill(false), // idem, na música tocando
  voices: null                          // ocupação do driver: fm[6], psg[3], noise
})
const driver = createChipDriver()
const playing = new Map()   // nota tocada → nota soando (com oitava), para soltar a certa
let context = null, node = null, gain = null, timer = 0, starting = null, stopMidi = null

// Instrumentos da música aberta (importados/editados) valem antes do banco pronto.
let songInstruments = []
const instrumentById = id => songInstruments.find(item => item.id === id) || PRESET_INSTRUMENTS.find(item => item.id === id)
/** Instrumentos próprios da música; a próxima nota recarrega os patches (podem ter sido editados). */
export function setSongInstruments(list) {
  songInstruments = Array.isArray(list) ? list : []
  for (const item of songInstruments) driver.invalidate(item.id)
}

function flush() {
  const writes = driver.take()
  if (writes.length && node) node.port.postMessage({ chip: 1, writes })
  state.voices = driver.voices()
}

/** Liga o áudio (idempotente). O Electron permite tocar sem gesto; se o sistema suspender, um clique retoma. */
export function startSynth() {
  if (state.status === 'on') return Promise.resolve(true)
  if (starting) return starting
  state.status = 'starting'; state.error = ''
  starting = (async () => {
    try {
      context = new AudioContext({ latencyHint: 'interactive' })
      await context.audioWorklet.addModule(workletUrl)
      node = new AudioWorkletNode(context, 'retro-chip', { numberOfInputs: 0, outputChannelCount: [2] })
      node.port.onmessage = ({ data }) => { if (data?.live) { state.active = data.live; state.songActive = data.song } }
      // Chip novo, zerado: o driver volta a carregar os patches na próxima nota.
      driver.allNotesOff(); driver.invalidate()
      gain = context.createGain(); gain.gain.value = state.volume
      node.connect(gain).connect(context.destination)
      if (context.state === 'suspended') await context.resume().catch(() => {})
      timer = setInterval(() => { driver.tick(); flush() }, 1000 / 60)
      stopMidi ||= onMidiEvent(onMidi)
      flush()
      state.status = 'on'
      return true
    } catch (error) {
      state.status = 'error'; state.error = 'Não foi possível ligar o som: ' + (error?.message || error)
      stopSynth()
      return false
    } finally { starting = null }
  })()
  return starting
}

export function stopSynth() {
  clearInterval(timer); timer = 0
  stopMidi?.(); stopMidi = null
  try { node?.disconnect() } catch (_) {}
  context?.close().catch(() => {})
  context = node = gain = null
  playing.clear()
  if (state.status !== 'error') state.status = 'off'
}

// key: o que foi apertado (nota MIDI, ou 'preview'); sounding: a nota que soa, já com a oitava.
function play(key, sounding, velocity) {
  if (context?.state === 'suspended') void context.resume()
  if (playing.has(key)) driver.noteOff(playing.get(key))
  playing.set(key, sounding)
  driver.noteOn(instrumentById(state.instrument) || PRESET_INSTRUMENTS[0], sounding, velocity)
  flush()
}
const transpose = note => Math.max(0, Math.min(127, note + state.octave * 12))
export function noteOn(note, velocity = 100) {
  if (state.status === 'on') play(note, transpose(note), velocity)
  else void startSynth().then(ok => { if (ok) play(note, transpose(note), velocity) })
}
export function noteOff(key) {
  if (!playing.has(key)) return
  driver.noteOff(playing.get(key)); playing.delete(key)
  flush()
}
export function allNotesOff() { playing.clear(); padPlaying.clear(); driver.allNotesOff(); driver.pitchBend(0); driver.modulation(0); flush() }

function onMidi(event) {
  // Canal 10 são os pads: quem toca é o useDrumPads (bateria) ou viram atalhos (controles).
  if (event.channel === DRUM_CHANNEL && (event.type === 'note-on' || event.type === 'note-off')) return
  if (event.type === 'note-on') noteOn(event.note, event.velocity)
  else if (event.type === 'note-off') noteOff(event.note)
  else if (event.type === 'pitch-bend') { driver.pitchBend(event.value / 8192 * BEND_RANGE); flush() }
  else if (event.type === 'control-change') {
    // Roda de modulação: CC1 por padrão, ou o controle aprendido.
    if (event.actions?.includes('modulation') || (event.controller === 1 && !event.actions?.length)) { driver.modulation(event.value / 127); flush() }
    if (event.actions?.includes('volume')) setVolume(event.value / 127)
    // CC 123 (all notes off) e 120 (all sound off), que alguns teclados mandam no botão de pânico.
    if (event.controller === 123 || event.controller === 120) allNotesOff()
  }
}

export function setInstrument(id) {
  if (!instrumentById(id)) return
  state.instrument = id; save()
}
export function setOctave(value) {
  allNotesOff()
  state.octave = Math.max(-3, Math.min(3, value)); save()
}
export function setVolume(value) {
  state.volume = Math.max(0, Math.min(1, value)); save()
  if (gain && context) gain.gain.setTargetAtTime(state.volume, context.currentTime, .02)
}
let previewTimer = 0

// ---- Pads (bateria): instrumento e nota fixos por pad, voz com dono próprio ----
const padPlaying = new Map()
/** Toca o instrumento `id` na nota exata (sem a oitava do teclado); `key` identifica o pad. */
export function playWith(key, id, note, velocity = 100) {
  const instrument = instrumentById(id)
  if (state.status !== 'on' || !instrument) return false
  if (context?.state === 'suspended') void context.resume()
  if (padPlaying.has(key)) driver.noteOff(padPlaying.get(key), key)
  padPlaying.set(key, note)
  driver.noteOn(instrument, note, velocity, key)
  flush()
  return true
}
export function stopWith(key) {
  if (!padPlaying.has(key)) return
  driver.noteOff(padPlaying.get(key), key); padPlaying.delete(key)
  flush()
}
/** Toca uma nota curta para ouvir o instrumento ao escolher (sem soltar teclas que o usuário segura). */
export async function previewInstrument(id, note = 60) {
  setInstrument(id)
  if (state.status !== 'on' && !(await startSynth())) return
  const instrument = instrumentById(id)
  if (!instrument) return
  const pitch = instrument.category === 'Baixos' ? note - 12 : instrument.category === 'Percussão' && instrument.kind === 'fm' ? note - 24 : note
  clearTimeout(previewTimer)
  play('preview', transpose(pitch), 100)
  previewTimer = setTimeout(() => noteOff('preview'), 450)
}

// ---- Música (chip 0): escritas agendadas no relógio do AudioContext ----

/** Relógio do áudio e o atraso até a saída (para alinhar a gravação com o que se ouve). */
export function audioClock() {
  if (!context) return null
  return { now: context.currentTime, latency: (context.outputLatency || 0) + (context.baseLatency || 0) }
}
export function scheduleSong(writes, at) {
  if (node && writes.length) node.port.postMessage({ chip: 0, at, writes })
}
export function clearSong() { node?.port.postMessage({ chip: 0, clear: true }) }
/** Clique do metrônomo (fora do chip, não vai para o VGM). */
export function metronomeClick(at, accent) {
  if (!context || !gain) return
  const osc = context.createOscillator(), env = context.createGain()
  osc.frequency.value = accent ? 1760 : 1175
  env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(accent ? .35 : .22, at + .002); env.gain.exponentialRampToValueAtTime(.0001, at + .05)
  osc.connect(env).connect(gain); osc.start(at); osc.stop(at + .06)
}

/** Toca um instrumento que ainda não está na música (prévia da biblioteca online). */
export async function previewPatch(instrument, note = 60) {
  if (!instrument || (state.status !== 'on' && !(await startSynth()))) return
  clearTimeout(previewTimer)
  if (playing.has('preview')) driver.noteOff(playing.get('preview'))
  driver.invalidate('__preview')
  const sounding = transpose(note)
  playing.set('preview', sounding)
  driver.noteOn({ ...instrument, id: '__preview' }, sounding, 100)
  flush()
  previewTimer = setTimeout(() => noteOff('preview'), 600)
}

export function useChipSynth() {
  return {
    synth: readonly(state), instruments: PRESET_INSTRUMENTS,
    startSynth, stopSynth, noteOn, noteOff, allNotesOff, setInstrument, setOctave, setVolume, previewInstrument,
    audioClock, scheduleSong, clearSong, metronomeClick, setSongInstruments, previewPatch, playWith, stopWith
  }
}
