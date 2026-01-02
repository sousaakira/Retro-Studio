<template>
  <div class="inspector-panel">
    <div class="inspector-header">
      <h3>Inspector</h3>
    </div>
    
    <div class="inspector-content" v-if="selectedNode">
      <!-- Node Info -->
      <div class="property-section">
        <div class="section-header" @click="toggleSection('info')">
          <i class="fas" :class="expandedSections.info ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span>Node Info</span>
        </div>
        <div v-if="expandedSections.info" class="section-content">
          <div class="property-field">
            <label>Name</label>
            <input 
              v-model="selectedNode.name" 
              type="text"
              @input="updateNode"
            />
          </div>
          <div class="property-field">
            <label>Type</label>
            <select v-model="selectedNode.type" @change="updateNode">
              <option value="sprite">Sprite</option>
              <option value="tile">Tile</option>
              <option value="entity">Entity</option>
              <option value="background">Background</option>
              <option value="sound">Sound</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Transform -->
      <div class="property-section">
        <div class="section-header" @click="toggleSection('transform')">
          <i class="fas" :class="expandedSections.transform ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span>Transform</span>
        </div>
        <div v-if="expandedSections.transform" class="section-content">
          <div class="property-field">
            <label>Position X</label>
            <input 
              v-model.number="selectedNode.x" 
              type="number"
              step="1"
              @input="updateNode"
            />
          </div>
          <div class="property-field">
            <label>Position Y</label>
            <input 
              v-model.number="selectedNode.y" 
              type="number"
              step="1"
              @input="updateNode"
            />
          </div>
          <div class="property-field">
            <label>Width</label>
            <input 
              v-model.number="selectedNode.width" 
              type="number"
              step="1"
              min="1"
              @input="updateNode"
            />
          </div>
          <div class="property-field">
            <label>Height</label>
            <input 
              v-model.number="selectedNode.height" 
              type="number"
              step="1"
              min="1"
              @input="updateNode"
            />
          </div>
        </div>
      </div>

      <!-- Sprite Properties -->
      <div v-if="selectedNode.type === 'sprite'" class="property-section">
        <div class="section-header" @click="toggleSection('sprite')">
          <i class="fas" :class="expandedSections.sprite ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span>Sprite</span>
        </div>
        <div v-if="expandedSections.sprite" class="section-content">
          <div class="property-field">
            <label>Sprite Resource</label>
            <select v-model="selectedNode.properties.spriteId" @change="updateNode">
              <option value="">None</option>
              <option 
                v-for="sprite in availableSprites" 
                :key="sprite.id" 
                :value="sprite.id"
              >
                {{ sprite.name }}
              </option>
            </select>
          </div>
          <div class="property-field">
            <label>Palette</label>
            <select v-model="selectedNode.properties.paletteId" @change="updateNode">
              <option value="">None</option>
              <option 
                v-for="palette in availablePalettes" 
                :key="palette.id" 
                :value="palette.id"
              >
                {{ palette.name }}
              </option>
            </select>
          </div>
          <div class="property-field">
            <label>Priority</label>
            <input 
              v-model.number="selectedNode.properties.priority" 
              type="number"
              min="0"
              max="3"
              @input="updateNode"
            />
          </div>
        </div>
      </div>

      <!-- Tile Properties -->
      <div v-if="selectedNode.type === 'tile'" class="property-section">
        <div class="section-header" @click="toggleSection('tile')">
          <i class="fas" :class="expandedSections.tile ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span>Tile</span>
        </div>
        <div v-if="expandedSections.tile" class="section-content">
          <div class="property-field">
            <label>Tile Index</label>
            <input 
              v-model.number="selectedNode.properties.tileIndex" 
              type="number"
              min="0"
              @input="updateNode"
            />
          </div>
          <div class="property-field">
            <label>Tilemap</label>
            <select v-model="selectedNode.properties.tilemapId" @change="updateNode">
              <option value="">None</option>
              <option 
                v-for="tilemap in availableTilemaps" 
                :key="tilemap.id" 
                :value="tilemap.id"
              >
                {{ tilemap.name }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <!-- Custom Properties -->
      <div class="property-section">
        <div class="section-header" @click="toggleSection('custom')">
          <i class="fas" :class="expandedSections.custom ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span>Custom Properties</span>
        </div>
        <div v-if="expandedSections.custom" class="section-content">
          <div 
            v-for="(value, key) in customProperties" 
            :key="key"
            class="property-field"
          >
            <label>{{ key }}</label>
            <input 
              v-model="selectedNode.properties[key]" 
              type="text"
              @input="updateNode"
            />
          </div>
          <button class="btn-add-property" @click="showAddPropertyDialog = true">
            <i class="fas fa-plus"></i> Add Property
          </button>
        </div>
      </div>
    </div>

    <div v-else class="inspector-empty">
      <p>No node selected</p>
      <p class="hint">Select a node to edit its properties</p>
    </div>

    <!-- Add Property Dialog -->
    <div v-if="showAddPropertyDialog" class="dialog-overlay" @click.self="cancelAddProperty">
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>Add Custom Property</h3>
          <button class="dialog-close" @click="cancelAddProperty">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="dialog-body">
          <label>Property Name:</label>
          <input 
            v-model="newPropertyName" 
            type="text" 
            placeholder="Enter property name"
            @keyup.enter="confirmAddProperty"
            @keyup.esc="cancelAddProperty"
            autofocus
            class="dialog-input"
          />
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="cancelAddProperty">Cancel</button>
          <button class="btn-confirm" @click="confirmAddProperty" :disabled="!newPropertyName.trim()">
            Add
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const expandedSections = ref({
  info: true,
  transform: true,
  sprite: true,
  tile: true,
  custom: false
})

const showAddPropertyDialog = ref(false)
const newPropertyName = ref('')

const selectedNode = computed(() => {
  return store.state.selectedNode
})

const availableSprites = computed(() => {
  return store.state.resources?.sprites || []
})

const availableTilemaps = computed(() => {
  return store.state.resources?.tilemaps || []
})

const availablePalettes = computed(() => {
  return store.state.resources?.palettes || []
})

const customProperties = computed(() => {
  if (!selectedNode.value || !selectedNode.value.properties) {
    return {}
  }
  const custom = {}
  Object.keys(selectedNode.value.properties).forEach(key => {
    if (!isReservedProperty(key)) {
      custom[key] = selectedNode.value.properties[key]
    }
  })
  return custom
})

const toggleSection = (section) => {
  expandedSections.value[section] = !expandedSections.value[section]
}

const updateNode = () => {
  if (selectedNode.value) {
    store.dispatch('updateSceneNode', selectedNode.value)
  }
}

const isReservedProperty = (key) => {
  const reserved = ['spriteId', 'paletteId', 'priority', 'tileIndex', 'tilemapId']
  return reserved.includes(key)
}

const confirmAddProperty = () => {
  const key = newPropertyName.value.trim()
  if (key && selectedNode.value) {
    // Check if property already exists
    if (selectedNode.value.properties && selectedNode.value.properties[key]) {
      store.dispatch('showNotification', {
        type: 'warning',
        title: 'Property Exists',
        message: `Property "${key}" already exists`
      })
      return
    }
    
    if (!selectedNode.value.properties) {
      selectedNode.value.properties = {}
    }
    selectedNode.value.properties[key] = ''
    updateNode()
    
    store.dispatch('showNotification', {
      type: 'success',
      title: 'Property Added',
      message: `Property "${key}" added successfully`
    })
  }
  cancelAddProperty()
}

const cancelAddProperty = () => {
  showAddPropertyDialog.value = false
  newPropertyName.value = ''
}

// Initialize properties if needed
watch(selectedNode, (node) => {
  if (node && !node.properties) {
    node.properties = {}
  }
}, { immediate: true })
</script>

<style scoped>
.inspector-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-left: 1px solid #333;
  width: 300px;
}

.inspector-header {
  padding: 8px 12px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.inspector-header h3 {
  margin: 0;
  font-size: 14px;
  color: #ccc;
  font-weight: 500;
}

.inspector-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.inspector-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #666;
  text-align: center;
}

.inspector-empty p {
  margin: 4px 0;
  font-size: 14px;
}

.hint {
  font-size: 12px;
  color: #444;
}

.property-section {
  margin-bottom: 8px;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #252525;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.section-header:hover {
  background: #2a2a2a;
}

.section-header i {
  font-size: 10px;
  color: #888;
}

.section-header span {
  font-size: 13px;
  font-weight: 500;
  color: #ccc;
}

.section-content {
  padding: 8px;
  background: #1e1e1e;
}

.property-field {
  margin-bottom: 12px;
}

.property-field:last-child {
  margin-bottom: 0;
}

.property-field label {
  display: block;
  font-size: 11px;
  color: #888;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.property-field input,
.property-field select {
  width: 100%;
  background: #252525;
  border: 1px solid #333;
  color: #ccc;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 13px;
  box-sizing: border-box;
}

.property-field input:focus,
.property-field select:focus {
  outline: none;
  border-color: #0066cc;
  background: #2a2a2a;
}

.btn-add-property {
  width: 100%;
  background: #2a2a2a;
  border: 1px dashed #444;
  color: #888;
  padding: 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  margin-top: 8px;
  transition: all 0.2s;
}

.btn-add-property:hover {
  background: #333;
  border-color: #555;
  color: #ccc;
}

/* Dialog Styles */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog-content {
  background: #252525;
  border: 1px solid #333;
  border-radius: 8px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #333;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #ccc;
  font-weight: 500;
}

.dialog-close {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.dialog-close:hover {
  background: #333;
  color: #fff;
}

.dialog-body {
  padding: 20px;
}

.dialog-body label {
  display: block;
  margin-bottom: 8px;
  color: #ccc;
  font-size: 13px;
}

.dialog-input {
  width: 100%;
  background: #1e1e1e;
  border: 1px solid #333;
  color: #ccc;
  padding: 10px 12px;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
}

.dialog-input:focus {
  outline: none;
  border-color: #0066cc;
  background: #2a2a2a;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #333;
}

.btn-cancel {
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #333;
  border-color: #444;
}

.btn-confirm {
  background: #0066cc;
  border: none;
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-confirm:hover:not(:disabled) {
  background: #0088ff;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
