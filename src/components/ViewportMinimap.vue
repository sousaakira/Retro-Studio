<template>
  <div class="viewport-minimap" v-if="show">
    <div class="minimap-header">
      <span class="minimap-title">Minimap</span>
      <button class="minimap-close" @click="$emit('close')" title="Close">
        <i class="fas fa-times"></i>
      </button>
    </div>
    
    <div 
      class="minimap-content"
      ref="minimapContainer"
      @mousedown="handleMinimapClick"
      @mousemove="handleMinimapDrag"
      @mouseup="isDragging = false"
    >
      <!-- Game Area (320x224) -->
      <div 
        class="minimap-game-area"
        :style="{
          width: `${320 * scale}px`,
          height: `${224 * scale}px`
        }"
      >
        <!-- Scene Nodes -->
        <div
          v-for="node in nodes"
          :key="node.id"
          class="minimap-node"
          :class="{ selected: selectedNodeId === node.id }"
          :style="{
            left: `${node.x * scale}px`,
            top: `${node.y * scale}px`,
            width: `${(node.width || 16) * scale}px`,
            height: `${(node.height || 16) * scale}px`
          }"
        ></div>
      </div>
      
      <!-- Viewport Indicator -->
      <div
        class="viewport-indicator"
        :style="{
          left: `${viewportX * scale}px`,
          top: `${viewportY * scale}px`,
          width: `${props.viewportWidth * scale}px`,
          height: `${props.viewportHeight * scale}px`
        }"
      ></div>
    </div>
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, computed } from 'vue'
import { useStore } from 'vuex'

const props = defineProps({
  show: {
    type: Boolean,
    default: true
  },
  viewportWidth: {
    type: Number,
    default: 320
  },
  viewportHeight: {
    type: Number,
    default: 224
  },
  viewportOffsetX: {
    type: Number,
    default: 0
  },
  viewportOffsetY: {
    type: Number,
    default: 0
  },
  zoom: {
    type: Number,
    default: 2
  }
})

const emit = defineEmits(['close', 'pan'])

const store = useStore()
const minimapContainer = ref(null)
const isDragging = ref(false)

const nodes = computed(() => store.state.sceneNodes || [])
const selectedNodeId = computed(() => store.state.selectedNode?.id)

// Calculate scale to fit 320x224 in minimap (max 200px width)
const minimapWidth = 200
const scale = computed(() => minimapWidth / 320)

// Viewport indicator position
const viewportX = computed(() => {
  // Convert viewport offset to game coordinates
  return Math.max(0, Math.min(320 - props.viewportWidth, -props.viewportOffsetX / props.zoom))
})

const viewportY = computed(() => {
  return Math.max(0, Math.min(224 - props.viewportHeight, -props.viewportOffsetY / props.zoom))
})

const handleMinimapClick = (e) => {
  if (!minimapContainer.value) return
  
  const rect = minimapContainer.value.getBoundingClientRect()
  const x = (e.clientX - rect.left) / scale.value
  const y = (e.clientY - rect.top) / scale.value
  
  // Center viewport on clicked position
  const newOffsetX = -(x - props.viewportWidth / 2) * props.zoom
  const newOffsetY = -(y - props.viewportHeight / 2) * props.zoom
  
  emit('pan', { x: newOffsetX, y: newOffsetY })
  isDragging.value = true
}

const handleMinimapDrag = (e) => {
  if (!isDragging.value || !minimapContainer.value) return
  
  const rect = minimapContainer.value.getBoundingClientRect()
  const x = (e.clientX - rect.left) / scale.value
  const y = (e.clientY - rect.top) / scale.value
  
  const newOffsetX = -(x - props.viewportWidth / 2) * props.zoom
  const newOffsetY = -(y - props.viewportHeight / 2) * props.zoom
  
  emit('pan', { x: newOffsetX, y: newOffsetY })
}
</script>

<style scoped>
.viewport-minimap {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 220px;
  background: #252525;
  border: 1px solid #333;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 100;
  overflow: hidden;
}

.minimap-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
}

.minimap-title {
  font-size: 11px;
  color: #ccc;
  font-weight: 500;
}

.minimap-close {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  transition: all 0.2s;
  font-size: 10px;
}

.minimap-close:hover {
  background: #333;
  color: #fff;
}

.minimap-content {
  position: relative;
  width: 200px;
  height: 140px;
  background: #1a1a1a;
  cursor: crosshair;
  overflow: hidden;
  margin: 10px;
  border: 1px solid #333;
}

.minimap-game-area {
  position: relative;
  background: #0f0f0f;
  border: 1px solid #0066cc;
}

.minimap-node {
  position: absolute;
  background: rgba(0, 255, 0, 0.3);
  border: 1px solid #00ff00;
  box-sizing: border-box;
  pointer-events: none;
}

.minimap-node.selected {
  background: rgba(0, 102, 204, 0.5);
  border-color: #0066cc;
  box-shadow: 0 0 4px rgba(0, 102, 204, 0.8);
}

.viewport-indicator {
  position: absolute;
  border: 2px solid #ffa500;
  background: rgba(255, 165, 0, 0.1);
  pointer-events: none;
  box-sizing: border-box;
}
</style>
