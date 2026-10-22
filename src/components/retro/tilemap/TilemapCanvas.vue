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
    @scroll="onMapScroll"
  >
    <canvas
      ref="mapCanvas"
      class="te-map-canvas"
      :class="{ 'te-cutscene-picking': !!state.cutscenePicking?.value || !!state.colorInspector?.picking.value }"
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
import { ref, computed, onMounted, onUnmounted, watch, unref, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { composeMapArtwork, priorityRuns, spritePriority, tilesetColumns } from '../../../utils/retro/mapComposition.js'
import { objectPaletteBank } from '../../../utils/retro/mapColors.js'
import { createTileLayerCache } from '../../../utils/retro/tileLayerCache.js'

const { t } = useI18n()

const props = defineProps({
  state: {
    type: Object,
    required: true
  }
})

const mapCanvas = ref(null)
const mapWrapRef = ref(null)
const movingObject = ref(null)
let selectionMouseUp = null
let cachedBackgroundSrc = ''
let cachedBackgroundImage = null
const parallaxImageCache = new Map()
let objectPreviewTimer = null
let reducedMotionQuery = null
let colorCaptureTimer = null
let pendingColorCapture = null
let colorArtworkDirty = true
// Tile layers drawn once at the map's resolution; each redraw copies the visible part.
const tileCache = createTileLayerCache(() => document.createElement('canvas'))
function syncObjectPreview() {
  if (objectPreviewTimer) clearInterval(objectPreviewTimer)
  objectPreviewTimer = null
  const hasAnimation = (st('objects') || []).some(obj => (obj.visual?.frames || 1) > 1)
  if (!hasAnimation || !st('previewAnimations') || props.state.colorInspector?.enabled.value || st('workspaceActive') === false || st('workspaceLeaving') || document.hidden || reducedMotionQuery?.matches) return
  objectPreviewTimer = setInterval(() => {
    props.state.previewClock.value += 100
    drawMap()
  }, 100)
}
function onMapVisibilityChange() { syncObjectPreview() }
onUnmounted(() => {
  cancelPendingGestures()
  document.removeEventListener('mousemove', onObjectDragMove)
  document.removeEventListener('mouseup', onObjectDragEnd)
  endNoteDrag()
  document.removeEventListener('visibilitychange', onMapVisibilityChange)
  if (objectPreviewTimer) clearInterval(objectPreviewTimer)
  if (colorCaptureTimer) clearTimeout(colorCaptureTimer)
  pendingColorCapture = null
  tileCache.reset()
  reducedMotionQuery?.removeEventListener?.('change', syncObjectPreview)
})

function st(key) {
  return unref(props.state?.[key])
}

function setSt(key, val) {
  const r = props.state?.[key]
  if (r && typeof r === 'object' && 'value' in r) r.value = val
}

function cancelPendingGestures() {
  if (selectionMouseUp) document.removeEventListener('mouseup', selectionMouseUp)
  selectionMouseUp = null
  document.removeEventListener('mousemove', onObjectDragMove)
  document.removeEventListener('mouseup', onObjectDragEnd)
  movingObject.value = null
  setSt('isMovingSelection', false)
  setSt('moveStartInSelection', null)
  setSt('movePreview', null)
  setSt('isDrawing', false)
  setSt('dragStart', null)
  setSt('selectionDragEnd', null)
  setSt('isPanning', false)
}

watch(() => [st('loadingMap'), st('saving'), st('selectingMapPath'), st('workspaceLeaving')], flags => {
  if (flags.some(Boolean)) cancelPendingGestures()
  if (flags[0]) setSt('selection', null)
}, { flush: 'sync' })

function zoomVal() {
  const z = props.state?.zoom
  if (z && typeof z === 'object' && 'value' in z) return Number(z.value) || 1
  return Number(z) || 1
}

function getBackgroundImage() {
  const source = st('backgroundImage')?.preview || ''
  if (!source) {
    cachedBackgroundSrc = ''
    cachedBackgroundImage = null
    return null
  }
  if (source === cachedBackgroundSrc) return cachedBackgroundImage
  cachedBackgroundSrc = source
  cachedBackgroundImage = null
  const image = new Image()
  image.onload = () => {
    if (cachedBackgroundSrc !== source) return
    cachedBackgroundImage = image
    colorArtworkDirty = true
    drawMap()
  }
  image.onerror = () => {
    if (cachedBackgroundSrc === source) cachedBackgroundSrc = ''
  }
  image.src = source
  return null
}

function paintBackground(ctx, image, width, height, zoom = zoomVal()) {
  if (!image?.naturalWidth || !image?.naturalHeight) return
  const background = st('backgroundImage') || {}
  const fit = background.fit || 'cover'
  const repeated = fit === 'repeat' || fit === 'repeat-x' || fit === 'repeat-y'
  // Ajuste fino de posição, em pixels do mapa. Num fundo repetido ele desloca o padrão.
  const offsetX = (Number(background.offsetX) || 0) * zoom
  const offsetY = (Number(background.offsetY) || 0) * zoom
  if (repeated) {
    const drawWidth = image.naturalWidth * zoom
    const drawHeight = image.naturalHeight * zoom
    const repeatX = fit !== 'repeat-y'
    const repeatY = fit !== 'repeat-x'
    const wrap = (offset, size) => ((offset % size) + size) % size - size
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(background.opacity ?? 1)))
    for (let y = repeatY ? wrap(offsetY, drawHeight) : (height - drawHeight) / 2 + offsetY; y < height; y += repeatY ? drawHeight : height) {
      for (let x = repeatX ? wrap(offsetX, drawWidth) : (width - drawWidth) / 2 + offsetX; x < width; x += repeatX ? drawWidth : width) {
        ctx.drawImage(image, x, y, drawWidth, drawHeight)
      }
    }
    ctx.restore()
    return
  }
  const scale = fit === 'stretch' ? 1 : fit === 'contain'
    ? Math.min(width / image.naturalWidth, height / image.naturalHeight)
    : Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = fit === 'stretch' ? width : image.naturalWidth * scale
  const drawHeight = fit === 'stretch' ? height : image.naturalHeight * scale
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(background.opacity ?? 1)))
  ctx.drawImage(image, (width - drawWidth) / 2 + offsetX, (height - drawHeight) / 2 + offsetY, drawWidth, drawHeight)
  ctx.restore()
}

function paintParallaxLayers(ctx, width, height, zoom = zoomVal()) {
  const layers = st('parallaxLayers') || []
  if (!layers.length) return
  const viewport = st('viewport') || { x: 0, y: 0, w: width / zoom, h: height / zoom }
  // #62: o jogo ajusta e repete os panoramas pela tela do console, não pela área visível do
  // editor — a prévia usa a mesma referência, para mostrar o que o exportador vai gerar.
  const screen = st('consoleScreen') || { width: 320, height: 224 }
  const viewW = Math.max(1, screen.width * zoom)
  const viewH = Math.max(1, screen.height * zoom)
  const camX = (viewport.x || 0) * zoom
  const camY = (viewport.y || 0) * zoom
  for (const layer of layers) {
    const src = layer.preview || ''
    if (!src) continue
    let image = parallaxImageCache.get(src)
    if (image === undefined) {
      image = null
      parallaxImageCache.set(src, null)
      const loading = new Image()
      loading.onload = () => { parallaxImageCache.set(src, loading); colorArtworkDirty = true; drawMap() }
      loading.onerror = () => parallaxImageCache.delete(src)
      loading.src = src
      continue
    }
    if (!image?.naturalWidth || !image?.naturalHeight) continue
    const repeatMode = ['repeat', 'repeat-x', 'repeat-y'].includes(layer.fit)
    let dw, dh
    if (layer.fit === 'stretch') { dw = viewW; dh = viewH }
    else if (repeatMode) { dw = image.naturalWidth * zoom; dh = image.naturalHeight * zoom }
    else {
      const scale = layer.fit === 'contain' ? Math.min(viewW / image.naturalWidth, viewH / image.naturalHeight) : Math.max(viewH / image.naturalHeight, viewW / image.naturalWidth)
      dw = image.naturalWidth * scale
      dh = image.naturalHeight * scale
    }
    const factorX = Math.max(0, Math.min(2, Number(layer.factorX ?? 0.5)))
    const factorY = Math.max(0, Math.min(2, Number(layer.factorY ?? 1)))
    // Repeat the viewport-sized layer across the map; its camera-relative offset
    // makes the configured factor visible while the editor scrolls the canvas.
    const repeatX = !repeatMode || layer.fit !== 'repeat-y'
    const repeatY = !repeatMode || layer.fit !== 'repeat-x'
    const stepX = Math.max(1, repeatX ? dw : viewW)
    const stepY = Math.max(1, repeatY ? dh : viewH)
    const offsetX = camX * (1 - factorX)
    const offsetY = camY * (1 - factorY)
    const startX = ((offsetX % stepX) + stepX) % stepX - stepX
    const startY = ((offsetY % stepY) + stepY) % stepY - stepY
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity ?? 1)))
    for (let y = startY; y < height; y += stepY) {
      for (let x = startX; x < width; x += stepX) {
        const drawX = repeatX ? x : x + (viewW - dw) / 2
        const drawY = repeatY ? y : y + (viewH - dh) / 2
        ctx.drawImage(image, drawX, drawY, dw, dh)
      }
    }
    ctx.restore()
  }
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

/** Cells of the map canvas the scrolled view shows, with a margin of two cells, or null when
 * it cannot be measured (then the whole map is painted). */
function visibleCells(c, tw, mw, mh) {
  const wrap = mapWrapRef.value
  if (!wrap || !tw) return null
  const canvas = c.getBoundingClientRect(), view = wrap.getBoundingClientRect()
  if (canvas.width <= 0 || canvas.height <= 0) return null
  const sx = c.width / canvas.width, sy = c.height / canvas.height, margin = 2
  const left = (Math.max(canvas.left, view.left) - canvas.left) * sx, right = (Math.min(canvas.right, view.right) - canvas.left) * sx
  const top = (Math.max(canvas.top, view.top) - canvas.top) * sy, bottom = (Math.min(canvas.bottom, view.bottom) - canvas.top) * sy
  if (right <= left || bottom <= top) return { x0: 0, y0: 0, x1: 0, y1: 0 }
  return {
    x0: Math.max(0, Math.floor(left / tw) - margin), x1: Math.min(mw, Math.ceil(right / tw) + margin),
    y0: Math.max(0, Math.floor(top / tw) - margin), y1: Math.min(mh, Math.ceil(bottom / tw) + margin)
  }
}

onMounted(() => {
  if (mapCanvas.value) setSt('mapCanvas', mapCanvas.value)
  if (mapWrapRef.value) setSt('mapWrapRef', mapWrapRef.value)
  props.state.updateViewport?.()

  props.state.ensureTiles()
  if (!st('history')?.length) {
    props.state.pushState()
    setSt('historyIndex', 0)
  }

  drawMap()
  reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
  reducedMotionQuery?.addEventListener?.('change', syncObjectPreview)
  document.addEventListener('visibilitychange', onMapVisibilityChange)
  syncObjectPreview()
})

function drawMap() {
  const c = mapCanvas.value || st('mapCanvas')
  if (!c) return
  const drawGeneration = (c.__teDrawGen = (c.__teDrawGen || 0) + 1)
  props.state.ensureTiles()
  const { tw, th, mw, mh } = syncCanvasSize(c)
  const backgroundImg = getBackgroundImage()
  const inspector = props.state.colorInspector
  const queueColorCapture = paint => {
    if (!inspector?.enabled.value || !colorArtworkDirty || st('loadingMap') || st('workspaceActive') === false) return
    pendingColorCapture = paint
    if (colorCaptureTimer) return
    colorCaptureTimer = setTimeout(() => {
      colorCaptureTimer = null
      const pending = pendingColorCapture
      pendingColorCapture = null
      if (!inspector.enabled.value || !pending || st('loadingMap') || st('workspaceActive') === false) return
      colorArtworkDirty = false
      inspector.capture(mw * (st('TILE_SIZE_CONST') || 8), mh * (st('TILE_SIZE_CONST') || 8), pending)
    }, 100)
  }
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
    paintBackground(ctx, backgroundImg, c.width, c.height)
    paintParallaxLayers(ctx, c.width, c.height)
    if (backgroundImg) {
      ctx.fillStyle = 'rgba(20, 20, 40, 0.28)'
      ctx.fillRect(0, 0, c.width, c.height)
    }
    queueColorCapture((colorCtx, target) => {
      if (inspector.scope.value === 'sprites' || !['all', 'unknown'].includes(inspector.bank.value)) return
      paintBackground(colorCtx, backgroundImg, target.width, target.height, 1)
      paintParallaxLayers(colorCtx, target.width, target.height, 1)
    })
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
    inspector?.drawHighlight(ctx, c.width, c.height)
    drawAutotilePreview(ctx, tw)
    return
  }

  // Wipe checker immediately so painting never looks "stuck" on empty pattern
  {
    const boot = c.getContext('2d')
    boot.fillStyle = '#1a1a2e'
    boot.fillRect(0, 0, c.width, c.height)
  }

  const tilesetsToLoad = [...tilesets]

  const renderWhenReady = (imagesData) => {
    if (c.__teDrawGen !== drawGeneration) return
    renderLoadedMap(imagesData, backgroundImg)
    queueColorCapture((_ctx, target) => renderLoadedMap(imagesData, backgroundImg, { target, artworkOnly: true, scale: 1 }))
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

  // Only the part of the map on screen is painted: a 566 × 68 level repainted its ~77 000 tiles
  // on every animation frame, brush stroke and scroll. The canvas keeps the size of the map, so
  // mouse coordinates do not change; scrolling repaints the newly visible part.
  function renderLoadedMap(imagesData, background, options = {}) {
    const target = options.target || c, scale = options.scale ?? zoomVal()
    const tw = (st('TILE_SIZE_CONST') || 8) * scale
    const view = options.artworkOnly || target !== c ? null : visibleCells(target, tw, st('mapWidth'), st('mapHeight'))
    const ctx = target.getContext('2d')
    if (view) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(view.x0 * tw, view.y0 * tw, (view.x1 - view.x0) * tw, (view.y1 - view.y0) * tw)
      ctx.clip()
    }
    try { paintLoadedMap(imagesData, background, options, view) } finally { if (view) ctx.restore() }
  }

  function paintLoadedMap(imagesData, background, { target = c, artworkOnly = false, scale = zoomVal() } = {}, view = null) {
    const c = target
    const tilePx = st('TILE_SIZE_CONST') || 8
    const tw = tilePx * scale, th = tw
    const scope = artworkOnly ? inspector?.scope.value || 'composition' : 'composition'
    const bank = artworkOnly && scope !== 'composition' ? inspector?.bank.value || 'all' : 'all'
    // Sort by firstgid descending to easily find the matching tileset
    imagesData.sort((a, b) => (b.ts.firstgid || 0) - (a.ts.firstgid || 0))
    
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)
    if (!artworkOnly) {
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, c.width, c.height)
    }
    if (scope !== 'sprites' && ['all', 'unknown'].includes(bank)) {
      paintBackground(ctx, background, c.width, c.height, scale)
      paintParallaxLayers(ctx, c.width, c.height, scale)
    }

    const mw = st('mapWidth')
    const mh = st('mapHeight')
    
    const drawLayer = (arr, alpha = 1.0, layerKey = 'bg', highOnly = false) => {
      if (!arr?.length || scope === 'sprites') return
      ctx.globalAlpha = alpha
      // Plain arrays: reading the reactive ones cell by cell costs more than drawing.
      arr = toRaw(arr)
      const fh = toRaw(layerKey === 'fg' ? st('flipHMap2') : st('flipHMap'))
      const fv = toRaw(layerKey === 'fg' ? st('flipVMap2') : st('flipVMap'))
      const palettes = toRaw(layerKey === 'fg' ? st('paletteMap2') : st('paletteMap'))
      const priorities = highOnly ? toRaw(st('priorityMap')) : null
      const plainTransform = ctx.getTransform().isIdentity
      const end = view ? Math.min(arr.length, view.y1 * mw) : arr.length
      for (let i = view ? view.y0 * mw : 0; i < end; i++) {
        if (view) { const x = i % mw; if (x < view.x0 || x >= view.x1) continue }
        const tid = arr[i]
        if (bank !== 'all' && String(Number(palettes?.[i] || 0) & 3) !== bank) continue
        if (tid <= 0 || (highOnly && ![true, 1, 'true', '1'].includes(priorities?.[i]))) continue
        
        const tsData = imagesData.find(d => tid >= (d.ts.firstgid || 1)) || imagesData[imagesData.length - 1]
        const dx = (i % mw) * tw
        const dy = Math.floor(i / mw) * th

        if (!tsData?.img) {
          if (artworkOnly) continue
          ctx.fillStyle = `hsl(${(tid * 47) % 360} 55% 42%)`
          ctx.fillRect(dx, dy, tw, th)
          continue
        }

        const img = tsData.img
        const natW = img.naturalWidth || 0
        // Preferir colunas da imagem; ts.columns do TMX costuma estar errado
        const cols = tilesetColumns(img, tilePx, tsData.ts.columns)
        if (tsData.ts && natW > 0) tsData.ts.columns = cols
        const firstgid = tsData.ts.firstgid || 1

        const localTid = tid - firstgid
        const tx = localTid % cols
        const ty = Math.floor(localTid / cols)
        const doFlipH = !!fh?.[i]
        const doFlipV = !!fv?.[i]

        try {
          if ((doFlipH || doFlipV) && plainTransform) {
            // Mirrored tile: a transform set and reset is much cheaper than save/restore per cell.
            ctx.setTransform(doFlipH ? -1 : 1, 0, 0, doFlipV ? -1 : 1, dx + (doFlipH ? tw : 0), dy + (doFlipV ? th : 0))
            try {
              ctx.drawImage(img, tx * tilePx, ty * tilePx, tilePx, tilePx, 0, 0, tw, th)
            } finally { ctx.setTransform(1, 0, 0, 1, 0, 0) }
          } else if (doFlipH || doFlipV) {
            ctx.save()
            ctx.translate(dx + (doFlipH ? tw : 0), dy + (doFlipV ? th : 0))
            ctx.scale(doFlipH ? -1 : 1, doFlipV ? -1 : 1)
            try {
              ctx.drawImage(img, tx * tilePx, ty * tilePx, tilePx, tilePx, 0, 0, tw, th)
            } finally { ctx.restore() }
          } else {
            ctx.drawImage(img, tx * tilePx, ty * tilePx, tilePx, tilePx, dx, dy, tw, th)
          }
        } catch (_) {
          if (artworkOnly) continue
          ctx.fillStyle = `hsl(${(tid * 47) % 360} 55% 42%)`
          ctx.fillRect(dx, dy, tw, th)
        }
      }
    }

    // The cutscene host samples scenery only; marker sprites belong to authoring.
    const clean = !!st('cutscenePreviewing')
    const visuals = []
    if (!clean) for (const obj of st('objects') || []) {
      if (scope === 'scenery') continue
      if (artworkOnly && scope === 'sprites' && inspector.spriteId.value !== 'all' && String(obj.id) !== inspector.spriteId.value) continue
      if (bank !== 'all' && objectPaletteBank(obj) !== bank) continue
      const position = movingObject.value?.id === obj.id ? movingObject.value : obj
      const ox = position.x * tw, oy = position.y * th
      const ow = (obj.width || 1) * tw, oh = (obj.height || 1) * th
      const visual = obj.visual
      if (visual?.gid && imagesData.length) {
        const sourceWidth = Math.max(1, visual.width || 1)
        const sourceHeight = Math.max(1, visual.height || 1)
        const frameCount = Math.max(1, visual.frames || 1)
        const elapsed = Math.max(0, (st('previewClock') || 0) - (obj.animationStart || 0))
        const elapsedFrame = Math.floor(elapsed * (visual.fps || 4) / 1000)
        const frame = frameCount > 1 && st('previewAnimations') && !reducedMotionQuery?.matches
          ? (visual.loop === false ? Math.min(frameCount - 1, elapsedFrame) : elapsedFrame % frameCount)
          : 0
        const frameGid = visual.gid + frame * sourceWidth
        const tsData = imagesData.find(d => frameGid >= (d.ts.firstgid || 1) && frameGid < (d.ts.firstgid || 1) + (d.ts.tilecount || 65536))
        if (tsData?.img) {
          const cols = tilesetColumns(tsData.img, tilePx, tsData.ts.columns)
          const local = frameGid - (tsData.ts.firstgid || 1)
          try {
            const zoom = tw / 8
            // A marker's dimensions describe its region, not the sprite frame.
            const nativeW = sourceWidth * tilePx, nativeH = sourceHeight * tilePx
            const displayW = Number(visual.displayWidth) || (visual.displayHeight ? Number(visual.displayHeight) * nativeW / nativeH : nativeW)
            const displayH = Number(visual.displayHeight) || (visual.displayWidth ? Number(visual.displayWidth) * nativeH / nativeW : nativeH)
            const drawW = Math.max(1, displayW * zoom)
            const drawH = Math.max(1, displayH * zoom)
            const anchor = obj.type === 'player_spawn' ? 'bottom-center' : (visual.anchor || 'top-left')
            const offsetX = Number(obj.properties?.spriteOffsetX || 0) * zoom
            const offsetY = Number(obj.properties?.spriteOffsetY || 0) * zoom
            let drawX = ox + offsetX, drawY = oy + offsetY
            if (anchor === 'center') { drawX += (ow - drawW) / 2; drawY += (oh - drawH) / 2 }
            else if (anchor === 'bottom-center') { drawX += (ow - drawW) / 2; drawY += oh - drawH }
            const flipH = [true, 1, 'true', '1'].includes(obj.properties?.flipH)
            const flipV = [true, 1, 'true', '1'].includes(obj.properties?.flipV)
            visuals.push({ id: obj.id, image: tsData.img,
              sourceX: (local % cols) * tilePx, sourceY: Math.floor(local / cols) * tilePx,
              sourceWidth: sourceWidth * tilePx, sourceHeight: sourceHeight * tilePx,
              x: drawX, y: drawY, width: drawW, height: drawH, flipH, flipV,
              highPriority: spritePriority(obj.properties?.priority) })
          } catch (_) { /* keep the editable object marker visible for malformed source regions */ }
        }
      }
    }
    const visualById = new Map(visuals.map(visual => [visual.id, visual]))
    // The cached tile layers serve the editor view and the color capture of the whole
    // composition; a capture of one bank or scope still draws tile by tile.
    const cached = scope === 'composition' && bank === 'all' ? tileCache.update({
      width: mw, height: mh, size: tilePx, imagesData,
      tiles: toRaw(st('tiles')) || [], tiles2: toRaw(st('tiles2')) || [], priority: toRaw(st('priorityMap')),
      flipH: toRaw(st('flipHMap')), flipV: toRaw(st('flipVMap')), flipH2: toRaw(st('flipHMap2')), flipV2: toRaw(st('flipVMap2'))
    }) : null
    const blit = (source, alpha = 1) => {
      const x0 = view ? view.x0 : 0, y0 = view ? view.y0 : 0, x1 = view ? view.x1 : mw, y1 = view ? view.y1 : mh
      if (x1 <= x0 || y1 <= y0) return
      ctx.globalAlpha = alpha
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(source, x0 * tilePx, y0 * tilePx, (x1 - x0) * tilePx, (y1 - y0) * tilePx, x0 * tw, y0 * th, (x1 - x0) * tw, (y1 - y0) * th)
    }
    const renderedVisuals = composeMapArtwork(ctx, visuals, {
      drawBG: () => cached ? blit(cached.bg) : drawLayer(st('tiles') || [], 1.0, 'bg'),
      createCanvas: () => document.createElement('canvas'),
      drawHighBG: () => {
        // Repaint only opaque high-priority BG pixels. Clearing/filling this clip
        // would wrongly hide sprites behind transparent palette-index-zero pixels.
        const runs = priorityRuns(st('priorityMap'), mw, mh)
        if (runs.length) {
          ctx.save()
          try {
            ctx.beginPath()
            for (const run of runs) ctx.rect(run.x * tw, run.y * th, run.width * tw, th)
            ctx.clip()
            if (scope !== 'sprites' && ['all', 'unknown'].includes(bank)) {
              paintBackground(ctx, background, c.width, c.height, scale)
              paintParallaxLayers(ctx, c.width, c.height, scale)
            }
            if (cached) blit(cached.high)
            else drawLayer(st('tiles') || [], 1.0, 'bg', true)
          } finally { ctx.restore() }
        }
      },
      // The generic exporter places FG on high-priority plane A.
      drawFG: () => cached ? blit(cached.fg, st('fgOpacity') ?? 1) : drawLayer(st('tiles2') || [], st('fgOpacity') ?? 1, 'fg')
    })
    ctx.globalAlpha = 1.0 // Authoring overlays stay visible above the composed art.
    if (artworkOnly) return
    // Cells the overlays below visit: the visible ones (all of them without a view).
    const cellCount = toRaw(props.state.tiles.value).length
    const firstCell = view ? view.y0 * mw : 0, endCell = view ? Math.min(cellCount, view.y1 * mw) : cellCount
    const offView = i => { if (!view) return false; const x = i % mw; return x < view.x0 || x >= view.x1 }
    if (!clean && st('showGrid')) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      const gx0 = view ? view.x0 : 0, gx1 = view ? view.x1 : mw, gy0 = view ? view.y0 : 0, gy1 = view ? view.y1 : mh
      ctx.beginPath()
      for (let y = gy0; y <= gy1; y++) {
        ctx.moveTo(gx0 * tw, y * th)
        ctx.lineTo(gx1 * tw, y * th)
      }
      for (let x = gx0; x <= gx1; x++) {
        ctx.moveTo(x * tw, gy0 * th)
        ctx.lineTo(x * tw, gy1 * th)
      }
      ctx.stroke()
    }
    if (!clean && props.state.showTileIndices.value && tw >= 12) {
      ctx.font = `${Math.min(10, tw - 2)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const bgTiles = toRaw(props.state.tiles.value), fgTiles = toRaw(props.state.tiles2.value)
      for (let i = firstCell; i < endCell; i++) {
        if (offView(i)) continue
        const vBg = bgTiles[i] ?? 0
        const vFg = fgTiles[i] ?? 0
        const v = vFg > 0 ? vFg : vBg
        if (v > 0) {
          const px = (i % mw) * tw + tw / 2
          const py = Math.floor(i / mw) * th + th / 2
          ctx.fillStyle = vFg > 0 ? 'rgba(0,255,255,0.9)' : 'rgba(255,255,0,0.8)'
          ctx.fillText(String(v - 1), px, py)
        }
      }
    }
    if (!clean && props.state.showCollision.value) {
      const collisions = toRaw(props.state.collisionMap.value)
      for (let i = firstCell; i < endCell; i++) {
        if (offView(i)) continue
        const cell = collisions[i]
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
    if (!clean && props.state.showPriority.value) {
      ctx.fillStyle = 'rgba(0, 100, 255, 0.3)'
      const priorities = toRaw(props.state.priorityMap.value)
      for (let i = firstCell; i < endCell; i++) {
        if (priorities[i] && !offView(i)) {
          ctx.fillRect(
            (i % mw) * tw,
            Math.floor(i / mw) * th,
            tw,
            th
          )
        }
      }
    }
    if (!clean && props.state.showFlips?.value) {
      const layer = props.state.activeLayer.value === 'fg' ? 'fg' : 'bg'
      const fh = toRaw(layer === 'fg' ? props.state.flipHMap2.value : props.state.flipHMap.value)
      const fv = toRaw(layer === 'fg' ? props.state.flipVMap2.value : props.state.flipVMap.value)
      for (let i = firstCell; i < endCell; i++) {
        if (offView(i)) continue
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
    if (!clean && props.state.showPaletteOverlay?.value) {
      const layer = props.state.activeLayer.value === 'fg' ? 'fg' : 'bg'
      const pal = toRaw(layer === 'fg' ? props.state.paletteMap2.value : props.state.paletteMap.value)
      const colors = ['#4caf50', '#2196f3', '#ff9800', '#e91e63']
      for (let i = firstCell; i < endCell; i++) {
        if (offView(i)) continue
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
    const guide = clean ? 'off' : props.state.viewportGuide?.value
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
    if (!clean && props.state.objects.value && props.state.objects.value.length > 0) {
      for (const obj of props.state.objects.value) {
        const position = movingObject.value?.id === obj.id ? movingObject.value : obj
        const ox = position.x * tw
        const oy = position.y * th
        const ow = (obj.width || 1) * tw, oh = (obj.height || 1) * th
        const hasVisual = renderedVisuals.has(obj.id)
        const visualTop = visualById.get(obj.id)?.y ?? oy
        if (!hasVisual) {
          if (obj.type === 'collision_slope') {
            const scale = th / 8
            const left = Math.max(0, Math.min(oh, Number(obj.properties?.leftHeight || 0) * scale))
            const right = Math.max(0, Math.min(oh, Number(obj.properties?.rightHeight || 0) * scale))
            ctx.fillStyle = 'rgba(255, 190, 70, 0.35)'
            ctx.beginPath(); ctx.moveTo(ox, oy + left); ctx.lineTo(ox + ow, oy + right)
            ctx.lineTo(ox + ow, oy + oh); ctx.lineTo(ox, oy + oh); ctx.closePath(); ctx.fill()
            ctx.strokeStyle = '#ffbe46'; ctx.beginPath(); ctx.moveTo(ox, oy + left); ctx.lineTo(ox + ow, oy + right); ctx.stroke()
          } else {
          ctx.fillStyle = obj.type === 'collision_solid' ? 'rgba(255, 90, 70, 0.4)' : obj.type === 'collision_clear' ? 'rgba(50, 220, 180, 0.3)' : obj.type === 'collision_platform' ? 'rgba(80, 180, 255, 0.35)' : obj.type === 'cutscene_trigger' ? 'rgba(251, 191, 36, 0.28)' : obj.type === 'scenery_drift' ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 0, 255, 0.4)'
          ctx.fillRect(ox, oy, ow, oh)
          if (obj.type === 'collision_platform') {
            ctx.strokeStyle = '#50b4ff'; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + ow, oy); ctx.stroke()
          }
          }
        }
        
        ctx.strokeStyle = st('selectedObjectId') === obj.id ? '#ffe18a' : '#8dbbde'
        ctx.lineWidth = 2
        ctx.strokeRect(ox, oy, ow, oh)
        
        // Match the exported player frame aligned to the spawn's bottom/center.
        if (obj.type === 'player_spawn' && ['hitboxX','hitboxY','hitboxW','hitboxH'].every(key => Number.isFinite(Number(obj.properties?.[key])))) {
          const scale = tw / 8
          const frameW = (obj.visual?.width || obj.width || 1) * tw
          const frameH = (obj.visual?.height || obj.height || 1) * tw
          const box = obj.properties
          ctx.strokeStyle = '#68ff9c'
          ctx.lineWidth = 1
          ctx.strokeRect(ox + (ow-frameW)/2 + Number(box.hitboxX)*scale,
            oy + oh-frameH + Number(box.hitboxY)*scale,
            Number(box.hitboxW)*scale, Number(box.hitboxH)*scale)
        }
        // Draw label
        if (tw >= 16) {
          ctx.font = `${Math.min(10, tw - 4)}px sans-serif`
          ctx.fillStyle = '#fff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          
          // Background behind text
          const txt = obj.name || obj.type || `#${obj.id}`
          const textW = ctx.measureText(txt).width
          ctx.fillStyle = 'rgba(0,0,0,0.6)'
          const labelY = hasVisual ? visualTop - 7 : oy + th / 2 - 1
          ctx.fillRect(ox + tw/2 - textW/2 - 2, labelY - 5, textW + 4, 12)
          
          ctx.fillStyle = '#fff'
          ctx.fillText(txt, ox + tw / 2, labelY)
        }
      }
    }
    
    if (clean) return
    drawCutsceneOverlay(ctx, tw / (st('TILE_SIZE_CONST') || 8))
    drawNotesOverlay(ctx, tw / (st('TILE_SIZE_CONST') || 8))
    drawSelectionOverlay()
    inspector?.drawHighlight(ctx, c.width, c.height)
    drawAutotilePreview(ctx, tw)
  }
}

function drawAutotilePreview(ctx, size) {
  const preview = props.state.autotile?.preview.value
  if (!preview) return
  const image = preview.tileset?._img
  if (!image) return
  const columns = Math.floor(image.naturalWidth / 8)
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.85
  for (const cell of preview.cells) {
    ctx.drawImage(image, (cell.local % columns) * 8, Math.floor(cell.local / columns) * 8, 8, 8,
      cell.x * size, cell.y * size, size, size)
    ctx.strokeStyle = '#63e8c3'; ctx.lineWidth = 1
    ctx.strokeRect(cell.x * size + 0.5, cell.y * size + 0.5, size - 1, size - 1)
  }
  ctx.restore()
}

// Anotações para a IA (#93): retângulo tracejado na cor do tipo, com o número e o começo do texto.
const NOTE_COLORS = { problem: '#f87171', task: '#60a5fa', info: '#a3e635' }
function drawNotesOverlay(ctx, scale) {
  const notes = props.state.mapNotes
  if (!notes) return
  const draft = notes.draft.value
  if (!draft && !(notes.visible.value || st('drawTool') === 'note')) return
  const list = notes.notes.value
  if (!list.length && !draft) return
  ctx.save()
  ctx.font = `bold ${Math.max(9, Math.min(12, 5 * scale))}px sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (const note of list) {
    const selected = note.id === notes.selectedId.value, done = note.status === 'done'
    const color = done ? '#94a3b8' : NOTE_COLORS[note.kind] || '#f87171'
    const x = note.x * scale, y = note.y * scale, w = note.width * scale, h = note.height * scale
    ctx.globalAlpha = done && !selected ? 0.55 : 1
    ctx.fillStyle = color + (selected ? '2e' : '14')
    ctx.fillRect(x, y, w, h)
    ctx.setLineDash(done ? [3, 4] : [7, 4])
    ctx.strokeStyle = color
    ctx.lineWidth = selected ? 3 : 1.5
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.setLineDash([])
    const words = note.text.replace(/\s+/g, ' ').trim()
    const label = `#${note.id}${done ? ' ✓' : ''}${words ? ' ' + (words.length > 28 ? words.slice(0, 27) + '…' : words) : ''}`
    const lw = ctx.measureText(label).width + 8
    const ly = y >= 16 ? y - 8 : y + 8
    ctx.fillStyle = 'rgba(10, 14, 20, 0.88)'
    ctx.fillRect(x, ly - 7, lw, 14)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, ly - 6.5, lw - 1, 13)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 4, ly)
  }
  if (draft) {
    ctx.globalAlpha = 1
    ctx.setLineDash([7, 4])
    ctx.strokeStyle = '#fde047'
    ctx.lineWidth = 2
    ctx.strokeRect(draft.x * scale + 0.5, draft.y * scale + 0.5, draft.width * scale - 1, draft.height * scale - 1)
  }
  ctx.restore()
}

// Arrastar com a ferramenta Nota marca um retângulo de tiles; clicar numa nota a seleciona.
let noteDrag = null
function startNoteDrag(e) {
  const notes = props.state.mapNotes, point = getMapPixelFromEvent(e)
  if (!notes || !point) return
  const existing = notes.at(point.x, point.y)
  if (existing) { notes.selectedId.value = existing.id; drawMap(); return }
  const size = st('TILE_SIZE_CONST') || 8
  noteDrag = { x: Math.floor(point.x / size), y: Math.floor(point.y / size) }
  updateNoteDraft(e)
  document.addEventListener('mousemove', updateNoteDraft)
  document.addEventListener('mouseup', finishNoteDrag)
}
function updateNoteDraft(e) {
  const notes = props.state.mapNotes, point = getMapPixelFromEvent(e)
  if (!noteDrag || !notes || !point) return
  const size = st('TILE_SIZE_CONST') || 8, mw = st('mapWidth') || 1, mh = st('mapHeight') || 1
  const tx = Math.max(0, Math.min(mw - 1, Math.floor(point.x / size))), ty = Math.max(0, Math.min(mh - 1, Math.floor(point.y / size)))
  const x1 = Math.min(noteDrag.x, tx), y1 = Math.min(noteDrag.y, ty)
  notes.draft.value = { x: x1 * size, y: y1 * size, width: (Math.max(noteDrag.x, tx) - x1 + 1) * size, height: (Math.max(noteDrag.y, ty) - y1 + 1) * size }
  drawMap()
}
function finishNoteDrag() {
  const notes = props.state.mapNotes, draft = notes?.draft.value
  endNoteDrag()
  if (draft) notes.add(draft)
  drawMap()
}
function endNoteDrag() {
  noteDrag = null
  document.removeEventListener('mousemove', updateNoteDraft)
  document.removeEventListener('mouseup', finishNoteDrag)
  if (props.state.mapNotes) props.state.mapNotes.draft.value = null
}

/** Draws the open cutscene's actors, paths and camera framings (world pixels * scale). */
function drawCutsceneOverlay(ctx, scale) {
  const marks = st('cutsceneOverlay') || []
  if (!marks.length) return
  ctx.save()
  ctx.font = `bold ${Math.max(9, Math.min(12, 5 * scale))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const badge = (x, y, text, color) => {
    const w = Math.max(14, ctx.measureText(text).width + 8)
    ctx.fillStyle = 'rgba(10, 14, 20, 0.85)'
    ctx.fillRect(x - w / 2, y - 7, w, 14)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(x - w / 2, y - 7, w, 14)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x, y)
  }
  for (const mark of marks) {
    if (mark.kind === 'camera') {
      ctx.setLineDash([8, 5])
      ctx.strokeStyle = mark.selected ? '#fde047' : 'rgba(253, 224, 71, 0.55)'
      ctx.lineWidth = mark.selected ? 3 : 1.5
      ctx.strokeRect(mark.x * scale, 0, mark.width * scale, mark.height * scale)
      ctx.setLineDash([])
      badge(mark.x * scale + 40, 12, mark.label, '#fde047')
    } else if (mark.kind === 'actor') {
      ctx.globalAlpha = mark.dim ? 0.5 : 1
      ctx.fillStyle = mark.color
      ctx.beginPath()
      ctx.arc(mark.x * scale, mark.y * scale, Math.max(4, 2.5 * scale), 0, Math.PI * 2)
      ctx.fill()
      badge(mark.x * scale, mark.y * scale + 12, mark.label, mark.color)
      ctx.globalAlpha = 1
    } else if (mark.kind === 'path' || mark.kind === 'jump') {
      const fx = mark.from.x * scale, fy = mark.from.y * scale - 4 * scale
      const tx = mark.to.x * scale, ty = mark.to.y * scale - 4 * scale
      ctx.strokeStyle = mark.color
      ctx.lineWidth = mark.selected ? 4 : 2
      if (mark.kind === 'jump') ctx.setLineDash([4, 4])
      // Um pulo aparece como arco: o pico da curva fica na altura do salto.
      const lift = mark.arc ? 2 * mark.arc * scale : 0
      ctx.beginPath(); ctx.moveTo(fx, fy)
      if (lift) ctx.quadraticCurveTo((fx + tx) / 2, (fy + ty) / 2 - lift, tx, ty)
      else ctx.lineTo(tx, ty)
      ctx.stroke()
      ctx.setLineDash([])
      const angle = lift ? Math.atan2(ty - ((fy + ty) / 2 - lift), tx - (fx + tx) / 2) : Math.atan2(ty - fy, tx - fx)
      ctx.fillStyle = mark.color
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(tx - 10 * Math.cos(angle - 0.45), ty - 10 * Math.sin(angle - 0.45))
      ctx.lineTo(tx - 10 * Math.cos(angle + 0.45), ty - 10 * Math.sin(angle + 0.45))
      ctx.fill()
      if (mark.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.stroke() }
      if (mark.label) badge((fx + tx) / 2, (fy + ty) / 2 - 10 - lift / 2, mark.label, mark.color)
    } else if (mark.kind === 'speech') {
      badge(mark.x * scale, mark.y * scale - 54 * scale / 2, `💬 ${mark.label}`, mark.color)
    }
  }
  ctx.restore()
}

// Map Watchers to trigger drawing
// Rebuild colors only when artwork changes. Grid, selection and highlight edits
// redraw the display without scanning the map again.
// The map layers are shallow refs replaced on every edit: watching their identity is enough,
// and a deep watch would walk every cell of every layer on each change (#90).
const MAP_LAYERS = ['tiles', 'tiles2', 'collisionMap', 'priorityMap', 'flipHMap', 'flipVMap', 'paletteMap', 'flipHMap2', 'flipVMap2', 'paletteMap2']
function markArtworkDirty() {
  colorArtworkDirty = true
  if (colorCaptureTimer) clearTimeout(colorCaptureTimer)
  colorCaptureTimer = null; pendingColorCapture = null
  if (props.state.colorInspector?.enabled.value) props.state.colorInspector.invalidate()
}
// Once per tick, before the redraw (post) reads the flag.
watch(() => MAP_LAYERS.filter(key => key !== 'collisionMap').map(key => st(key)), markArtworkDirty, { flush: 'pre' })
watch(() => [st('userTilesets'), st('backgroundImage'), st('parallaxLayers'),
  st('mapWidth'), st('mapHeight'), st('fgOpacity'), st('objects'), st('previewAnimations'), st('workspaceActive'),
  st('loadingMap'), st('parallaxLayers')?.length ? st('viewport') : null], markArtworkDirty, { deep: true, flush: 'pre' })
watch(() => [props.state.colorInspector?.scope.value, props.state.colorInspector?.spriteId.value, props.state.colorInspector?.bank.value], () => {
  colorArtworkDirty = true
  props.state.colorInspector?.invalidate()
  drawMap()
}, { flush: 'post' })
watch(() => st('currentMapPath'), () => {
  colorArtworkDirty = true
  props.state.colorInspector?.invalidate(true)
})
watch(() => props.state.colorInspector?.enabled.value, enabled => {
  colorArtworkDirty = true
  if (colorCaptureTimer) clearTimeout(colorCaptureTimer)
  colorCaptureTimer = null; pendingColorCapture = null
  if (enabled) props.state.colorInspector.invalidate()
  drawMap()
  syncObjectPreview()
}, { flush: 'post' })
watch(() => [props.state.colorInspector?.revision.value, props.state.colorInspector?.highlight.value], drawMap, { flush: 'post' })
watch(() => props.state.autotile?.preview.value, drawMap, { flush: 'post' })
watch(
  [
    () => st('userTilesets'),
    () => st('loadingMap'),
    () => st('backgroundImage'),
    () => st('parallaxLayers'),
    () => st('mapWidth'),
    () => st('mapHeight'),
    () => st('zoom'),
    () => st('showGrid'),
    () => st('showTileIndices'),
    () => st('showCollision'),
    () => st('showPriority'),
    () => st('showFlips'),
    () => st('showPaletteOverlay'),
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
    () => st('objects'),
    () => st('previewAnimations'),
    () => st('workspaceActive'),
    () => st('workspaceLeaving'),
    () => st('selectedObjectId'),
    () => st('cutsceneOverlay'),
    () => st('cutscenePreviewing'),
    () => props.state.mapNotes?.notes.value,
    () => props.state.mapNotes?.selectedId.value,
    () => props.state.mapNotes?.visible.value
  ], 
  () => {
    drawMap()
    syncObjectPreview()
  }, 
  { deep: true, flush: 'post' }
)
watch(() => MAP_LAYERS.map(key => st(key)), () => drawMap(), { flush: 'post' })

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
  if (st('workspaceLeaving') || st('loadingMap') || st('saving') || st('selectingMapPath')) { cancelPendingGestures(); return }
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

function onMapScroll() {
  props.state.updateViewport()
  requestAnimationFrame(() => drawMap())
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
  if (e.ctrlKey || e.altKey) {
    const wrap = mapWrapRef.value
    if (!wrap) return
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? (e.altKey && !e.ctrlKey ? wrap.clientWidth : wrap.clientHeight)
        : 1
    if (e.altKey && !e.ctrlKey) wrap.scrollLeft += e.deltaY * unit
    else wrap.scrollTop += e.deltaY * unit
    return
  }
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

function getMapPixelFromEvent(e) {
  const c = mapCanvas.value || st('mapCanvas')
  if (!c) return null
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const zoom = zoomVal()
  return { x: (e.clientX - rect.left) * (c.width / rect.width) / zoom, y: (e.clientY - rect.top) * (c.height / rect.height) / zoom }
}

function onMapMouseDown(e) {
  if (e.button !== 0) return
  if (props.state.colorInspector?.picking.value && !st('cutscenePicking')) {
    e.preventDefault()
    const point = getMapPixelFromEvent(e)
    if (point) props.state.colorInspector.pick(point.x, point.y)
    return
  }
  if (st('cutscenePicking')) {
    const point = getMapPixelFromEvent(e)
    if (point) props.state.cutscenes.completePick(point)
    return
  }
  const idx = getMapTileFromEvent(e)
  if (idx < 0) return
  props.state.ensureTiles()

  if (st('editCollision')) {
    // Arrastar pinta (ou apaga) em sequência; Shift+clique preenche o retângulo desde o último ponto.
    const value = props.state.beginCollisionStroke(idx)
    if (value === null) return
    if (e.shiftKey && collisionAnchor >= 0) props.state.paintCollisionCells(cellsInRect(collisionAnchor, idx), collisionAnchorValue)
    else { props.state.paintCollisionCells([idx], value); collisionStroke = { value, last: idx }; collisionAnchorValue = value }
    collisionAnchor = idx
    drawMap()
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
  if (tool === 'note') { startNoteDrag(e); return }
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
      const onUp = () => { finishMoveSelection(); document.removeEventListener('mouseup', onUp); if (selectionMouseUp === onUp) selectionMouseUp = null }
      if (selectionMouseUp) document.removeEventListener('mouseup', selectionMouseUp)
      selectionMouseUp = onUp
      document.addEventListener('mouseup', onUp)
      return
    }
    setSt('dragStart', idx)
    setSt('isDrawing', true)
    setSt('selection', null)
    return
  }

  if (tool === 'object') {
    const canvas = mapCanvas.value
    const rect = canvas.getBoundingClientRect()
    const tilePx = (st('TILE_SIZE_CONST') || 8) * zoomVal()
    const x = (e.clientX - rect.left) * canvas.width / rect.width / tilePx
    const y = (e.clientY - rect.top) * canvas.height / rect.height / tilePx
    const existing = [...st('objects')].reverse().find(o =>
      x >= o.x && y >= o.y && x < o.x + (o.width || 1) && y < o.y + (o.height || 1)
    )
    if (existing) {
      setSt('selectedObjectId', existing.id)
      movingObject.value = { id: existing.id, x: existing.x, y: existing.y, offsetX: x - existing.x, offsetY: y - existing.y }
      document.addEventListener('mousemove', onObjectDragMove)
      document.addEventListener('mouseup', onObjectDragEnd)
      return
    }
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

// Traço de colisão em andamento (botão esquerdo pressionado) e último ponto clicado, para o Shift+clique.
let collisionStroke = null, collisionAnchor = -1, collisionAnchorValue = 0
function cellsInRect(from, to) {
  const width = st('mapWidth'), cells = []
  const x1 = Math.min(from % width, to % width), x2 = Math.max(from % width, to % width)
  const y1 = Math.min(Math.floor(from / width), Math.floor(to / width)), y2 = Math.max(Math.floor(from / width), Math.floor(to / width))
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push(y * width + x)
  return cells
}
// Todas as células entre dois pontos: o mouse rápido pula células e o traço ficaria falhado.
function cellsOnLine(from, to) {
  const width = st('mapWidth'), cells = []
  let x = from % width, y = Math.floor(from / width)
  const x2 = to % width, y2 = Math.floor(to / width), dx = Math.abs(x2 - x), dy = -Math.abs(y2 - y), sx = x < x2 ? 1 : -1, sy = y < y2 ? 1 : -1
  let error = dx + dy
  for (let guard = 0; guard < 4096; guard++) {
    cells.push(y * width + x)
    if (x === x2 && y === y2) break
    const twice = 2 * error
    if (twice >= dy) { error += dy; x += sx }
    if (twice <= dx) { error += dx; y += sy }
  }
  return cells
}

function onMapMouseMove(e) {
  if (props.state.colorInspector?.picking.value) return
  if (movingObject.value) return
  const idx = getMapTileFromEvent(e)
  if (collisionStroke) {
    // Botão solto fora do canvas: o traço termina aqui.
    if (!(e.buttons & 1) || !st('editCollision')) { collisionStroke = null; return }
    if (idx >= 0 && idx !== collisionStroke.last) {
      if (props.state.paintCollisionCells(cellsOnLine(collisionStroke.last, idx), collisionStroke.value)) drawMap()
      collisionStroke.last = idx; collisionAnchor = idx
    }
    return
  }

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
  // Sair do canvas com o botão pressionado não encerra o traço: ele continua ao voltar.
  if (collisionStroke) { if (e.type !== 'mouseleave') collisionStroke = null; return }
  if (e.type === 'mouseleave' && movingObject.value) return
  if (movingObject.value && e.button === 0) {
    onObjectDragEnd()
    return
  }
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

function onObjectDragMove(e) {
  if (st('workspaceLeaving') || st('loadingMap') || st('saving') || st('selectingMapPath')) return
  const moving = movingObject.value
  const c = mapCanvas.value
  if (!moving || !c) return
  const rect = c.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const scaleX = c.width / rect.width
  const scaleY = c.height / rect.height
  const tilePx = (st('TILE_SIZE_CONST') || 8) * zoomVal()
  const obj = st('objects').find(o => o.id === moving.id)
  if (!obj) return
  const precision = ['collision_solid','collision_clear','collision_platform','collision_slope'].includes(obj.type) ? 8 : 1
  const rawX = Math.round(((e.clientX - rect.left) * scaleX / tilePx - moving.offsetX) * precision) / precision
  const rawY = Math.round(((e.clientY - rect.top) * scaleY / tilePx - moving.offsetY) * precision) / precision
  moving.x = Math.max(0, Math.min(st('mapWidth') - (obj.width || 1), rawX))
  moving.y = Math.max(0, Math.min(st('mapHeight') - (obj.height || 1), rawY))
  drawMap()
}

function onObjectDragEnd() {
  const moving = movingObject.value
  if (!moving) return
  document.removeEventListener('mousemove', onObjectDragMove)
  document.removeEventListener('mouseup', onObjectDragEnd)
  movingObject.value = null
  if (st('workspaceLeaving') || st('loadingMap') || st('saving') || st('selectingMapPath')) return
  props.state.moveSelectedObjectTo(moving.x, moving.y)
  drawMap()
}
</script>

<style scoped>
.te-map-canvas.te-cutscene-picking { cursor: crosshair; }
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
