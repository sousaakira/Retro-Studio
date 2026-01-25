<template>
  <div class="emulator-settings">
    <div class="settings-header">
      <h3>Emulator Configuration</h3>
      <button class="refresh-btn" @click="refreshEmulators" :disabled="isLoading" :title="isLoading ? 'Loading...' : 'Scan for emulators'">
        <i :class="isLoading ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'"></i>
      </button>
    </div>
    
    <!-- Auto-detected Emulators -->
    <div v-if="autoDetected.length > 0" class="settings-section">
      <label class="section-label">📁 Auto-Detected Emulators</label>
      <div class="emulator-list auto-detected">
        <div v-for="emulator in autoDetected" :key="emulator.name" class="emulator-card">
          <div class="emulator-status" :class="{ available: emulator.available }">
            <i :class="emulator.available ? 'fas fa-check-circle' : 'fas fa-times-circle'"></i>
          </div>
          <div class="emulator-info">
            <div class="emulator-name-row">
              <span class="emulator-name">{{ emulator.displayName }}</span>
              <span v-if="emulator.available" class="status-badge">Available</span>
              <span v-else class="status-badge error">Not Found</span>
            </div>
            <div class="emulator-path">{{ emulator.path }}</div>
          </div>
          <label class="radio-wrapper">
            <input 
              type="radio" 
              :value="emulator.name" 
              v-model="selectedEmulator"
              @change="saveEmulatorConfig"
              :disabled="!emulator.available"
            />
            <span class="radio-checkmark"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- Manual Configuration -->
    <div class="settings-section">
      <label class="section-label">⚙️ Manual Configuration</label>
      <div class="manual-config">
        <div class="config-input-group">
          <label>Genesis SDL2 Path:</label>
          <div class="input-row">
            <input 
              v-model="customPaths.gen_sdl2" 
              type="text" 
              placeholder="/path/to/gen_sdl2"
              @change="saveCustomPaths"
              class="path-input"
            />
            <button class="browse-btn" @click="() => browsePath('gen_sdl2')" title="Browse...">
              <i class="fas fa-folder-open"></i>
            </button>
          </div>
        </div>
        <div class="config-input-group">
          <label>BlastEm Path:</label>
          <div class="input-row">
            <input 
              v-model="customPaths.blastem" 
              type="text" 
              placeholder="/path/to/blastem"
              @change="saveCustomPaths"
              class="path-input"
            />
            <button class="browse-btn" @click="() => browsePath('blastem')" title="Browse...">
              <i class="fas fa-folder-open"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Current Selection -->
    <div class="settings-info">
      <p class="info-text">
        <strong>Selected Emulator:</strong> {{ formatEmulatorName(selectedEmulator) }}
      </p>
      <p class="info-text small">
        🔍 Emulators are auto-detected from <code>/src/toolkit/emulators/</code>
      </p>
    </div>

    <!-- BlastEm Debug Keys -->
    <div v-if="selectedEmulator === 'blastem'" class="settings-section">
      <label class="section-label">🔧 BlastEm Debug Keys</label>
      <div class="debug-keys-container">
        <p class="debug-info-title">Press these keys during emulation:</p>
        <div class="debug-keys-grid">
          <div class="debug-key-item">
            <span class="key-label">CPU Debugger</span>
            <span class="key-binding">U</span>
          </div>
          <div class="debug-key-item">
            <span class="key-label">Plane Debugger</span>
            <span class="key-binding">B</span>
          </div>
          <div class="debug-key-item">
            <span class="key-label">VRAM Debugger</span>
            <span class="key-binding">V</span>
          </div>
          <div class="debug-key-item">
            <span class="key-label">CRAM Debugger</span>
            <span class="key-binding">C</span>
          </div>
          <div class="debug-key-item">
            <span class="key-label">Layer Debugger</span>
            <span class="key-binding">N</span>
          </div>
          <div class="debug-key-item">
            <span class="key-label">Cycle Mode/PAL</span>
            <span class="key-binding">[</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const isLoading = ref(false)
const autoDetected = ref([])
const customPaths = ref({
  gen_sdl2: '',
  blastem: ''
})

const selectedEmulator = computed({
  get: () => store.state.selectedEmulator,
  set: (val) => store.commit('setSelectedEmulator', val)
})

const formatEmulatorName = (name) => {
  const names = {
    'gen_sdl2': 'Genesis SDL2 (Default)',
    'blastem': 'BlastEm'
  }
  return names[name] || name
}

const refreshEmulators = () => {
  isLoading.value = true
  window.ipc?.send('get-available-emulators')
}

const saveEmulatorConfig = () => {
  window.ipc?.send('set-emulator-config', JSON.parse(JSON.stringify({ selectedEmulator: selectedEmulator.value })))
  
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Emulator Selected',
    message: `Using: ${formatEmulatorName(selectedEmulator.value)}`
  })
}

const saveCustomPaths = () => {
  window.ipc?.send('set-custom-emulator-paths', JSON.parse(JSON.stringify(customPaths.value)))
  
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Paths Updated',
    message: 'Custom emulator paths saved'
  })
  
  // Rescannear após salvar
  setTimeout(() => refreshEmulators(), 500)
}

const browsePath = (emulatorName) => {
  window.ipc?.send('browse-emulator-path', { emulator: emulatorName })
}

onMounted(() => {
  // Listen for available emulators response
  window.ipc?.on?.('available-emulators', (data) => {
    isLoading.value = false
    if (data.success) {
      // Formatar dados dos emuladores
      autoDetected.value = (data.emulators || []).map(name => ({
        name,
        displayName: formatEmulatorName(name),
        path: data.paths?.[name] || 'Path not found',
        available: !!data.paths?.[name]
      }))
    } else {
      autoDetected.value = []
    }
  })

  // Listen for custom paths response
  window.ipc?.on?.('custom-emulator-paths', (data) => {
    if (data.success) {
      customPaths.value = data.paths || {}
    }
  })

  // Listen for browse path result
  window.ipc?.on?.('emulator-path-selected', (data) => {
    if (data.path && data.emulator) {
      customPaths.value[data.emulator] = data.path
      saveCustomPaths()
    }
  })

  // Listen for emulator config response
  window.ipc?.on?.('emulator-config', (data) => {
    if (data.success && data.config) {
      // Já atualizado via Vuex
    }
  })

  // Initial load
  refreshEmulators()
  window.ipc?.send('get-custom-emulator-paths')
  window.ipc?.send('get-emulator-config')
})
</script>

<style scoped>
.emulator-settings {
  padding: 20px;
  color: #ccc;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.settings-header h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
}

.refresh-btn {
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.refresh-btn:hover:not(:disabled) {
  background: #333;
  color: #fff;
  border-color: #555;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-section {
  margin-bottom: 24px;
}

.section-label {
  display: block;
  margin-bottom: 12px;
  color: #aaa;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Auto-Detected Emulators */
.emulator-list {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}

.emulator-list.auto-detected {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

.emulator-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  transition: all 0.2s;
}

.emulator-card:hover {
  background: #2a2a2a;
  border-color: #444;
}

.emulator-status {
  font-size: 18px;
  color: #888;
  flex-shrink: 0;
}

.emulator-status.available {
  color: #4ade80;
}

.emulator-info {
  flex: 1;
  min-width: 0;
}

.emulator-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.emulator-name {
  font-weight: 500;
  color: #fff;
  font-size: 13px;
}

.status-badge {
  font-size: 11px;
  padding: 2px 6px;
  background: #333;
  color: #aaa;
  border-radius: 2px;
  text-transform: uppercase;
  font-weight: 600;
}

.status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.emulator-path {
  font-size: 11px;
  color: #888;
  word-break: break-all;
  font-family: 'Courier New', monospace;
}

.radio-wrapper {
  display: flex;
  align-items: center;
  position: relative;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.radio-wrapper input[type="radio"] {
  appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid #555;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
}

.radio-wrapper input[type="radio"]:hover:not(:disabled) {
  border-color: #888;
}

.radio-wrapper input[type="radio"]:checked {
  border-color: #3b82f6;
  background: #3b82f6;
  box-shadow: inset 0 0 0 3px #1e1e1e;
}

.radio-wrapper input[type="radio"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Manual Configuration */
.manual-config {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-input-group > label {
  color: #aaa;
  font-size: 12px;
  font-weight: 500;
}

.input-row {
  display: flex;
  gap: 6px;
}

.path-input {
  flex: 1;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  transition: all 0.2s;
}

.path-input:focus {
  outline: none;
  border-color: #3b82f6;
  background: #333;
}

.browse-btn {
  background: #333;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.browse-btn:hover {
  background: #3b3b3b;
  color: #fff;
  border-color: #555;
}

/* Info Section */
.settings-info {
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
  margin-top: 16px;
}

.info-text {
  margin: 0;
  font-size: 13px;
  color: #ccc;
  line-height: 1.6;
}

.info-text code {
  background: #1e1e1e;
  padding: 2px 4px;
  border-radius: 2px;
  font-family: 'Courier New', monospace;
  color: #4ade80;
}

.info-text.small {
  font-size: 12px;
  color: #888;
  margin-top: 8px;
}

/* Debug Keys Section */
.debug-keys-container {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
}

.debug-info-title {
  margin: 0;
  font-size: 13px;
  color: #aaa;
  margin-bottom: 12px;
}

.debug-keys-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}

.debug-key-item {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.key-label {
  font-size: 12px;
  color: #aaa;
  text-align: center;
}

.key-binding {
  font-size: 18px;
  color: #fff;
  font-family: 'Courier New', monospace;
  padding: 4px 8px;
  background: #333;
  border: 1px solid #444;
  border-radius: 4px;
}
</style>
