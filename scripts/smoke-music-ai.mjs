// #89: compor pela IA — formato em tempos e nomes de nota, análise do que o chip toca, e os comandos
// music_guide/list/read/write/open da API de controle (agente interno e MCP) num projeto temporário.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseNote, noteName, songFromAuthoring, songToAuthoring, analyzeSong } from '../shared/retro/songAuthoring.js'
import { controlCommands, runControlCommand, ControlError } from '../electron/control/commands.js'
import { readVgm } from '../shared/retro/vgm.js'
import { PRESET_INSTRUMENTS } from '../shared/retro/chipInstruments.js'

// Notas: C4 = 60, sustenidos e bemóis, número MIDI.
assert.equal(parseNote('C4'), 60); assert.equal(parseNote('A4'), 69); assert.equal(parseNote('F#3'), 54); assert.equal(parseNote('Bb2'), 46); assert.equal(parseNote('C-1'), 0); assert.equal(parseNote(72), 72)
assert.throws(() => parseNote('H2'), /Nota inválida/); assert.equal(parseNote('G9'), 127); assert.throws(() => parseNote('G#9'), /fora do MIDI/)
assert.equal(noteName(61), 'C#4')

// Autoria em tempos → ticks (48 por tempo); compassos e loop automáticos.
const authored = {
  id: 'tema_ia', name: 'Tema da IA', tempo: 140,
  tracks: [
    { name: 'Baixo', instrument: 'baixo-slap', notes: [{ at: 0, len: 0.5, note: 'A1' }, { at: 0.5, len: 0.5, note: 'A2', vel: 90 }] },
    { name: 'Melodia', instrument: 'lead-quadrado', notes: [{ at: 4, len: 1.5, note: 'E5', vel: 110 }] },
    { name: 'Melodia', instrument: 'psg-quadrada', notes: [{ t: 0, d: 48, n: 40, v: 80 }] }
  ]
}
const song = songFromAuthoring(authored)
assert.deepEqual(song.tracks[0].notes, [{ t: 0, d: 24, n: 33, v: 100 }, { t: 24, d: 24, n: 45, v: 90 }])
assert.deepEqual(song.tracks[1].notes, [{ t: 192, d: 72, n: 76, v: 110 }])
assert.equal(song.bars, 2, 'bars cover the last note (beat 5.5 in 4/4)')
assert.deepEqual(song.loop, { start: 0, end: 384 })
assert.deepEqual(song.tracks.map(track => track.id), ['faixa-1', 'faixa-2', 'faixa-3'], 'stable unique track IDs')
assert.deepEqual(songFromAuthoring({ ...authored, loop: { start: 2, end: 2 } }).loop, { start: 192, end: 384 })
assert.equal(songFromAuthoring({ ...authored, loop: false }).loop, null)
// Ida e volta pelo formato de leitura.
assert.deepEqual(songFromAuthoring(songToAuthoring(song)).tracks.map(track => track.notes), song.tracks.map(track => track.notes))
// Erros que dizem onde.
assert.throws(() => songFromAuthoring({ ...authored, tracks: [{ name: 'X', instrument: 'nao-existe', notes: [] }] }), /Instrumento desconhecido na faixa "X"/)
assert.throws(() => songFromAuthoring({ ...authored, tracks: [{ name: 'X', instrument: 'orgao', notes: [{ at: 0, note: 'C4' }] }] }), /faixa 1 \("X"\), nota 1: "len"/)
assert.throws(() => songFromAuthoring({ ...authored, tracks: [{ name: 'X', instrument: 'orgao', notes: [{ at: 0, len: 1, note: 'C4', vel: 200 }] }] }), /"vel"/)
assert.throws(() => songFromAuthoring({ ...authored, loop: { start: 3, end: 5 } }), /Loop inválido/)
assert.throws(() => songFromAuthoring({ ...authored, tracks: [] }), /pelo menos uma faixa/)

// Análise: picos de vozes e avisos (7 notas FM juntas, PSG grave demais, ruídos sobrepostos).
const crowded = songFromAuthoring({ id: 'cheia', name: 'Cheia', tempo: 120, tracks: [
  { name: 'Acorde', instrument: 'orgao', notes: ['C4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5'].map(note => ({ at: 0, len: 4, note })) },
  { name: 'PSG', instrument: 'psg-quadrada', notes: [{ at: 0, len: 1, note: 'C2' }] },
  { name: 'Chimbal', instrument: 'chimbal', notes: [{ at: 0, len: 1, note: 'C4' }] },
  { name: 'Caixa', instrument: 'caixa', notes: [{ at: 0.5, len: 1, note: 'C4' }] }] })
const report = analyzeSong(crowded)
assert.deepEqual(report.voices, { fm: { peak: 7, limit: 6 }, psg: { peak: 1, limit: 3 }, noise: { peak: 2, limit: 1 } })
assert.equal(report.warnings.length, 3)
assert.match(report.warnings.join(' '), /mais de 6 vozes FM/); assert.match(report.warnings.join(' '), /abaixo de A2/); assert.match(report.warnings.join(' '), /canal de ruído só/)
assert.equal(analyzeSong(song).warnings.length, 1, 'only the low PSG note in the first song')
assert.equal(report.seconds, 2)

// Comandos da API de controle: disponíveis para o agente interno e para o MCP.
for (const name of ['music_guide', 'music_list', 'music_read', 'music_write', 'music_open']) {
  const command = controlCommands.find(item => item.name === name)
  assert.ok(command && command.agents.includes('acp') && command.agents.includes('internal'), name)
}
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'retro-music-ai-')))
const rendered = []
const webContents = { isDestroyed: () => false, executeJavaScript: async expression => { rendered.push(expression); return expression.includes('openMusic') ? JSON.stringify({ ok: true, id: 'tema_ia', playing: true }) : JSON.stringify({ open: false }) } }
const context = { workspace, webContents }, deps = { toolkitPath: async () => null }
const run = (name, args) => runControlCommand(name, args, context, deps)
try {
  const guide = (await run('music_guide')).data
  assert.equal(guide.instrumentos.length, PRESET_INSTRUMENTS.length)
  assert.doesNotThrow(() => songFromAuthoring(guide.exemplo), 'the guide example is a valid song')

  const written = (await run('music_write', { song: authored })).data
  assert.equal(written.file, 'music/tema_ia.song.json'); assert.equal(written.vgm, null); assert.ok(written.revision)
  assert.ok(fs.existsSync(path.join(workspace, 'music/tema_ia.song.json')))
  assert.match(rendered.at(-1), /musicChanged\?\.\("tema_ia"\)/, 'the open editor is told to reload')
  assert.deepEqual((await run('music_list')).data.songs, [{ id: 'tema_ia', name: 'Tema da IA', exported: false }])

  const read = (await run('music_read', { id: 'tema_ia' })).data
  assert.equal(read.revision, written.revision)
  assert.deepEqual(read.song.tracks[0].notes[1], { at: 0.5, len: 0.5, note: 'A2', vel: 90 })
  // Edita o que leu e salva com a revisão; também exporta para o jogo.
  read.song.tracks[1].notes.push({ at: 6, len: 2, note: 'G5' })
  const updated = (await run('music_write', { song: read.song, revision: read.revision, exportToGame: true })).data
  assert.equal(updated.catalog.registered, true)
  assert.ok(readVgm(fs.readFileSync(path.join(workspace, 'res/music/tema_ia.vgm'))).samples > 0)
  // Revisão velha (o usuário mudou depois): recusado. Sem revisão por cima de música existente: recusado.
  await assert.rejects(run('music_write', { song: read.song, revision: read.revision }), /mudou no disco/)
  await assert.rejects(run('music_write', { song: authored }), /Já existe uma música/)
  await assert.rejects(run('music_write', { song: { ...authored, id: 'outra', tracks: [{ name: 'X', instrument: 'nada', notes: [] }] } }), error => error instanceof ControlError && /Instrumento desconhecido/.test(error.message))
  await assert.rejects(run('music_write', { song: '{quebrado' }), /objeto JSON/)
  await assert.rejects(run('music_read', { id: '../fora' }), /ID de música inválido/)

  const opened = (await run('music_open', { id: 'tema_ia', play: true })).data
  assert.deepEqual(opened, { ok: true, id: 'tema_ia', playing: true })
  assert.match(rendered.at(-1), /openMusic\?\.\("tema_ia", true\)/)
  await assert.rejects(run('music_open', { id: 'Tema"); alert(1); ("' }), /ID de música inválido/, 'the ID never reaches the page unvalidated')
} finally { fs.rmSync(workspace, { recursive: true, force: true }) }
console.log('music-ai smoke passed: beats authoring, note names, analysis, and music_guide/list/read/write/open commands.')
