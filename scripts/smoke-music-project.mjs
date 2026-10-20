// #89: músicas no projeto — salvar, listar, abrir, exportar VGM e registrar no catálogo de áudio,
// sem sobrescrever VGM alheio nem uma música alterada fora do editor.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listSongs, loadSong, saveSong, songVgmPath } from '../electron/retro/musicProject.js'
import { audioConfigurationStatus, validateAudioForBuild } from '../electron/retro/audioConfiguration.js'
import { createSong } from '../shared/retro/song.js'
import { readVgm } from '../shared/retro/vgm.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-music-'))
try {
  const song = createSong({ id: 'tema_floresta', name: 'Tema da floresta' })
  song.tracks[0].notes.push({ t: 0, d: 48, n: 60, v: 100 }, { t: 48, d: 48, n: 64, v: 100 })
  assert.deepEqual(listSongs(root), [])

  // Música nova: só a fonte.
  const first = saveSong(root, { song })
  assert.equal(first.vgm, null)
  assert.ok(fs.existsSync(path.join(root, 'music/tema_floresta.song.json')))
  assert.ok(!fs.existsSync(path.join(root, songVgmPath('tema_floresta'))))
  assert.deepEqual(listSongs(root), [{ id: 'tema_floresta', name: 'Tema da floresta', exported: false }])
  assert.throws(() => saveSong(root, { song }), /Já existe uma música/, 'a new song cannot take an existing ID')

  // Abrir e salvar com a revisão; revisão velha é recusada.
  const opened = loadSong(root, 'tema_floresta')
  assert.equal(opened.revision, first.revision)
  assert.deepEqual(opened.song.tracks[0].notes, song.tracks[0].notes)
  const exported = saveSong(root, { song: opened.song, revision: opened.revision, exportToGame: true })

  // Exportar: VGM válido, registro do compositor e entrada no catálogo de áudio (que o build aceita).
  const vgm = readVgm(fs.readFileSync(path.join(root, 'res/music/tema_floresta.vgm')))
  assert.equal(vgm.samples, exported.vgm.seconds * 60 * 735)
  assert.ok(exported.vgm.loop)
  assert.deepEqual(exported.catalog, { registered: true, added: true })
  const catalog = audioConfigurationStatus(root).config
  assert.deepEqual(catalog.music, [{ id: 'tema_floresta', name: 'Tema da floresta', source: 'res/music/tema_floresta.vgm', preview: '', timing: 'ntsc' }])
  assert.doesNotThrow(() => validateAudioForBuild(root), 'build preflight accepts the exported song')
  assert.equal(listSongs(root)[0].exported, true)

  // Reexportar com outro nome atualiza a mesma entrada; o build continua aceitando o VGM novo.
  const renamed = { ...exported.song, name: 'Floresta (noite)', tempo: 90 }
  const again = saveSong(root, { song: renamed, revision: exported.revision, exportToGame: true })
  assert.deepEqual(again.catalog, { registered: true, added: false })
  assert.equal(audioConfigurationStatus(root).config.music[0].name, 'Floresta (noite)')
  assert.doesNotThrow(() => validateAudioForBuild(root))

  // VGM que não é do compositor nunca é sobrescrito.
  const other = createSong({ id: 'chefe', name: 'Chefe' })
  fs.writeFileSync(path.join(root, 'res/music/chefe.vgm'), 'feito à mão')
  assert.throws(() => saveSong(root, { song: other, exportToGame: true }), /não foi gerado pelo compositor/)
  assert.equal(fs.readFileSync(path.join(root, 'res/music/chefe.vgm'), 'utf8'), 'feito à mão')
  assert.ok(!fs.existsSync(path.join(root, 'music/chefe.song.json')), 'nothing is written when the export is refused')

  // ID já usado no catálogo por outro arquivo: a música e o VGM salvam, o catálogo explica o conflito.
  const status = audioConfigurationStatus(root)
  const config = JSON.parse(JSON.stringify(status.config))
  config.music.push({ id: 'vila', name: 'Vila', source: 'res/music/chefe.vgm', preview: '', timing: 'auto' })
  const { saveAudioConfiguration } = await import('../electron/retro/audioConfiguration.js')
  saveAudioConfiguration(root, { config, revision: status.revision })
  const village = saveSong(root, { song: createSong({ id: 'vila', name: 'Vila nova' }), exportToGame: true })
  assert.equal(village.catalog.registered, false)
  assert.match(village.catalog.error, /já tem a música “vila”/)
  assert.ok(fs.existsSync(path.join(root, 'res/music/vila.vgm')))

  // Editada fora do editor depois de aberta: salvar com a revisão antiga é recusado.
  const file = path.join(root, 'music/tema_floresta.song.json')
  fs.writeFileSync(file, JSON.stringify({ ...again.song, name: 'Editada à mão' }))
  assert.throws(() => saveSong(root, { song: again.song, revision: again.revision }), /mudou no disco/)
  assert.equal(loadSong(root, 'tema_floresta').song.name, 'Editada à mão')

  // Música alterada à mão com erro aparece na lista com o motivo.
  fs.writeFileSync(path.join(root, 'music/quebrada.song.json'), '{"format":"retro-studio.song","version":1}')
  assert.ok(listSongs(root).find(item => item.id === 'quebrada').error)
  assert.throws(() => loadSong(root, '../fora'), /ID de música inválido/)
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('music-project smoke passed: save, list, load, revision, VGM export, catalog registration, build preflight and foreign files.')
