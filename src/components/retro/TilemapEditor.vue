<template>
  <div class="tilemap-editor" tabindex="0" @keydown="onKeydown">
    <!-- Title bar personalizada -->
    <div class="te-titlebar" @dblclick="toggleMaximize">
      <div class="te-titlebar-left">
        <div class="te-window-controls">
          <button class="te-tb-btn te-close" title="Fechar" @click="$emit('close')">
            <span class="icon-xmark"></span>
          </button>
          <button class="te-tb-btn" title="Minimizar" @click="minimize">
            <span class="icon-window-minimize"></span>
          </button>
          <button class="te-tb-btn" :title="isMaximized ? 'Restaurar' : 'Maximizar'" @click="toggleMaximize">
            <span v-if="!isMaximized" class="icon-window-maximize"></span>
            <span v-else class="icon-window-restore"></span>
          </button>
        </div>
        <div class="te-app-title">
          <span class="te-logo">◫</span>
          <span>Editor de Mapas</span>
        </div>
      </div>
      <div class="te-titlebar-center">{{ currentMapName }}</div>
      <div class="te-titlebar-right">
        <button class="te-tb-btn" title="Abrir mapa" @click="openMap">
          <span class="icon-folder-open"></span>
        </button>
        <button
          class="te-tb-btn"
          @click="saveMap"
          :disabled="!canSave || saving"
          :title="savePathHint"
        >
          <span class="icon-floppy-disk"></span>
        </button>
        <button
          class="te-tb-btn"
          @click="saveMapAs"
          :disabled="!canSave || saving"
          title="Salvar como..."
        >
          <span class="icon-file-plus"></span>
        </button>
        <button
          class="te-tb-btn"
          @click="exportToC"
          :disabled="!canSave || saving"
          title="Exportar para C (array)"
        >
          C
        </button>
      </div>
    </div>
    <div class="te-content">
      <!-- Painel lateral estilo Tiled -->
      <div class="te-sidebar">
        <div class="te-section">
          <div class="te-section-header">
            <label>Tilesets</label>
            <button class="te-btn-add" @click="addTileset" title="Adicionar tileset">
              <span class="icon-plus"></span> Adicionar
            </button>
          </div>
          <div v-if="!userTilesets.length" class="te-empty-hint">
            <p>Nenhum tileset adicionado.</p>
            <p class="te-hint-small">Clique em "Adicionar" para escolher uma imagem de tiles (8×8 px).</p>
          </div>
          <div v-else class="te-tileset-list">
            <div
              v-for="ts in userTilesets"
              :key="ts.id"
              class="te-tileset-item"
              :class="{ active: selectedTilesetId === ts.id }"
              @click="selectTileset(ts)"
            >
              <div class="te-tileset-thumb" v-if="ts.preview">
                <img :src="ts.preview" :alt="ts.name" />
              </div>
              <div class="te-tileset-name" :title="ts.path">{{ ts.name }}</div>
              <button class="te-btn-remove" @click.stop="removeTileset(ts)" title="Remover">×</button>
            </div>
          </div>
        </div>
        <div class="te-section te-palette-section" v-if="selectedTileset">
          <div class="te-palette-header">
            <label>Paleta de tiles</label>
            <button
              class="te-tool-btn te-palette-btn"
              :class="{ active: showPaletteIndices }"
              title="Mostrar números dos tiles"
              @click="showPaletteIndices = !showPaletteIndices"
            >
              #
            </button>
          </div>
          <div class="te-tileset-preview" ref="tilesetRef">
            <canvas ref="tilesetCanvas" @click="onTilesetClick"></canvas>
          </div>
          <div class="te-tile-info">
            <span class="te-tile-num">Tile: {{ selectedTileIndex }}</span>
            <span class="te-hint">(botão direito no mapa = copiar tile)</span>
          </div>
        </div>
        <div class="te-section">
          <label>Dimensões do mapa</label>
          <div class="te-dims">
            <input v-model.number="mapWidth" type="number" min="8" max="128" />
            <span>×</span>
            <input v-model.number="mapHeight" type="number" min="8" max="128" />
          </div>
        </div>
      </div>
      <div class="te-main">
        <div class="te-toolbar-map">
          <div class="te-layer-select">
            <button
              class="te-tool-btn"
              :class="{ active: activeLayer === 'bg' }"
              title="Camada fundo (BG)"
              @click="activeLayer = 'bg'"
            >
              BG
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: activeLayer === 'fg' }"
              title="Camada frente (FG)"
              @click="activeLayer = 'fg'"
            >
              FG
            </button>
          </div>
          <div class="te-tools">
            <button
              v-for="t in drawTools"
              :key="t.id"
              class="te-tool-btn"
              :class="{ active: drawTool === t.id }"
              :title="t.title"
              @click="drawTool = t.id"
            >
              {{ t.icon }}
            </button>
          </div>
          <div class="te-debug-tools">
            <button
              class="te-tool-btn"
              :class="{ active: showGrid }"
              title="Mostrar/ocultar grade"
              @click="showGrid = !showGrid"
            >
              ⊞
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: showTileIndices }"
              title="Mostrar índices dos tiles"
              @click="showTileIndices = !showTileIndices"
            >
              #
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: showCollision }"
              title="Mostrar colisões"
              @click="showCollision = !showCollision"
            >
              ⬛
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: editCollision }"
              title="Editar colisão (C) - clique para alternar"
              @click="editCollision = !editCollision"
            >
              ◼
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: showPriority }"
              title="Mostrar prioridade"
              @click="showPriority = !showPriority"
            >
              △
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: editPriority }"
              title="Editar prioridade (O) - tile na frente do sprite"
              @click="editPriority = !editPriority"
            >
              ▲
            </button>
            <button
              class="te-tool-btn"
              :class="{ active: showCoords }"
              title="Mostrar coordenadas ao passar o mouse"
              @click="showCoords = !showCoords"
            >
              ⌖
            </button>
          </div>
          <div class="te-selection-actions">
            <button
              class="te-tool-btn"
              :disabled="!selection?.w"
              title="Duplicar seleção (Ctrl+D) - cola à direita ou abaixo da região"
              @click="duplicateSelection"
            >
              ⊕
            </button>
          </div>
          <div class="te-undo-redo">
            <button class="te-tool-btn" :disabled="!canUndo" title="Desfazer (Ctrl+Z)" @click="undo">↶</button>
            <button class="te-tool-btn" :disabled="!canRedo" title="Refazer (Ctrl+Shift+Z)" @click="redo">↷</button>
          </div>
          <div class="te-zoom">
            <button @click="zoom = Math.max(1, zoom - 1)">−</button>
            <span>{{ zoom }}×</span>
            <button @click="zoom = Math.min(8, zoom + 1)">+</button>
          </div>
        </div>
        <div
          ref="mapWrapRef"
          class="te-map-wrap"
          :class="{ 'te-panning': isPanning }"
          @mousedown="onMapWrapMouseDown"
          @mousemove="onMapWrapMouseMove"
          @mouseleave="onMapWrapMouseLeave"
          @wheel.prevent="onMapWheel"
          @mouseup="onMapWrapMouseUp"
        >
          <canvas
            ref="mapCanvas"
            class="te-map-canvas"
            :width="mapWidth * TILE_SIZE * zoom"
            :height="mapHeight * TILE_SIZE * zoom"
            @mousedown="onMapMouseDown"
            @mousemove="onMapMouseMove"
            @mouseup="onMapMouseUp"
            @mouseleave="onMapMouseUp"
            @contextmenu.prevent="onMapContextMenu"
          ></canvas>
          <div v-if="showCoords && hoverCoord" class="te-coord-hint">
            ({{ hoverCoord.x }}, {{ hoverCoord.y }}) → tile {{ hoverCoord.tileIdx > 0 ? hoverCoord.tileIdx - 1 : '-' }}{{ hoverCoord.layer ? ` [${hoverCoord.layer}]` : '' }}
            <span v-if="hoverCoord.collision"> | colisão</span>
            <span v-if="hoverCoord.priority"> | prioridade</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * TilemapEditor - Editor de mapas TMX compatível com SGDK
 * Suporta: BG/FG, copy/paste, export C, resources.res automático
 */
import { ref, computed, watch, onMounted } from 'vue'
import { toTMX, fromTMX, fromJSON, toCArray, TILE_SIZE } from '@/utils/retro/tmxFormat.js'

const props = defineProps({
  asset: { type: Object, default: null },
  projectPath: { type: String, default: '' },
  assets: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'saved'])

const TILE_SIZE_CONST = TILE_SIZE
const PALETTE_ZOOM = 3
const mapCanvas = ref(null)
const tilesetCanvas = ref(null)
const mapWrapRef = ref(null)

const mapWidth = ref(40)
const mapHeight = ref(30)
const tiles = ref([])
const tiles2 = ref([])
const activeLayer = ref('bg')
const zoom = ref(2)
const selectedTileIndex = ref(0)
const selectedTilesetId = ref('')
const saving = ref(false)
const isDrawing = ref(false)
const isMaximized = ref(false)

// Ferramentas de desenho
const DRAW_TOOLS = {
  pencil: { id: 'pencil', icon: '✎', title: 'Lápis (P)' },
  eraser: { id: 'eraser', icon: '⌫', title: 'Apagar (E)' },
  fill: { id: 'fill', icon: '▤', title: 'Preencher (F)' },
  rect: { id: 'rect', icon: '▭', title: 'Retângulo (R)' },
  line: { id: 'line', icon: '∕', title: 'Linha (L)' },
  select: {
    id: 'select',
    icon: '▢',
    title: 'Selecionar (S): 1) Arraste para marcar região  2) Clique dentro + arraste para mover  3) Ctrl+C copiar, Ctrl+V colar, Ctrl+D duplicar'
  }
}
const drawTools = Object.values(DRAW_TOOLS)
const drawTool = ref('pencil')

// Debug
const showGrid = ref(true)
const showTileIndices = ref(false)
const showPaletteIndices = ref(false)
const showCoords = ref(false)
const showCollision = ref(false)
const showPriority = ref(false)
const hoverCoord = ref(null)

// Atributos por tile (colisão, prioridade)
const collisionMap = ref([])
const priorityMap = ref([])
const editCollision = ref(false)
const editPriority = ref(false)

// Para retângulo/linha
const dragStart = ref(null)

// Undo/Redo
const HISTORY_MAX = 50
const history = ref([])
const historyIndex = ref(-1)

// Pan (botão do meio)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })

// Seleção e clipboard
const selection = ref(null)
const selectionDragEnd = ref(null)
const clipboard = ref(null)
const isMovingSelection = ref(false)
const moveStartInSelection = ref(null)
const movePreview = ref(null)

// Mapa atual (pode ser alterado via Abrir/Salvar como)
const currentMapPath = ref(null)

// Tilesets adicionados pelo usuário (estilo Tiled)
const userTilesets = ref([])

const selectedTileset = computed(() => userTilesets.value.find((t) => t.id === selectedTilesetId.value))
const tilesetPreview = computed(() => selectedTileset.value?.preview ?? null)
const canSave = computed(() => selectedTileset.value && userTilesets.value.length > 0)
const currentMapName = computed(() => {
  if (currentMapPath.value) {
    return currentMapPath.value.split(/[/\\]/).pop()?.replace(/\.tmx$/i, '') || 'Mapa'
  }
  return props.asset?.name || 'Mapa sem título'
})
const savePathHint = computed(() => {
  const base = (props.projectPath || '').replace(/\/+$/, '')
  if (!base) return 'Salvar TMX no projeto'
  const relPath = getCurrentMapRelativePath()
  return `Salvar em: ${base}/${relPath}`
})

function getCurrentMapRelativePath() {
  if (currentMapPath.value && props.projectPath) {
    const base = props.projectPath.replace(/[/\\]+$/, '')
    if (currentMapPath.value.startsWith(base)) {
      return currentMapPath.value.slice(base.length).replace(/^[/\\]/, '')
    }
  }
  return props.asset?.path || 'maps/map.tmx'
}

function minimize() {
  window.retroStudio?.windowMinimize?.()
}
async function toggleMaximize() {
  window.retroStudio?.windowToggleMaximize?.()
  try {
    isMaximized.value = await window.retroStudio?.windowIsMaximized?.() ?? false
  } catch (_) {}
}

function ensureTiles() {
  const len = mapWidth.value * mapHeight.value
  if (tiles.value.length !== len) {
    tiles.value = Array.from({ length: len }, (_, i) => tiles.value[i] ?? 0)
  }
  if (tiles2.value.length !== len) {
    tiles2.value = Array.from({ length: len }, (_, i) => tiles2.value[i] ?? 0)
  }
  if (collisionMap.value.length !== len) {
    collisionMap.value = Array.from({ length: len }, (_, i) => collisionMap.value[i] ?? false)
  }
  if (priorityMap.value.length !== len) {
    priorityMap.value = Array.from({ length: len }, (_, i) => priorityMap.value[i] ?? false)
  }
}

watch([mapWidth, mapHeight], ensureTiles)

function pushState() {
  ensureTiles()
  const state = {
    tiles: [...tiles.value],
    tiles2: [...tiles2.value],
    collision: [...collisionMap.value],
    priority: [...priorityMap.value]
  }
  const idx = historyIndex.value
  history.value = history.value.slice(0, idx + 1)
  history.value.push(state)
  if (history.value.length > HISTORY_MAX) history.value.shift()
  historyIndex.value = history.value.length - 1
}

function undo() {
  if (historyIndex.value <= 0) return
  historyIndex.value--
  const s = history.value[historyIndex.value]
  tiles.value = [...s.tiles]
  tiles2.value = s.tiles2 ? [...s.tiles2] : Array(mapWidth.value * mapHeight.value).fill(0)
  collisionMap.value = [...s.collision]
  priorityMap.value = [...s.priority]
  drawMap()
}

function redo() {
  if (historyIndex.value >= history.value.length - 1) return
  historyIndex.value++
  const s = history.value[historyIndex.value]
  tiles.value = [...s.tiles]
  tiles2.value = s.tiles2 ? [...s.tiles2] : Array(mapWidth.value * mapHeight.value).fill(0)
  collisionMap.value = [...s.collision]
  priorityMap.value = [...s.priority]
  drawMap()
}

const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1 && history.value.length > 0)

async function addTileset() {
  const baseDir = (props.projectPath || '').replace(/\/+$/, '')
  const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : ''
  const result = await window.retroStudio?.retro?.selectFile?.({
    context: 'tileset',
    title: 'Selecionar imagem do tileset',
    defaultPath: resDir || baseDir || undefined,
    filters: [
      { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  })
  if (!result?.success || !result.path) return
  const fullPath = result.path
  const name = fullPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'tileset'
  let preview = null
  try {
    const r = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, fullPath)
    preview = r?.success ? r.preview : null
  } catch (_) {}
  if (!preview) {
    window.retroStudioToast?.error?.('Não foi possível carregar a imagem')
    return
  }
  const ts = {
    id: `ts_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name,
    path: fullPath,
    preview
  }
  userTilesets.value.push(ts)
  selectedTilesetId.value = ts.id
}

function removeTileset(ts) {
  userTilesets.value = userTilesets.value.filter((t) => t.id !== ts.id)
  if (selectedTilesetId.value === ts.id) {
    selectedTilesetId.value = userTilesets.value[0]?.id || ''
  }
}

function selectTileset(ts) {
  selectedTilesetId.value = ts.id
}

function drawTileset() {
  const c = tilesetCanvas.value
  if (!c || !tilesetPreview.value) return
  const img = new Image()
  img.onload = () => {
    const cols = Math.floor(img.width / TILE_SIZE_CONST)
    const rows = Math.ceil(img.height / TILE_SIZE_CONST)
    const tilePx = TILE_SIZE_CONST * PALETTE_ZOOM
    c.width = cols * tilePx
    c.height = rows * tilePx
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        ctx.drawImage(
          img,
          tx * TILE_SIZE_CONST, ty * TILE_SIZE_CONST, TILE_SIZE_CONST, TILE_SIZE_CONST,
          tx * tilePx, ty * tilePx, tilePx, tilePx
        )
      }
    }
    if (showPaletteIndices.value) {
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
        ctx.strokeText(String(i), cx, cy)
        ctx.fillText(String(i), cx, cy)
      }
    }
    if (selectedTileIndex.value >= 0) {
      const tx = selectedTileIndex.value % cols
      const ty = Math.floor(selectedTileIndex.value / cols)
      if (tx < cols && ty < rows) {
        ctx.strokeStyle = '#0f0'
        ctx.lineWidth = 3
        ctx.strokeRect(tx * tilePx, ty * tilePx, tilePx, tilePx)
      }
    }
  }
  img.src = tilesetPreview.value
}

function onTilesetClick(e) {
  const c = tilesetCanvas.value
  if (!c || e.target !== c) return
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const canvasX = (e.offsetX ?? (e.clientX - rect.left)) * scaleX
  const canvasY = (e.offsetY ?? (e.clientY - rect.top)) * scaleY
  const tilePx = TILE_SIZE_CONST * PALETTE_ZOOM
  const cols = Math.floor(c.width / tilePx)
  const rows = Math.floor(c.height / tilePx)
  const tileX = Math.floor(canvasX / tilePx)
  const tileY = Math.floor(canvasY / tilePx)
  if (tileX >= 0 && tileX < cols && tileY >= 0 && tileY < rows) {
    selectedTileIndex.value = tileY * cols + tileX
  }
  drawTileset()
}

function drawMap() {
  const c = mapCanvas.value
  if (!c) return
  ensureTiles()
  const tw = TILE_SIZE_CONST * zoom.value
  const th = tw
  const drawSelectionOverlay = () => {
    const ctx = c.getContext('2d')
    const sel = selection.value
    const dragEnd = selectionDragEnd.value
    const dragStartVal = dragStart.value
    const move = movePreview.value
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0
    if (isMovingSelection.value && move) {
      x1 = move.x1; y1 = move.y1; x2 = move.x2; y2 = move.y2
      ctx.strokeStyle = 'rgba(0,255,0,0.8)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 2
      ctx.strokeRect(x1 * tw, y1 * th, (x2 - x1 + 1) * tw, (y2 - y1 + 1) * th)
      ctx.setLineDash([])
    } else if (sel) {
      x1 = sel.x1; y1 = sel.y1; x2 = sel.x2; y2 = sel.y2
      ctx.strokeStyle = '#0f0'
      ctx.lineWidth = 2
      ctx.strokeRect(x1 * tw, y1 * th, (x2 - x1 + 1) * tw, (y2 - y1 + 1) * th)
    } else if (isDrawing.value && drawTool.value === 'select' && dragStartVal != null && dragEnd != null) {
      x1 = Math.min(dragStartVal % mapWidth.value, dragEnd % mapWidth.value)
      x2 = Math.max(dragStartVal % mapWidth.value, dragEnd % mapWidth.value)
      y1 = Math.min(Math.floor(dragStartVal / mapWidth.value), Math.floor(dragEnd / mapWidth.value))
      y2 = Math.max(Math.floor(dragStartVal / mapWidth.value), Math.floor(dragEnd / mapWidth.value))
      ctx.strokeStyle = '#0f0'
      ctx.lineWidth = 2
      ctx.strokeRect(x1 * tw, y1 * th, (x2 - x1 + 1) * tw, (y2 - y1 + 1) * th)
    }
  }
  if (!tilesetPreview.value) {
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    drawSelectionOverlay()
    return
  }
  const img = new Image()
  img.onload = () => {
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)
    const cols = Math.floor(img.width / TILE_SIZE_CONST)
    const tw = TILE_SIZE_CONST * zoom.value
    const th = TILE_SIZE_CONST * zoom.value
    const drawLayer = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        const tid = arr[i]
        if (tid <= 0) continue
        const tx = (tid - 1) % cols
        const ty = Math.floor((tid - 1) / cols)
        ctx.drawImage(
          img,
          tx * TILE_SIZE_CONST,
          ty * TILE_SIZE_CONST,
          TILE_SIZE_CONST,
          TILE_SIZE_CONST,
          (i % mapWidth.value) * tw,
          Math.floor(i / mapWidth.value) * th,
          tw,
          th
        )
      }
    }
    drawLayer(tiles.value)
    drawLayer(tiles2.value)
    if (showGrid.value) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      for (let y = 0; y <= mapHeight.value; y++) {
        ctx.beginPath()
        ctx.moveTo(0, y * th)
        ctx.lineTo(mapWidth.value * tw, y * th)
        ctx.stroke()
      }
      for (let x = 0; x <= mapWidth.value; x++) {
        ctx.beginPath()
        ctx.moveTo(x * tw, 0)
        ctx.lineTo(x * tw, mapHeight.value * th)
        ctx.stroke()
      }
    }
    if (showTileIndices.value && tw >= 12) {
      ctx.font = `${Math.min(10, tw - 2)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < tiles.value.length; i++) {
        const vBg = tiles.value[i] ?? 0
        const vFg = tiles2.value[i] ?? 0
        const v = vFg > 0 ? vFg : vBg
        if (v > 0) {
          const px = (i % mapWidth.value) * tw + tw / 2
          const py = Math.floor(i / mapWidth.value) * th + th / 2
          ctx.fillStyle = vFg > 0 ? 'rgba(0,255,255,0.9)' : 'rgba(255,255,0,0.8)'
          ctx.fillText(String(v - 1), px, py)
        }
      }
    }
    if (showCollision.value) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.35)'
      for (let i = 0; i < tiles.value.length; i++) {
        if (collisionMap.value[i]) {
          ctx.fillRect(
            (i % mapWidth.value) * tw,
            Math.floor(i / mapWidth.value) * th,
            tw,
            th
          )
        }
      }
    }
    if (showPriority.value) {
      ctx.fillStyle = 'rgba(0, 100, 255, 0.3)'
      for (let i = 0; i < tiles.value.length; i++) {
        if (priorityMap.value[i]) {
          ctx.fillRect(
            (i % mapWidth.value) * tw,
            Math.floor(i / mapWidth.value) * th,
            tw,
            th
          )
        }
      }
    }
    drawSelectionOverlay()
  }
  img.src = tilesetPreview.value
}

function getMapTileFromEvent(e) {
  const c = mapCanvas.value
  if (!c) return -1
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return -1
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY
  const x = Math.floor(canvasX / (TILE_SIZE_CONST * zoom.value))
  const y = Math.floor(canvasY / (TILE_SIZE_CONST * zoom.value))
  if (x < 0 || x >= mapWidth.value || y < 0 || y >= mapHeight.value) return -1
  return y * mapWidth.value + x
}

function getPaintValue() {
  return drawTool.value === 'eraser' ? 0 : selectedTileIndex.value + 1
}

function getActiveTiles() {
  return activeLayer.value === 'fg' ? tiles2 : tiles
}

function paintTile(idx) {
  if (idx < 0) return
  ensureTiles()
  const arr = getActiveTiles().value
  const newVal = getPaintValue()
  if (arr[idx] !== newVal) {
    arr[idx] = newVal
    getActiveTiles().value = [...arr]
    drawMap()
  }
}

function fillTile(idx) {
  if (idx < 0 || !selectedTileset.value) return
  ensureTiles()
  const arr = getActiveTiles().value
  const targetVal = arr[idx]
  const newVal = getPaintValue()
  if (targetVal === newVal) return
  pushState()
  const stack = [idx]
  const visited = new Set([idx])
  let count = 0
  const maxFill = mapWidth.value * mapHeight.value
  while (stack.length > 0 && count < maxFill) {
    const i = stack.pop()
    if (arr[i] !== targetVal) continue
    arr[i] = newVal
    count++
    const x = i % mapWidth.value
    const y = Math.floor(i / mapWidth.value)
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < mapWidth.value && ny >= 0 && ny < mapHeight.value) {
        const ni = ny * mapWidth.value + nx
        if (!visited.has(ni)) {
          visited.add(ni)
          stack.push(ni)
        }
      }
    }
  }
  getActiveTiles().value = [...arr]
  drawMap()
}

function paintRect(idx1, idx2) {
  if (idx1 < 0 || idx2 < 0) return
  ensureTiles()
  const arr = getActiveTiles().value
  const x1 = Math.min(idx1 % mapWidth.value, idx2 % mapWidth.value)
  const x2 = Math.max(idx1 % mapWidth.value, idx2 % mapWidth.value)
  const y1 = Math.min(Math.floor(idx1 / mapWidth.value), Math.floor(idx2 / mapWidth.value))
  const y2 = Math.max(Math.floor(idx1 / mapWidth.value), Math.floor(idx2 / mapWidth.value))
  const newVal = getPaintValue()
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const i = y * mapWidth.value + x
      arr[i] = newVal
    }
  }
  getActiveTiles().value = [...arr]
  drawMap()
}

function paintLine(idx1, idx2) {
  if (idx1 < 0 || idx2 < 0) return
  ensureTiles()
  const arr = getActiveTiles().value
  const x1 = idx1 % mapWidth.value
  const y1 = Math.floor(idx1 / mapWidth.value)
  const x2 = idx2 % mapWidth.value
  const y2 = Math.floor(idx2 / mapWidth.value)
  const dx = Math.abs(x2 - x1)
  const dy = Math.abs(y2 - y1)
  const sx = x1 < x2 ? 1 : -1
  const sy = y1 < y2 ? 1 : -1
  let err = dx - dy
  let x = x1
  let y = y1
  const newVal = getPaintValue()
  const maxSteps = mapWidth.value * mapHeight.value
  let steps = 0
  while (steps++ < maxSteps) {
    const i = y * mapWidth.value + x
    arr[i] = newVal
    if (x === x2 && y === y2) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
  getActiveTiles().value = [...arr]
  drawMap()
}

function onMapWrapMouseMove(e) {
  if (isPanning.value) {
    const wrap = mapWrapRef.value
    if (wrap) {
      wrap.scrollLeft = panStart.value.scrollLeft + panStart.value.x - e.clientX
      wrap.scrollTop = panStart.value.scrollTop + panStart.value.y - e.clientY
    }
    return
  }
  onMapHover(e)
}

function onMapWrapMouseLeave() {
  hoverCoord.value = null
  if (isPanning.value) isPanning.value = false
}

function finishMoveSelection() {
  if (!isMovingSelection.value || !movePreview.value || !selection.value) return
  const prev = selection.value
  const next = movePreview.value
  if (next.x1 !== prev.x1 || next.y1 !== prev.y1) {
    pushState()
    moveSelectionTo(next.x1, next.y1)
  }
  isMovingSelection.value = false
  moveStartInSelection.value = null
  movePreview.value = null
  drawMap()
}

function onMapWrapMouseUp(e) {
  if (e.button === 1) isPanning.value = false
  if (e.button === 0 && isMovingSelection.value) finishMoveSelection()
}

function onMapWheel(e) {
  e.preventDefault()
  if (e.deltaY < 0) zoom.value = Math.min(8, zoom.value + 1)
  else if (e.deltaY > 0) zoom.value = Math.max(1, zoom.value - 1)
}

function onMapHover(e) {
  if (!showCoords.value) return
  const idx = getMapTileFromEvent(e)
  if (idx >= 0) {
    const x = idx % mapWidth.value
    const y = Math.floor(idx / mapWidth.value)
    const vFg = tiles2.value[idx] ?? 0
    const vBg = tiles.value[idx] ?? 0
    hoverCoord.value = {
      x,
      y,
      tileIdx: vFg > 0 ? vFg : vBg,
      layer: vFg > 0 ? 'FG' : 'BG',
      collision: !!collisionMap.value[idx],
      priority: !!priorityMap.value[idx]
    }
  } else {
    hoverCoord.value = null
  }
}

function toggleTileAttribute(idx, attr) {
  if (idx < 0) return
  ensureTiles()
  pushState()
  const arr = attr === 'collision' ? collisionMap.value : priorityMap.value
  arr[idx] = !arr[idx]
  if (attr === 'collision') collisionMap.value = [...arr]
  else priorityMap.value = [...arr]
  drawMap()
}

function onMapWrapMouseDown(e) {
  if (e.button === 1) {
    isPanning.value = true
    const wrap = mapWrapRef.value
    panStart.value = { x: e.clientX, y: e.clientY, scrollLeft: wrap?.scrollLeft ?? 0, scrollTop: wrap?.scrollTop ?? 0 }
    e.preventDefault()
  }
}

function onMapContextMenu(e) {
  const idx = getMapTileFromEvent(e)
  if (idx < 0) return
  const vFg = tiles2.value[idx] ?? 0
  const vBg = tiles.value[idx] ?? 0
  const v = vFg > 0 ? vFg : vBg
  if (v > 0) {
    selectedTileIndex.value = v - 1
    activeLayer.value = vFg > 0 ? 'fg' : 'bg'
    drawTileset()
    window.retroStudioToast?.success?.(`Tile ${v - 1} copiado`)
  }
}

function onMapMouseDown(e) {
  if (e.button !== 0) return
  const idx = getMapTileFromEvent(e)
  if (idx < 0) return
  ensureTiles()
  if (editCollision.value) {
    toggleTileAttribute(idx, 'collision')
    return
  }
  if (editPriority.value) {
    toggleTileAttribute(idx, 'priority')
    return
  }
  if (drawTool.value === 'fill') {
    fillTile(idx)
    return
  }
  if (drawTool.value === 'select') {
    const sel = selection.value
    if (sel && isTileInSelection(idx)) {
      const ox = sel.x1
      const oy = sel.y1
      const cx = idx % mapWidth.value
      const cy = Math.floor(idx / mapWidth.value)
      isMovingSelection.value = true
      moveStartInSelection.value = { offsetX: cx - ox, offsetY: cy - oy }
      movePreview.value = { x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2 }
      const onUp = () => { finishMoveSelection(); document.removeEventListener('mouseup', onUp) }
      document.addEventListener('mouseup', onUp)
      return
    }
    dragStart.value = idx
    isDrawing.value = true
    selection.value = null
    return
  }
  if (drawTool.value === 'rect' || drawTool.value === 'line') {
    pushState()
    dragStart.value = idx
    isDrawing.value = true
    return
  }
  pushState()
  isDrawing.value = true
  paintTile(idx)
}

function onMapMouseMove(e) {
  const idx = getMapTileFromEvent(e)
  if (isMovingSelection.value && moveStartInSelection.value) {
    if (idx >= 0) {
      const cx = idx % mapWidth.value
      const cy = Math.floor(idx / mapWidth.value)
      const { offsetX, offsetY } = moveStartInSelection.value
      const sel = selection.value
      if (sel) {
        let nx1 = cx - offsetX
        let ny1 = cy - offsetY
        nx1 = Math.max(0, Math.min(nx1, mapWidth.value - sel.w))
        ny1 = Math.max(0, Math.min(ny1, mapHeight.value - sel.h))
        movePreview.value = { x1: nx1, y1: ny1, x2: nx1 + sel.w - 1, y2: ny1 + sel.h - 1 }
      }
    }
    drawMap()
    return
  }
  if (drawTool.value === 'select' && isDrawing.value) {
    selectionDragEnd.value = idx >= 0 ? idx : dragStart.value
    drawMap()
    return
  }
  if (!isDrawing.value) return
  if (drawTool.value === 'rect' || drawTool.value === 'line') return
  paintTile(idx)
}

function onMapMouseUp(e) {
  if (e.button === 0 && isMovingSelection.value) {
    finishMoveSelection()
    return
  }
  if (!isDrawing.value || !dragStart.value) {
    isDrawing.value = false
    dragStart.value = null
    return
  }
  const idx = getMapTileFromEvent(e)
  if (drawTool.value === 'select') {
    const i1 = dragStart.value
    const i2 = idx >= 0 ? idx : i1
    const x1 = Math.min(i1 % mapWidth.value, i2 % mapWidth.value)
    const x2 = Math.max(i1 % mapWidth.value, i2 % mapWidth.value)
    const y1 = Math.min(Math.floor(i1 / mapWidth.value), Math.floor(i2 / mapWidth.value))
    const y2 = Math.max(Math.floor(i1 / mapWidth.value), Math.floor(i2 / mapWidth.value))
    selection.value = { x1, y1, x2, y2, w: x2 - x1 + 1, h: y2 - y1 + 1 }
    selectionDragEnd.value = null
    drawMap()
  } else if (drawTool.value === 'rect') {
    paintRect(dragStart.value, idx >= 0 ? idx : dragStart.value)
  } else if (drawTool.value === 'line') {
    paintLine(dragStart.value, idx >= 0 ? idx : dragStart.value)
  }
  isDrawing.value = false
  dragStart.value = null
}

function isTileInSelection(idx) {
  const sel = selection.value
  if (!sel) return false
  const x = idx % mapWidth.value
  const y = Math.floor(idx / mapWidth.value)
  return x >= sel.x1 && x <= sel.x2 && y >= sel.y1 && y <= sel.y2
}

function duplicateSelection() {
  const sel = selection.value
  if (!sel || !sel.w || !sel.h) return
  copySelection()
  const pasteX = sel.x2 + 1
  const pasteY = sel.y1
  if (pasteX + sel.w > mapWidth.value) {
    const pasteX2 = sel.x1
    const pasteY2 = sel.y2 + 1
    if (pasteY2 + sel.h > mapHeight.value) return
    pushState()
    pasteAt(pasteX2, pasteY2)
    selection.value = { x1: pasteX2, y1: pasteY2, x2: pasteX2 + sel.w - 1, y2: pasteY2 + sel.h - 1, w: sel.w, h: sel.h }
    drawMap()
    return
  }
  pushState()
  pasteAt(pasteX, pasteY)
  selection.value = { x1: pasteX, y1: pasteY, x2: pasteX + sel.w - 1, y2: pasteY + sel.h - 1, w: sel.w, h: sel.h }
  drawMap()
}

function pasteAt(x, y) {
  const clip = clipboard.value
  if (!clip || !clip.tiles?.length) return
  const t2 = clip.tiles2?.length ? clip.tiles2 : Array(clip.w * clip.h).fill(0)
  for (let dy = 0; dy < clip.h; dy++) {
    for (let dx = 0; dx < clip.w; dx++) {
      const ty = y + dy
      const tx = x + dx
      if (tx >= 0 && tx < mapWidth.value && ty >= 0 && ty < mapHeight.value) {
        const srcIdx = dy * clip.w + dx
        const dstIdx = ty * mapWidth.value + tx
        tiles.value[dstIdx] = clip.tiles[srcIdx] ?? 0
        tiles2.value[dstIdx] = t2[srcIdx] ?? 0
        collisionMap.value[dstIdx] = !!clip.collision[srcIdx]
        priorityMap.value[dstIdx] = !!clip.priority[srcIdx]
      }
    }
  }
  tiles.value = [...tiles.value]
  tiles2.value = [...tiles2.value]
  collisionMap.value = [...collisionMap.value]
  priorityMap.value = [...priorityMap.value]
}

function moveSelectionTo(newX1, newY1) {
  const sel = selection.value
  if (!sel || !sel.w || !sel.h) return
  const clip = { w: sel.w, h: sel.h, tiles: [], tiles2: [], collision: [], priority: [] }
  for (let y = sel.y1; y <= sel.y2; y++) {
    for (let x = sel.x1; x <= sel.x2; x++) {
      const i = y * mapWidth.value + x
      clip.tiles.push(tiles.value[i] ?? 0)
      clip.tiles2.push(tiles2.value[i] ?? 0)
      clip.collision.push(!!collisionMap.value[i])
      clip.priority.push(!!priorityMap.value[i])
    }
  }
  for (let y = sel.y1; y <= sel.y2; y++) {
    for (let x = sel.x1; x <= sel.x2; x++) {
      const i = y * mapWidth.value + x
      tiles.value[i] = 0
      tiles2.value[i] = 0
      collisionMap.value[i] = false
      priorityMap.value[i] = false
    }
  }
  clipboard.value = clip
  pasteAt(newX1, newY1)
  tiles.value = [...tiles.value]
  tiles2.value = [...tiles2.value]
  collisionMap.value = [...collisionMap.value]
  priorityMap.value = [...priorityMap.value]
  selection.value = {
    x1: newX1, y1: newY1,
    x2: newX1 + sel.w - 1, y2: newY1 + sel.h - 1,
    w: sel.w, h: sel.h
  }
}

function copySelection() {
  const sel = selection.value
  if (!sel || !sel.w || !sel.h) return
  ensureTiles()
  const data = { w: sel.w, h: sel.h, tiles: [], tiles2: [], collision: [], priority: [] }
  for (let y = sel.y1; y <= sel.y2; y++) {
    for (let x = sel.x1; x <= sel.x2; x++) {
      const i = y * mapWidth.value + x
      data.tiles.push(tiles.value[i] ?? 0)
      data.tiles2.push(tiles2.value[i] ?? 0)
      data.collision.push(!!collisionMap.value[i])
      data.priority.push(!!priorityMap.value[i])
    }
  }
  clipboard.value = data
}

function pasteSelection() {
  const clip = clipboard.value
  if (!clip || !clip.tiles?.length) return
  const sel = selection.value
  const pasteX = sel ? sel.x1 : 0
  const pasteY = sel ? sel.y1 : 0
  pushState()
  ensureTiles()
  pasteAt(pasteX, pasteY)
  selection.value = { x1: pasteX, y1: pasteY, x2: pasteX + clip.w - 1, y2: pasteY + clip.h - 1, w: clip.w, h: clip.h }
  drawMap()
}

function getRelativeTilesetPath(fullPath) {
  if (!props.projectPath) return fullPath.split(/[/\\]/).pop() || 'tileset.png'
  const base = props.projectPath.replace(/[/\\]+$/, '')
  if (fullPath.startsWith(base)) {
    return fullPath.slice(base.length).replace(/^[/\\]/, '')
  }
  return fullPath.split(/[/\\]/).pop() || 'tileset.png'
}

async function loadExisting() {
  const fullPath = currentMapPath.value || (props.asset?.path && props.projectPath ? `${props.projectPath}/${props.asset.path}`.replace(/\/+/g, '/') : null)
  if (!fullPath || !window.retroStudio?.readTextFile) return
  try {
    const content = await window.retroStudio.readTextFile(fullPath)
    const ext = (fullPath || '').toLowerCase()
    let data = null
    if (ext.endsWith('.tmx')) data = fromTMX(content)
    else if (ext.endsWith('.json')) data = fromJSON(content)
    if (data) {
      mapWidth.value = data.width
      mapHeight.value = data.height
      tiles.value = data.tiles || []
      tiles2.value = data.tiles2?.length ? [...data.tiles2] : []
      collisionMap.value = data.collision?.length ? [...data.collision] : []
      priorityMap.value = data.priority?.length ? [...data.priority] : []
      history.value = []
      pushState()
      historyIndex.value = 0
      if (data.tilesetImagePath) {
        const imgName = data.tilesetImagePath.split(/[/\\]/).pop() || ''
        const fileDir = fullPath.replace(/[/\\][^/\\]+$/, '')
        const candidatePath = `${fileDir}/${imgName}`.replace(/\/+/g, '/')
        const projPath = props.projectPath || fileDir.replace(/[/\\]res$/, '')
        try {
          const r = await window.retroStudio.retro.getAssetPreview(projPath, candidatePath)
          if (r?.success) {
            const ts = {
              id: `ts_${Date.now()}`,
              name: imgName.replace(/\.[^.]+$/, ''),
              path: candidatePath,
              preview: r.preview
            }
            userTilesets.value = [ts]
            selectedTilesetId.value = ts.id
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('loadExisting:', e)
  }
}

async function openMap() {
  const baseDir = (props.projectPath || '').replace(/\/+$/, '')
  const mapsDir = baseDir ? `${baseDir}/maps`.replace(/\/+/g, '/') : undefined
  const result = await window.retroStudio?.retro?.selectFile?.({
    context: 'map-open',
    title: 'Abrir mapa TMX',
    defaultPath: mapsDir || baseDir,
    filters: [{ name: 'TMX', extensions: ['tmx'] }, { name: 'Todos', extensions: ['*'] }]
  })
  if (!result?.success || !result.path) return
  currentMapPath.value = result.path
  await loadExisting()
}

async function exportToC() {
  if (!canSave.value || !window.retroStudio?.writeTextFile) return
  const baseDir = (props.projectPath || '').replace(/\/+$/, '')
  const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : undefined
  const result = await window.retroStudio?.retro?.selectSaveFile?.({
    context: 'map-save',
    title: 'Exportar para C',
    defaultPath: resDir || baseDir,
    filters: [{ name: 'C', extensions: ['c', 'h'] }, { name: 'Todos', extensions: ['*'] }]
  })
  if (!result?.success || !result.path) return
  ensureTiles()
  const varName = (result.path.split(/[/\\]/).pop()?.replace(/\.(c|h)$/i, '') || 'map_tiles').replace(/[^a-zA-Z0-9_]/g, '_')
  const cCode = toCArray({ width: mapWidth.value, height: mapHeight.value, tiles: tiles.value }, varName)
  await window.retroStudio.writeTextFile(result.path, cCode)
  window.retroStudioToast?.success?.('Exportado para C')
}

async function saveMapAs() {
  if (!canSave.value || !window.retroStudio?.writeTextFile) return
  const baseDir = (props.projectPath || '').replace(/\/+$/, '')
  const mapsDir = baseDir ? `${baseDir}/maps`.replace(/\/+/g, '/') : undefined
  const result = await window.retroStudio?.retro?.selectSaveFile?.({
    context: 'map-save',
    title: 'Salvar mapa como',
    defaultPath: mapsDir ? `${mapsDir}/map.tmx` : baseDir,
    filters: [{ name: 'TMX', extensions: ['tmx'] }, { name: 'Todos', extensions: ['*'] }]
  })
  if (!result?.success || !result.path) return
  currentMapPath.value = result.path
  await doSave(result.path)
}

/**
 * Salva o tilemap como TMX (compatível com SGDK rescomp).
 */
async function saveMap() {
  if (!canSave.value || !window.retroStudio?.writeTextFile) return
  const outPath = currentMapPath.value
  if (!outPath) {
    await saveMapAs()
    return
  }
  await doSave(outPath)
}

async function doSave(outPath) {
  const ts = selectedTileset.value
  if (!ts) return
  const relPath = getRelativeTilesetPath(ts.path)
  const imgName = relPath.split(/[/\\]/).pop() || 'tileset.png'
  saving.value = true
  try {
    const parentDir = outPath.replace(/[/\\][^/\\]+$/, '')
    if (parentDir && window.retroStudio?.ensureDirectory) {
      await window.retroStudio.ensureDirectory(parentDir)
    }
    ensureTiles()
    const tmx = toTMX({
      width: mapWidth.value,
      height: mapHeight.value,
      tiles: tiles.value,
      tiles2: tiles2.value,
      tilesetImagePath: imgName,
      tilesetColumns: 16,
      collision: collisionMap.value,
      priority: priorityMap.value
    })
    await window.retroStudio.writeTextFile(outPath, tmx)
    if (props.projectPath && window.retroStudio?.retro?.updateTilemapResourceEntry) {
      const base = props.projectPath.replace(/[/\\]+$/, '')
      const tmxRel = outPath.startsWith(base) ? outPath.slice(base.length).replace(/^[/\\]/, '').replace(/\\/g, '/') : outPath.split(/[/\\]/).pop()
      const mapName = (outPath.split(/[/\\]/).pop()?.replace(/\.tmx$/i, '') || 'map').toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_MAP'
      try {
        await window.retroStudio.retro.updateTilemapResourceEntry({ projectPath: props.projectPath, tmxRelPath: tmxRel, mapName })
      } catch (_) {}
    }
    emit('saved')
    window.retroStudioToast?.success?.('Tilemap salvo')
  } catch (e) {
    window.retroStudioToast?.error?.(e?.message || 'Erro ao salvar')
  } finally {
    saving.value = false
  }
}

watch([tilesetPreview, tiles, tiles2, mapWidth, mapHeight, zoom, showGrid, showTileIndices, showCollision, showPriority, collisionMap, priorityMap, selection, selectionDragEnd, isDrawing, dragStart, drawTool, isMovingSelection, movePreview], () => {
  drawMap()
  drawTileset()
}, { flush: 'post' })

watch([selectedTileIndex, showPaletteIndices], drawTileset)

onMounted(() => {
  ensureTiles()
  if (history.value.length === 0) {
    pushState()
    historyIndex.value = 0
  }
})

watch(() => props.asset, (asset) => {
  if (asset?.path && props.projectPath) {
    currentMapPath.value = `${props.projectPath}/${asset.path}`.replace(/\/+/g, '/')
  } else {
    currentMapPath.value = null
  }
  if (asset) loadExisting()
}, { immediate: true })

function onKeydown(e) {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (e.key === 'y') {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'c') {
      e.preventDefault()
      copySelection()
      return
    }
    if (e.key === 'v') {
      e.preventDefault()
      pasteSelection()
      return
    }
    if (e.key === 'd') {
      e.preventDefault()
      duplicateSelection()
      return
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 's') { drawTool.value = 'select'; editCollision.value = false; editPriority.value = false; e.preventDefault() }
  else if (key === 'p') { drawTool.value = 'pencil'; editCollision.value = false; editPriority.value = false; e.preventDefault() }
  else if (key === 'e') { drawTool.value = 'eraser'; editCollision.value = false; editPriority.value = false; e.preventDefault() }
  else if (key === 'f') { drawTool.value = 'fill'; e.preventDefault() }
  else if (key === 'r') { drawTool.value = 'rect'; e.preventDefault() }
  else if (key === 'l') { drawTool.value = 'line'; e.preventDefault() }
  else if (key === 'c') { editCollision.value = !editCollision.value; editPriority.value = false; e.preventDefault() }
  else if (key === 'o') { editPriority.value = !editPriority.value; editCollision.value = false; e.preventDefault() }
  else if (/^[1-9]$/.test(key)) {
    const n = parseInt(key, 10) - 1
    const tilePx = TILE_SIZE_CONST * PALETTE_ZOOM
    const cols = selectedTileset.value ? Math.floor((tilesetCanvas.value?.width || 256) / tilePx) : 32
    const rows = selectedTileset.value ? Math.ceil((tilesetCanvas.value?.height || 128) / tilePx) : 16
    const maxIdx = cols * rows - 1
    if (n <= maxIdx) selectedTileIndex.value = n
    e.preventDefault()
  }
}
</script>

<style scoped>
.tilemap-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

/* Title bar personalizada */
.te-titlebar {
  height: 36px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  background: linear-gradient(180deg, #2d2d30 0%, #252526 100%);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  padding: 0 8px;
}
.te-titlebar-left,
.te-titlebar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.te-titlebar-left { justify-self: start; }
.te-titlebar-right { justify-self: end; }
.te-titlebar-center {
  justify-self: center;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.te-window-controls {
  display: flex;
  margin-right: 12px;
}
.te-app-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.te-logo {
  font-size: 14px;
  color: var(--accent);
  opacity: 0.9;
}
.te-tb-btn {
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
  -webkit-app-region: no-drag;
}
.te-tb-btn:hover { background: rgba(255,255,255,0.08); color: var(--text); }
.te-tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.te-tb-btn.te-close:hover { background: rgba(255, 92, 92, 0.85); color: #111; }

.te-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

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

.te-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.te-toolbar-map {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.te-layer-select,
.te-tools,
.te-debug-tools,
.te-selection-actions,
.te-undo-redo {
  display: flex;
  align-items: center;
  gap: 2px;
}
.te-layer-select { margin-right: 8px; }
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
.te-map-wrap {
  flex: 1;
  position: relative;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 8px;
}
.te-map-wrap.te-panning {
  cursor: grabbing;
}
.te-coord-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: rgba(0,0,0,0.75);
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  color: #aaa;
  pointer-events: none;
}

.te-map-canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  background: #1a1a2e;
  border: 1px solid var(--border);
}

.te-zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
}

.te-zoom button {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  cursor: pointer;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}

.te-zoom button:hover { background: var(--accent); color: #fff; }
</style>
