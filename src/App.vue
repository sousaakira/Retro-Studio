<template>
  <div id="app">
    <MainLayout />

    <!-- Notifications -->
    <NotificationToast />
    
    <!-- Modals -->
    <Modal ref="projectModal" title="Project Manager" w="1024px" h="600px" icon="fas fa-folder-open">
      <ProjectSetings />
    </Modal>

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
            <input 
              type="text" 
              placeholder="Ex: /home/user/marsdev/mars" 
              v-model="toolkitPath"
            />
          </div>
        </div>
        <div class="settings-section">
          <EmulatorSettings />
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
import ProjectSetings from './components/ProjectSetings.vue'
import NotificationToast from './components/NotificationToast.vue'
import EmulatorSettings from './components/EmulatorSettings.vue'

const store = useStore()

const projectModal = ref(null)
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

// Watch for store actions to open modals
watch(() => store.state.modalActions, (actions) => {
  if (actions?.openProject) {
    projectModal.value?.openModal()
    store.dispatch('clearModalAction', 'openProject')
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

.settings-section:last-child {
  border-bottom: none;
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