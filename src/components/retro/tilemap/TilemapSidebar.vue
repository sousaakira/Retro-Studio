<template>
  <div class="te-sidebar">
    <div class="te-section">
      <div class="te-section-header">
        <label>{{ t('tilemap.tilesets') }}</label>
        <button class="te-btn-add" @click="state.addTileset" :title="t('tilemap.addTileset')">
          <span class="icon-plus"></span> {{ t('tilemap.add') }}
        </button>
      </div>
      <div v-if="!tilesetList.length" class="te-empty-hint">
        <p>{{ t('tilemap.noTilesets') }}</p>
        <p class="te-hint-small">{{ t('tilemap.tilesetHint') }}</p>
      </div>
      <div v-else class="te-tileset-list">
        <div
          v-for="ts in tilesetList"
          :key="ts.id"
          class="te-tileset-item"
          :class="{ active: sv('selectedTilesetId') === ts.id }"
          @click="state.selectTileset(ts)"
        >
          <div class="te-tileset-thumb" v-if="ts.preview">
            <img :src="ts.preview" :alt="ts.name" />
          </div>
          <div class="te-tileset-name" :title="ts.path">{{ ts.name }}</div>
          <button class="te-btn-remove" @click.stop="state.removeTileset(ts)" :title="t('tilemap.remove')">×</button>
        </div>
      </div>
    </div>
    
    <div class="te-section te-palette-section" v-if="activeTileset">
      <div class="te-palette-header">
        <label>{{ t('tilemap.tilePalette') }}</label>
        <button
          class="te-tool-btn te-palette-btn"
          :class="{ active: showPaletteIndices }"
          :title="t('tilemap.showTileNumbers')"
          @click="togglePaletteIndices"
        >
          #
        </button>
      </div>
      <div
        class="te-tileset-preview"
        @mousedown="onTilesetMouseDown"
        @mousemove="onTilesetMouseMove"
        @mouseup="onTilesetMouseUp"
        @mouseleave="onTilesetMouseLeave"
      >
        <div class="te-palette-stage" :style="paletteStageStyle">
          <img
            ref="paletteImg"
            class="te-palette-img"
            :src="activeTileset.preview"
            alt=""
            draggable="false"
            @load="onPaletteImgLoad"
          />
          <div class="te-palette-sel" :style="paletteSelStyle" />
          <div v-if="showPaletteIndices" class="te-palette-indices">
            <span
              v-for="n in paletteTileCount"
              :key="n"
              class="te-palette-idx"
              :style="paletteIndexStyle(n - 1)"
            >{{ (activeTileset.firstgid || 1) + (n - 1) }}</span>
          </div>
        </div>
      </div>
      <div class="te-tile-info">
        <span class="te-tile-num" v-if="selectedRegion?.w === 1 && selectedRegion?.h === 1">{{ t('tilemap.tileWithIndex', { n: selectedRegion.idx + (activeTileset?.firstgid || 1) }) }}</span>
        <span class="te-tile-num" v-else-if="selectedRegion">{{ t('tilemap.regionWithTiles', { w: selectedRegion.w, h: selectedRegion.h, n: selectedRegion.idx + (activeTileset?.firstgid || 1) }) }}</span>
        <span class="te-hint">{{ t('tilemap.hintDragTiles') }}</span>
        <span class="te-hint">{{ t('tilemap.hintRightClickCopy') }}</span>
      </div>
    </div>
    
    <div class="te-section">
      <label>{{ t('tilemap.mapDimensions') }}</label>
      <div class="te-dims">
        <input v-model.number="state.mapWidth.value" type="number" min="8" max="256" step="8" />
        <span>×</span>
        <input v-model.number="state.mapHeight.value" type="number" min="8" max="256" step="8" />
      </div>
    </div>

    <div class="te-section">
      <label>{{ t('tilemap.stamps') }}</label>
      <div class="te-stamp-row">
        <input v-model="state.stampNameDraft.value" class="te-stamp-input" :placeholder="t('tilemap.stampName')" @keyup.enter="state.saveStampFromSelection()" />
        <button class="te-btn-add" type="button" :title="t('tilemap.saveStamp')" @click="state.saveStampFromSelection()">＋</button>
      </div>
      <div v-if="!state.stamps.value.length" class="te-hint-small">{{ t('tilemap.stampsHint') }}</div>
      <div v-else class="te-stamp-list">
        <div v-for="st in state.stamps.value" :key="st.id" class="te-stamp-item">
          <button type="button" class="te-stamp-apply" :title="t('tilemap.applyStamp')" @click="applyStamp(st)">
            {{ st.name }} ({{ st.w }}×{{ st.h }})
          </button>
          <button type="button" class="te-btn-remove" :title="t('tilemap.remove')" @click="state.deleteStamp(st.id)">×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, unref, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  state: {
    type: Object,
    required: true
  }
})

const paletteImg = ref(null)
const imgNatural = ref({ w: 0, h: 0 })

function sv(key) {
  return unref(props.state?.[key])
}

function setSv(key, val) {
  const r = props.state?.[key]
  if (r && typeof r === 'object' && 'value' in r) r.value = val
}

const tilesetList = computed(() => {
  const list = sv('userTilesets')
  return Array.isArray(list) ? list : []
})

const activeTileset = computed(() => {
  const list = tilesetList.value
  const id = sv('selectedTilesetId')
  return list.find((t) => t.id === id) || list[0] || null
})

const selectedRegion = computed(() => sv('selectedTileRegion') || { idx: 0, w: 1, h: 1 })
const showPaletteIndices = computed(() => !!sv('showPaletteIndices'))
const tileSize = computed(() => sv('TILE_SIZE_CONST') || 8)
const paletteZoom = computed(() => sv('PALETTE_ZOOM') || 3)

const paletteCols = computed(() => {
  const w = imgNatural.value.w || 0
  return Math.max(1, Math.floor(w / tileSize.value) || 1)
})

const paletteRows = computed(() => {
  const h = imgNatural.value.h || 0
  return Math.max(1, Math.ceil(h / tileSize.value) || 1)
})

const paletteTileCount = computed(() => paletteCols.value * paletteRows.value)

const paletteStageStyle = computed(() => {
  const z = paletteZoom.value
  const w = (imgNatural.value.w || 0) * z
  const h = (imgNatural.value.h || 0) * z
  return {
    width: w ? `${w}px` : '100%',
    height: h ? `${h}px` : '96px',
    position: 'relative'
  }
})

const paletteSelStyle = computed(() => {
  const region = selectedRegion.value
  const cols = paletteCols.value
  const z = paletteZoom.value
  const ts = tileSize.value
  const tilePx = ts * z
  const tx = region.idx % cols
  const ty = Math.floor(region.idx / cols)
  return {
    left: `${tx * tilePx}px`,
    top: `${ty * tilePx}px`,
    width: `${region.w * tilePx}px`,
    height: `${region.h * tilePx}px`
  }
})

function paletteIndexStyle(i) {
  const cols = paletteCols.value
  const z = paletteZoom.value
  const ts = tileSize.value
  const tilePx = ts * z
  const tx = i % cols
  const ty = Math.floor(i / cols)
  return {
    left: `${tx * tilePx}px`,
    top: `${ty * tilePx}px`,
    width: `${tilePx}px`,
    height: `${tilePx}px`
  }
}

function togglePaletteIndices() {
  setSv('showPaletteIndices', !sv('showPaletteIndices'))
}

function applyStamp(st) {
  setSv('pendingStamp', st)
  props.state.selectDrawTool?.('pencil')
  window.retroStudioToast?.info?.(t('tilemap.stampClickToPlace', { name: st.name }))
}

function onPaletteImgLoad(e) {
  const img = e?.target || paletteImg.value
  if (!img) return
  imgNatural.value = { w: img.naturalWidth || 0, h: img.naturalHeight || 0 }
  const ts = activeTileset.value
  if (ts) {
    // Always sync columns from the real image (fixes wrong TMX/default columns)
    ts.columns = Math.floor(img.naturalWidth / tileSize.value) || 16
    ts.tilecount = ts.columns * Math.ceil(img.naturalHeight / tileSize.value)
    if (!ts._img || ts._img.naturalWidth <= 0) {
      const mapImg = new Image()
      mapImg.onload = () => {
        ts._img = markRaw(mapImg)
        ts.columns = Math.floor(mapImg.naturalWidth / tileSize.value) || 16
        ts.tilecount = ts.columns * Math.ceil(mapImg.naturalHeight / tileSize.value)
      }
      mapImg.src = ts.preview
    }
  }
  setSv('tilesetCanvas', img)
}

watch(activeTileset, async (ts) => {
  if (!ts?.preview) {
    imgNatural.value = { w: 0, h: 0 }
    return
  }
  // Reset until @load fires (or use cached size from _img)
  if (ts._img?.naturalWidth) {
    imgNatural.value = { w: ts._img.naturalWidth, h: ts._img.naturalHeight }
  }
  // Cached images may not fire @load again
  requestAnimationFrame(() => {
    const img = paletteImg.value
    if (img?.complete && img.naturalWidth) onPaletteImgLoad({ target: img })
  })
}, { immediate: true })

const isSelectingTiles = ref(false)
const selectionStart = ref(null)

function getTileCoordFromEvent(e) {
  const stage = e.currentTarget?.querySelector?.('.te-palette-stage') || paletteImg.value?.parentElement
  if (!stage || !imgNatural.value.w) return null
  const rect = stage.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const tilePx = tileSize.value * paletteZoom.value
  const cols = paletteCols.value
  const rows = paletteRows.value
  const tx = Math.floor(x / tilePx)
  const ty = Math.floor(y / tilePx)
  if (tx >= 0 && tx < cols && ty >= 0 && ty < rows) {
    return { x: tx, y: ty, idx: ty * cols + tx, cols }
  }
  return null
}

function onTilesetMouseDown(e) {
  if (e.button !== 0) return
  e.preventDefault()
  const coord = getTileCoordFromEvent(e)
  if (!coord) return
  isSelectingTiles.value = true
  selectionStart.value = coord

  props.state.selectDrawTool?.('pencil')
  setSv('pendingStamp', null)
  setSv('selectedTileRegion', { idx: coord.idx, w: 1, h: 1 })

  const onDocUp = (ev) => {
    if (ev.button !== 0) return
    isSelectingTiles.value = false
    selectionStart.value = null
    document.removeEventListener('mouseup', onDocUp)
  }
  document.addEventListener('mouseup', onDocUp)
}

function onTilesetMouseMove(e) {
  if (!isSelectingTiles.value || !selectionStart.value) return
  const coord = getTileCoordFromEvent(e)
  if (!coord) return

  const start = selectionStart.value
  const end = coord
  const startX = Math.min(start.x, end.x)
  const startY = Math.min(start.y, end.y)
  const endX = Math.max(start.x, end.x)
  const endY = Math.max(start.y, end.y)
  const w = endX - startX + 1
  const h = endY - startY + 1
  const startIdx = startY * start.cols + startX
  setSv('selectedTileRegion', { idx: startIdx, w, h })
}

function onTilesetMouseUp(e) {
  if (e.button !== 0) return
  isSelectingTiles.value = false
  selectionStart.value = null
}

function onTilesetMouseLeave() {
  // keep drag via document mouseup
}
</script>

<style scoped>
.te-tool-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.te-tool-btn:hover { background: rgba(255,255,255,0.08); color: var(--text); }
.te-tool-btn.active { background: var(--accent); color: #fff; }
.te-sidebar {
  width: 240px;
  padding: 12px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--panel);
  overflow-y: auto;
}

.te-section label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
}

.te-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.te-section-header label { margin-bottom: 0; }

.te-btn-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.te-btn-add:hover { opacity: 0.9; }

.te-empty-hint {
  padding: 12px;
  background: rgba(255,255,255,0.03);
  border-radius: 4px;
  font-size: 12px;
  color: var(--muted);
}

.te-hint-small { font-size: 11px; margin-top: 6px; opacity: 0.8; }

.te-tileset-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.te-tileset-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.02);
}

.te-tileset-item:hover {
  background: rgba(255,255,255,0.06);
}

.te-tileset-item.active {
  border-color: var(--accent);
  background: rgba(0, 122, 204, 0.15);
}

.te-tileset-thumb {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 2px;
  overflow: hidden;
  background: var(--bg);
}

.te-tileset-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.te-tileset-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.te-btn-remove {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  border-radius: 2px;
}

.te-btn-remove:hover {
  background: rgba(244, 76, 76, 0.3);
  color: #f44c4c;
}

.te-palette-section { flex-shrink: 0; }
.te-palette-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.te-palette-header label { margin-bottom: 0; }
.te-palette-btn {
  width: 24px;
  height: 24px;
  font-size: 12px;
}

.te-tileset-preview {
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: auto;
  max-height: 320px;
  min-height: 96px;
  background: #111;
  cursor: crosshair;
}

.te-palette-stage {
  position: relative;
  display: inline-block;
  min-width: 48px;
  min-height: 48px;
}

.te-palette-img {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  -webkit-user-drag: none;
  user-select: none;
  pointer-events: none;
}

.te-palette-sel {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #0f0;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5);
  pointer-events: none;
  z-index: 2;
}

.te-palette-indices {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.te-palette-idx {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-family: monospace;
  color: #fff;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
  box-sizing: border-box;
}

.te-tile-info { font-size: 12px; color: var(--muted); margin-top: 6px; }
.te-tile-info .te-tile-num { font-weight: 600; color: var(--text); }
.te-tile-info .te-hint { font-size: 10px; opacity: 0.7; display: block; margin-top: 2px; }

.te-stamp-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.te-stamp-input {
  flex: 1;
  min-width: 0;
  background: var(--panel-2, #252526);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
}
.te-stamp-list { display: flex; flex-direction: column; gap: 4px; }
.te-stamp-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.te-stamp-apply {
  flex: 1;
  text-align: left;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 11px;
  cursor: pointer;
}
.te-stamp-apply:hover { border-color: #58a6ff; }

.te-dims {
  display: flex;
  align-items: center;
  gap: 8px;
}

.te-dims input { width: 60px; padding: 4px; }
</style>
