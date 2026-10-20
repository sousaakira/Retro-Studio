// #89: os 8 pads do teclado MIDI (canal 10). Modo Bateria: cada pad toca o seu instrumento/nota e avisa
// a gravação (onPadHit); modo Controles: cada pad chama um atalho registrado pelo compositor. O mouse
// nos pads da tela passa pelo mesmo caminho. Configuração por máquina (localStorage), como o MIDI learn.
import { reactive, readonly } from 'vue'
import { PAD_COUNT, PAD_ACTIONS, defaultPadSettings, normalizePadSettings, padIndex } from '../../shared/retro/drumPads.js'
import { onMidiEvent } from './useMidiInput.js'
import { playWith, stopWith } from './useChipSynth.js'

const STORAGE_KEY = 'retro-studio.pads'
function load() { try { return normalizePadSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')) } catch (_) { return defaultPadSettings() } }
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, mode: state.mode, notes: state.notes, kit: state.kit })) } catch (_) {} }

const state = reactive({ ...load(), lit: {}, learning: -1 })
const hitListeners = new Set()
let actions = null

/** Toque de um pad (MIDI ou mouse). velocity 0 = soltou. */
function hit(index, velocity) {
  if (index < 0 || index >= PAD_COUNT) return
  const on = velocity > 0
  if (on) state.lit[index] = velocity; else delete state.lit[index]
  if (state.mode === 'controls') {
    if (on) actions?.[PAD_ACTIONS[index][0]]?.()
    return
  }
  const pad = state.kit[index]
  if (on) playWith('pad:' + index, pad.instrument, pad.note, velocity); else stopWith('pad:' + index)
  for (const listener of hitListeners) {
    try { listener({ index, on, velocity, instrument: pad.instrument, note: pad.note }) } catch (error) { console.error('[pads] listener', error) }
  }
}

onMidiEvent(event => {
  if (state.learning >= 0 && event.type === 'note-on' && event.channel === 9) {
    // Aprender: os próximos toques definem a nota de cada pad, na ordem 1..8.
    if (!state.notes.slice(0, state.learning).includes(event.note)) {
      state.notes[state.learning] = event.note
      state.learning = state.learning + 1 < PAD_COUNT ? state.learning + 1 : -1
      if (state.learning < 0) {
        const unique = new Set(state.notes)
        if (unique.size !== PAD_COUNT) state.notes = [...defaultPadSettings().notes]
        save()
      }
    }
    return
  }
  const index = padIndex(event, state.notes)
  if (index >= 0) hit(index, event.type === 'note-on' ? event.velocity : 0)
})

export function setPadMode(mode) { state.mode = mode === 'controls' ? 'controls' : 'drums'; state.lit = {}; save() }
export function setPad(index, patch) { Object.assign(state.kit[index], patch); save() }
export function learnPads() { state.learning = 0 }
export function cancelLearn() { state.learning = -1 }
export function resetPads() { const base = defaultPadSettings(); state.notes = base.notes; state.kit = base.kit; state.learning = -1; save() }
export function pressPad(index, velocity = 100) { hit(index, velocity) }
export function releasePad(index) { hit(index, 0) }
/** Atalhos do modo Controles (o compositor registra ao abrir; null ao fechar). */
export function setPadActions(handlers) { actions = handlers }
/** Toques do modo Bateria, para a gravação. Devolve a função que cancela. */
export function onPadHit(listener) { hitListeners.add(listener); return () => hitListeners.delete(listener) }

export function useDrumPads() {
  return { pads: readonly(state), setPadMode, setPad, learnPads, cancelLearn, resetPads, pressPad, releasePad, setPadActions, onPadHit }
}
