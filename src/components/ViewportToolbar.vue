<template>
  <div class="viewport-toolbar">
    <!-- Tools Group -->
    <div class="toolbar-group">
      <button 
        class="toolbar-btn" 
        :class="{ active: currentTool === 'select' }"
        @click="setTool('select')"
        title="Select Tool (Q)"
      >
        <i class="fas fa-mouse-pointer"></i>
      </button>
      <button 
        class="toolbar-btn" 
        :class="{ active: currentTool === 'move' }"
        @click="setTool('move')"
        title="Move Tool (W)"
      >
        <i class="fas fa-arrows-alt"></i>
      </button>
      <button 
        class="toolbar-btn" 
        :class="{ active: currentTool === 'sprite' }"
        @click="setTool('sprite')"
        title="Add Sprite (S)"
      >
        <i class="fas fa-image"></i>
      </button>
      <button 
        class="toolbar-btn" 
        :class="{ active: currentTool === 'tile' }"
        @click="setTool('tile')"
        title="Add Tile (T)"
      >
        <i class="fas fa-th"></i>
      </button>
    </div>
    
    <!-- Separator -->
    <div class="toolbar-separator"></div>
    
    <!-- Zoom Group -->
    <div class="toolbar-group">
      <button class="toolbar-btn" @click="zoomOut" title="Zoom Out (-)">
        <i class="fas fa-search-minus"></i>
      </button>
      <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
      <button class="toolbar-btn" @click="zoomIn" title="Zoom In (+)">
        <i class="fas fa-search-plus"></i>
      </button>
      <button class="toolbar-btn" @click="resetZoom" title="Reset Zoom (0)">
        <i class="fas fa-expand-arrows-alt"></i>
      </button>
    </div>
    
    <!-- Separator -->
    <div class="toolbar-separator"></div>
    
    <!-- Grid Group -->
    <div class="toolbar-group">
      <button 
        class="toolbar-btn" 
        @click="toggleSnapToGrid" 
        :class="{ active: snapToGrid }" 
        title="Snap to Grid (G)"
      >
        <i class="fas fa-th"></i>
      </button>
      <input 
        v-model.number="gridSizeValue" 
        type="number" 
        min="8" 
        max="64" 
        step="8"
        class="grid-size-input"
        title="Grid Size"
        @change="updateGridSize"
      />
      <button 
        class="toolbar-btn" 
        @click="toggleShowGrid" 
        :class="{ active: showGrid }" 
        title="Toggle Grid"
      >
        <i class="fas fa-border-all"></i>
      </button>
    </div>
    
    <!-- Separator -->
    <div class="toolbar-separator"></div>
    
    <!-- Undo/Redo Group -->
    <div class="toolbar-group">
      <button 
        class="toolbar-btn" 
        @click="undo"
        :disabled="!canUndo"
        title="Undo (Ctrl+Z)"
      >
        <i class="fas fa-undo"></i>
      </button>
      <button 
        class="toolbar-btn" 
        @click="redo"
        :disabled="!canRedo"
        title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
      >
        <i class="fas fa-redo"></i>
      </button>
    </div>
    
    <!-- Separator -->
    <div class="toolbar-separator"></div>
    
    <!-- View Controls -->
    <div class="toolbar-group">
      <button 
        class="toolbar-btn" 
        @click="centerViewport"
        title="Center Viewport (C)"
      >
        <i class="fas fa-crosshairs"></i>
      </button>
      <button 
        class="toolbar-btn" 
        @click="fitToScreen"
        title="Fit to Screen (F)"
      >
        <i class="fas fa-compress"></i>
      </button>
      <button 
        class="toolbar-btn" 
        @click="zoomToFit"
        title="Zoom to Fit"
      >
        <i class="fas fa-expand"></i>
      </button>
      <button 
        class="toolbar-btn" 
        @click="zoomToSelection"
        title="Zoom to Selection"
      >
        <i class="fas fa-search"></i>
      </button>
    </div>
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, watch } from 'vue'
import { useUndoRedo } from '../composables/useUndoRedo'

const props = defineProps({
  currentTool: {
    type: String,
    default: 'select'
  },
  zoom: {
    type: Number,
    default: 2
  },
  snapToGrid: {
    type: Boolean,
    default: true
  },
  gridSize: {
    type: Number,
    default: 8
  },
  showGrid: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits([
  'tool-change',
  'zoom-in',
  'zoom-out',
  'reset-zoom',
  'toggle-snap-grid',
  'grid-size-change',
  'toggle-show-grid',
  'center-viewport',
  'fit-to-screen'
])

const { undo, redo, canUndo, canRedo } = useUndoRedo()

const gridSizeValue = ref(props.gridSize)

const setTool = (tool) => {
  emit('tool-change', tool)
}

const zoomIn = () => {
  emit('zoom-in')
}

const zoomOut = () => {
  emit('zoom-out')
}

const resetZoom = () => {
  emit('reset-zoom')
}

const toggleSnapToGrid = () => {
  emit('toggle-snap-grid')
}

const updateGridSize = () => {
  emit('grid-size-change', gridSizeValue.value)
}

const toggleShowGrid = () => {
  emit('toggle-show-grid')
}

const centerViewport = () => {
  emit('center-viewport')
}

const fitToScreen = () => {
  emit('fit-to-screen')
}

const zoomToFit = () => {
  emit('zoom-to-fit')
}

const zoomToSelection = () => {
  emit('zoom-to-selection')
}

watch(() => props.gridSize, (newVal) => {
  gridSizeValue.value = newVal
})
</script>

<style scoped>
.viewport-toolbar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 8px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: #333;
  margin: 0 4px;
}

.toolbar-btn {
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn:hover:not(:disabled) {
  background: #333;
  border-color: #444;
}

.toolbar-btn.active {
  background: #0066cc;
  border-color: #0088ff;
  color: white;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn:disabled:hover {
  background: #2a2a2a;
  border-color: #333;
}

.zoom-level {
  color: #ccc;
  font-size: 12px;
  padding: 0 8px;
  min-width: 50px;
  text-align: center;
}

.grid-size-input {
  width: 50px;
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px;
  border-radius: 3px;
  font-size: 12px;
  text-align: center;
}

.grid-size-input:focus {
  outline: none;
  border-color: #0066cc;
  background: #333;
}
</style>
