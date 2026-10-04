<template>
  <div class="te-sidebar">
    <details class="te-accordion te-library-accordion">
      <summary class="te-accordion-title">Kit, mapas e objetos <span class="te-count">{{ state.assetPack.value?.name || `${state.recentKits.value.length} kits recentes` }}</span></summary>
      <TilemapLibrary :state="state" />
    </details>
    <details class="te-section te-background-section te-accordion">
      <summary class="te-accordion-title">Fundo e parallax <span class="te-count">{{ state.parallaxLayers.value.length }} camadas</span></summary>
      <div class="te-accordion-content">
      <div class="te-section-header">
        <button class="te-btn-add" type="button" @click="state.chooseBackgroundImage()">
          <span class="icon-plus"></span> {{ t(state.backgroundImage.value ? 'tilemap.background.replace' : 'tilemap.background.add') }}
        </button>
      </div>
      <template v-if="state.backgroundImage.value">
        <img v-if="state.backgroundImage.value.preview" class="te-background-preview" :src="state.backgroundImage.value.preview" :alt="state.backgroundImage.value.path.split(/[/\\\\]/).pop()" />
        <div class="te-background-path-row">
          <div class="te-background-path" :title="state.backgroundImage.value.path">{{ state.backgroundImage.value.path.split(/[/\\\\]/).pop() }}</div>
          <button
            class="te-btn-remove te-background-remove"
            type="button"
            :title="t('tilemap.background.remove')"
            :aria-label="t('tilemap.background.remove')"
            @click="state.clearBackgroundImage()"
          >
            <span class="icon-trash" aria-hidden="true"></span>
          </button>
        </div>
        <label>{{ t('tilemap.background.fit') }}
          <select :value="state.backgroundImage.value.fit" @change="state.updateBackgroundOption('fit', $event.target.value)">
            <option value="cover">{{ t('tilemap.background.cover') }}</option>
            <option value="contain">{{ t('tilemap.background.contain') }}</option>
            <option value="stretch">{{ t('tilemap.background.stretch') }}</option>
          </select>
        </label>
        <label>{{ t('tilemap.background.opacity') }} — {{ Math.round(state.backgroundImage.value.opacity * 100) }}%
          <input type="range" min="0" max="1" step="0.05" :value="state.backgroundImage.value.opacity" @input="state.updateBackgroundOption('opacity', $event.target.value)" />
        </label>
      </template>
      <p v-else class="te-hint-small">{{ t('tilemap.background.hint') }}</p>
      <div class="te-parallax-header">
        <strong>Parallax</strong>
        <button class="te-btn-add" type="button" @click="state.addParallaxLayer()"><span class="icon-plus"></span> Camada</button>
      </div>
      <p v-if="!state.parallaxLayers.value.length" class="te-hint-small">Adicione planos de fundo com velocidades de rolagem independentes.</p>
      <article v-for="(layer, index) in state.parallaxLayers.value" :key="layer.id" class="te-parallax-card">
        <img v-if="layer.preview" :src="layer.preview" :alt="layer.path.split(/[/\\\\]/).pop()" />
        <div class="te-background-path-row">
          <span class="te-background-path" :title="layer.path">{{ index + 1 }}. {{ layer.path.split(/[/\\\\]/).pop() }}</span>
          <button class="te-tool-btn" type="button" title="Mover para frente" :disabled="index === 0" @click="state.moveParallaxLayer(layer.id, -1)">↑</button>
          <button class="te-tool-btn" type="button" title="Mover para trás" :disabled="index === state.parallaxLayers.value.length - 1" @click="state.moveParallaxLayer(layer.id, 1)">↓</button>
          <button class="te-btn-remove te-background-remove" type="button" title="Remover camada" @click="state.removeParallaxLayer(layer.id)">×</button>
        </div>
        <label>Velocidade horizontal — {{ Number(layer.factorX).toFixed(2) }}×
          <input type="range" min="0" max="1.5" step="0.05" :value="layer.factorX" @input="state.updateParallaxLayer(layer.id, 'factorX', $event.target.value)" />
        </label>
        <label>Velocidade vertical — {{ Number(layer.factorY).toFixed(2) }}×
          <input type="range" min="0" max="1.5" step="0.05" :value="layer.factorY" @input="state.updateParallaxLayer(layer.id, 'factorY', $event.target.value)" />
        </label>
        <label>Opacidade — {{ Math.round(layer.opacity * 100) }}%
          <input type="range" min="0" max="1" step="0.05" :value="layer.opacity" @input="state.updateParallaxLayer(layer.id, 'opacity', $event.target.value)" />
        </label>
      </article>
      </div>
    </details>
    <details class="te-section te-accordion">
      <summary class="te-accordion-title">{{ t('tilemap.tilesets') }} <span class="te-count">{{ tilesetList.length }}</span></summary>
      <div class="te-accordion-content">
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
    </details>
    
    <details class="te-section te-palette-section te-accordion" v-if="activeTileset" open>
      <summary class="te-accordion-title">{{ t('tilemap.tilePalette') }}</summary>
      <div class="te-accordion-content">
      <div class="te-palette-header">
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
    </details>
    
    <details class="te-section te-accordion">
      <summary class="te-accordion-title">{{ t('tilemap.mapDimensions') }}</summary>
      <div class="te-accordion-content">
      <div class="te-dims">
        <input v-model.number="state.mapWidth.value" type="number" min="8" max="256" step="8" />
        <span>×</span>
        <input v-model.number="state.mapHeight.value" type="number" min="8" max="256" step="8" />
      </div>
      </div>
    </details>

    <details class="te-section te-accordion">
      <summary class="te-accordion-title">{{ t('tilemap.stamps') }} <span class="te-count">{{ state.stamps.value.length }}</span></summary>
      <div class="te-accordion-content">
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
    </details>
  </div>
</template>

<script setup>
import TilemapLibrary from './TilemapLibrary.vue'
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
  width: 264px;
  box-sizing: border-box;
  flex-shrink: 0;
  min-width: 0;
  padding: 12px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--panel);
  overflow-y: auto;
}
.te-sidebar > * { flex: 0 0 auto; }
.te-background-preview {
  display:block;
  width:100%;
  height:88px;
  object-fit:cover;
  image-rendering:pixelated;
  background:#111;
  border:1px solid var(--border);
  border-radius:4px;
}
.te-accordion { padding: 0; border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
.te-accordion-title { list-style: none; cursor: pointer; min-height: 34px; box-sizing: border-box; display:flex; align-items:center; padding: 7px 9px; font-size: 12px; font-weight: 600; color: var(--text); background: rgba(255,255,255,.035); }
.te-accordion-title::-webkit-details-marker { display: none; }
.te-accordion-title::before { content: '›'; display: inline-block; width: 16px; flex:none; color: var(--muted); transition: transform .12s ease; }
.te-accordion[open] > .te-accordion-title::before { transform: rotate(90deg); }
.te-accordion-content { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.te-count { margin-left:auto; color: var(--muted); font-size:10px; font-weight: 400; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.te-library-accordion > :deep(.map-library) { padding: 8px; border-bottom: 0; }
.te-parallax-header { display:flex; align-items:center; justify-content:space-between; padding-top:8px; border-top:1px solid var(--border); font-size:11px; }
.te-parallax-card { display:flex; flex-direction:column; gap:6px; padding:7px; background:rgba(0,0,0,.14); border:1px solid var(--border); border-radius:4px; }
.te-parallax-card img { width:100%; height:54px; object-fit:cover; image-rendering:pixelated; background:#111; }
.te-parallax-card label { margin:0; }
.te-parallax-card input[type=range] { display:block; width:100%; }
.te-parallax-card .te-tool-btn { width:22px; height:22px; flex:none; }
.te-parallax-card .te-tool-btn:disabled { opacity:.3; cursor:default; }
.te-background-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.7; font-size:11px; }
.te-background-path-row { display:flex; align-items:center; gap:6px; min-width:0; }
.te-background-remove {
  width:28px;
  height:28px;
  flex:none;
  display:grid;
  place-items:center;
  border:1px solid var(--border);
  margin:0;
}
.te-background-remove .icon-trash { width:13px; height:13px; opacity:.8; }
.te-background-remove:hover .icon-trash { opacity:1; }

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
