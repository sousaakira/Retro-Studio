import { ref, computed } from 'vue'
import { AUTOTILE_FORMAT, validateAutotile, generateAutotiles, nineSliceRules, autotilePlacement } from '../utils/retro/autotileRules.js'
import { toPortablePath, samePortablePath } from '../../shared/retro/portablePath.js'

const clone = value => JSON.parse(JSON.stringify(value))
export function useAutotileAuthoring(state) {
  const open = ref(false), busy = ref(false), error = ref(''), filePath = ref(''), saved = ref('')
  const tilesetId = ref(''), selectedRule = ref(0), chosenTile = ref(0), showOnMap = ref(false)
  const originX = ref(0), originY = ref(0), layer = ref('bg'), draft = ref(null)
  let fileRevision = null
  const tileset = computed(() => state.userTilesets.value.find(ts => ts.id === tilesetId.value))
  const validation = computed(() => {
    if (!draft.value || !tileset.value) return 'missingTileset'
    try { validateAutotile(draft.value, tileset.value.tilecount); return '' } catch (cause) { return cause.message }
  })
  const output = computed(() => validation.value ? { tiles: [], ruleIndices: [], occupied: 0, unmatched: 0 } : generateAutotiles(draft.value))
  const placement = computed(() => {
    if (validation.value) return { cells: [], replaced: 0, error: validation.value }
    try {
      return { ...autotilePlacement(draft.value, output.value, tileset.value, {
        width: state.mapWidth.value, height: state.mapHeight.value, x: originX.value, y: originY.value,
        current: layer.value === 'fg' ? state.tiles2.value : state.tiles.value
      }), error: '' }
    } catch (cause) { return { cells: [], replaced: 0, error: cause.message } }
  })
  const preview = computed(() => open.value && showOnMap.value && !placement.value.error ? { ...placement.value, tileset: tileset.value } : null)
  const dirty = computed(() => !!draft.value && JSON.stringify(serializable()) !== saved.value)
  function serializable() {
    return { ...clone(draft.value), source: { path: toPortablePath(state.projectPath, tileset.value?.path || ''), name: tileset.value?.name || '' }, layer: layer.value }
  }
  function start() {
    if (state.loadingMap.value || state.saving.value || state.workspaceLeaving.value || !state.userTilesets.value.length) return
    if (!draft.value) {
      const ts = state.selectedTileset.value || state.userTilesets.value[0]
      tilesetId.value = ts.id; chosenTile.value = state.selectedTileRegion.value?.idx || 0
      const width = Math.min(16, state.mapWidth.value), height = Math.min(10, state.mapHeight.value)
      draft.value = { format: AUTOTILE_FORMAT, version: 1, tileSize: 8, name: 'Autotile', width, height,
        mask: Array.from({ length: width * height }, (_, i) => { const x = i % width, y = Math.floor(i / width); return +(x > 0 && x < width - 1 && y > 0 && y < height - 1) }),
        rules: [{ name: 'Base', tile: chosenTile.value, pattern: [-1,-1,-1,-1,1,-1,-1,-1,-1], enabled: true }] }
    }
    layer.value = state.activeLayer.value === 'fg' ? 'fg' : 'bg'
    const selection = state.selection.value
    originX.value = selection ? Math.min(selection.x1, selection.x2) : 0
    originY.value = selection ? Math.min(selection.y1, selection.y2) : 0
    showOnMap.value = false; error.value = ''; open.value = true
  }
  function close() { if (!busy.value) { open.value = false; showOnMap.value = false } }
  function resize(width, height) {
    width = Math.max(1, Math.min(64, Math.round(Number(width) || 1)))
    height = Math.max(1, Math.min(64, Math.round(Number(height) || 1)))
    const previous = draft.value
    const mask = Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width)
      return x < previous.width && y < previous.height ? previous.mask[y * previous.width + x] : 0
    })
    draft.value = { ...previous, width, height, mask }
  }
  function preset(free = false) {
    try {
      if (!tileset.value) throw new Error('missingTileset')
      draft.value.rules = free
        ? nineSliceRules(0, 3, 9).map(rule => ({ ...rule, tile: chosenTile.value }))
        : nineSliceRules(chosenTile.value, tileset.value.columns, tileset.value.tilecount)
      draft.value.rules.push({ name: 'Base', tile: free ? chosenTile.value : chosenTile.value + tileset.value.columns + 1, pattern: [-1,-1,-1,-1,1,-1,-1,-1,-1], enabled: true })
      selectedRule.value = 0; error.value = ''
    } catch (cause) { error.value = cause.message }
  }
  function addRule() {
    if (draft.value.rules.length >= 256) return
    draft.value.rules.unshift({ name: `Regra ${draft.value.rules.length + 1}`, tile: chosenTile.value, pattern: [-1,-1,-1,-1,1,-1,-1,-1,-1], enabled: true })
    selectedRule.value = 0
  }
  function apply() {
    if (busy.value || state.loadingMap.value || state.saving.value || state.workspaceLeaving.value || placement.value.error || !placement.value.cells.length) return false
    // Resolve every destination before mutation. Empty shape cells preserve existing art.
    const cells = placement.value.cells
    state.ensureTiles(); state.pushState()
    const values = [...(layer.value === 'fg' ? state.tiles2.value : state.tiles.value)]
    const attrs = layer.value === 'fg' ? [state.flipHMap2, state.flipVMap2] : [state.flipHMap, state.flipVMap]
    const maps = attrs.map(attr => [...attr.value])
    for (const cell of cells) { values[cell.index] = cell.gid; maps[0][cell.index] = false; maps[1][cell.index] = false }
    // Palette banks, priority, collisions and objects are kept at each destination.
    if (layer.value === 'fg') state.tiles2.value = values
    else state.tiles.value = values
    attrs[0].value = maps[0]; attrs[1].value = maps[1]
    state.pushState(); close()
    return true
  }
  async function save() {
    if (busy.value || validation.value) return
    busy.value = true; error.value = ''
    try {
      const result = await window.retroStudio.retro.selectSaveFile({ context:'autotile-save', title:'Salvar regras de autotile',
        defaultPath:filePath.value || `${state.projectPath}/autotiles/terrain.autotile.json`, filters:[{name:'Autotile JSON',extensions:['json']}] })
      if (!result?.success || !result.path) return
      const previous = await window.retroStudio.readTextFileOptional(result.path)
      if (previous != null && (result.path !== filePath.value || previous !== fileRevision)) throw new Error('fileConflict')
      const data = serializable(), raw = JSON.stringify(data, null, 2) + '\n'
      await window.retroStudio.writeTextFile(result.path, raw)
      filePath.value = result.path; fileRevision = raw; saved.value = JSON.stringify(data)
    } catch (cause) { error.value = cause.message }
    finally { busy.value = false }
  }
  async function load() {
    if (busy.value) return
    busy.value = true; error.value = ''
    try {
      const result = await window.retroStudio.retro.selectFile({ context:'autotile-open', title:'Abrir regras de autotile', filters:[{name:'Autotile JSON',extensions:['json']}] })
      if (!result?.success || !result.path) return
      const raw = await window.retroStudio.readTextFileOptional(result.path)
      if (!raw || raw.length > 1024 * 1024) throw new Error('invalidDocument')
      const data = JSON.parse(raw)
      const ts = state.userTilesets.value.find(item => samePortablePath(state.projectPath, item.path, data.source?.path))
      if (!ts) throw new Error('missingTileset')
      validateAutotile(data, ts.tilecount)
      draft.value = clone(data); tilesetId.value = ts.id; layer.value = data.layer === 'fg' ? 'fg' : 'bg'; selectedRule.value = 0
      filePath.value = result.path; fileRevision = raw; saved.value = JSON.stringify(serializable())
    } catch (cause) { error.value = cause.message }
    finally { busy.value = false }
  }
  return { open, busy, error, filePath, dirty, draft, tilesetId, tileset, selectedRule, chosenTile, originX, originY, layer, showOnMap,
    output, validation, placement, preview, start, close, resize, preset, addRule, apply, save, load }
}
