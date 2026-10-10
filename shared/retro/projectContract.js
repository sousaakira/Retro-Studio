/**
 * Shared, side-effect-free authoring/runtime contract. Legacy games remain
 * undeclared: possessing a file or runtime source is not proof of integration.
 */
export const PROJECT_CONTRACT_VERSION = 1
export const CAPABILITIES = Object.freeze({
  'map.bg': 'map', 'map.fg': 'map', 'map.background': 'map',
  'map.priority': 'map', 'map.collision': 'map', 'map.parallax': 'map',
  'object.visual': 'object', 'object.animation': 'object',
  'player.spawn': 'room', 'room.transition': 'room',
  'character.animation': 'charset', 'character.physics': 'charset',
  'combat.boxes': 'charset', 'camera.control': 'room',
  'audio.music': 'audio', 'audio.sound': 'audio', 'cutscene.trigger': 'cutscene'
})
export const AUTHORING_FORMATS = Object.freeze({
  map: { format: 'tmx', extensionVersion: 1, units: 'pixels', tileSize: 8 },
  kit: { format: 'map-kit-json', version: 1, regionUnits: 'tiles' },
  charset: { format: 'charset-json', version: 4, regionUnits: 'pixels', timeUnits: 'video-ticks' },
  cutscene: { format: 'retro-studio.cutscene', version: 1, timeUnits: 'video-ticks' },
  scene: { format: 'scene-json', version: 1, units: 'pixels' },
  audio: { format: 'retro-studio.audio', version: 1, reference: 'stable-id' },
  room: { format: 'retro-studio.world', version: 1, units: 'pixels', reference: 'stable-id' },
  camera: { format: 'retro-studio.camera', version: 1, units: 'pixels', timeUnits: 'video-ticks' },
  progress: { format: 'retro-studio.progress', version: 1, reference: 'stable-id' },
  debug: { format: 'retro-studio.debug', version: 1 }
})
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
export function validateProjectContract(config) {
  const diagnostics = []
  if (!object(config)) return { valid: false, declared: false, diagnostics: [{ code: 'invalid-project', path: '', severity: 'error' }] }
  const contract = config.retroStudio
  if (contract === undefined) return { valid: true, declared: false, diagnostics: [] }
  const error = (code, path) => diagnostics.push({ code, path, severity: 'error' })
  if (!object(contract)) return { valid: false, declared: true, diagnostics: [{ code: 'invalid-contract', path: 'retroStudio', severity: 'error' }] }
  if (contract.contractVersion !== PROJECT_CONTRACT_VERSION) error('unsupported-contract-version', 'retroStudio.contractVersion')
  if (!object(contract.target)) error('invalid-target', 'retroStudio.target')
  else {
    if (!['megadrive', '32x'].includes(contract.target.platform)) error('invalid-platform', 'retroStudio.target.platform')
    if (!['sgdk', 'marsdev', 'custom'].includes(contract.target.sdk)) error('invalid-sdk', 'retroStudio.target.sdk')
    if (!['H32', 'H40'].includes(contract.target.videoMode)) error('invalid-video-mode', 'retroStudio.target.videoMode')
    if (!['ntsc', 'pal', 'auto'].includes(contract.target.region)) error('invalid-region', 'retroStudio.target.region')
  }
  if (!object(contract.adapter)) error('invalid-adapter', 'retroStudio.adapter')
  else {
    if (typeof contract.adapter.id !== 'string' || !idPattern.test(contract.adapter.id)) error('invalid-adapter-id', 'retroStudio.adapter.id')
    if (!Number.isInteger(contract.adapter.version) || contract.adapter.version < 1) error('invalid-adapter-version', 'retroStudio.adapter.version')
    if (!Array.isArray(contract.adapter.capabilities)) error('invalid-capabilities', 'retroStudio.adapter.capabilities')
    else {
      const seen = new Set()
      contract.adapter.capabilities.forEach((capability, index) => {
        if (typeof capability !== 'string' || !Object.hasOwn(CAPABILITIES, capability)) error('unknown-capability', `retroStudio.adapter.capabilities[${index}]`)
        else if (seen.has(capability)) error('duplicate-capability', `retroStudio.adapter.capabilities[${index}]`)
        seen.add(capability)
      })
    }
  }
  if (contract.modules !== undefined) {
    if (!Array.isArray(contract.modules)) error('invalid-modules', 'retroStudio.modules')
    else {
      const seen = new Set()
      contract.modules.forEach((module, index) => {
        if (!object(module) || typeof module.id !== 'string' || !idPattern.test(module.id) ||
            !Number.isInteger(module.version) || module.version < 1 || seen.has(module.id))
          error('invalid-module', `retroStudio.modules[${index}]`)
        else seen.add(module.id)
      })
    }
  }
  return { valid: !diagnostics.length, declared: true, diagnostics }
}
export function assessRuntimeSupport(config, requirements = []) {
  const validation = validateProjectContract(config)
  const capabilities = validation.valid && validation.declared ? config.retroStudio.adapter.capabilities : []
  const requested = [...new Set(requirements)]
  return {
    ...validation,
    adapter: validation.valid && validation.declared ? config.retroStudio.adapter.id : null,
    requirements: requested,
    supported: requested.filter(key => capabilities.includes(key)),
    unsupported: validation.valid && validation.declared ? requested.filter(key => !capabilities.includes(key)) : [],
    unknown: !validation.valid || !validation.declared ? requested : []
  }
}
/** Read old documents as-is. This migration is explicit and never mutates input. */
export function declareProjectContract(config, contract) {
  const migrated = structuredClone(config)
  if (migrated.retroStudio !== undefined) throw new Error('Project already has a runtime contract; use a version-specific migration.')
  migrated.retroStudio = structuredClone(contract)
  const validation = validateProjectContract(migrated)
  if (!validation.valid) throw new Error('Invalid runtime contract: ' + validation.diagnostics.map(item => item.path).join(', '))
  return migrated
}
/** Catalog IDs persist across rename/export; file paths and names are not IDs. */
export function validateCatalogReferences(catalogs = {}, references = []) {
  const diagnostics = []
  const ids = new Map()
  for (const [kind, entries] of Object.entries(catalogs)) {
    const set = new Set()
    if (!Array.isArray(entries)) {
      diagnostics.push({ code: 'invalid-catalog', kind }); continue
    }
    entries.forEach((entry, index) => {
      if (!object(entry) || typeof entry.id !== 'string' || !idPattern.test(entry.id) || set.has(entry.id))
        diagnostics.push({ code: 'invalid-or-duplicate-id', kind, index })
      else set.add(entry.id)
    })
    ids.set(kind, set)
  }
  references.forEach((reference, index) => {
    if (!object(reference) || !ids.get(reference.kind)?.has(reference.id))
      diagnostics.push({ code: 'missing-reference', index, kind: reference?.kind, id: reference?.id, source: reference?.source })
  })
  return { valid: !diagnostics.length, diagnostics }
}
export function mapRuntimeRequirements(data = {}) {
  const requirements = new Set()
  if (data.tiles?.some(value => value > 0)) requirements.add('map.bg')
  if (data.tiles2?.some(value => value > 0)) requirements.add('map.fg')
  if (data.priority?.some(Boolean)) requirements.add('map.priority')
  if (data.collision?.some(value => value > 0)) requirements.add('map.collision')
  if (data.background?.path) requirements.add('map.background')
  if (data.parallaxLayers?.length || data.background?.parallaxLayers?.length) requirements.add('map.parallax')
  if (data.musicTrack) requirements.add('audio.music')
  for (const entry of data.objects || []) {
    if (entry.type === 'player_spawn') { requirements.add('player.spawn'); continue }
    if (['collision_solid', 'collision_clear'].includes(entry.type)) requirements.add('map.collision')
    if (entry.type === 'room_exit') requirements.add('room.transition')
    if (entry.type === 'cutscene_trigger') requirements.add('cutscene.trigger')
    let visual = entry.visual || entry.properties?.['retroStudio.visual']
    if (typeof visual === 'string') { try { visual = JSON.parse(visual) } catch { visual = null } }
    if (visual) requirements.add(Number(visual.frames) > 1 ? 'object.animation' : 'object.visual')
  }
  return [...requirements].sort()
}
