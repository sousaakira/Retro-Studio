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
        <div class="te-section" v-if="selectedTileset">
          <label>Paleta de tiles</label>
          <div class="te-tileset-preview" ref="tilesetRef">
            <canvas ref="tilesetCanvas" @click="onTilesetClick"></canvas>
          </div>
          <div class="te-tile-info">Tile: {{ selectedTileIndex }}</div>
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
          <div class="te-zoom">
            <button @click="zoom = Math.max(1, zoom - 1)">−</button>
            <span>{{ zoom }}×</span>
            <button @click="zoom = Math.min(8, zoom + 1)">+</button>
          </div>
        </div>
        <div class="te-map-wrap" @mousemove="onMapHover" @mouseleave="hoverCoord = null">
          <canvas
            ref="mapCanvas"
            class="te-map-canvas"
            :width="mapWidth * TILE_SIZE * zoom"
            :height="mapHeight * TILE_SIZE * zoom"
            @mousedown="onMapMouseDown"
            @mousemove="onMapMouseMove"
            @mouseup="onMapMouseUp"
            @mouseleave="onMapMouseUp"
          ></canvas>
          <div v-if="showCoords && hoverCoord" class="te-coord-hint">
            ({{ hoverCoord.x }}, {{ hoverCoord.y }}) → tile {{ hoverCoord.tileIdx }}
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
 *
 * SUGESTÕES DE MELHORIAS FUTURAS:
 * - Desfazer/Refazer (Ctrl+Z / Ctrl+Shift+Z) com histórico de edições
 * - Copiar/colar região (seleção retangular) - Ctrl+C, Ctrl+V
 * - Camadas múltiplas (foreground, background)
 * - Atributos por tile (colisão, prioridade, etc)
 * - Preview em tempo real no jogo (hot reload)
 * - Export para formato C (array de tiles) para uso direto no SGDK
 * - Suporte a tilesets animados
 * - Ferramenta de seleção de região para mover/duplicar
 * - Atalhos numéricos (1-9) para tiles rápidos
 * - Grid de snap configurável (8, 16, 32)
 * - Zoom com scroll do mouse
 * - Pan/arrastar com botão do meio
 */
import { ref, computed, watch } from 'vue'
import { toTMX, fromTMX, fromJSON, TILE_SIZE } from '@/utils/retro/tmxFormat.js'

const props = defineProps({
  asset: { type: Object, default: null },
  projectPath: { type: String, default: '' },
  assets: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'saved'])

const TILE_SIZE_CONST = TILE_SIZE
const mapCanvas = ref(null)
const tilesetCanvas = ref(null)

const mapWidth = ref(40)
const mapHeight = ref(30)
const tiles = ref([])
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
  line: { id: 'line', icon: '∕', title: 'Linha (L)' }
}
const drawTools = Object.values(DRAW_TOOLS)
const drawTool = ref('pencil')

// Debug
const showGrid = ref(true)
const showTileIndices = ref(false)
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
  return props.asset?.path || 'res/map.tmx'
}

function minimize() {
  window.monarco?.windowMinimize?.()
}
async function toggleMaximize() {
  window.monarco?.windowToggleMaximize?.()
  try {
    isMaximized.value = await window.monarco?.windowIsMaximized?.() ?? false
  } catch (_) {}
}

function ensureTiles() {
  const len = mapWidth.value * mapHeight.value
  if (tiles.value.length !== len) {
    tiles.value = Array.from({ length: len }, (_, i) => tiles.value[i] ?? 0)
  }
  if (collisionMap.value.length !== len) {
    collisionMap.value = Array.from({ length: len }, (_, i) => collisionMap.value[i] ?? false)
  }
  if (priorityMap.value.length !== len) {
    priorityMap.value = Array.from({ length: len }, (_, i) => priorityMap.value[i] ?? false)
  }
}

watch([mapWidth, mapHeight], ensureTiles)

async function addTileset() {
  const baseDir = (props.projectPath || '').replace(/\/+$/, '')
  const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : ''
  const result = await window.monarco?.retro?.selectFile?.({
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
    const r = await window.monarco?.retro?.getAssetPreview?.(props.projectPath, fullPath)
    preview = r?.success ? r.preview : null
  } catch (_) {}
  if (!preview) {
    window.monarcoToast?.error?.('Não foi possível carregar a imagem')
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
    c.width = Math.min(cols * TILE_SIZE_CONST, 256)
    c.height = Math.min(Math.ceil(img.height / TILE_SIZE_CONST) * TILE_SIZE_CONST, 128)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, 0, c.width, c.height)
    if (selectedTileIndex.value >= 0) {
      const tx = selectedTileIndex.value % cols
      const ty = Math.floor(selectedTileIndex.value / cols)
      ctx.strokeStyle = '#0f0'
      ctx.lineWidth = 2
      ctx.strokeRect(tx * TILE_SIZE_CONST, ty * TILE_SIZE_CONST, TILE_SIZE_CONST, TILE_SIZE_CONST)
    }
  }
  img.src = tilesetPreview.value
}

function onTilesetClick(e) {
  const c = tilesetCanvas.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  // Corrige escala: canvas pode estar renderizado em tamanho diferente do exibido (CSS)
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY
  const tileX = Math.floor(canvasX / TILE_SIZE_CONST)
  const tileY = Math.floor(canvasY / TILE_SIZE_CONST)
  const cols = Math.floor(c.width / TILE_SIZE_CONST)
  const rows = Math.floor(c.height / TILE_SIZE_CONST)
  if (tileX >= 0 && tileX < cols && tileY >= 0 && tileY < rows) {
    selectedTileIndex.value = tileY * cols + tileX
  }
  drawTileset()
}

function drawMap() {
  const c = mapCanvas.value
  if (!c || !tilesetPreview.value) return
  ensureTiles()
  const img = new Image()
  img.onload = () => {
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)
    const cols = Math.floor(img.width / TILE_SIZE_CONST)
    const tw = TILE_SIZE_CONST * zoom.value
    const th = TILE_SIZE_CONST * zoom.value
    for (let i = 0; i < tiles.value.length; i++) {
      const tid = tiles.value[i]
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
      ctx.fillStyle = 'rgba(255,255,0,0.8)'
      for (let i = 0; i < tiles.value.length; i++) {
        const v = tiles.value[i] ?? 0
        if (v > 0) {
          const px = (i % mapWidth.value) * tw + tw / 2
          const py = Math.floor(i / mapWidth.value) * th + th / 2
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

function paintTile(idx) {
  if (idx < 0) return
  ensureTiles()
  const newVal = getPaintValue()
  if (tiles.value[idx] !== newVal) {
    tiles.value[idx] = newVal
    tiles.value = [...tiles.value]
    drawMap()
  }
}

function fillTile(idx) {
  if (idx < 0 || !selectedTileset.value) return
  ensureTiles()
  const targetVal = tiles.value[idx]
  const newVal = getPaintValue()
  if (targetVal === newVal) return
  const cols = Math.floor((tilesetCanvas.value?.width || 256) / TILE_SIZE_CONST)
  const maxIdx = cols * Math.ceil((tilesetCanvas.value?.height || 128) / TILE_SIZE_CONST)
  const stack = [idx]
  const visited = new Set([idx])
  let count = 0
  const maxFill = mapWidth.value * mapHeight.value
  while (stack.length > 0 && count < maxFill) {
    const i = stack.pop()
    if (tiles.value[i] !== targetVal) continue
    tiles.value[i] = newVal
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
  tiles.value = [...tiles.value]
  drawMap()
}

function paintRect(idx1, idx2) {
  if (idx1 < 0 || idx2 < 0) return
  ensureTiles()
  const x1 = Math.min(idx1 % mapWidth.value, idx2 % mapWidth.value)
  const x2 = Math.max(idx1 % mapWidth.value, idx2 % mapWidth.value)
  const y1 = Math.min(Math.floor(idx1 / mapWidth.value), Math.floor(idx2 / mapWidth.value))
  const y2 = Math.max(Math.floor(idx1 / mapWidth.value), Math.floor(idx2 / mapWidth.value))
  const newVal = getPaintValue()
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const i = y * mapWidth.value + x
      tiles.value[i] = newVal
    }
  }
  tiles.value = [...tiles.value]
  drawMap()
}

function paintLine(idx1, idx2) {
  if (idx1 < 0 || idx2 < 0) return
  ensureTiles()
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
    tiles.value[i] = newVal
    if (x === x2 && y === y2) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
  tiles.value = [...tiles.value]
  drawMap()
}

function onMapHover(e) {
  if (!showCoords.value) return
  const idx = getMapTileFromEvent(e)
  if (idx >= 0) {
    const x = idx % mapWidth.value
    const y = Math.floor(idx / mapWidth.value)
    hoverCoord.value = {
      x,
      y,
      tileIdx: tiles.value[idx] ?? 0,
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
  const arr = attr === 'collision' ? collisionMap.value : priorityMap.value
  arr[idx] = !arr[idx]
  if (attr === 'collision') collisionMap.value = [...arr]
  else priorityMap.value = [...arr]
  drawMap()
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
  if (drawTool.value === 'rect' || drawTool.value === 'line') {
    dragStart.value = idx
    isDrawing.value = true
    return
  }
  isDrawing.value = true
  paintTile(idx)
}

function onMapMouseMove(e) {
  if (!isDrawing.value) return
  const idx = getMapTileFromEvent(e)
  if (drawTool.value === 'rect' || drawTool.value === 'line') return
  paintTile(idx)
}

function onMapMouseUp(e) {
  if (!isDrawing.value || !dragStart.value) {
    isDrawing.value = false
    dragStart.value = null
    return
  }
  const idx = getMapTileFromEvent(e)
  if (drawTool.value === 'rect') {
    paintRect(dragStart.value, idx >= 0 ? idx : dragStart.value)
  } else if (drawTool.value === 'line') {
    paintLine(dragStart.value, idx >= 0 ? idx : dragStart.value)
  }
  isDrawing.value = false
  dragStart.value = null
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
  if (!fullPath || !window.monarco?.readTextFile) return
  try {
    const content = await window.monarco.readTextFile(fullPath)
    const ext = (fullPath || '').toLowerCase()
    let data = null
    if (ext.endsWith('.tmx')) data = fromTMX(content)
    else if (ext.endsWith('.json')) data = fromJSON(content)
    if (data) {
      mapWidth.value = data.width
      mapHeight.value = data.height
      tiles.value = data.tiles || []
      collisionMap.value = data.collision?.length ? [...data.collision] : []
      priorityMap.value = data.priority?.length ? [...data.priority] : []
      if (data.tilesetImagePath) {
        const imgName = data.tilesetImagePath.split(/[/\\]/).pop() || ''
        const fileDir = fullPath.replace(/[/\\][^/\\]+$/, '')
        const candidatePath = `${fileDir}/${imgName}`.replace(/\/+/g, '/')
        const projPath = props.projectPath || fileDir.replace(/[/\\]res$/, '')
        try {
          const r = await window.monarco.retro.getAssetPreview(projPath, candidatePath)
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
  const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : undefined
  const result = await window.monarco?.retro?.selectFile?.({
    context: 'map-open',
    title: 'Abrir mapa TMX',
    defaultPath: resDir || baseDir,
    filters: [{ name: 'TMX', extensions: ['tmx'] }, { name: 'Todos', extensions: ['*'] }]
  })
  if (!result?.success || !result.path) return
  currentMapPath.value = result.path
  await loadExisting()
}

async function saveMapAs() {
  if (!canSave.value || !window.monarco?.writeTextFile) return
  const baseDir = (props.projectPath || '').replace(/\/+$/, '')
  const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : undefined
  const result = await window.monarco?.retro?.selectSaveFile?.({
    context: 'map-save',
    title: 'Salvar mapa como',
    defaultPath: resDir || baseDir,
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
  if (!canSave.value || !window.monarco?.writeTextFile) return
  let outPath = currentMapPath.value
  if (!outPath && props.projectPath) {
    const base = props.projectPath.replace(/\/+$/, '')
    outPath = `${base}/res/map.tmx`.replace(/\/+/g, '/')
  }
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
    ensureTiles()
    const tmx = toTMX({
      width: mapWidth.value,
      height: mapHeight.value,
      tiles: tiles.value,
      tilesetImagePath: imgName,
      tilesetColumns: 16,
      collision: collisionMap.value,
      priority: priorityMap.value
    })
    await window.monarco.writeTextFile(outPath, tmx)
    emit('saved')
    window.monarcoToast?.success?.('Tilemap salvo')
  } catch (e) {
    window.monarcoToast?.error?.(e?.message || 'Erro ao salvar')
  } finally {
    saving.value = false
  }
}

watch([tilesetPreview, tiles, mapWidth, mapHeight, zoom, showGrid, showTileIndices, showCollision, showPriority, collisionMap, priorityMap], () => {
  drawMap()
  drawTileset()
}, { flush: 'post' })

watch(selectedTileIndex, drawTileset)

watch(() => props.asset, (asset) => {
  if (asset?.path && props.projectPath) {
    currentMapPath.value = `${props.projectPath}/${asset.path}`.replace(/\/+/g, '/')
  } else {
    currentMapPath.value = null
  }
  if (asset) loadExisting()
}, { immediate: true })

function onKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'p') { drawTool.value = 'pencil'; editCollision.value = false; editPriority.value = false; e.preventDefault() }
  else if (key === 'e') { drawTool.value = 'eraser'; editCollision.value = false; editPriority.value = false; e.preventDefault() }
  else if (key === 'f') { drawTool.value = 'fill'; e.preventDefault() }
  else if (key === 'r') { drawTool.value = 'rect'; e.preventDefault() }
  else if (key === 'l') { drawTool.value = 'line'; e.preventDefault() }
  else if (key === 'c') { editCollision.value = !editCollision.value; editPriority.value = false; e.preventDefault() }
  else if (key === 'o') { editPriority.value = !editPriority.value; editCollision.value = false; e.preventDefault() }
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

.te-tileset-preview {
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: auto;
  max-height: 180px;
}

.te-tileset-preview canvas {
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.te-tile-info { font-size: 11px; color: var(--muted); margin-top: 4px; }

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
.te-tools,
.te-debug-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
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
