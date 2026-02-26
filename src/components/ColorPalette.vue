<template>
  <!-- Eyedropper Overlay (fallback mode) -->
  <div 
    v-if="isEyedropperActive" 
    class="eyedropper-overlay"
    @click="handleEyedropperClick"
    @keydown.escape="deactivateEyedropper"
  >
    <div class="eyedropper-hint">
      Clique em qualquer lugar para capturar a cor
      <br><small>Pressione ESC para cancelar</small>
    </div>
  </div>

  <!-- Color History Panel -->
  <div v-if="isOpen" class="color-palette-overlay" @click.self="close">
    <div class="color-palette-panel">
      <div class="color-palette-header">
        <h3>Histórico de Cores</h3>
        <button class="color-palette-close" @click="close">×</button>
      </div>
      <div class="color-palette-info">
        Clique em uma cor para copiar o valor HEX
      </div>
      
      <div v-if="colorHistory.length === 0" class="color-palette-empty">
        Nenhuma cor capturada ainda. Use o botão "Capturar Cor" na barra de status.
      </div>
      
      <div v-else class="color-palette-grid">
        <div 
          v-for="(color, index) in colorHistory" 
          :key="index"
          class="color-item"
          @click="copyColor(color)"
          :title="color + '\nClique para copiar'"
        >
          <div 
            class="color-swatch" 
            :style="{ backgroundColor: color }"
          ></div>
          <div class="color-info">
            <span class="color-value">{{ color }}</span>
          </div>
        </div>
      </div>
      
      <div class="color-palette-actions">
        <button @click="captureNewColor">Capturar Nova Cor</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'colorPicked'])

const colorHistory = ref([])
const isEyedropperActive = ref(false)
const pickedColor = ref(null)

function loadColorHistory() {
  try {
    const saved = localStorage.getItem('retroStudio.colorHistory')
    if (saved) {
      colorHistory.value = JSON.parse(saved)
    }
  } catch (e) {
    // ignore
  }
}

function saveColorHistory() {
  localStorage.setItem('retroStudio.colorHistory', JSON.stringify(colorHistory.value))
}

function addToColorHistory(color) {
  const history = colorHistory.value.filter(c => c !== color)
  history.unshift(color)
  colorHistory.value = history.slice(0, 20)
  saveColorHistory()
}

function rgbToHex(rgb) {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return rgb
  
  const r = parseInt(match[1])
  const g = parseInt(match[2])
  const b = parseInt(match[3])
  
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

async function activateEyedropper() {
  if ('EyeDropper' in window) {
    try {
      const eyeDropper = new window.EyeDropper()
      const result = await eyeDropper.open()
      const color = result.sRGBHex
      pickedColor.value = color
      addToColorHistory(color)
      copyToClipboard(color)
      emit('colorPicked', color)
      return
    } catch (e) {
      console.log('EyeDropper cancelled or error:', e)
      return
    }
  }
  
  isEyedropperActive.value = true
  document.body.style.cursor = 'crosshair'
}

function handleEyedropperClick(e) {
  if (!isEyedropperActive.value) return
  
  const x = e.clientX
  const y = e.clientY
  
  const element = document.elementFromPoint(x, y)
  if (element) {
    const computedStyle = getComputedStyle(element)
    let color = computedStyle.backgroundColor
    
    if (color.startsWith('rgb')) {
      color = rgbToHex(color)
    }
    
    pickedColor.value = color
    addToColorHistory(color)
    copyToClipboard(color)
    emit('colorPicked', color)
  }
  
  deactivateEyedropper()
}

function deactivateEyedropper() {
  isEyedropperActive.value = false
  document.body.style.cursor = ''
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log('Cor copiada:', text)
  })
}

function copyColor(color) {
  copyToClipboard(color)
  emit('colorPicked', color)
}

function captureNewColor() {
  close()
  activateEyedropper()
}

function close() {
  emit('close')
}

onMounted(() => {
  loadColorHistory()
})

// Expor métodos para uso externo
defineExpose({
  activateEyedropper,
  pickedColor,
  colorHistory
})
</script>

<style scoped>
.eyedropper-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
  z-index: 1000;
  cursor: crosshair;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 100px;
}

.eyedropper-hint {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 16px 24px;
  border-radius: 10px;
  text-align: center;
  color: var(--text);
  font-size: 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.eyedropper-hint small {
  color: var(--muted);
}

.color-palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-palette-panel {
  width: 680px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.color-palette-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}

.color-palette-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.color-palette-close {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-palette-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.color-palette-info {
  padding: 12px 20px;
  font-size: 13px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.color-palette-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.color-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.color-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--accent);
}

.color-item:active {
  transform: scale(0.98);
}

.color-swatch {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.color-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.color-value {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.color-palette-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
}

.color-palette-actions button {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.color-palette-actions button:hover {
  background: #1a8ad4;
}

.color-palette-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
