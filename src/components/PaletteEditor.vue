<template>
  <div class="palette-editor">
    <div class="editor-header">
      <h3>{{ editingPalette?.name || 'Palette Editor' }}</h3>
      <div class="header-actions">
        <button class="icon-btn" @click="closeEditor" title="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <div class="editor-content">
      <div class="palette-info">
        <p class="info-text">
          Mega Drive supports 16 colors per palette (4 palettes total).
          Colors are stored as 15-bit RGB (5 bits per channel).
        </p>
      </div>

      <div class="color-grid">
        <div 
          v-for="(color, index) in paletteColors" 
          :key="index"
          class="color-slot"
          :class="{ selected: selectedIndex === index }"
          @click="selectColor(index)"
        >
          <div 
            class="color-preview"
            :style="{ backgroundColor: color }"
            @click.stop="openColorPicker(index)"
          >
            <span class="slot-number">{{ index }}</span>
          </div>
          <div class="color-controls">
            <input 
              type="color" 
              v-model="paletteColors[index]"
              @input="updateColor(index, $event.target.value)"
              class="color-input"
            />
            <input 
              type="text" 
              v-model="paletteColors[index]"
              @input="updateColor(index, $event.target.value)"
              class="color-hex"
              placeholder="#000000"
            />
          </div>
          <div class="rgb-controls">
            <label>R:</label>
            <input 
              type="number" 
              v-model.number="rgbValues[index].r"
              @input="updateFromRGB(index)"
              min="0"
              max="31"
              class="rgb-input"
            />
            <label>G:</label>
            <input 
              type="number" 
              v-model.number="rgbValues[index].g"
              @input="updateFromRGB(index)"
              min="0"
              max="31"
              class="rgb-input"
            />
            <label>B:</label>
            <input 
              type="number" 
              v-model.number="rgbValues[index].b"
              @input="updateFromRGB(index)"
              min="0"
              max="31"
              class="rgb-input"
            />
          </div>
        </div>
      </div>

      <div class="editor-actions">
        <button class="btn-action" @click="resetPalette">
          <i class="fas fa-undo"></i> Reset to Default
        </button>
        <button class="btn-action" @click="importPalette">
          <i class="fas fa-file-import"></i> Import
        </button>
        <button class="btn-action" @click="exportPalette">
          <i class="fas fa-file-export"></i> Export
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const selectedIndex = ref(0)
const paletteColors = ref([])
const rgbValues = ref([])

const editingPalette = computed(() => store.state.selectedResource)

// Convert hex to Mega Drive RGB (15-bit, 5 bits per channel)
const hexToMegaDriveRGB = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  
  // Convert to 5-bit (0-31)
  return {
    r: Math.floor(r / 8),
    g: Math.floor(g / 8),
    b: Math.floor(b / 8)
  }
}

// Convert Mega Drive RGB to hex
const megaDriveRGBToHex = (r, g, b) => {
  // Convert from 5-bit to 8-bit
  const r8 = Math.floor((r * 255) / 31)
  const g8 = Math.floor((g * 255) / 31)
  const b8 = Math.floor((b * 255) / 31)
  
  return `#${[r8, g8, b8].map(x => {
    const hex = x.toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')}`
}

const initPalette = () => {
  if (editingPalette.value && editingPalette.value.colors) {
    paletteColors.value = [...editingPalette.value.colors]
  } else {
    // Default Mega Drive palette
    paletteColors.value = [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00',
      '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
      '#808080', '#800000', '#008000', '#000080',
      '#808000', '#800080', '#008080', '#C0C0C0'
    ]
  }
  
  // Initialize RGB values
  rgbValues.value = paletteColors.value.map(hex => hexToMegaDriveRGB(hex))
}

const selectColor = (index) => {
  selectedIndex.value = index
}

const openColorPicker = (index) => {
  // Color picker is handled by the color input
  selectedIndex.value = index
}

const updateColor = (index, hex) => {
  paletteColors.value[index] = hex
  rgbValues.value[index] = hexToMegaDriveRGB(hex)
  savePalette()
}

const updateFromRGB = (index) => {
  const { r, g, b } = rgbValues.value[index]
  const hex = megaDriveRGBToHex(r, g, b)
  paletteColors.value[index] = hex
  savePalette()
}

const savePalette = () => {
  if (editingPalette.value) {
    const updatedPalette = {
      ...editingPalette.value,
      colors: [...paletteColors.value]
    }
    store.dispatch('updateResource', updatedPalette)
  }
}

const resetPalette = () => {
  if (confirm('Reset palette to default? This will lose all changes.')) {
    initPalette()
    savePalette()
  }
}

const importPalette = () => {
  // TODO: Implement palette import from file
  // For now, show a message (alert doesn't work in Electron, but console.log is fine)
  console.log('Palette import coming soon!')
  // You could create a file input dialog here
}

const exportPalette = () => {
  if (!editingPalette.value) return
  
  const paletteData = {
    name: editingPalette.value.name,
    colors: paletteColors.value,
    rgbValues: rgbValues.value
  }
  
  const dataStr = JSON.stringify(paletteData, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${editingPalette.value.name || 'palette'}.json`
  link.click()
  URL.revokeObjectURL(url)
}

const closeEditor = () => {
  savePalette()
  store.dispatch('closeResourceEditor')
}

watch(editingPalette, (newPalette) => {
  if (newPalette) {
    initPalette()
  }
}, { immediate: true })

onMounted(() => {
  initPalette()
})
</script>

<style scoped>
.palette-editor {
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

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.palette-info {
  margin-bottom: 24px;
  padding: 12px;
  background: #252525;
  border-radius: 4px;
  border-left: 3px solid #0066cc;
}

.info-text {
  margin: 0;
  color: #aaa;
  font-size: 13px;
  line-height: 1.5;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.color-slot {
  background: #252525;
  border: 2px solid #333;
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s;
}

.color-slot:hover {
  border-color: #444;
  background: #2a2a2a;
}

.color-slot.selected {
  border-color: #0066cc;
  box-shadow: 0 0 12px rgba(0, 102, 204, 0.3);
}

.color-preview {
  width: 100%;
  height: 80px;
  border-radius: 4px;
  border: 2px solid #333;
  margin-bottom: 12px;
  position: relative;
  cursor: pointer;
  transition: all 0.2s;
}

.color-preview:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.slot-number {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: bold;
}

.color-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.color-input {
  width: 50px;
  height: 32px;
  border: 1px solid #333;
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
}

.color-hex {
  flex: 1;
  background: #1e1e1e;
  border: 1px solid #333;
  color: #ccc;
  padding: 6px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.color-hex:focus {
  outline: none;
  border-color: #0066cc;
}

.rgb-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rgb-controls label {
  font-size: 11px;
  color: #888;
  min-width: 12px;
}

.rgb-input {
  width: 50px;
  background: #1e1e1e;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px 6px;
  border-radius: 3px;
  font-size: 12px;
}

.rgb-input:focus {
  outline: none;
  border-color: #0066cc;
}

.editor-actions {
  display: flex;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #333;
}

.btn-action {
  background: #0066cc;
  border: none;
  color: white;
  padding: 10px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-action:hover {
  background: #0088ff;
}

.btn-action i {
  font-size: 12px;
}
</style>
