<template>
  <div class="resizable-panel" :style="{ width: width + 'px' }">
    <div 
      class="resizer"
      @mousedown="startResize"
      :class="{ resizing: isResizing }"
    ></div>
    <div class="panel-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  initialWidth: {
    type: Number,
    default: 300
  },
  minWidth: {
    type: Number,
    default: 200
  },
  maxWidth: {
    type: Number,
    default: 800
  },
  side: {
    type: String,
    default: 'left', // 'left' or 'right'
    validator: (value) => ['left', 'right'].includes(value)
  }
})

const emit = defineEmits(['update:width'])

const width = ref(props.initialWidth)
const isResizing = ref(false)
const startX = ref(0)
const startWidth = ref(0)

// Watch for width changes and emit
watch(width, (newWidth) => {
  emit('update:width', newWidth)
})

const startResize = (e) => {
  isResizing.value = true
  startX.value = e.clientX
  startWidth.value = width.value
  
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

const handleResize = (e) => {
  if (!isResizing.value) return
  
  const deltaX = props.side === 'left' 
    ? e.clientX - startX.value 
    : startX.value - e.clientX
  
  const newWidth = startWidth.value + deltaX
  width.value = Math.max(props.minWidth, Math.min(props.maxWidth, newWidth))
}

const stopResize = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onUnmounted(() => {
  stopResize()
})
</script>

<style scoped>
.resizable-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.2s;
}

.resizer:hover,
.resizer.resizing {
  background: #0066cc;
}

.resizable-panel[style*="left"] .resizer {
  right: -2px;
}

.resizable-panel[style*="right"] .resizer {
  left: -2px;
}

.panel-content {
  flex: 1;
  overflow: hidden;
  width: 100%;
  height: 100%;
}
</style>
