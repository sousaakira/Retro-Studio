// #89: pads do teclado MIDI — canal 10, kit padrão que existe e soa, configuração salva estragada volta ao padrão.
import assert from 'node:assert/strict'
import { PAD_COUNT, PAD_ACTIONS, DEFAULT_PAD_NOTES, DRUM_CHANNEL, defaultPadKit, defaultPadSettings, normalizePadSettings, padIndex } from '../shared/retro/drumPads.js'
import { PRESET_INSTRUMENTS } from '../shared/retro/chipInstruments.js'
import { createChipDriver } from '../shared/retro/chipDriver.js'
import { Ym2612 } from '../shared/retro/ym2612.js'
import { Sn76489 } from '../shared/retro/sn76489.js'

// SMK-25: pads mandam notas 36..43 no canal 10 (9 contando do zero) — captura real com aseqdump.
assert.equal(DRUM_CHANNEL, 9)
// Fileira de cima (pads 1-4) = 40-43, de baixo (5-8) = 36-39: a primeira batida no pad 1 mandou 40.
assert.equal(padIndex({ type: 'note-on', channel: 9, note: 40, velocity: 54 }), 0)
assert.equal(padIndex({ type: 'note-on', channel: 9, note: 36, velocity: 51 }), 4)
assert.equal(padIndex({ type: 'note-off', channel: 9, note: 43, velocity: 64 }), 3)
assert.equal(padIndex({ type: 'note-on', channel: 0, note: 36, velocity: 51 }), -1, 'keys on channel 1 are not pads')
assert.equal(padIndex({ type: 'control-change', channel: 9, controller: 36, value: 1 }), -1)
assert.equal(padIndex({ type: 'note-on', channel: 9, note: 50, velocity: 1 }), -1, 'a drum note outside the pads')
assert.equal(padIndex({ type: 'note-on', channel: 9, note: 50, velocity: 1 }, [50, 51, 52, 53, 54, 55, 56, 57]), 0, 'learned pad notes')
assert.equal(PAD_ACTIONS.length, PAD_COUNT)
assert.equal(DEFAULT_PAD_NOTES.length, PAD_COUNT)

// Kit padrão: 8 peças do banco, e cada uma soa e silencia.
const kit = defaultPadKit()
assert.equal(kit.length, PAD_COUNT)
const RATE = 48000
for (const [index, pad] of kit.entries()) {
  const instrument = PRESET_INSTRUMENTS.find(item => item.id === pad.instrument)
  assert.ok(instrument, 'pad ' + (index + 1) + ' uses a preset: ' + pad.instrument)
  const driver = createChipDriver(), fm = new Ym2612(), psg = new Sn76489()
  driver.noteOn(instrument, pad.note, 110, 'pad:' + index)
  let peak = 0, tail = 0, position = 0, nextFrame = 0
  for (let s = 0; s < RATE * 3; s++) {
    if (s === RATE / 10) driver.noteOff(pad.note, 'pad:' + index)
    if (s >= nextFrame) { driver.tick(); nextFrame += RATE / 60 }
    for (const w of driver.take()) w[0] === 0 ? fm.write(w[1], w[2], w[3]) : psg.write(w[1])
    position += fm.sampleRate / RATE; while (position >= 1) { position--; fm.step() }
    const v = (fm.left + fm.right) / 2 * .22 + psg.sample(RATE) * .2
    peak = Math.max(peak, Math.abs(v)); if (s > RATE * 2.8) tail = Math.max(tail, Math.abs(v))
  }
  assert.ok(peak > .02, 'pad ' + (index + 1) + ' sounds')
  assert.ok(tail < .01, 'pad ' + (index + 1) + ' goes silent')
}
// Voz com dono do pad: soltar o pad não solta a mesma nota tocada no teclado.
{
  const driver = createChipDriver(), tom = PRESET_INSTRUMENTS.find(item => item.id === 'tom'), piano = PRESET_INSTRUMENTS.find(item => item.id === 'piano-eletrico')
  driver.noteOn(piano, 50, 100); driver.noteOn(tom, 50, 100, 'pad:4')
  driver.noteOff(50, 'pad:4')
  assert.deepEqual(driver.voices().fm.filter(voice => voice.held).map(voice => voice.instrument), ['piano-eletrico'])
}

// Configuração salva: válida passa; estragada volta ao padrão (por campo).
assert.deepEqual(normalizePadSettings(null), defaultPadSettings())
assert.deepEqual(normalizePadSettings({ mode: 'controls', notes: [50, 51, 52, 53, 54, 55, 56, 57], kit }).mode, 'controls')
assert.deepEqual(normalizePadSettings({ mode: 'outro' }).mode, 'drums')
assert.deepEqual(normalizePadSettings({ notes: [36, 36, 37, 38, 39, 40, 41, 42] }).notes, [...DEFAULT_PAD_NOTES], 'repeated notes are refused')
assert.deepEqual(normalizePadSettings({ notes: [36, 37, 38, 39, 40, 41, 42, 43] }).notes, [40, 41, 42, 43, 36, 37, 38, 39], 'old saved order (rows swapped) is migrated')
assert.deepEqual(normalizePadSettings({ version: 2, notes: [36, 37, 38, 39, 40, 41, 42, 43] }).notes, [36, 37, 38, 39, 40, 41, 42, 43], 'a learned order is kept')
assert.deepEqual(normalizePadSettings({ notes: [36, 37] }).notes, [...DEFAULT_PAD_NOTES])
const broken = normalizePadSettings({ kit: [{ instrument: 'meu-bumbo', note: 30 }, { instrument: '../x', note: 60 }, { instrument: 'caixa', note: 300 }] })
assert.deepEqual(broken.kit.slice(0, 3), [{ instrument: 'meu-bumbo', note: 30 }, kit[1], kit[2]])
console.log('drum-pads smoke passed: channel 10 pads, default kit sounds and stops, pad voices, saved settings.')
