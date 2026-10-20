// #89: música do compositor → linha do tempo → VGM. Valida o modelo, a ordem das escritas, o loop
// e o arquivo. Com o toolkit instalado (XGMTOOL ou ~/.retrostudio/toolkit), converte o VGM em XGM.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createSong, validateSong, normalizeSong, songLength, tickFrame, snapTick, snapLength, SONG_PPQ } from '../shared/retro/song.js'
import { songTimeline } from '../shared/retro/songTimeline.js'
import { writeVgm, readVgm } from '../shared/retro/vgm.js'
import { songInstrument } from '../shared/retro/instrumentFormats.js'
import { PRESET_INSTRUMENTS } from '../shared/retro/chipInstruments.js'

const song = createSong({ id: 'tema_teste', name: 'Tema de teste', tempo: 150 })
song.bars = 2; song.loop = { start: SONG_PPQ * 4, end: songLength(song) }
song.tracks[0].notes = [
  { t: 0, d: 24, n: 60, v: 100 }, { t: 24, d: 24, n: 64, v: 100 }, { t: 48, d: 48, n: 67, v: 90 }, { t: 192, d: 192, n: 72, v: 110 }
]
song.tracks.push({ id: 'baixo', name: 'Baixo', instrument: 'baixo-slap', mute: false, solo: false, notes: [{ t: 0, d: 96, n: 36, v: 120 }, { t: 192, d: 96, n: 36, v: 120 }] })
song.tracks.push({ id: 'bateria', name: 'Bateria', instrument: 'chimbal', mute: true, solo: false, notes: [{ t: 0, d: 6, n: 42, v: 100 }, { t: 24, d: 6, n: 42, v: 100 }] })
validateSong(song)

// Tempo → quadros: 150 BPM, semínima = 0,4 s = 24 quadros.
assert.equal(tickFrame(song, SONG_PPQ), 24)
assert.equal(snapTick(13, 12), 12); assert.equal(snapLength(3, 12), 12); assert.equal(snapLength(30, 12), 36)

const timeline = songTimeline(song)
assert.equal(timeline.end, tickFrame(song, songLength(song)))
assert.equal(timeline.loopFrame, tickFrame(song, SONG_PPQ * 4))
assert.deepEqual(timeline.missing, [])
const keyOns = timeline.frames.flatMap(f => f.writes.filter(w => w[0] === 0 && w[2] === 0x28 && (w[3] & 0xf0)).map(() => f.frame))
assert.deepEqual(keyOns, [0, 0, 12, 24, 96, 96], 'FM key-ons at the note frames (the muted hi-hat track still exports)')
assert.ok(timeline.frames.some(f => f.frame === 0 && f.writes.some(w => w[0] === 1 && (w[1] & 0xf0) === 0xe0)), 'noise track exports when not auditioning')
const audition = songTimeline(song, { audition: true })
assert.ok(!audition.frames.some(f => f.writes.some(w => w[0] === 1 && (w[1] & 0xf0) === 0xe0)), 'muted track is silent when auditioning')
song.tracks[1].solo = true
const solo = songTimeline(song, { audition: true }).frames.flatMap(f => f.writes.filter(w => w[0] === 0 && w[2] === 0x28 && (w[3] & 0xf0)))
assert.equal(solo.length, 2, 'solo leaves only the bass')
song.tracks[1].solo = false

// Loop: o chip é zerado no início do loop (key-off dos 6 canais) e no fim.
const loopWrites = timeline.frames.find(f => f.frame === timeline.loopFrame).writes
assert.ok([0, 1, 2, 4, 5, 6].every(code => loopWrites.some(w => w[2] === 0x28 && w[3] === code)), 'all FM channels keyed off at the loop start')
assert.ok(loopWrites.some(w => w[2] === 0xb0), 'patches reload after the loop point')

// Trecho a partir de um ponto (tocar do meio): quadros relativos e só notas que começam ali.
const part = songTimeline(song, { from: SONG_PPQ * 4, audition: true })
assert.deepEqual(part.frames.flatMap(f => f.writes.filter(w => w[2] === 0x28 && (w[3] & 0xf0)).map(() => f.frame)), [0, 0])

// VGM: cabeçalho, duração, loop, e as mesmas escritas em ordem.
const bytes = writeVgm(timeline, { title: song.name })
const vgm = readVgm(bytes)
assert.equal(vgm.version, 0x150); assert.equal(vgm.ymClock, 7670453); assert.equal(vgm.psgClock, 3579545)
assert.equal(vgm.samples, timeline.end * 735); assert.equal(vgm.duration, vgm.samples)
assert.equal(vgm.loopTime, timeline.loopFrame * 735); assert.equal(vgm.loopSamples, (timeline.end - timeline.loopFrame) * 735)
const expected = timeline.frames.flatMap(f => f.writes.map(w => w[0] === 0 ? { time: f.frame * 735, chip: 'fm', port: w[1], address: w[2], data: w[3] } : { time: f.frame * 735, chip: 'psg', data: w[1] }))
assert.deepEqual(vgm.commands, expected)
assert.ok(Buffer.from(bytes).includes(Buffer.from('Tema de teste', 'utf16le')), 'GD3 title')
// Sem loop: offset zerado.
assert.equal(readVgm(writeVgm(songTimeline({ ...song, loop: null }))).loopOffset, null)

// Modelo: erros claros e normalização depois de encurtar.
assert.throws(() => validateSong({ ...song, id: 'Tema' }), /song ID/)
assert.throws(() => validateSong({ ...song, tempo: 10 }), /tempo/)
assert.throws(() => validateSong({ ...song, tracks: [{ ...song.tracks[0], notes: [{ t: 0, d: 0, n: 60, v: 100 }] }] }), /note length/)
const short = normalizeSong({ ...song, bars: 1 })
assert.ok(short.tracks.every(track => track.notes.every(note => note.t + note.d <= songLength(short))))
assert.equal(short.loop.end, songLength(short))

// Instrumento próprio da música (cópia editada do banco): a faixa usa, a exportação acha e grava o patch editado.
{
  const custom = songInstrument(PRESET_INSTRUMENTS.find(item => item.id === 'baixo-slap'), [])
  custom.ops[3].tl = 0; custom.fb = 7
  const own = { ...createSong({ id: 'proprio' }), instruments: [custom] }
  own.tracks[0].instrument = custom.id
  own.tracks[0].notes = [{ t: 0, d: 48, n: 40, v: 127 }]
  validateSong(own)
  const result = songTimeline(own)
  assert.deepEqual(result.missing, [])
  assert.ok(result.frames[0].writes.some(w => w[0] === 0 && w[2] === 0xb0 && w[3] === ((7 << 3) | custom.alg)), 'edited feedback reaches the registers')
  assert.throws(() => validateSong({ ...own, instruments: [custom, custom] }), /Duplicate instrument/)
  assert.throws(() => validateSong({ ...own, instruments: [{ ...custom, id: 'orgao' }] }), /same as a preset/)
  assert.deepEqual(songTimeline({ ...own, instruments: [] }).missing, [custom.id], 'a missing instrument is reported, not silently replaced')
}

// Conversão real para XGM, quando o toolkit existe.
const xgmtool = process.env.XGMTOOL || path.join(os.homedir(), '.retrostudio/toolkit/sgdk/m68k-elf/bin/xgmtool')
if (fs.existsSync(xgmtool)) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-song-'))
  try {
    fs.writeFileSync(path.join(folder, 'tema.vgm'), bytes)
    const run = spawnSync(xgmtool, [path.join(folder, 'tema.vgm'), path.join(folder, 'tema.xgm')], { encoding: 'utf8', timeout: 30000 })
    assert.equal(run.status, 0, 'xgmtool converts the VGM: ' + run.stdout + run.stderr)
    const xgm = fs.readFileSync(path.join(folder, 'tema.xgm'))
    assert.equal(xgm.toString('latin1', 0, 4), 'XGM ', 'XGM header')
    console.log('xgmtool: ' + xgm.length + ' bytes de XGM')
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
} else console.log('xgmtool ausente: conversão XGM não testada')
console.log('song-export smoke passed: model, timeline order, mute/solo, loop reset, partial playback and VGM layout.')
