<template>
  <div class="scene-viewport" ref="containerRef">
    <ViewportToolbar
      :current-tool="currentTool"
      :zoom="zoom"
      :show-grid="showGrid"
      :snap-to-grid="snapToGrid"
      @tool-change="currentTool = $event"
      @zoom-in="zoom = Math.min(4, zoom + 0.5)"
      @zoom-out="zoom = Math.max(0.5, zoom - 0.5)"
      @reset-zoom="zoom = 2"
      @toggle-show-grid="showGrid = !showGrid"
      @toggle-snap-grid="snapToGrid = !snapToGrid"
    />
    <div
      class="viewport-canvas"
      :style="{ width: 320 * zoom + 40 + 'px', height: 224 * zoom + 40 + 'px' }"
      @mousedown="onCanvasDown"
    >
      <svg v-if="showGrid" class="grid-svg" :width="320 * zoom" :height="224 * zoom">
        <defs>
          <pattern id="grid" :width="16 * zoom" :height="16 * zoom" patternUnits="userSpaceOnUse">
            <path :d="`M ${16 * zoom} 0 L 0 0 0 ${16 * zoom}`" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div class="game-area" :style="{ width: 320 * zoom + 'px', height: 224 * zoom + 'px' }">
        <div
          v-for="node in sceneNodes"
          :key="node.id"
          class="scene-node"
          :class="{ selected: selectedNodeId === node.id }"
          :style="nodeStyle(node)"
          @mousedown.stop="selectNode(node.id)"
        >
          {{ node.name || node.type }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import ViewportToolbar from './ViewportToolbar.vue'

const props = defineProps({
  sceneNodes: { type: Array, default: () => [] },
  selectedNodeId: { type: String, default: null }
})

const emit = defineEmits(['update:selectedNodeId', 'scene-changed'])

const currentTool = ref('select')
const zoom = ref(2)
const showGrid = ref(true)
const snapToGrid = ref(true)
const containerRef = ref(null)

function selectNode(id) {
  emit('update:selectedNodeId', id)
}

function nodeStyle(node) {
  return {
    left: (node.x || 0) + 'px',
    top: (node.y || 0) + 'px',
    width: (node.width || 32) + 'px',
    height: (node.height || 32) + 'px'
  }
}

function onCanvasDown(e) {
  if (e.target.classList.contains('viewport-canvas') || e.target.classList.contains('game-area')) {
    emit('update:selectedNodeId', null)
  }
}
</script>

<style scoped>
.scene-viewport {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
}
.viewport-canvas {
  flex: 1;
  position: relative;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.grid-svg {
  position: absolute;
  top: 20px;
  left: 20px;
}
.game-area {
  position: relative;
  background: #0a0a0a;
  border: 1px solid #333;
}
.scene-node {
  position: absolute;
  background: rgba(100, 150, 255, 0.5);
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
}
.scene-node.selected {
  border-color: var(--accent);
  outline: 1px solid var(--accent);
}
</style>
