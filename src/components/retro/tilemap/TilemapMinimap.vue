<template>
  <div 
    class="te-minimap-container" 
    :class="{ hidden: !state.showMinimap?.value }"
    @mousedown="onMouseDown"
  >
    <div class="te-minimap-header">
      <span>Minimapa</span>
      <button class="te-minimap-close" @click="state.showMinimap.value = false" title="Fechar">×</button>
    </div>
    <div class="te-minimap-body">
      <canvas 
        ref="minimapCanvas"
        class="te-minimap-canvas"
      ></canvas>
      <div 
        class="te-minimap-viewport"
        :style="viewportRectStyle"
        @mousedown.stop="onViewportMouseDown"
      ></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  state: { type: Object, required: true }
})

const minimapCanvas = ref(null)
const minimapScale = ref(1)

const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

// Calculated viewport rectangle mapped to the minimap
const viewportRectStyle = computed(() => {
  const v = props.state.viewport.value
  if (!v) return { display: 'none' }
  return {
    left: `${v.x * minimapScale.value}px`,
    top: `${v.y * minimapScale.value}px`,
    width: `${v.w * minimapScale.value}px`,
    height: `${v.h * minimapScale.value}px`
  }
})

function drawMinimap() {
  const sourceCanvas = props.state.mapCanvas.value
  const targetCanvas = minimapCanvas.value
  if (!sourceCanvas || !targetCanvas) return

  const ctx = targetCanvas.getContext('2d')
  if (!ctx) return
  
  // Calculate scaled sizing based on the source Map Dimensions directly
  const { mapWidth, mapHeight, TILE_SIZE_CONST } = props.state
  const fullWidth = mapWidth.value * TILE_SIZE_CONST
  const fullHeight = mapHeight.value * TILE_SIZE_CONST
  
  // Max minimap dimension is 200px
  const maxDim = 200
  minimapScale.value = Math.min(maxDim / fullWidth, maxDim / fullHeight, 1) // don't upscale
  
  const w = fullWidth * minimapScale.value
  const h = fullHeight * minimapScale.value
  
  targetCanvas.width = w
  targetCanvas.height = h
  
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sourceCanvas, 0, 0, w, h)
}

function updateViewportFromEvent(e) {
  const targetCanvas = minimapCanvas.value
  if (!targetCanvas) return
  
  const rect = targetCanvas.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  
  const scale = minimapScale.value
  const v = props.state.viewport.value
  
  // Try to center the viewport around the click
  let targetX = (mouseX / scale) - (v.w / 2)
  let targetY = (mouseY / scale) - (v.h / 2)
  
  props.state.setViewportPosition(targetX, targetY)
}

function onMouseDown(e) {
  if (e.button !== 0) return
  updateViewportFromEvent(e)
  isDragging.value = true
  
  const onMove = (ev) => {
    if (isDragging.value) updateViewportFromEvent(ev)
  }
  const onUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onViewportMouseDown(e) {
  if (e.button !== 0) return
  isDragging.value = true
  dragStart.value = {
    x: e.clientX,
    y: e.clientY,
    vx: props.state.viewport.value.x,
    vy: props.state.viewport.value.y
  }
  
  const onMove = (ev) => {
    if (!isDragging.value) return
    const dx = (ev.clientX - dragStart.value.x) / minimapScale.value
    const dy = (ev.clientY - dragStart.value.y) / minimapScale.value
    props.state.setViewportPosition(
      dragStart.value.vx + dx,
      dragStart.value.vy + dy
    )
  }
  const onUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// Watchers
watch(
  [
    () => props.state.tiles.value,
    () => props.state.tiles2.value,
    () => props.state.mapWidth.value,
    () => props.state.mapHeight.value,
    () => props.state.showMinimap?.value,
    () => props.state.objects.value
  ], 
  () => {
    if (props.state.showMinimap?.value) {
      // Debounce drawing minimally not to choke performance on fast paints
      requestAnimationFrame(drawMinimap)
    }
  }, { deep: true }
)

onMounted(() => {
  drawMinimap()
})
</script>

<style scoped>
.te-minimap-container {
  position: absolute;
  bottom: 20px;
  right: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.te-minimap-container.hidden {
  display: none;
}
.te-minimap-header {
  padding: 4px 8px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
}
.te-minimap-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
}
.te-minimap-close:hover {
  color: var(--text);
}
.te-minimap-body {
  position: relative;
  padding: 4px;
  background: #111;
}
.te-minimap-canvas {
  display: block;
  cursor: crosshair;
}
.te-minimap-viewport {
  position: absolute;
  border: 1px solid #fff;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.1);
  cursor: move;
  pointer-events: auto;
}
</style>
