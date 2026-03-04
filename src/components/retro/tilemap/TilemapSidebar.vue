<template>
  <div class="te-sidebar">
    <div class="te-section">
      <div class="te-section-header">
        <label>Tilesets</label>
        <button class="te-btn-add" @click="state.addTileset" title="Adicionar tileset">
          <span class="icon-plus"></span> Adicionar
        </button>
      </div>
      <div v-if="!state.userTilesets.value.length" class="te-empty-hint">
        <p>Nenhum tileset adicionado.</p>
        <p class="te-hint-small">Clique em "Adicionar" para escolher uma imagem de tiles (8×8 px).</p>
      </div>
      <div v-else class="te-tileset-list">
        <div
          v-for="ts in state.userTilesets.value"
          :key="ts.id"
          class="te-tileset-item"
          :class="{ active: state.selectedTilesetId.value === ts.id }"
          @click="state.selectTileset(ts)"
        >
          <div class="te-tileset-thumb" v-if="ts.preview">
            <img :src="ts.preview" :alt="ts.name" />
          </div>
          <div class="te-tileset-name" :title="ts.path">{{ ts.name }}</div>
          <button class="te-btn-remove" @click.stop="state.removeTileset(ts)" title="Remover">×</button>
        </div>
      </div>
    </div>
    
    <div class="te-section te-palette-section" v-show="state.selectedTileset.value">
      <div class="te-palette-header">
        <label>Paleta de tiles</label>
        <button
          class="te-tool-btn te-palette-btn"
          :class="{ active: state.showPaletteIndices.value }"
          title="Mostrar números dos tiles"
          @click="state.showPaletteIndices.value = !state.showPaletteIndices.value"
        >
          #
        </button>
      </div>
      <div class="te-tileset-preview">
        <canvas ref="tilesetCanvas" @mousedown="onTilesetMouseDown" @mousemove="onTilesetMouseMove" @mouseup="onTilesetMouseUp" @mouseleave="onTilesetMouseLeave"></canvas>
      </div>
      <div class="te-tile-info">
        <span class="te-tile-num" v-if="state.selectedTileRegion.value?.w === 1 && state.selectedTileRegion.value?.h === 1">Tile: {{ state.selectedTileRegion.value.idx + (state.selectedTileset.value?.firstgid || 1) }}</span>
        <span class="te-tile-num" v-else-if="state.selectedTileRegion.value">Region: {{ state.selectedTileRegion.value.w }}x{{ state.selectedTileRegion.value.h }} (Tile {{ state.selectedTileRegion.value.idx + (state.selectedTileset.value?.firstgid || 1) }})</span>
        <span class="te-hint">(Arraste para selecionar vários tiles)</span>
        <span class="te-hint">(botão direito no mapa = copiar bloco)</span>
      </div>
    </div>
    
    <div class="te-section">
      <label>Dimensões do mapa</label>
      <div class="te-dims">
        <input v-model.number="state.mapWidth.value" type="number" min="8" max="256" step="8" />
        <span>×</span>
        <input v-model.number="state.mapHeight.value" type="number" min="8" max="256" step="8" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'

const props = defineProps({
  state: {
    type: Object,
    required: true
  }
})

const tilesetCanvas = ref(null)

onMounted(() => {
  if (tilesetCanvas.value) {
    props.state.tilesetCanvas.value = tilesetCanvas.value
    drawTileset()
  }
})

function drawTileset() {
  const c = props.state.tilesetCanvas.value
  if (!c || !props.state.tilesetPreview.value) return
  const img = new Image()
  img.onload = () => {
    const cols = Math.floor(img.width / props.state.TILE_SIZE_CONST)
    const rows = Math.ceil(img.height / props.state.TILE_SIZE_CONST)
    const tilePx = props.state.TILE_SIZE_CONST * props.state.PALETTE_ZOOM
    c.width = cols * tilePx
    c.height = rows * tilePx
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        ctx.drawImage(
          img,
          tx * props.state.TILE_SIZE_CONST, ty * props.state.TILE_SIZE_CONST, props.state.TILE_SIZE_CONST, props.state.TILE_SIZE_CONST,
          tx * tilePx, ty * tilePx, tilePx, tilePx
        )
      }
    }
    const firstgid = props.state.selectedTileset.value?.firstgid || 1
    if (props.state.showPaletteIndices.value) {
      ctx.font = `${Math.min(12, tilePx - 4)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 2
      for (let i = 0; i < cols * rows; i++) {
        const tx = i % cols
        const ty = Math.floor(i / cols)
        const cx = tx * tilePx + tilePx / 2
        const cy = ty * tilePx + tilePx / 2
        const displayIdx = i + firstgid
        ctx.strokeText(String(displayIdx), cx, cy)
        ctx.fillText(String(displayIdx), cx, cy)
      }
    }
    if (props.state.selectedTileRegion.value?.idx >= 0) {
      const { idx, w, h } = props.state.selectedTileRegion.value
      const tx = idx % cols
      const ty = Math.floor(idx / cols)
      if (tx < cols && ty < rows) {
        ctx.strokeStyle = '#0f0'
        ctx.lineWidth = 3
        ctx.strokeRect(tx * tilePx, ty * tilePx, w * tilePx, h * tilePx)
      }
    }
  }
  img.src = props.state.tilesetPreview.value
}

// Multi-tile selection logic in Palette
const isSelectingTiles = ref(false)
const selectionStart = ref(null)

function getTileCoordFromEvent(e) {
  const c = props.state.tilesetCanvas.value
  if (!c) return null
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY
  const tilePx = props.state.TILE_SIZE_CONST * props.state.PALETTE_ZOOM
  const cols = Math.floor(c.width / tilePx)
  const rows = Math.floor(c.height / tilePx)
  const tx = Math.floor(canvasX / tilePx)
  const ty = Math.floor(canvasY / tilePx)
  if (tx >= 0 && tx < cols && ty >= 0 && ty < rows) {
    return { x: tx, y: ty, idx: ty * cols + tx, cols }
  }
  return null
}

function onTilesetMouseDown(e) {
  if (e.button !== 0) return
  const coord = getTileCoordFromEvent(e)
  if (!coord) return
  isSelectingTiles.value = true
  selectionStart.value = coord
  
  // Set single tile temporarily for instant visual feedback
  props.state.selectedTileRegion.value = { idx: coord.idx, w: 1, h: 1 }
  drawTileset()
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
  
  props.state.selectedTileRegion.value = { idx: startIdx, w, h }
  drawTileset()
}

function onTilesetMouseUp(e) {
  if (e.button !== 0) return
  isSelectingTiles.value = false
  selectionStart.value = null
}

function onTilesetMouseLeave() {
  isSelectingTiles.value = false
  selectionStart.value = null
}

watch([
  () => props.state.selectedTileRegion?.value?.idx, 
  () => props.state.selectedTileRegion?.value?.w, 
  () => props.state.selectedTileRegion?.value?.h, 
  () => props.state.showPaletteIndices.value, 
  () => props.state.tilesetPreview.value
], drawTileset, { flush: 'post' })

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
}

.te-tileset-preview canvas {
  display: block;
  flex-shrink: 0;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.te-tile-info { font-size: 12px; color: var(--muted); margin-top: 6px; }
.te-tile-info .te-tile-num { font-weight: 600; color: var(--text); }
.te-tile-info .te-hint { font-size: 10px; opacity: 0.7; display: block; margin-top: 2px; }

.te-dims {
  display: flex;
  align-items: center;
  gap: 8px;
}

.te-dims input { width: 60px; padding: 4px; }
</style>
