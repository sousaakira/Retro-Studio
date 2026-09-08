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
      @mousedown="onMapMouseDown"
      @mousemove="onMapMouseMove"
      @mouseup="onMapMouseUp"
      @mouseleave="onMapMouseUp"
      @contextmenu.prevent="onMapContextMenu"
    ></canvas>
    
    <div
      v-if="!hasTilesets"
      class="te-empty-canvas"
    >
      <p class="te-empty-canvas-title">{{ t('tilemap.emptyCanvasTitle') }}</p>
      <p class="te-empty-canvas-hint">{{ t('tilemap.emptyCanvasHint') }}</p>
      <button type="button" class="te-empty-canvas-btn" @click="state.addTileset()">
        {{ t('tilemap.emptyCanvasAction') }}
      </button>
    </div>

    <div v-if="state.showCoords.value && state.hoverCoord.value" class="te-coord-hint">
      ({{ state.hoverCoord.value.x }}, {{ state.hoverCoord.value.y }}) → tile {{ state.hoverCoord.value.tileIdx > 0 ? state.hoverCoord.value.tileIdx - 1 : '-' }}{{ state.hoverCoord.value.layer ? ` [${state.hoverCoord.value.layer}]` : '' }}
      <span v-if="state.hoverCoord.value.collision"> | colisão {{ state.hoverCoord.value.collisionValue }}</span>
      <span v-if="state.hoverCoord.value.priority"> | prioridade</span>
      <span v-if="state.hoverCoord.value.flipH || state.hoverCoord.value.flipV">
        | flip {{ state.hoverCoord.value.flipH ? 'H' : '' }}{{ state.hoverCoord.value.flipV ? 'V' : '' }}
      </span>
      <span v-if="state.hoverCoord.value.palette"> | PAL{{ state.hoverCoord.value.palette }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, unref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  state: {
    type: Object,
    required: true
  }
})

const mapCanvas = ref(null)
const mapWrapRef = ref(null)

function st(key) {
  return unref(props.state?.[key])
}

function setSt(key, val) {
  const r = props.state?.[key]
  if (r && typeof r === 'object' && 'value' in r) r.value = val
}

function zoomVal() {
  const z = props.state?.zoom
  if (z && typeof z === 'object' && 'value' in z) return Number(z.value) || 1
  return Number(z) || 1
}

const hasTilesets = computed(() => {
  const list = st('userTilesets')
  return Array.isArray(list) && list.length > 0
})

/** Keep buffer size in sync. Setting width/height clears pixels — always redraw after. */
function syncCanvasSize(c) {
  const tileSize = st('TILE_SIZE_CONST') || 8
  const zoom = zoomVal()
  const mw = st('mapWidth') || 1
  const mh = st('mapHeight') || 1
  const needW = Math.max(1, Math.floor(mw * tileSize * zoom))
  const needH = Math.max(1, Math.floor(mh * tileSize * zoom))
  if (c.width !== needW) c.width = needW
  if (c.height !== needH) c.height = needH
  return { tileSize, zoom, tw: tileSize * zoom, th: tileSize * zoom, mw, mh }
}

onMounted(() => {
  if (mapCanvas.value) setSt('mapCanvas', mapCanvas.value)
  if (mapWrapRef.value) setSt('mapWrapRef', mapWrapRef.value)

  props.state.ensureTiles()
  if (!st('history')?.length) {
    props.state.pushState()
    setSt('historyIndex', 0)
  }

  drawMap()
})

function drawMap() {
  const c = mapCanvas.value || st('mapCanvas')
  if (!c) return
  props.state.ensureTiles()
  const { tw, th, mw, mh } = syncCanvasSize(c)
  const tilesets = (() => {
    const list = st('userTilesets')
    return Array.isArray(list) ? list : []
  })()
  const drawSelectionOverlay = () => {
    if (st('drawTool') !== 'select' && !st('isMovingSelection')) return
    const ctx = c.getContext('2d')
    const sel = st('selection')
    const dragEnd = st('selectionDragEnd')
    const dragStartVal = st('dragStart')
    const move = st('movePreview')
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0
    if (st('isMovingSelection') && move) {
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
    } else if (st('isDrawing') && dragStartVal != null && dragEnd != null) {
      x1 = Math.min(dragStartVal % mw, dragEnd % mw)
      x2 = Math.max(dragStartVal % mw, dragEnd % mw)
      y1 = Math.min(Math.floor(dragStartVal / mw), Math.floor(dragEnd / mw))
      y2 = Math.max(Math.floor(dragStartVal / mw), Math.floor(dragEnd / mw))
      ctx.strokeStyle = '#0f0'
      ctx.lineWidth = 2
      ctx.strokeRect(x1 * tw, y1 * th, (x2 - x1 + 1) * tw, (y2 - y1 + 1) * th)
    }
  }
  if (!tilesets.length) {
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    const mw = st('mapWidth')
    const mh = st('mapHeight')
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        ctx.fillStyle = ((x + y) % 2 === 0) ? '#1e1e32' : '#16162a'
        ctx.fillRect(x * tw, y * th, tw, th)
      }
    }
    if (st('showGrid')) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      for (let x = 0; x <= mw; x++) {
        ctx.beginPath()
        ctx.moveTo(x * tw + 0.5, 0)
        ctx.lineTo(x * tw + 0.5, mh * th)
        ctx.stroke()
      }
      for (let y = 0; y <= mh; y++) {
        ctx.beginPath()
        ctx.moveTo(0, y * th + 0.5)
        ctx.lineTo(mw * tw, y * th + 0.5)
        ctx.stroke()
      }
    }
    drawSelectionOverlay()
    return
  }

  // Wipe checker immediately so painting never looks "stuck" on empty pattern
  {
    const boot = c.getContext('2d')
    boot.fillStyle = '#1a1a2e'
    boot.fillRect(0, 0, c.width, c.height)
  }

  const tilesetsToLoad = [...tilesets]
  const drawGeneration = (c.__teDrawGen = (c.__teDrawGen || 0) + 1)

  const renderWhenReady = (imagesData) => {
    if (c.__teDrawGen !== drawGeneration) return
    renderLoadedMap(imagesData)
  }

  const allCached =
    tilesetsToLoad.length > 0 &&
    tilesetsToLoad.every((ts) => ts._img && ts._img.naturalWidth > 0)

  if (allCached) {
    renderWhenReady(tilesetsToLoad.map((ts) => ({ ts, img: ts._img })))
  } else {
    Promise.all(
      tilesetsToLoad.map(
        (ts) =>
          new Promise((resolve) => {
            if (ts._img && ts._img.naturalWidth > 0) {
              resolve({ ts, img: ts._img })
              return
            }
            if (!ts.preview) {
              resolve({ ts, img: null })
              return
            }
            const img = new Image()
            img.onload = () => {
              ts._img = markRawImg(img)
              resolve({ ts, img })
            }
            img.onerror = () => resolve({ ts, img: null })
            img.src = ts.preview
          })
      )
    ).then(renderWhenReady)
  }

  function markRawImg(img) {
    return img
  }

  function renderLoadedMap(imagesData) {
    // Sort by firstgid descending to easily find the matching tileset
    imagesData.sort((a, b) => (b.ts.firstgid || 0) - (a.ts.firstgid || 0))
    
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, c.width, c.height)

    const mw = st('mapWidth')
    const mh = st('mapHeight')
    const tilePx = st('TILE_SIZE_CONST') || 8
    
    const drawLayer = (arr, alpha = 1.0, layerKey = 'bg') => {
      if (!arr?.length) return
      ctx.globalAlpha = alpha
      const fh = layerKey === 'fg' ? st('flipHMap2') : st('flipHMap')
      const fv = layerKey === 'fg' ? st('flipVMap2') : st('flipVMap')
      for (let i = 0; i < arr.length; i++) {
        const tid = arr[i]
        if (tid <= 0) continue
        
        const tsData = imagesData.find(d => tid >= (d.ts.firstgid || 1)) || imagesData[imagesData.length - 1]
        const dx = (i % mw) * tw
        const dy = Math.floor(i / mw) * th

        if (!tsData?.img) {
          ctx.fillStyle = `hsl(${(tid * 47) % 360} 55% 42%)`
          ctx.fillRect(dx, dy, tw, th)
          continue
        }

        const img = tsData.img
        const natW = img.naturalWidth || 0
        // Preferir colunas da imagem; ts.columns do TMX costuma estar errado
        const cols = (natW > 0 ? Math.floor(natW / tilePx) : 0) || tsData.ts.columns || 16
        if (tsData.ts && natW > 0) tsData.ts.columns = cols
        const firstgid = tsData.ts.firstgid || 1

        const localTid = tid - firstgid
        const tx = localTid % cols
        const ty = Math.floor(localTid / cols)
        const doFlipH = !!fh?.[i]
        const doFlipV = !!fv?.[i]

        try {
          if (doFlipH || doFlipV) {
            ctx.save()
            ctx.translate(dx + (doFlipH ? tw : 0), dy + (doFlipV ? th : 0))
            ctx.scale(doFlipH ? -1 : 1, doFlipV ? -1 : 1)
            ctx.drawImage(img, tx * tilePx, ty * tilePx, tilePx, tilePx, 0, 0, tw, th)
            ctx.restore()
          } else {
            ctx.drawImage(img, tx * tilePx, ty * tilePx, tilePx, tilePx, dx, dy, tw, th)
          }
        } catch (_) {
          ctx.fillStyle = `hsl(${(tid * 47) % 360} 55% 42%)`
          ctx.fillRect(dx, dy, tw, th)
        }
      }
    }

    drawLayer(st('tiles') || [], 1.0, 'bg')
    drawLayer(st('tiles2') || [], st('fgOpacity') ?? 1, 'fg')
    ctx.globalAlpha = 1.0 // Reset for grid and other elements
    if (st('showGrid')) {
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
      for (let i = 0; i < props.state.tiles.value.length; i++) {
        const cell = props.state.collisionMap.value[i]
        if (!props.state.hasCollision?.(cell) && !cell) continue
        const n = Number(cell) || 0
        if (!n) continue
        const px = (i % mw) * tw
        const py = Math.floor(i / mw) * th
        const type = (n >> 4) & 0x0f
        const dirs = n & 0x0f
        const colors = {
          1: 'rgba(255, 0, 0, 0.35)',
          2: 'rgba(0, 200, 80, 0.4)',
          3: 'rgba(30, 120, 255, 0.4)',
          4: 'rgba(255, 80, 0, 0.45)',
          5: 'rgba(180, 0, 255, 0.4)'
        }
        ctx.fillStyle = colors[type] || 'rgba(255, 0, 0, 0.35)'
        ctx.fillRect(px, py, tw, th)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = Math.max(1, tw / 8)
        if (dirs & 0x01) { // TOP
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + tw, py); ctx.stroke()
        }
        if (dirs & 0x02) { // BOTTOM
          ctx.beginPath(); ctx.moveTo(px, py + th); ctx.lineTo(px + tw, py + th); ctx.stroke()
        }
        if (dirs & 0x04) { // LEFT
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + th); ctx.stroke()
        }
        if (dirs & 0x08) { // RIGHT
          ctx.beginPath(); ctx.moveTo(px + tw, py); ctx.lineTo(px + tw, py + th); ctx.stroke()
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
    if (props.state.showFlips?.value) {
      const layer = props.state.activeLayer.value === 'fg' ? 'fg' : 'bg'
      const fh = layer === 'fg' ? props.state.flipHMap2.value : props.state.flipHMap.value
      const fv = layer === 'fg' ? props.state.flipVMap2.value : props.state.flipVMap.value
      for (let i = 0; i < props.state.tiles.value.length; i++) {
        const h = !!fh?.[i]
        const v = !!fv?.[i]
        if (!h && !v) continue
        const px = (i % mw) * tw
        const py = Math.floor(i / mw) * th
        ctx.fillStyle = 'rgba(255, 200, 0, 0.25)'
        ctx.fillRect(px, py, tw, th)
        if (tw >= 10) {
          ctx.fillStyle = '#ffcc00'
          ctx.font = `${Math.min(9, tw - 2)}px monospace`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(`${h ? 'H' : ''}${v ? 'V' : ''}`, px + 1, py + 1)
        }
      }
    }
    if (props.state.showPaletteOverlay?.value) {
      const layer = props.state.activeLayer.value === 'fg' ? 'fg' : 'bg'
      const pal = layer === 'fg' ? props.state.paletteMap2.value : props.state.paletteMap.value
      const colors = ['#4caf50', '#2196f3', '#ff9800', '#e91e63']
      for (let i = 0; i < props.state.tiles.value.length; i++) {
        const p = pal?.[i] ?? 0
        if (!p) continue
        const px = (i % mw) * tw
        const py = Math.floor(i / mw) * th
        ctx.strokeStyle = colors[p % 4]
        ctx.lineWidth = 2
        ctx.strokeRect(px + 1, py + 1, tw - 2, th - 2)
      }
    }

    // Viewport guide H40 / H32
    const guide = props.state.viewportGuide?.value
    if (guide === 'H40' || guide === 'H32') {
      const gw = guide === 'H32' ? 32 : 40
      const gh = 28
      ctx.save()
      ctx.strokeStyle = 'rgba(0, 220, 255, 0.85)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(0, 0, gw * tw, gh * th)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(0, 220, 255, 0.9)'
      ctx.font = `${Math.max(10, tw)}px monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(guide, 4, 4)
      ctx.restore()
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
    () => st('userTilesets'),
    () => st('tiles'),
    () => st('tiles2'),
    () => st('mapWidth'),
    () => st('mapHeight'),
    () => st('zoom'),
    () => st('showGrid'),
    () => st('showTileIndices'),
    () => st('showCollision'),
    () => st('showPriority'),
    () => st('showFlips'),
    () => st('showPaletteOverlay'),
    () => st('collisionMap'),
    () => st('priorityMap'),
    () => st('flipHMap'),
    () => st('flipVMap'),
    () => st('paletteMap'),
    () => st('flipHMap2'),
    () => st('flipVMap2'),
    () => st('paletteMap2'),
    () => st('activeLayer'),
    () => st('selection'),
    () => st('selectionDragEnd'),
    () => st('isDrawing'),
    () => st('dragStart'),
    () => st('drawTool'),
    () => st('isMovingSelection'),
    () => st('movePreview'),
    () => st('fgOpacity'),
    () => st('viewportGuide'),
    () => st('objects')
  ], 
  () => {
    drawMap()
  }, 
  { deep: true, flush: 'post' }
)

// Zoom / size: canvas buffer clear on resize — force redraw after DOM settles
watch(zoomVal, async () => {
  await nextTick()
  requestAnimationFrame(() => drawMap())
})

watch(
  () => [st('mapWidth'), st('mapHeight')],
  async () => {
    await nextTick()
    requestAnimationFrame(() => drawMap())
  }
)

// Mouse / Interaction Logic (delegated back to the composable actions)
function getMapTileFromEvent(e) {
  const c = mapCanvas.value || st('mapCanvas')
  if (!c) return -1
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return -1
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const canvasX = (e.clientX - rect.left) * scaleX
  const canvasY = (e.clientY - rect.top) * scaleY
  const tileSize = st('TILE_SIZE_CONST') || 8
  const zoom = zoomVal()
  const x = Math.floor(canvasX / (tileSize * zoom))
  const y = Math.floor(canvasY / (tileSize * zoom))
  const mw = st('mapWidth')
  const mh = st('mapHeight')
  if (x < 0 || x >= mw || y < 0 || y >= mh) return -1
  return y * mw + x
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
      collision: !!(props.state.collisionMap.value[idx]),
      collisionValue: props.state.collisionMap.value[idx] || 0,
      priority: !!props.state.priorityMap.value[idx],
      flipH: props.state.activeLayer.value === 'fg'
        ? !!props.state.flipHMap2.value[idx]
        : !!props.state.flipHMap.value[idx],
      flipV: props.state.activeLayer.value === 'fg'
        ? !!props.state.flipVMap2.value[idx]
        : !!props.state.flipVMap.value[idx],
      palette: props.state.activeLayer.value === 'fg'
        ? (props.state.paletteMap2.value[idx] ?? 0)
        : (props.state.paletteMap.value[idx] ?? 0)
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
  const currZoom = zoomVal()
  if (e.deltaY < 0) setSt('zoom', Math.min(8, currZoom + 1))
  else if (e.deltaY > 0) setSt('zoom', Math.max(1, currZoom - 1))
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

function needsTilesetToDraw(tool) {
  return tool === 'pencil' || tool === 'fill' || tool === 'rect' || tool === 'line' || tool === 'object'
}

function onMapMouseDown(e) {
  if (e.button !== 0) return
  const idx = getMapTileFromEvent(e)
  if (idx < 0) return
  props.state.ensureTiles()

  if (st('editCollision')) {
    props.state.toggleTileAttribute(idx, 'collision')
    return
  }
  if (st('editPriority')) {
    props.state.toggleTileAttribute(idx, 'priority')
    return
  }
  if (st('editFlipH')) {
    props.state.toggleTileAttribute(idx, 'flipH')
    return
  }
  if (st('editFlipV')) {
    props.state.toggleTileAttribute(idx, 'flipV')
    return
  }
  if (st('editPalette')) {
    props.state.toggleTileAttribute(idx, 'palette')
    return
  }
  const pending = st('pendingStamp')
  if (pending) {
    props.state.placeStampAt(pending, idx)
    setSt('pendingStamp', null)
    return
  }
  const tool = st('drawTool')
  if (needsTilesetToDraw(tool) && !hasTilesets.value) {
    window.retroStudioToast?.info?.(t('tilemap.needTilesetToPaint'))
    return
  }
  if (tool === 'fill') {
    props.state.fillTile(idx)
    drawMap()
    return
  }
  if (tool === 'select') {
    const sel = st('selection')
    if (sel && props.state.isTileInSelection(idx)) {
      const ox = sel.x1
      const oy = sel.y1
      const mw = st('mapWidth')
      const cx = idx % mw
      const cy = Math.floor(idx / mw)
      setSt('isMovingSelection', true)
      setSt('moveStartInSelection', { offsetX: cx - ox, offsetY: cy - oy })
      setSt('movePreview', { x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2 })
      const onUp = () => { finishMoveSelection(); document.removeEventListener('mouseup', onUp) }
      document.addEventListener('mouseup', onUp)
      return
    }
    setSt('dragStart', idx)
    setSt('isDrawing', true)
    setSt('selection', null)
    return
  }

  if (tool === 'object') {
    props.state.placeObject(idx)
    return
  }
  
  if (tool === 'rect' || tool === 'line') {
    props.state.pushState()
    setSt('dragStart', idx)
    setSt('isDrawing', true)
    return
  }
  
  props.state.pushState()
  setSt('isDrawing', true)
  props.state.paintTile(idx)
  drawMap()
}

function onMapMouseMove(e) {
  const idx = getMapTileFromEvent(e)

  if (st('isMovingSelection') && st('moveStartInSelection')) {
    if (idx >= 0) {
      const mw = st('mapWidth')
      const cx = idx % mw
      const cy = Math.floor(idx / mw)
      const { offsetX, offsetY } = st('moveStartInSelection')
      const sel = st('selection')
      if (sel) {
        let nx1 = cx - offsetX
        let ny1 = cy - offsetY
        nx1 = Math.max(0, Math.min(nx1, mw - sel.w))
        ny1 = Math.max(0, Math.min(ny1, st('mapHeight') - sel.h))
        setSt('movePreview', { x1: nx1, y1: ny1, x2: nx1 + sel.w - 1, y2: ny1 + sel.h - 1 })
      }
    }
    return
  }
  if (st('drawTool') === 'select' && st('isDrawing')) {
    setSt('selectionDragEnd', idx >= 0 ? idx : st('dragStart'))
    return
  }
  if (!st('isDrawing')) return
  if (st('drawTool') === 'rect' || st('drawTool') === 'line') return
  props.state.paintTile(idx)
  drawMap()
}

function onMapMouseUp(e) {
  if (e.button === 0 && st('isMovingSelection')) {
    finishMoveSelection()
    return
  }
  if (!st('isDrawing') || st('dragStart') == null) {
    setSt('isDrawing', false)
    setSt('dragStart', null)
    return
  }
  const idx = getMapTileFromEvent(e)
  const mw = st('mapWidth')
  const tool = st('drawTool')
  const dragStart = st('dragStart')
  
  if (tool === 'select') {
    const i1 = dragStart
    const i2 = idx >= 0 ? idx : i1
    const x1 = Math.min(i1 % mw, i2 % mw)
    const x2 = Math.max(i1 % mw, i2 % mw)
    const y1 = Math.min(Math.floor(i1 / mw), Math.floor(i2 / mw))
    const y2 = Math.max(Math.floor(i1 / mw), Math.floor(i2 / mw))
    setSt('selection', { x1, y1, x2, y2, w: x2 - x1 + 1, h: y2 - y1 + 1 })
    setSt('selectionDragEnd', null)
  } else if (tool === 'rect') {
    props.state.paintRect(dragStart, idx >= 0 ? idx : dragStart)
    drawMap()
  } else if (tool === 'line') {
    props.state.paintLine(dragStart, idx >= 0 ? idx : dragStart)
    drawMap()
  }
  
  setSt('isDrawing', false)
  setSt('dragStart', null)
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

.te-empty-canvas {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  background: rgba(10, 10, 20, 0.72);
  pointer-events: auto;
}

.te-empty-canvas-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #e8e8f0);
}

.te-empty-canvas-hint {
  margin: 0;
  max-width: 360px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted, #9a9ab0);
}

.te-empty-canvas-btn {
  margin-top: 4px;
  padding: 6px 14px;
  font-size: 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.te-empty-canvas-btn:hover { opacity: 0.9; }

.te-map-canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  background: #1a1a2e;
  border: 1px solid var(--border);
}
</style>
