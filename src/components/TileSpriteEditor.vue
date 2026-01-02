<template>
  <div class="tile-sprite-editor">
    <div class="editor-header">
      <h3>{{ editingResource?.name || 'Tile/Sprite Editor' }}</h3>
      <div class="header-actions">
        <button class="icon-btn" @click="closeEditor" title="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <div class="editor-toolbar">
      <div class="toolbar-group">
        <button 
          class="toolbar-btn"
          :class="{ active: currentTool === 'pencil' }"
          @click="currentTool = 'pencil'"
          title="Pencil (P)"
        >
          <i class="fas fa-pencil"></i>
        </button>
        <button 
          class="toolbar-btn"
          :class="{ active: currentTool === 'eraser' }"
          @click="currentTool = 'eraser'"
          title="Eraser (E)"
        >
          <i class="fas fa-eraser"></i>
        </button>
        <button 
          class="toolbar-btn"
          :class="{ active: currentTool === 'fill' }"
          @click="currentTool = 'fill'"
          title="Fill (F)"
        >
          <i class="fas fa-fill"></i>
        </button>
        <button 
          class="toolbar-btn"
          :class="{ active: currentTool === 'eyedropper' }"
          @click="currentTool = 'eyedropper'"
          title="Eyedropper (I)"
        >
          <i class="fas fa-eye-dropper"></i>
        </button>
      </div>

      <div class="toolbar-group">
        <label>Size:</label>
        <input 
          v-model.number="brushSize" 
          type="number" 
          min="1" 
          max="8"
          class="size-input"
        />
      </div>

      <div class="toolbar-group">
        <label>Zoom:</label>
        <button class="toolbar-btn" @click="zoomOut">
          <i class="fas fa-search-minus"></i>
        </button>
        <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
        <button class="toolbar-btn" @click="zoomIn">
          <i class="fas fa-search-plus"></i>
        </button>
        <button class="toolbar-btn" @click="resetZoom">
          <i class="fas fa-expand-arrows-alt"></i>
        </button>
      </div>
    </div>

    <div class="editor-content">
      <!-- Palette Selector -->
      <div class="palette-panel">
        <h4>Palette</h4>
        <div class="palette-selector">
          <select v-model="selectedPaletteId" @change="updateSelectedPalette" class="palette-select">
            <option v-for="palette in availablePalettes" :key="palette.id" :value="palette.id">
              {{ palette.name }}
            </option>
          </select>
          <button class="btn-new-palette" @click="createNewPalette" title="Create New Palette">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="palette-colors">
          <div 
            v-for="(color, index) in currentPalette.colors" 
            :key="index"
            class="palette-color"
            :class="{ selected: selectedColorIndex === index }"
            :style="{ backgroundColor: color }"
            @click="selectColor(index)"
            :title="`Color ${index}: ${color}`"
          >
            <span class="color-index">{{ index }}</span>
          </div>
        </div>
        <button class="btn-edit-palette" @click="openPaletteEditor">
          <i class="fas fa-palette"></i> Edit Palette
        </button>
      </div>

      <!-- Canvas Area -->
      <div class="canvas-panel">
        <div class="canvas-container" ref="canvasContainer">
          <canvas 
            ref="canvas"
            :width="canvasWidth"
            :height="canvasHeight"
            @mousedown="handleMouseDown"
            @mousemove="handleMouseMove"
            @mouseup="handleMouseUp"
            @mouseleave="handleMouseLeave"
          ></canvas>
          
          <!-- Grid Overlay -->
          <div 
            v-if="showGrid"
            class="grid-overlay"
            :style="{
              backgroundImage: `linear-gradient(to right, #333 1px, transparent 1px),
                                linear-gradient(to bottom, #333 1px, transparent 1px)`,
              backgroundSize: `${zoom * 8}px ${zoom * 8}px`,
              width: `${canvasWidth * zoom}px`,
              height: `${canvasHeight * zoom}px`
            }"
          ></div>
        </div>

        <!-- Canvas Info -->
        <div class="canvas-info">
          <span>Size: {{ editingResource?.width || 8 }}x{{ editingResource?.height || 8 }}</span>
          <span>Position: X:{{ mousePixelX }}, Y:{{ mousePixelY }}</span>
          <button class="btn-toggle-grid" @click="showGrid = !showGrid">
            <i class="fas" :class="showGrid ? 'fa-th' : 'fa-th-large'"></i> Grid
          </button>
        </div>
      </div>

      <!-- Preview Panel -->
      <div class="preview-panel">
        <h4>Preview</h4>
        <div class="preview-container">
          <canvas 
            ref="previewCanvas"
            :width="previewSize"
            :height="previewSize"
            class="preview-canvas"
          ></canvas>
        </div>
        <div class="preview-info">
          <p>Mega Drive Format</p>
          <p>8x8 tiles</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const canvas = ref(null)
const previewCanvas = ref(null)
const canvasContainer = ref(null)
const currentTool = ref('pencil')
const brushSize = ref(1)
const zoom = ref(8)
const showGrid = ref(true)
const selectedColorIndex = ref(0)
const mousePixelX = ref(0)
const mousePixelY = ref(0)

const editingResource = computed(() => store.state.selectedResource)
const availablePalettes = computed(() => {
  return store.state.resources?.palettes || []
})

const selectedPaletteId = ref(null)
const currentPalette = computed(() => {
  // Find selected palette or use first available
  if (selectedPaletteId.value) {
    const palette = availablePalettes.value.find(p => p.id === selectedPaletteId.value)
    if (palette) return palette
  }
  
  // Fallback to first palette or default
  return availablePalettes.value[0] || {
    id: 'default',
    name: 'Default Palette',
    colors: [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00',
      '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
      '#808080', '#800000', '#008000', '#000080',
      '#808000', '#800080', '#008080', '#C0C0C0'
    ]
  }
})

const updateSelectedPalette = () => {
  // Palette changed, redraw canvas
  redrawCanvas()
  updatePreview()
}

const createNewPalette = () => {
  const newPalette = {
    id: `palette_${Date.now()}`,
    name: `Palette ${availablePalettes.value.length + 1}`,
    type: 'palette',
    colors: [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00',
      '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
      '#808080', '#800000', '#008000', '#000080',
      '#808000', '#800080', '#008080', '#C0C0C0'
    ],
    createdAt: new Date().toISOString()
  }
  
  store.dispatch('addResource', newPalette)
  selectedPaletteId.value = newPalette.id
  
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Palette Created',
    message: `"${newPalette.name}" created`
  })
}

const canvasWidth = computed(() => (editingResource.value?.width || 8) * 8)
const canvasHeight = computed(() => (editingResource.value?.height || 8) * 8)
const previewSize = computed(() => (editingResource.value?.width || 8) * 8)

let isDrawing = false
let pixelData = null
let ctx = null
let previewCtx = null

const initCanvas = () => {
  if (!canvas.value || !editingResource.value) return
  
  ctx = canvas.value.getContext('2d')
  previewCtx = previewCanvas.value?.getContext('2d')
  
  const width = canvasWidth.value
  const height = canvasHeight.value
  
  // Initialize pixel data (Mega Drive uses indexed colors)
  if (!pixelData) {
    pixelData = new Array(width * height).fill(0)
  }
  
  // Draw existing data or clear
  redrawCanvas()
  updatePreview()
}

const redrawCanvas = () => {
  if (!ctx) return
  
  const width = canvasWidth.value
  const height = canvasHeight.value
  
  // Clear canvas
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  
  // Draw pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const colorIndex = pixelData[index] || 0
      const color = currentPalette.value.colors[colorIndex] || '#000000'
      
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

const updatePreview = () => {
  if (!previewCtx) return
  
  const size = previewSize.value
  previewCtx.imageSmoothingEnabled = false
  
  // Scale up for preview
  const scale = size / canvasWidth.value
  
  for (let y = 0; y < canvasHeight.value; y++) {
    for (let x = 0; x < canvasWidth.value; x++) {
      const index = y * canvasWidth.value + x
      const colorIndex = pixelData[index] || 0
      const color = currentPalette.value.colors[colorIndex] || '#000000'
      
      previewCtx.fillStyle = color
      previewCtx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
}

const getPixelFromMouse = (e) => {
  const rect = canvas.value.getBoundingClientRect()
  const x = Math.floor((e.clientX - rect.left) / zoom.value)
  const y = Math.floor((e.clientY - rect.top) / zoom.value)
  
  return { x, y }
}

const setPixel = (x, y, colorIndex) => {
  if (x < 0 || x >= canvasWidth.value || y < 0 || y >= canvasHeight.value) return
  
  const index = y * canvasWidth.value + x
  pixelData[index] = colorIndex
  
  // Redraw affected area
  ctx.fillStyle = currentPalette.value.colors[colorIndex] || '#000000'
  ctx.fillRect(x, y, 1, 1)
  
  updatePreview()
}

const fillArea = (startX, startY, targetColorIndex, newColorIndex) => {
  if (targetColorIndex === newColorIndex) return
  
  const stack = [{ x: startX, y: startY }]
  const width = canvasWidth.value
  const height = canvasHeight.value
  
  while (stack.length > 0) {
    const { x, y } = stack.pop()
    
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    
    const index = y * width + x
    if (pixelData[index] !== targetColorIndex) continue
    
    pixelData[index] = newColorIndex
    ctx.fillStyle = currentPalette.value.colors[newColorIndex] || '#000000'
    ctx.fillRect(x, y, 1, 1)
    
    stack.push({ x: x + 1, y })
    stack.push({ x: x - 1, y })
    stack.push({ x, y: y + 1 })
    stack.push({ x, y: y - 1 })
  }
  
  updatePreview()
}

const handleMouseDown = (e) => {
  isDrawing = true
  const { x, y } = getPixelFromMouse(e)
  mousePixelX.value = x
  mousePixelY.value = y
  
  if (currentTool.value === 'pencil') {
    setPixel(x, y, selectedColorIndex.value)
  } else if (currentTool.value === 'eraser') {
    setPixel(x, y, 0) // 0 is transparent/black
  } else if (currentTool.value === 'fill') {
    const index = y * canvasWidth.value + x
    const targetColor = pixelData[index] || 0
    fillArea(x, y, targetColor, selectedColorIndex.value)
  } else if (currentTool.value === 'eyedropper') {
    const index = y * canvasWidth.value + x
    selectedColorIndex.value = pixelData[index] || 0
  }
}

const handleMouseMove = (e) => {
  const { x, y } = getPixelFromMouse(e)
  mousePixelX.value = x
  mousePixelY.value = y
  
  if (isDrawing && (currentTool.value === 'pencil' || currentTool.value === 'eraser')) {
    if (currentTool.value === 'pencil') {
      setPixel(x, y, selectedColorIndex.value)
    } else {
      setPixel(x, y, 0)
    }
  }
}

const handleMouseUp = () => {
  isDrawing = false
}

const handleMouseLeave = () => {
  isDrawing = false
}

const selectColor = (index) => {
  selectedColorIndex.value = index
}

const zoomIn = () => {
  zoom.value = Math.min(zoom.value + 2, 32)
}

const zoomOut = () => {
  zoom.value = Math.max(zoom.value - 2, 2)
}

const resetZoom = () => {
  zoom.value = 8
}

const openPaletteEditor = () => {
  if (currentPalette.value && currentPalette.value.id !== 'default') {
    store.dispatch('updateSelectedResource', currentPalette.value)
    store.dispatch('openResourceEditor', currentPalette.value)
  } else {
    store.dispatch('showNotification', {
      type: 'warning',
      title: 'No Palette Selected',
      message: 'Please select or create a palette first'
    })
  }
}

// Watch for palette changes and update selection
watch(() => availablePalettes.value, (newPalettes) => {
  if (newPalettes.length > 0 && !selectedPaletteId.value) {
    selectedPaletteId.value = newPalettes[0].id
  }
}, { immediate: true })

// Watch for selected palette changes
watch(() => currentPalette.value, () => {
  redrawCanvas()
  updatePreview()
})

const closeEditor = () => {
  // Save changes
  if (editingResource.value && pixelData) {
    const updatedResource = {
      ...editingResource.value,
      data: pixelData
    }
    store.dispatch('updateResource', updatedResource)
  }
  
  store.dispatch('closeResourceEditor')
}

// Keyboard shortcuts
const handleKeyDown = (e) => {
  if (e.target.tagName === 'INPUT') return
  
  switch(e.key.toLowerCase()) {
    case 'p':
      currentTool.value = 'pencil'
      break
    case 'e':
      currentTool.value = 'eraser'
      break
    case 'f':
      currentTool.value = 'fill'
      break
    case 'i':
      currentTool.value = 'eyedropper'
      break
    case '=':
    case '+':
      zoomIn()
      break
    case '-':
      zoomOut()
      break
    case '0':
      resetZoom()
      break
  }
}

watch(editingResource, (newResource) => {
  if (newResource) {
    nextTick(() => {
      initCanvas()
    })
  }
}, { immediate: true })

watch(zoom, () => {
  if (canvas.value) {
    canvas.value.style.width = `${canvasWidth.value * zoom.value}px`
    canvas.value.style.height = `${canvasHeight.value * zoom.value}px`
    canvas.value.style.imageRendering = 'pixelated'
  }
})

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  initCanvas()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  closeEditor()
})
</script>

<style scoped>
.tile-sprite-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: #1a1a1a;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.editor-header h3 {
  margin: 0;
  font-size: 16px;
  color: #ccc;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 4px;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: #333;
  color: #fff;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-right: 1px solid #333;
}

.toolbar-group:last-child {
  border-right: none;
}

.toolbar-btn {
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: #333;
  border-color: #444;
}

.toolbar-btn.active {
  background: #0066cc;
  border-color: #0088ff;
  color: white;
}

.size-input {
  width: 50px;
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px;
  border-radius: 3px;
}

.zoom-level {
  color: #ccc;
  font-size: 12px;
  padding: 0 8px;
  min-width: 50px;
  text-align: center;
}

.editor-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.palette-panel {
  width: 200px;
  padding: 16px;
  background: #1e1e1e;
  border-right: 1px solid #333;
  overflow-y: auto;
}

.palette-panel h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #ccc;
}

.palette-selector {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.palette-select {
  flex: 1;
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.palette-select:hover {
  background: #333;
  border-color: #444;
}

.palette-select:focus {
  outline: none;
  border-color: #0066cc;
}

.btn-new-palette {
  background: #0066cc;
  border: none;
  color: white;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-new-palette:hover {
  background: #0088ff;
}

.palette-colors {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 16px;
}

.palette-color {
  aspect-ratio: 1;
  border: 2px solid #333;
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
}

.palette-color:hover {
  border-color: #555;
  transform: scale(1.1);
}

.palette-color.selected {
  border-color: #0066cc;
  box-shadow: 0 0 8px rgba(0, 102, 204, 0.5);
}

.color-index {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 8px;
  color: rgba(255, 255, 255, 0.7);
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
}

.btn-edit-palette {
  width: 100%;
  background: #0066cc;
  border: none;
  color: white;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-edit-palette:hover {
  background: #0088ff;
}

.canvas-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #0f0f0f;
  overflow: auto;
}

.canvas-container {
  position: relative;
  background: #000;
  border: 2px solid #333;
}

canvas {
  display: block;
  image-rendering: pixelated;
  cursor: crosshair;
}

.grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  opacity: 0.3;
}

.canvas-info {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
  color: #888;
  font-size: 12px;
}

.btn-toggle-grid {
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}

.btn-toggle-grid:hover {
  background: #333;
}

.preview-panel {
  width: 200px;
  padding: 16px;
  background: #1e1e1e;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
}

.preview-panel h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #ccc;
}

.preview-container {
  background: #000;
  border: 2px solid #333;
  padding: 8px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-canvas {
  image-rendering: pixelated;
  max-width: 100%;
  height: auto;
}

.preview-info {
  color: #888;
  font-size: 11px;
}

.preview-info p {
  margin: 4px 0;
}
</style>
