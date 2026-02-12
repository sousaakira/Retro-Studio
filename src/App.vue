<template>
  <div id="app">
    <MainLayout />

    <!-- Notifications -->
    <NotificationToast />
    
    <!-- Modals -->
    <NewProjectModal ref="newProjectModal" />

    <Modal ref="settingsModal" title="Configurações" w="820px" h="640px" icon="fas fa-sliders-h">
      <div class="settings-panel">
        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-code"></i>
            <h4>Editor</h4>
          </div>
          <div class="setting-item">
            <label>Font Size</label>
            <input type="number" min="10" max="24" value="16" class="input" />
          </div>
          <div class="setting-item">
            <label>Theme</label>
            <select class="input">
              <option>Dark</option>
              <option>Light</option>
            </select>
          </div>
          <div class="setting-item">
            <label>Word Wrap</label>
            <select v-model="editorWordWrap" class="input">
              <option value="off">Desativado</option>
              <option value="on">Ativado</option>
              <option value="wordWrapColumn">Por coluna</option>
              <option value="bounded">Limitado</option>
            </select>
          </div>
        </div>

        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-eye"></i>
            <h4>Modo de Desenvolvimento</h4>
          </div>
          <div class="setting-item setting-row">
            <label class="checkbox-label">
              <input type="checkbox" v-model="enableVisualMode" class="input-checkbox" />
              <span>Habilitar Modo Visual</span>
            </label>
            <div class="setting-hint">
              Habilita o editor visual estilo Godot para desenvolvimento de cenas (experimental)
            </div>
          </div>
        </div>

        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-download"></i>
            <h4>Ferramentas (MarsDev / SGDK / Emuladores)</h4>
          </div>
          <ToolkitDownloads />
        </div>

        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-hammer"></i>
            <h4>Build</h4>
          </div>
          <div class="setting-item">
            <label>Marsdev Toolkit Path</label>
            <div class="path-input-group">
              <input
                type="text"
                placeholder="Ex: ~/.retrostudio/toolkit/marsdev/mars"
                v-model="toolkitPath"
                class="input path-input"
              />
              <button type="button" class="btn-icon" @click="browseToolkitPath" title="Procurar...">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
            <p class="setting-hint">Preenchido automaticamente após baixar MarsDev acima.</p>
          </div>
        </div>

        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-external-link-alt"></i>
            <h4>Ferramentas Externas</h4>
          </div>
          <div class="setting-item">
            <label>Editor de Imagens</label>
            <div class="path-input-group">
              <input
                type="text"
                placeholder="Aseprite, GIMP, etc."
                v-model="imageEditorPath"
                class="input path-input"
              />
              <button type="button" class="btn-icon" @click="browseImageEditorPath" title="Procurar...">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
          </div>
          <div class="setting-item">
            <label>Editor de Mapas</label>
            <div class="path-input-group">
              <input
                type="text"
                placeholder="Tiled, etc."
                v-model="mapEditorPath"
                class="input path-input"
              />
              <button type="button" class="btn-icon" @click="browseMapEditorPath" title="Procurar...">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section card">
          <EmulatorSettings />
        </div>

        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-microchip"></i>
            <h4>Cart Programmer</h4>
          </div>
          <div class="setting-item">
            <label>USB Vendor ID</label>
            <input type="text" placeholder="0x2e8a" v-model="cartridgeVendorId" class="input" />
          </div>
          <div class="setting-item">
            <label>Baud Rate</label>
            <select v-model="cartridgeBaudRate" class="input">
              <option value="9600">9600</option>
              <option value="19200">19200</option>
              <option value="38400">38400</option>
              <option value="57600">57600</option>
              <option value="115200">115200 (recomendado)</option>
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
              class="input"
            />
          </div>
          <div class="setting-item setting-row">
            <label class="checkbox-label">
              <input type="checkbox" v-model="cartridgeSwapEndianness" class="input-checkbox" />
              <span>Swap 16-bit Endianness</span>
            </label>
          </div>
        </div>

        <div class="settings-section card">
          <div class="section-header">
            <i class="section-icon fas fa-window-maximize"></i>
            <h4>Janela</h4>
          </div>
          <div class="setting-item">
            <label>Botões de controle</label>
            <div class="settings-radio-group">
              <label class="radio-option">
                <input type="radio" value="right" v-model="windowControlsPosition" class="input-radio" />
                <span>Direita (padrão)</span>
              </label>
              <label class="radio-option">
                <input type="radio" value="left" v-model="windowControlsPosition" class="input-radio" />
                <span>Esquerda (macOS)</span>
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
import ToolkitDownloads from './components/ToolkitDownloads.vue'

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

const enableVisualMode = computed({
  get: () => store.state.uiSettings.enableVisualMode || false,
  set: (value) => {
    store.dispatch('setEnableVisualMode', value)
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

/* --- Settings panel (modern) --- */
.settings-panel {
  --set-bg: #161b22;
  --set-border: #30363d;
  --set-accent: #58a6ff;
  --set-text: #e6edf3;
  --set-muted: #8b949e;
  --set-input-bg: #0d1117;
  --set-radius: 10px;
  padding: 20px 24px 28px;
  color: var(--set-text);
  font-size: 13px;
}

.settings-panel .settings-section.card {
  margin-bottom: 20px;
  padding: 18px 20px;
  background: var(--set-bg);
  border: 1px solid var(--set-border);
  border-radius: var(--set-radius);
}

.settings-panel .settings-section.card:last-child {
  margin-bottom: 0;
}

.settings-panel .section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.settings-panel .section-icon {
  width: 20px;
  color: var(--set-accent);
  font-size: 14px;
}

.settings-panel .section-header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--set-text);
  letter-spacing: 0.02em;
}

.settings-panel .setting-item {
  margin-bottom: 14px;
}

.settings-panel .setting-item:last-child {
  margin-bottom: 0;
}

.settings-panel .setting-item > label {
  display: block;
  margin-bottom: 6px;
  color: var(--set-muted);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.settings-panel .input,
.settings-panel .path-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  background: var(--set-input-bg);
  border: 1px solid var(--set-border);
  border-radius: 6px;
  color: var(--set-text);
  font-size: 13px;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.settings-panel .input:focus,
.settings-panel .path-input:focus {
  outline: none;
  border-color: var(--set-accent);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
}

.settings-panel .path-input-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.settings-panel .path-input-group .path-input {
  flex: 1;
  min-width: 0;
}

.settings-panel .btn-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--set-input-bg);
  border: 1px solid var(--set-border);
  border-radius: 6px;
  color: var(--set-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.settings-panel .btn-icon:hover {
  color: var(--set-accent);
  border-color: var(--set-accent);
  background: rgba(88, 166, 255, 0.08);
}

.settings-panel .setting-hint {
  font-size: 11px;
  color: var(--set-muted);
  margin: 6px 0 0 0;
}

.settings-panel .setting-row {
  margin-top: 12px;
}

.settings-panel .checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  color: var(--set-text);
  font-size: 13px;
  text-transform: none;
  letter-spacing: 0;
}

.settings-panel .input-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--set-accent);
  cursor: pointer;
}

.settings-panel .settings-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.settings-panel .radio-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--set-text);
  font-size: 13px;
}

.settings-panel .input-radio {
  width: 16px;
  height: 16px;
  accent-color: var(--set-accent);
  cursor: pointer;
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