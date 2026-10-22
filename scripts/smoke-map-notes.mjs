// Notas para a IA nos mapas (#93): formato do arquivo, cruzamento com os objetos do TMX,
// comandos map_notes / map_note_update / map_note_image e ligação no editor e no painel IA.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapNotesFile, normalizeMapPath, parseMapNotes, serializeMapNotes, normalizeNote, describeNotes, noteSummary, nextNoteId } from '../shared/retro/mapNotes.js'
import { runControlCommand, findControlCommand } from '../electron/control/commands.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

// Caminhos: só .tmx relativo, sem subir de pasta.
assert.equal(mapNotesFile('res/maps/fase1.tmx'), '.retrostudio/map-notes/res/maps/fase1.tmx.json')
assert.equal(normalizeMapPath('res\\maps\\a.tmx'), 'res/maps/a.tmx')
for (const bad of ['../x.tmx', '/abs/x.tmx', 'C:/x.tmx', 'res/x.png', '', 'a/./../b.tmx']) assert.equal(normalizeMapPath(bad), null, bad)

// Normalização: limites do mapa, tipos conhecidos e texto limitado.
const clamped = normalizeNote({ id: 3, kind: 'x', layer: 'fg', status: 'done', x: 500, y: -4, width: 900, height: 0, text: 'a\r\nb' }, { width: 512, height: 256 })
assert.deepEqual([clamped.kind, clamped.layer, clamped.status, clamped.x, clamped.y, clamped.width, clamped.height, clamped.text], ['problem', 'fg', 'done', 500, 0, 12, 1, 'a\nb'])
assert.equal(normalizeNote({ text: 'x'.repeat(5000) }).text.length, 2000)

// Arquivo: ida e volta, ids repetidos, formato inválido e versão futura.
const saved = serializeMapNotes('res/maps/fase1.tmx', [{ id: 1, x: 64, y: 96, width: 32, height: 16, text: 'gravidade muda na rampa' }, { id: 1, x: 0, y: 0, text: 'água' }])
const parsed = parseMapNotes(saved)
assert.equal(parsed.problem, '')
assert.deepEqual(parsed.notes.map(note => note.id), [1, 2])
assert.equal(nextNoteId(parsed.notes), 3)
assert.match(parseMapNotes('{').problem, /JSON/)
assert.match(parseMapNotes('{"format":"outro","notes":[]}').problem, /formato/)
assert.match(parseMapNotes('{"format":"retro-studio.map-notes","version":9,"notes":[]}').problem, /mais nova/)
assert.deepEqual(parseMapNotes(null), { notes: [], problem: '' })

// Cruzamento com os objetos: só os que tocam a área.
const objects = [{ id: 7, type: 'collision_slope', name: '', x: 72, y: 100, width: 32, height: 16, properties: { leftHeight: '16' } }, { id: 8, type: 'player_spawn', x: 400, y: 0, width: 16, height: 40, properties: {} }]
const described = describeNotes(parsed.notes, { objects })
assert.deepEqual(described[0].tiles, { x1: 8, y1: 12, x2: 11, y2: 13 })
assert.deepEqual(described[0].objects.map(obj => obj.id), [7])
assert.deepEqual(described[0].objects[0].properties, { leftHeight: '16' })
assert.match(noteSummary(parsed.notes[0]), /^#1 problema \[qualquer camada\] px 64,96 32x16 \(tiles 8,12-11,13\): gravidade muda na rampa$/)

// Comandos sobre um projeto temporário (sem janela: o aviso ao editor é opcional).
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'retro-map-notes-')))
try {
  fs.mkdirSync(path.join(workspace, 'res/maps'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'res/maps/fase1.tmx'), `<?xml version="1.0"?>\n<map version="1.10" orientation="orthogonal" width="64" height="32" tilewidth="8" tileheight="8">\n<objectgroup id="5" name="objects">\n<object id="7" name="" type="collision_slope" x="72" y="100" width="32" height="16"><properties><property name="leftHeight" type="float" value="16"/></properties></object>\n</objectgroup>\n</map>\n`)
  const notesFile = path.join(workspace, mapNotesFile('res/maps/fase1.tmx'))
  fs.mkdirSync(path.dirname(notesFile), { recursive: true })
  fs.writeFileSync(notesFile, serializeMapNotes('res/maps/fase1.tmx', [
    { id: 1, kind: 'problem', layer: 'collision', x: 64, y: 96, width: 32, height: 16, text: 'Ao subir a rampa a gravidade muda.' },
    { id: 2, kind: 'task', layer: 'background', status: 'done', x: 0, y: 160, width: 512, height: 48, text: 'Água do fundo: animar.' }
  ]))
  const context = { workspace, webContents: null }

  const open = (await runControlCommand('map_notes', {}, context)).data
  assert.equal(open.maps.length, 1)
  assert.equal(open.maps[0].map, 'res/maps/fase1.tmx')
  assert.deepEqual([open.maps[0].width, open.maps[0].height, open.maps[0].tileSize, open.maps[0].total], [64, 32, 8, 2])
  assert.deepEqual(open.maps[0].notes.map(note => note.id), [1], 'padrão: só as abertas')
  assert.equal(open.maps[0].notes[0].objects[0].type, 'collision_slope')
  const all = (await runControlCommand('map_notes', { map: path.join(workspace, 'res/maps/fase1.tmx'), status: 'all' }, context)).data
  assert.deepEqual(all.maps[0].notes.map(note => note.id), [1, 2], 'caminho absoluto dentro do projeto também vale')
  assert.equal((await runControlCommand('map_notes', { map: 'res/maps/outro.tmx' }, context)).data.maps[0].notes.length, 0)
  await assert.rejects(runControlCommand('map_notes', { map: '../fora.tmx' }, context), /relativo ao projeto/)

  const updated = (await runControlCommand('map_note_update', { map: 'res/maps/fase1.tmx', id: 1, status: 'done', reply: 'Gravidade fixa na rampa.' }, context)).data
  assert.deepEqual([updated.status, updated.reply, updated.editor], ['done', 'Gravidade fixa na rampa.', null])
  const after = parseMapNotes(fs.readFileSync(notesFile, 'utf8')).notes[0]
  assert.deepEqual([after.status, after.reply, after.text, after.x], ['done', 'Gravidade fixa na rampa.', 'Ao subir a rampa a gravidade muda.', 64], 'texto e área do usuário intactos')
  await assert.rejects(runControlCommand('map_note_update', { map: 'res/maps/fase1.tmx', id: 9, status: 'done' }, context), /não existe/)
  await assert.rejects(runControlCommand('map_note_update', { map: 'res/maps/fase1.tmx', id: 1 }, context), /status ou reply/)
  await assert.rejects(runControlCommand('map_note_update', { map: 'res/maps/fase1.tmx', id: 1, status: 'talvez' }, context), /status/)
  await assert.rejects(runControlCommand('map_note_image', { map: 'res/maps/fase1.tmx', id: 1 }, context), /janela da IDE/)
  assert.deepEqual(findControlCommand('map_note_image').agents, ['acp'])
  assert.equal(findControlCommand('map_note_update').kind, 'write')
} finally { fs.rmSync(workspace, { recursive: true, force: true }) }

// Ligação no editor, no estado da IDE e no painel IA.
const state = read('src/composables/useTilemapEditorState.js'), canvas = read('src/components/retro/tilemap/TilemapCanvas.vue')
const sidebar = read('src/components/retro/tilemap/TilemapSidebar.vue'), editor = read('src/components/retro/TilemapEditor.vue')
const app = read('src/App.vue'), panel = read('src/components/AcpAgentPanel.vue'), notesState = read('src/composables/useMapNotes.js')
assert.match(state, /\{ id: 'note', icon: '✱', i18nKey: 'tilemap.toolNote' \}/)
assert.match(state, /mapNotes,\n/)
assert.match(canvas, /if \(tool === 'note'\) \{ startNoteDrag\(e\); return \}/)
assert.match(canvas, /drawNotesOverlay\(ctx, tw/)
assert.match(sidebar, /\{ id: 'notes', label: 'Notas'/)
assert.match(editor, /key === 'n'\) \{ editorState\.selectDrawTool\('note'\)/)
assert.match(editor, /aiMapContext: \(\) => editorState\.mapNotes\.context\(\)/)
assert.match(app, /openMap: \(\(\) =>/)
assert.match(app, /focusMapNote: \(path, id\) =>/)
assert.match(panel, /open notes \(map_notes for details/)
assert.match(notesState, /flush: 'sync'/, 'salvar mapa novo leva as notas da memória')
for (const locale of ['pt-BR', 'en', 'es', 'ja']) assert.ok(JSON.parse(read(`src/locales/${locale}.json`)).tilemap.toolNote, locale)
const exporter = read('assets/toolkit/examples/sgdk-skeleton/tools/export-map.py')
assert.ok(!exporter.includes('map-notes'), 'as notas não passam pelo exportador do jogo')

console.log('Map notes: formato, objetos da área, map_notes/map_note_update/map_note_image e ligação no editor e no painel IA passaram.')
