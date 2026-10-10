import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  validateProjectContract, assessRuntimeSupport, declareProjectContract,
  mapRuntimeRequirements, validateCatalogReferences
} from '../src/utils/retro/projectContract.js'
import { declareRuntimeForProject } from '../electron/retro/projectContractStore.js'

const template = JSON.parse(fs.readFileSync(new URL('../assets/toolkit/examples/sgdk-skeleton/retro-studio.json', import.meta.url), 'utf8'))
assert.equal(validateProjectContract(template).valid, true)
assert.equal(validateProjectContract({}).declared, false)
const legacy = { name: 'Custom game', customField: { untouched: 42 }, mapExport: { script: 'tools/my-exporter.py' } }
const before = JSON.stringify(legacy)
const migrated = declareProjectContract(legacy, template.retroStudio)
assert.equal(JSON.stringify(legacy), before)
assert.deepEqual(migrated.customField, legacy.customField)
assert.equal(migrated.mapExport.script, legacy.mapExport.script)
assert.throws(() => declareProjectContract(migrated, template.retroStudio))
const future = structuredClone(migrated)
future.retroStudio.contractVersion = 2
assert.equal(validateProjectContract(future).valid, false)
assert.deepEqual(assessRuntimeSupport(future, ['map.bg']).unknown, ['map.bg'])
assert.deepEqual(assessRuntimeSupport(legacy, ['map.parallax']).unsupported, [])
assert.deepEqual(assessRuntimeSupport(template, ['map.bg', 'map.parallax']).unsupported, ['map.parallax'])
const malformed = structuredClone(template)
malformed.retroStudio.adapter.capabilities = ['map.bg', 'map.bg', 'made.up']
assert.equal(validateProjectContract(malformed).valid, false)
assert.equal(validateProjectContract(null).valid, false)
assert.equal(validateProjectContract(false).valid, false)
assert.equal(validateProjectContract(0).valid, false)
assert.deepEqual(mapRuntimeRequirements({objects:[{type:'collision_solid'}, {type:'collision_clear'}]}), ['map.collision'])
assert.deepEqual(assessRuntimeSupport(template, ['player.spawn']).unsupported, ['player.spawn'])
assert.equal(validateProjectContract({ retroStudio: null }).valid, false)

assert.deepEqual(mapRuntimeRequirements({
  tiles: [1], tiles2: [2], collision: [31], priority: [true],
  background: { path: 'bg.png' }, parallaxLayers: [{}], musicTrack: 'theme',
  objects: [
    { type: 'player_spawn', visual: { frames: 8 } },
    { type: 'room_exit' }, { type: 'cutscene_trigger' },
    { type: 'enemy', properties: { 'retroStudio.visual': '{"frames":4}' } }
  ]
}), ['audio.music', 'cutscene.trigger', 'map.background', 'map.bg', 'map.collision', 'map.fg',
      'map.parallax', 'map.priority', 'object.animation', 'player.spawn', 'room.transition'])
// A spawn preview must never imply a second object sprite to compile.
assert.deepEqual(mapRuntimeRequirements({ objects: [{ type: 'player_spawn', visual: { frames: 8 } }] }), ['player.spawn'])
assert.equal(validateCatalogReferences({ rooms: [{ id: 'room-a' }] }, [{ kind: 'rooms', id: 'room-a' }]).valid, true)
assert.equal(validateCatalogReferences({ rooms: [{ id: 'a' }, { id: 'a' }] }).valid, false)
assert.equal(validateCatalogReferences({}, [{ kind: 'audio', id: 'missing' }]).valid, false)

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-contract-'))
try {
  const projectFile = path.join(temporary, 'retro-studio.json')
  fs.writeFileSync(projectFile, before)
  const result = declareRuntimeForProject(temporary, template.retroStudio)
  assert.equal(fs.readFileSync(result.backupPath, 'utf8'), before)
  assert.deepEqual(JSON.parse(fs.readFileSync(projectFile, 'utf8')), migrated)
  assert.throws(() => declareRuntimeForProject(temporary, template.retroStudio))
  assert.equal(fs.readdirSync(temporary).filter(name => name.endsWith('.tmp')).length, 0)
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
console.log('Contratos: declaração, legado, capacidades, IDs, referências e migração com backup conferidos.')
