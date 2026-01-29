<template>
  <div id="app">
    <MainLayout />

    <!-- Notifications -->
    <NotificationToast />
    
    <!-- Modals -->
    <NewProjectModal ref="newProjectModal" />

    <Modal ref="settingsModal" title="Settings" w="800px" h="600px" icon="fas fa-cog">
      <div class="settings-content">
        <h3>Application Settings</h3>
        <div class="settings-section">
          <h4>Editor</h4>
          <div class="setting-item">
            <label>Font Size</label>
            <input type="number" min="10" max="24" value="16" />
          </div>
          <div class="setting-item">
            <label>Theme</label>
            <select>
              <option>Dark</option>
              <option>Light</option>
            </select>
          </div>
          <div class="setting-item">
            <label>Word Wrap</label>
            <select v-model="editorWordWrap">
              <option value="off">Desativado</option>
              <option value="on">Ativado</option>
              <option value="wordWrapColumn">Por coluna</option>
              <option value="bounded">Limitado</option>
            </select>
          </div>
        </div>
        <div class="settings-section">
          <h4>Build</h4>
          <div class="setting-item">
            <label>Marsdev Toolkit Path</label>
            <div class="path-input-group">
              <input 
                type="text" 
                placeholder="Ex: /home/user/marsdev/mars" 
                v-model="toolkitPath"
                class="path-input"
              />
              <button class="btn-browse-small" @click="browseToolkitPath" title="Browse...">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h4>Ferramentas Externas</h4>
          <div class="setting-item">
            <label>Editor de Imagens (Aseprite, GIMP, etc.)</label>
            <div class="path-input-group">
              <input 
                type="text" 
                placeholder="Caminho do executável..." 
                v-model="imageEditorPath"
                class="path-input"
              />
              <button class="btn-browse-small" @click="browseImageEditorPath" title="Browse...">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
          </div>
          <div class="setting-item">
            <label>Editor de Mapas (Tiled, etc.)</label>
            <div class="path-input-group">
              <input 
                type="text" 
                placeholder="Caminho do executável..." 
                v-model="mapEditorPath"
                class="path-input"
              />
              <button class="btn-browse-small" @click="browseMapEditorPath" title="Browse...">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <EmulatorSettings />
        </div>
        <div class="settings-section">
          <h4>Cart Programmer</h4>
          <div class="setting-item">
            <label>USB Vendor ID</label>
            <input 
              type="text" 
              placeholder="0x2e8a" 
              v-model="cartridgeVendorId"
              class="path-input"
            />
          </div>
          <div class="setting-item">
            <label>Baud Rate</label>
            <select v-model="cartridgeBaudRate" class="path-input">
              <option value="9600">9600</option>
              <option value="19200">19200</option>
              <option value="38400">38400</option>
              <option value="57600">57600</option>
              <option value="115200">115200 (recommended)</option>
              <option value="230400">230400</option>
              <option value="460800">460800</option>
              <option value="921600">921600</option>
            </select>
          </div>
          <div class="setting-item">
            <label>Chunk Size (bytes)</label>
            <input 
              type="number" 
              min="64" 
              max="8192" 
              step="64"
              v-model="cartridgeChunkSize"
              class="path-input"
            />
          </div>
          <div class="setting-item">
            <label>
              <input 
                type="checkbox" 
                v-model="cartridgeSwapEndianness"
              />
              Swap 16-bit Endianness
            </label>
          </div>
        </div>
        <div class="settings-section">
          <h4>Window Controls</h4>
          <div class="setting-item">
            <label>Position</label>
            <div class="settings-radio-group">
              <label class="settings-radio-option">
                <input
                  type="radio"
                  value="right"
                  v-model="windowControlsPosition"
                />
                Direita (padrão)
              </label>
              <label class="settings-radio-option">
                <input
                  type="radio"
                  value="left"
                  v-model="windowControlsPosition"
                />
                Esquerda (macOS)
              </label>
            </div>
          </div>
        </div>
      </div>
  </Modal>

    <Modal ref="imageModal" title="Image Preview" w="800px" h="600px" icon="fas fa-image">
      <div class="image-content" v-if="imageData">
        <img :src="'custom://' + imageData.node.path" alt="Preview" />
      </div>
  </Modal>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useStore } from 'vuex'
import MainLayout from './components/MainLayout.vue'
import Modal from './components/ModalPage.vue'
import NewProjectModal from './components/NewProjectModal.vue'
import NotificationToast from './components/NotificationToast.vue'
import EmulatorSettings from './components/EmulatorSettings.vue'

const store = useStore()

const newProjectModal = ref(null)
const settingsModal = ref(null)
const imageModal = ref(null)
const imageData = ref(null)

const windowControlsPosition = computed({
  get: () => store.state.uiSettings.windowControlsPosition || 'right',
  set: (value) => {
    store.dispatch('setWindowControlsPosition', value)
  }
})

const editorWordWrap = computed({
  get: () => store.state.uiSettings.editorWordWrap || 'off',
  set: (value) => {
    store.dispatch('setEditorWordWrap', value)
  }
})

const toolkitPath = computed({
  get: () => store.state.uiSettings.toolkitPath || '',
  set: (value) => {
    store.dispatch('setToolkitPath', value)
  }
})

const imageEditorPath = computed({
  get: () => store.state.uiSettings.imageEditorPath || '',
  set: (value) => {
    store.dispatch('setImageEditorPath', value)
  }
})

const mapEditorPath = computed({
  get: () => store.state.uiSettings.mapEditorPath || '',
  set: (value) => {
    store.dispatch('setMapEditorPath', value)
  }
})

const cartridgeVendorId = computed({
  get: () => store.state.uiSettings.cartridgeVendorId || '0x2e8a',
  set: (value) => {
    store.dispatch('setCartridgeVendorId', value)
  }
})

const cartridgeBaudRate = computed({
  get: () => store.state.uiSettings.cartridgeBaudRate || '115200',
  set: (value) => {
    store.dispatch('setCartridgeBaudRate', value)
  }
})

const cartridgeChunkSize = computed({
  get: () => store.state.uiSettings.cartridgeChunkSize || 1024,
  set: (value) => {
    store.dispatch('setCartridgeChunkSize', value)
  }
})

const cartridgeSwapEndianness = computed({
  get: () => store.state.uiSettings.cartridgeSwapEndianness !== false,
  set: (value) => {
    store.dispatch('setCartridgeSwapEndianness', value)
  }
})

const browseToolkitPath = () => {
  window.ipc?.send('select-folder', {})
  window.ipc?.once('folder-selected', (result) => {
    if (result && result.path) {
      toolkitPath.value = result.path
    }
  })
}

const browseImageEditorPath = () => {
  window.ipc?.send('select-file', { title: 'Selecionar Editor de Imagens' })
  window.ipc?.once('file-selected', (result) => {
    if (result && result.path) {
      imageEditorPath.value = result.path
    }
  })
}

const browseMapEditorPath = () => {
  window.ipc?.send('select-file', { title: 'Selecionar Editor de Mapas' })
  window.ipc?.once('file-selected', (result) => {
    if (result && result.path) {
      mapEditorPath.value = result.path
    }
  })
}

// Watch for store actions to open modals
watch(() => store.state.modalActions, (actions) => {
  if (actions?.newProject) {
    newProjectModal.value?.open()
    store.dispatch('clearModalAction', 'newProject')
  }
  if (actions?.openSettings) {
    settingsModal.value?.openModal()
    store.dispatch('clearModalAction', 'openSettings')
  }
}, { deep: true })

// Watch for image requests
watch(() => store.state.imageRequest, (newData) => {
  if (newData) {
    imageData.value = newData
    imageModal.value?.openModal()
  }
})

onMounted(() => {
  // Initialize any required setup
  store.dispatch('initSettings')
})
</script>

<style>
  #app {
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  overflow: hidden;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.settings-content {
  padding: 20px;
  color: #ccc;
}

.settings-content h3 {
  margin: 0 0 20px 0;
  color: #ccc;
  font-size: 18px;
}

.settings-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid #333;
}

.path-input-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.path-input {
  flex: 1;
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.btn-browse-small {
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-browse-small:hover {
  background: #1b2334;
  border-color: #304159;
  color: #fff;
}


.settings-section h4 {
  margin: 0 0 12px 0;
  color: #0066cc;
  font-size: 14px;
  font-weight: 500;
}

.setting-item {
  margin-bottom: 16px;
}

.setting-item label {
  display: block;
  margin-bottom: 6px;
  color: #aaa;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-item input,
.setting-item select {
  width: 100%;
  background: #252525;
  border: 1px solid #333;
  color: #ccc;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
}

.setting-item input:focus,
.setting-item select:focus {
  outline: none;
  border-color: #0066cc;
  background: #2a2a2a;
}

.image-content {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  height: 100%;
}

.image-content img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  }
</style>