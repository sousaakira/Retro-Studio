// #89: síntese do compositor sem navegador — afinação do YM2612 e do PSG, envelopes, vozes e o banco
// de instrumentos prontos. Se SMOKE_WAV_DIR estiver definido, grava uma prévia de cada instrumento.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Ym2612 } from '../shared/retro/ym2612.js'
import { Sn76489 } from '../shared/retro/sn76489.js'
import { createChipDriver, fmPitch, psgPeriod } from '../shared/retro/chipDriver.js'
import { PRESET_INSTRUMENTS, INSTRUMENT_CATEGORIES, validateInstrument, fmPatchWrites, velocityAttenuation } from '../shared/retro/chipInstruments.js'

const RATE = 48000
function render(driver, seconds, { fm = new Ym2612(), psg = new Sn76489(), events = [] } = {}) {
  const out = new Float32Array(Math.round(seconds * RATE)), ratio = fm.sampleRate / RATE, frame = RATE / 60
  let position = 0, nextFrame = 0
  const apply = () => { for (const w of driver.take()) w[0] === 0 ? fm.write(w[1], w[2], w[3]) : psg.write(w[1]) }
  for (let index = 0; index < out.length; index++) {
    for (const event of events) if (event.at === index) event.run(driver)
    if (index >= nextFrame) { driver.tick(); nextFrame += frame }
    apply()
    position += ratio
    while (position >= 1) { position -= 1; fm.step() }
    out[index] = (fm.left + fm.right) / 2 * .22 + psg.sample(RATE) * .2
  }
  return out
}
// Frequência por cruzamentos de zero na janela [from, to) segundos.
function pitch(samples, from, to) {
  let crossings = 0, first = -1, last = -1
  for (let index = Math.round(from * RATE) + 1; index < Math.round(to * RATE); index++) {
    if (samples[index - 1] < 0 && samples[index] >= 0) { crossings++; if (first < 0) first = index; last = index }
  }
  return (crossings - 1) / ((last - first) / RATE)
}
const rms = (samples, from, to) => { let sum = 0, n = 0; for (let index = Math.round(from * RATE); index < Math.round(to * RATE); index++) { sum += samples[index] ** 2; n++ } return Math.sqrt(sum / n) }
const cents = (a, b) => 1200 * Math.log2(a / b)

// Seno puro: algoritmo 7 com só o S1 soando.
const sine = validateInstrument({ id: 'teste-seno', name: 'Seno', kind: 'fm', alg: 7, fb: 0, ams: 0, pms: 0,
  ops: [0, 1, 2, 3].map(index => ({ ar: 31, d1r: 0, d2r: 0, rr: 15, sl: 0, tl: index ? 127 : 0, ks: 0, mul: 1, dt: 0, am: 0, ssg: 0 })) })

for (const note of [45, 57, 69, 81]) {
  const driver = createChipDriver()
  driver.noteOn(sine, note, 127)
  const samples = render(driver, .5)
  const expected = 440 * 2 ** ((note - 69) / 12)
  assert.ok(Math.abs(cents(pitch(samples, .1, .5), expected)) < 6, 'FM note ' + note + ' in tune: ' + pitch(samples, .1, .5).toFixed(2) + ' Hz')
}
assert.deepEqual(fmPitch(69), { block: 4, fnum: 1083 }, 'A4 lands in block 4 like a Mega Drive driver')
assert.ok(fmPitch(60).fnum >= 600 && fmPitch(71).fnum < 1300)

// Key off: release leva ao silêncio; velocity menor = mais baixo.
{
  const driver = createChipDriver()
  const samples = render(driver, 1, { events: [{ at: 0, run: d => d.noteOn(sine, 69, 127) }, { at: RATE / 2, run: d => d.noteOff(69) }] })
  assert.ok(rms(samples, .2, .45) > .1, 'note sounds')
  assert.ok(rms(samples, .8, 1) < 1e-4, 'release reaches silence')
  const soft = createChipDriver(); soft.noteOn(sine, 69, 40)
  assert.ok(rms(render(soft, .4), .2, .4) < rms(samples, .2, .45) * .5, 'velocity 40 is at least 6 dB softer')
  assert.equal(velocityAttenuation(127), 0)
  assert.ok(velocityAttenuation(64) >= 5 && velocityAttenuation(64) <= 7)
}

// Pitch bend de +2 semitons.
{
  const driver = createChipDriver()
  driver.noteOn(sine, 69, 127); driver.pitchBend(2)
  assert.ok(Math.abs(cents(pitch(render(driver, .5), .1, .5), 440 * 2 ** (2 / 12))) < 6)
}

// PSG: período e afinação de A4, envelope volta a 15 (mudo) depois do release.
{
  assert.equal(psgPeriod(69), 254)
  assert.ok(psgPeriod(30) <= 1023, 'notes below the PSG range move up an octave')
  const square = PRESET_INSTRUMENTS.find(item => item.id === 'psg-quadrada')
  const driver = createChipDriver(), psg = new Sn76489()
  const samples = render(driver, 1, { psg, events: [{ at: 0, run: d => d.noteOn(square, 69, 127) }, { at: RATE / 2, run: d => d.noteOff(69) }] })
  assert.ok(Math.abs(cents(pitch(samples, .1, .45), 440)) < 8, 'PSG A4: ' + pitch(samples, .1, .45).toFixed(2))
  assert.equal(psg.volume[0], 15, 'released PSG voice is muted')
  assert.ok(rms(samples, .9, 1) < 1e-3)
}

// Vozes: 6 notas FM simultâneas ocupam os 6 canais; a 7ª rouba a mais antiga.
{
  const driver = createChipDriver(), piano = PRESET_INSTRUMENTS.find(item => item.id === 'piano-eletrico')
  for (let note = 60; note < 66; note++) driver.noteOn(piano, note, 100)
  assert.deepEqual(driver.voices().fm.map(voice => voice.note), [60, 61, 62, 63, 64, 65])
  driver.noteOn(piano, 70, 100)
  assert.deepEqual(driver.voices().fm.map(voice => voice.note), [70, 61, 62, 63, 64, 65])
  driver.noteOff(61); driver.noteOn(piano, 72, 100)
  assert.equal(driver.voices().fm[1].note, 72, 'a released channel is reused first')
  const writes = driver.take()
  assert.equal(writes.filter(w => w[0] === 0 && w[2] >= 0x30 && w[2] <= 0x32).length, 6, 'patch loaded once per channel; a steal with the same patch does not reload it')
  // PSG: 3 tons; ruído no canal 4.
  const tone = PRESET_INSTRUMENTS.find(item => item.id === 'psg-pluck'), hat = PRESET_INSTRUMENTS.find(item => item.id === 'chimbal')
  for (const note of [60, 64, 67]) driver.noteOn(tone, note, 100)
  driver.noteOn(hat, 42, 100)
  const voices = driver.voices()
  assert.deepEqual(voices.psg.map(voice => voice.note), [60, 64, 67])
  assert.equal(voices.noise.note, 42)
  driver.allNotesOff()
  assert.ok(driver.voices().fm.every(voice => !voice.held))
}

// Patch → registradores: S2 fica no deslocamento +8, S3 no +4 (ordem do YM2612).
{
  const writes = fmPatchWrites(4, PRESET_INSTRUMENTS[0])
  assert.ok(writes.every(w => w[0] === 1), 'channel 5 is on port 1')
  const tl = writes.filter(w => (w[1] & 0xf0) === 0x40).map(w => [w[1], w[2]])
  assert.deepEqual(tl, [[0x41, 45], [0x49, 16], [0x45, 30], [0x4d, 12]], 'carriers S2/S4 come trimmed by 6 dB (two carriers)')
}

// Banco: IDs únicos, categorias conhecidas, cada instrumento soa e silencia.
{
  assert.equal(new Set(PRESET_INSTRUMENTS.map(item => item.id)).size, PRESET_INSTRUMENTS.length)
  assert.ok(PRESET_INSTRUMENTS.length >= 20)
  for (const category of INSTRUMENT_CATEGORIES) assert.ok(PRESET_INSTRUMENTS.some(item => item.category === category), 'category ' + category)
  const folder = process.env.SMOKE_WAV_DIR
  for (const instrument of PRESET_INSTRUMENTS) {
    const note = instrument.category === 'Baixos' ? 40 : instrument.category === 'Percussão' ? 45 : 64
    const driver = createChipDriver()
    const samples = render(driver, 5, { events: [{ at: 0, run: d => d.noteOn(instrument, note, 110) }, { at: RATE, run: d => d.noteOff(note) }] })
    let peak = 0; for (const value of samples) peak = Math.max(peak, Math.abs(value))
    assert.ok(peak > .02, instrument.id + ' sounds (peak ' + peak.toFixed(3) + ')')
    assert.ok(peak < 1, instrument.id + ' does not clip (peak ' + peak.toFixed(3) + ')')
    assert.ok(rms(samples, 4.6, 5) < 2e-3, instrument.id + ' is silent within 3.5 s of the release')
    if (folder) writeWav(path.join(folder, instrument.id + '.wav'), samples)
  }
  assert.throws(() => validateInstrument({ ...sine, alg: 8 }), /alg/)
  assert.throws(() => validateInstrument({ ...sine, ops: sine.ops.slice(0, 3) }), /4 operators/)
  assert.throws(() => validateInstrument({ id: 'x', name: 'x', kind: 'noise', mode: 'pink', rate: 0, envelope: { volume: 0, attack: 0, decay: 0, sustain: 0, release: 0 } }), /noise mode/)
}

function writeWav(file, samples) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((value, index) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), index * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([header, data]))
}
console.log('chip-synth smoke passed: FM/PSG tuning, envelopes, velocity, bend, voices, register layout and ' + PRESET_INSTRUMENTS.length + ' presets.')
