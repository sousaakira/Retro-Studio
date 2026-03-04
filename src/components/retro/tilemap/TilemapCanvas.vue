<template>
  <div
    ref="mapWrapRef"
    class="te-map-wrap"
    :class="{ 'te-panning': state.isPanning.value }"
    @mousedown="onMapWrapMouseDown"
    @mousemove="onMapWrapMouseMove"
    @mouseleave="onMapWrapMouseLeave"
    @wheel.prevent="onMapWheel"
    @mouseup="onMapWrapMouseUp"
    @scroll="state.updateViewport()"
  >
    <canvas
      ref="mapCanvas"
      class="te-map-canvas"
      :width="state.mapWidth.value * state.TILE_SIZE_CONST * state.zoom.value"
      :height="state.mapHeight.value * state.TILE_SIZE_CONST * state.zoom.value"
      @mousedown="onMapMouseDown"
      @mousemove="onMapMouseMove"
      @mouseup="onMapMouseUp"
      @mouseleave="onMapMouseUp"
      @contextmenu.prevent="onMapContextMenu"
    ></canvas>
    
    <div v-if="state.showCoords.value && state.hoverCoord.value" class="te-coord-hint">
      ({{ state.hoverCoord.value.x }}, {{ state.hoverCoord.value.y }}) → tile {{ state.hoverCoord.value.tileIdx > 0 ? state.hoverCoord.value.tileIdx - 1 : '-' }}{{ state.hoverCoord.value.layer ? ` [${state.hoverCoord.value.layer}]` : '' }}
      <span v-if="state.hoverCoord.value.collision"> | colisão</span>
      <span v-if="state.hoverCoord.value.priority"> | prioridade</span>
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

const mapCanvas = ref(null)
const mapWrapRef = ref(null)

onMounted(() => {
  if (mapCanvas.value) props.state.mapCanvas.value = mapCanvas.value
  if (mapWrapRef.value) props.state.mapWrapRef.value = mapWrapRef.value

  props.state.ensureTiles()
  if (props.state.history.value.length === 0) {
    props.state.pushState()
    props.state.historyIndex.value = 0
  }

  drawMap()
})

function drawMap() {
  const c = props.state.mapCanvas.value
  if (!c) return
  props.state.ensureTiles()
  const tw = props.state.TILE_SIZE_CONST * props.state.zoom.value
  const th = tw
  const drawSelectionOverlay = () => {
    const ctx = c.getContext('2d')
    const sel = props.state.selection.value
    const dragEnd = props.state.selectionDragEnd.value
    const dragStartVal = props.state.dragStart.value
    const move = props.state.movePreview.value
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0
    if (props.state.isMovingSelection.value && move) {
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
    } else if (props.state.isDrawing.value && props.state.drawTool.value === 'select' && dragStartVal != null && dragEnd != null) {
      const mw = props.state.mapWidth.value
      x1 = Math.min(dragStartVal % mw, dragEnd % mw)
      x2 = Math.max(dragStartVal % mw, dragEnd % mw)
      y1 = Math.min(Math.floor(dragStartVal / mw), Math.floor(dragEnd / mw))
      y2 = Math.max(Math.floor(dragStartVal / mw), Math.floor(dragEnd / mw))
      ctx.strokeStyle = '#0f0'
      ctx.lineWidth = 2
      ctx.strokeRect(x1 * tw, y1 * th, (x2 - x1 + 1) * tw, (y2 - y1 + 1) * th)
    }
  }
  if (!props.state.userTilesets.value || props.state.userTilesets.value.length === 0) {
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    drawSelectionOverlay()
    return
  }

  // Load all images
  const loadedImages = []
  let loadedCount = 0
  const tilesetsToLoad = [...props.state.userTilesets.value] // Copy to avoid mutation issues during loop

  // Basic layout: find which tileset the TID belongs to based on firstgid and counts
  // count = cols * Math.ceil(256 / cols) (as seen in toTMX exported values)
  
  for (let i = 0; i < tilesetsToLoad.length; i++) {
    const ts = tilesetsToLoad[i]
    const img = new Image()
    img.src = ts.preview
    img.onload = () => {
      loadedImages.push({ ts, img })
      loadedCount++
      if (loadedCount === tilesetsToLoad.length) {
        renderLoadedMap(loadedImages)
      }
    }
    img.onerror = () => {
      loadedCount++
      if (loadedCount === tilesetsToLoad.length) {
        renderLoadedMap(loadedImages)
      }
    }
  }

  function renderLoadedMap(imagesData) {
    // Sort by firstgid descending to easily find the matching tileset
    imagesData.sort((a, b) => b.ts.firstgid - a.ts.firstgid)
    
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)

    const mw = props.state.mapWidth.value
    const mh = props.state.mapHeight.value
    
    const drawLayer = (arr, alpha = 1.0) => {
      ctx.globalAlpha = alpha
      for (let i = 0; i < arr.length; i++) {
        const tid = arr[i]
        if (tid <= 0) continue
        
        // Find which tileset this tid belongs to
        const tsData = imagesData.find(d => tid >= (d.ts.firstgid || 1)) || imagesData[imagesData.length - 1]
        if (!tsData) continue

        const img = tsData.img
        const cols = tsData.ts.columns || Math.floor(img.width / props.state.TILE_SIZE_CONST) || 16
        const firstgid = tsData.ts.firstgid || 1

        const localTid = tid - firstgid
        const tx = localTid % cols
        const ty = Math.floor(localTid / cols)

        ctx.drawImage(
          img,
          tx * props.state.TILE_SIZE_CONST,
          ty * props.state.TILE_SIZE_CONST,
          props.state.TILE_SIZE_CONST,
          props.state.TILE_SIZE_CONST,
          (i % mw) * tw,
          Math.floor(i / mw) * th,
          tw,
          th
        )
      }
    }

    drawLayer(props.state.tiles.value, 1.0)
    drawLayer(props.state.tiles2.value, props.state.fgOpacity.value)
    ctx.globalAlpha = 1.0 // Reset for grid and other elements
    if (props.state.showGrid.value) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      for (let y = 0; y <= mh; y++) {
        ctx.beginPath()
        ctx.moveTo(0, y * th)
        ctx.lineTo(mw * tw, y * th)
        ctx.stroke()
      }
      for (let x = 0; x <= mw; x++) {
        ctx.beginPath()
        ctx.moveTo(x * tw, 0)
        ctx.lineTo(x * tw, mh * th)
        ctx.stroke()
      }
    }
    if (props.state.showTileIndices.value && tw >= 12) {
      ctx.font = `${Math.min(10, tw - 2)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < props.state.tiles.value.length; i++) {
        const vBg = props.state.tiles.value[i] ?? 0
        const vFg = props.state.tiles2.value[i] ?? 0
        const v = vFg > 0 ? vFg : vBg
        if (v > 0) {
          const px = (i % mw) * tw + tw / 2
          const py = Math.floor(i / mw) * th + th / 2
          ctx.fillStyle = vFg > 0 ? 'rgba(0,255,255,0.9)' : 'rgba(255,255,0,0.8)'
          ctx.fillText(String(v - 1), px, py)
        }
      }
    }
    if (props.state.showCollision.value) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.35)'
      for (let i = 0; i < props.state.tiles.value.length; i++) {
        if (props.state.collisionMap.value[i]) {
          ctx.fillRect(
            (i % mw) * tw,
            Math.floor(i / mw) * th,
            tw,
            th
          )
        }
      }
    }
    if (props.state.showPriority.value) {
      ctx.fillStyle = 'rgba(0, 100, 255, 0.3)'
      for (let i = 0; i < props.state.tiles.value.length; i++) {
        if (props.state.priorityMap.value[i]) {
          ctx.fillRect(
            (i % mw) * tw,
            Math.floor(i / mw) * th,
            tw,
            th
          )
        }
      }
    }
    
    // Draw Objects
    if (props.state.objects.value && props.state.objects.value.length > 0) {
      for (const obj of props.state.objects.value) {
        const ox = obj.x * tw
        const oy = obj.y * th
        
        ctx.fillStyle = 'rgba(255, 0, 255, 0.4)'
        ctx.fillRect(ox, oy, tw, th)
        
        ctx.strokeStyle = '#ff00ff'
        ctx.lineWidth = 2
        ctx.strokeRect(ox, oy, tw, th)
        
        // Draw label
        if (tw >= 16) {
          ctx.font = `${Math.min(10, tw - 4)}px sans-serif`
          ctx.fillStyle = '#fff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          
          // Background behind text
          const txt = `O:${obj.id}`
          const textW = ctx.measureText(txt).width
          ctx.fillStyle = 'rgba(0,0,0,0.6)'
          ctx.fillRect(ox + tw/2 - textW/2 - 2, oy + th/2 - 5 - 1, textW + 4, 12)
          
          ctx.fillStyle = '#fff'
          ctx.fillText(txt, ox + tw / 2, oy + th / 2 - 1)
        }
      }
    }
    
    drawSelectionOverlay()
  }
}

// Map Watchers to trigger drawing
watch(
  [
    () => props.state.userTilesets.value,
    () => props.state.tiles.value,
    () => props.state.tiles2.value,
    () => props.state.mapWidth.value,
    () => props.state.mapHeight.value,
    () => props.state.zoom.value,
    () => props.state.showGrid.value,
    () => props.state.showTileIndices.value,
    () => props.state.showCollision.value,
    () => props.state.showPriority.value,
    () => props.state.collisionMap.value,
    () => props.state.priorityMap.value,
    () => props.state.selection.value,
    () => props.state.selectionDragEnd.value,
    () => props.state.isDrawing.value,
    () => props.state.dragStart.value,
    () => props.state.drawTool.value,
    () => props.state.isMovingSelection.value,
    () => props.state.movePreview.value,
    () => props.state.fgOpacity.value,
    () => props.state.objects.value
  ], 
  () => {
    drawMap()
  }, 
  { deep: true, flush: 'post' }
)

// Mouse / Interaction Logic (delegated back to the composable actions)
function getMapTileFromEvent(e) {
  const c = props.state.mapCanvas.value
  if (!c) return -1
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return -1
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY
  const x = Math.floor(canvasX / (props.state.TILE_SIZE_CONST * props.state.zoom.value))
  const y = Math.floor(canvasY / (props.state.TILE_SIZE_CONST * props.state.zoom.value))
  if (x < 0 || x >= props.state.mapWidth.value || y < 0 || y >= props.state.mapHeight.value) return -1
  return y * props.state.mapWidth.value + x
}

function finishMoveSelection() {
  if (!props.state.isMovingSelection.value || !props.state.movePreview.value || !props.state.selection.value) return
  const prev = props.state.selection.value
  const next = props.state.movePreview.value
  if (next.x1 !== prev.x1 || next.y1 !== prev.y1) {
    props.state.pushState()
    props.state.moveSelectionTo(next.x1, next.y1)
  }
  props.state.isMovingSelection.value = false
  props.state.moveStartInSelection.value = null
  props.state.movePreview.value = null
}

function onMapWrapMouseDown(e) {
  if (e.button === 1) {
    props.state.isPanning.value = true
    const wrap = props.state.mapWrapRef.value
    props.state.panStart.value = { x: e.clientX, y: e.clientY, scrollLeft: wrap?.scrollLeft ?? 0, scrollTop: wrap?.scrollTop ?? 0 }
    e.preventDefault()
  }
}

function onMapWrapMouseMove(e) {
  if (props.state.isPanning.value) {
    const wrap = props.state.mapWrapRef.value
    if (wrap) {
      wrap.scrollLeft = props.state.panStart.value.scrollLeft + props.state.panStart.value.x - e.clientX
      wrap.scrollTop = props.state.panStart.value.scrollTop + props.state.panStart.value.y - e.clientY
    }
    return
  }
  onMapHover(e)
}

function onMapHover(e) {
  if (!props.state.showCoords.value) return
  const idx = getMapTileFromEvent(e)
  if (idx >= 0) {
    const x = idx % props.state.mapWidth.value
    const y = Math.floor(idx / props.state.mapWidth.value)
    const vFg = props.state.tiles2.value[idx] ?? 0
    const vBg = props.state.tiles.value[idx] ?? 0
    props.state.hoverCoord.value = {
      x,
      y,
      tileIdx: vFg > 0 ? vFg : vBg,
      layer: vFg > 0 ? 'FG' : 'BG',
      collision: !!props.state.collisionMap.value[idx],
      priority: !!props.state.priorityMap.value[idx]
    }
  } else {
    props.state.hoverCoord.value = null
  }
}

function onMapWrapMouseLeave() {
  props.state.hoverCoord.value = null
  if (props.state.isPanning.value) props.state.isPanning.value = false
}

function onMapWrapMouseUp(e) {
  if (e.button === 1) props.state.isPanning.value = false
  if (e.button === 0 && props.state.isMovingSelection.value) finishMoveSelection()
}

function onMapWheel(e) {
  e.preventDefault()
  let currZoom = props.state.zoom.value
  if (e.deltaY < 0) props.state.zoom.value = Math.min(8, currZoom + 1)
  else if (e.deltaY > 0) props.state.zoom.value = Math.max(1, currZoom - 1)
}

function onMapContextMenu(e) {
  const idx = getMapTileFromEvent(e)
  if (idx < 0) return
  const vFg = props.state.tiles2.value[idx] ?? 0
  const vBg = props.state.tiles.value[idx] ?? 0
  const v = vFg > 0 ? vFg : vBg
  if (v > 0) {
    props.state.selectedTileIndex.value = v - 1
    props.state.activeLayer.value = vFg > 0 ? 'fg' : 'bg'
    window.retroStudioToast?.success?.(`Tile ${v - 1} copiado`)
  }
}

function onMapMouseDown(e) {
  if (e.button !== 0) return
  const idx = getMapTileFromEvent(e)
  if (idx < 0) return
  props.state.ensureTiles()

  const state = props.state
  if (state.editCollision.value) {
    state.toggleTileAttribute(idx, 'collision')
    return
  }
  if (state.editPriority.value) {
    state.toggleTileAttribute(idx, 'priority')
    return
  }
  if (state.drawTool.value === 'fill') {
    state.fillTile(idx)
    return
  }
  if (state.drawTool.value === 'select') {
    const sel = state.selection.value
    if (sel && state.isTileInSelection(idx)) {
      const ox = sel.x1
      const oy = sel.y1
      const cx = idx % state.mapWidth.value
      const cy = Math.floor(idx / state.mapWidth.value)
      state.isMovingSelection.value = true
      state.moveStartInSelection.value = { offsetX: cx - ox, offsetY: cy - oy }
      state.movePreview.value = { x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2 }
      const onUp = () => { finishMoveSelection(); document.removeEventListener('mouseup', onUp) }
      document.addEventListener('mouseup', onUp)
      return
    }
    state.dragStart.value = idx
    state.isDrawing.value = true
    state.selection.value = null
    return
  }

  if (state.drawTool.value === 'object') {
    state.placeObject(idx)
    return
  }
  
  if (state.drawTool.value === 'rect' || state.drawTool.value === 'line') {
    state.pushState()
    state.dragStart.value = idx
    state.isDrawing.value = true
    return
  }
  
  state.pushState()
  state.isDrawing.value = true
  state.paintTile(idx)
}

function onMapMouseMove(e) {
  const idx = getMapTileFromEvent(e)
  const state = props.state

  if (state.isMovingSelection.value && state.moveStartInSelection.value) {
    if (idx >= 0) {
      const cx = idx % state.mapWidth.value
      const cy = Math.floor(idx / state.mapWidth.value)
      const { offsetX, offsetY } = state.moveStartInSelection.value
      const sel = state.selection.value
      if (sel) {
        let nx1 = cx - offsetX
        let ny1 = cy - offsetY
        nx1 = Math.max(0, Math.min(nx1, state.mapWidth.value - sel.w))
        ny1 = Math.max(0, Math.min(ny1, state.mapHeight.value - sel.h))
        state.movePreview.value = { x1: nx1, y1: ny1, x2: nx1 + sel.w - 1, y2: ny1 + sel.h - 1 }
      }
    }
    return
  }
  if (state.drawTool.value === 'select' && state.isDrawing.value) {
    state.selectionDragEnd.value = idx >= 0 ? idx : state.dragStart.value
    return
  }
  if (!state.isDrawing.value) return
  if (state.drawTool.value === 'rect' || state.drawTool.value === 'line') return
  state.paintTile(idx)
}

function onMapMouseUp(e) {
  const state = props.state
  if (e.button === 0 && state.isMovingSelection.value) {
    finishMoveSelection()
    return
  }
  if (!state.isDrawing.value || !state.dragStart.value) {
    state.isDrawing.value = false
    state.dragStart.value = null
    return
  }
  const idx = getMapTileFromEvent(e)
  const mw = state.mapWidth.value
  
  if (state.drawTool.value === 'select') {
    const i1 = state.dragStart.value
    const i2 = idx >= 0 ? idx : i1
    const x1 = Math.min(i1 % mw, i2 % mw)
    const x2 = Math.max(i1 % mw, i2 % mw)
    const y1 = Math.min(Math.floor(i1 / mw), Math.floor(i2 / mw))
    const y2 = Math.max(Math.floor(i1 / mw), Math.floor(i2 / mw))
    state.selection.value = { x1, y1, x2, y2, w: x2 - x1 + 1, h: y2 - y1 + 1 }
    state.selectionDragEnd.value = null
  } else if (state.drawTool.value === 'rect') {
    state.paintRect(state.dragStart.value, idx >= 0 ? idx : state.dragStart.value)
  } else if (state.drawTool.value === 'line') {
    state.paintLine(state.dragStart.value, idx >= 0 ? idx : state.dragStart.value)
  }
  
  state.isDrawing.value = false
  state.dragStart.value = null
}
</script>

<style scoped>
.te-map-wrap {
  flex: 1;
  position: relative;
  overflow: auto;
  display: flex;
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
</style>
