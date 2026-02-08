<template>
  <div class="emulator-settings">
    <div class="section-header">
      <i class="section-icon fas fa-gamepad"></i>
      <h4>Emuladores</h4>
      <button type="button" class="refresh-btn" @click="refreshEmulators" :disabled="isLoading" :title="isLoading ? 'Carregando...' : 'Detectar emuladores'">
        <i :class="isLoading ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'"></i>
      </button>
    </div>

    <!-- Auto-detected Emulators -->
    <div v-if="autoDetected.length > 0" class="sub-section">
      <span class="sub-label">Auto-detectados</span>
      <div class="emulator-list auto-detected">
        <div v-for="emulator in autoDetected" :key="emulator.id" class="emulator-card">
          <div class="emulator-status" :class="{ available: emulator.available }">
            <i :class="emulator.available ? 'fas fa-check-circle' : 'fas fa-times-circle'"></i>
          </div>
          <div class="emulator-info">
            <div class="emulator-name-row">
              <span class="emulator-name">{{ emulator.displayName }}</span>
              <span v-if="emulator.available" class="status-badge">Disponível</span>
              <span v-else class="status-badge error">Não encontrado</span>
            </div>
            <div class="emulator-path">{{ emulator.path || '—' }}</div>
          </div>
          <label class="radio-wrapper">
            <input
              type="radio"
              :value="emulator.id"
              v-model="selectedEmulator"
              @change="saveEmulatorConfig"
              :disabled="!emulator.available"
            />
          </label>
        </div>
      </div>
    </div>

    <!-- Manual Configuration -->
    <div class="sub-section">
      <span class="sub-label">Caminhos manuais</span>
      <div class="manual-config">
        <div v-for="emulator in autoDetected" :key="'manual-' + emulator.id" class="config-input-group">
          <label>{{ emulator.displayName }} Path:</label>
          <div class="input-row">
            <input 
              v-model="customPaths[emulator.id]" 
              type="text" 
              :placeholder="'Path to ' + emulator.displayName"
              @change="saveCustomPaths"
              class="path-input"
            />
            <button class="browse-btn" @click="() => browsePath(emulator.id)" title="Browse...">
              <i class="fas fa-folder-open"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Current Selection -->
    <div class="settings-info">
      <p class="info-text"><strong>Emulador selecionado:</strong> {{ selectedEmulatorDisplayName }}</p>
      <p class="info-text small">Detectados em <code>~/.retrostudio/emulators/</code>, pacotes baixados ou MarsDev <code>dgen</code>.</p>
    </div>

    <!-- BlastEm Debug Keys -->
    <div v-if="selectedEmulator === 'blastem'" class="sub-section">
      <span class="sub-label">BlastEm — teclas de debug</span>
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
const customPaths = ref({})

const selectedEmulator = computed({
  get: () => store.state.selectedEmulator,
  set: (val) => store.commit('setSelectedEmulator', val)
})

const selectedEmulatorDisplayName = computed(() => {
  const emu = autoDetected.value.find((e) => e.id === selectedEmulator.value)
  return emu ? emu.displayName : selectedEmulator.value
})

const refreshEmulators = () => {
  isLoading.value = true
  window.ipc?.send('get-available-emulators')
}

const saveEmulatorConfig = () => {
  window.ipc?.send('set-emulator-config', JSON.parse(JSON.stringify({ selectedEmulator: selectedEmulator.value })))
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Emulator Selected',
    message: `Using: ${selectedEmulatorDisplayName.value}`
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
    if (data.success && Array.isArray(data.list) && data.list.length > 0) {
      autoDetected.value = data.list
    } else if (data.success && (data.emulators || []).length > 0) {
      autoDetected.value = (data.emulators || []).map((id) => ({
        id,
        displayName: id,
        path: data.paths?.[id] || '',
        available: !!data.paths?.[id]
      }))
    } else {
      autoDetected.value = data.list || []
    }
  })

  // Listen for custom paths response
  window.ipc?.on?.('custom-emulator-paths', (data) => {
    if (data.success && data.paths) {
      customPaths.value = { ...data.paths }
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
  --emu-bg: #0d1117;
  --emu-border: #30363d;
  --emu-accent: #58a6ff;
  --emu-text: #e6edf3;
  --emu-muted: #8b949e;
  --emu-success: #3fb950;
  --emu-error: #f85149;
  color: var(--emu-text);
  font-size: 13px;
}

.emulator-settings .section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.emulator-settings .section-icon {
  width: 20px;
  color: var(--emu-accent);
  font-size: 14px;
}

.emulator-settings .section-header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--emu-text);
  flex: 1;
}

.emulator-settings .refresh-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--emu-bg);
  border: 1px solid var(--emu-border);
  border-radius: 6px;
  color: var(--emu-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.emulator-settings .refresh-btn:hover:not(:disabled) {
  color: var(--emu-accent);
  border-color: var(--emu-accent);
  background: rgba(88, 166, 255, 0.08);
}

.emulator-settings .refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.emulator-settings .sub-section {
  margin-bottom: 16px;
}

.emulator-settings .sub-section:last-child {
  margin-bottom: 0;
}

.emulator-settings .sub-label {
  display: block;
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--emu-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.emulator-list.auto-detected {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.emulator-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--emu-bg);
  border: 1px solid var(--emu-border);
  border-radius: 8px;
  transition: border-color 0.15s, background 0.15s;
}

.emulator-card:hover {
  background: #161b22;
  border-color: #21262d;
}

.emulator-status {
  font-size: 16px;
  color: var(--emu-muted);
  flex-shrink: 0;
}

.emulator-status.available {
  color: var(--emu-success);
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
  color: var(--emu-text);
  font-size: 13px;
}

.status-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(110, 118, 129, 0.2);
  color: var(--emu-muted);
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 600;
}

.status-badge.error {
  background: rgba(248, 81, 73, 0.15);
  color: var(--emu-error);
}

.emulator-path {
  font-size: 11px;
  color: var(--emu-muted);
  word-break: break-all;
  font-family: ui-monospace, monospace;
}

.radio-wrapper {
  display: flex;
  align-items: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
}

.radio-wrapper input[type="radio"] {
  width: 18px;
  height: 18px;
  accent-color: var(--emu-accent);
  cursor: pointer;
}

.radio-wrapper input[type="radio"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.manual-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-input-group > label {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--emu-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.input-row {
  display: flex;
  gap: 8px;
}

.emulator-settings .path-input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  background: var(--emu-bg);
  border: 1px solid var(--emu-border);
  border-radius: 6px;
  color: var(--emu-text);
  font-size: 12px;
  font-family: ui-monospace, monospace;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.emulator-settings .path-input:focus {
  outline: none;
  border-color: var(--emu-accent);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
}

.emulator-settings .browse-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--emu-bg);
  border: 1px solid var(--emu-border);
  border-radius: 6px;
  color: var(--emu-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.emulator-settings .browse-btn:hover {
  color: var(--emu-accent);
  border-color: var(--emu-accent);
  background: rgba(88, 166, 255, 0.08);
}

.settings-info {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--emu-bg);
  border: 1px solid var(--emu-border);
  border-radius: 8px;
}

.info-text {
  margin: 0;
  font-size: 13px;
  color: var(--emu-text);
  line-height: 1.5;
}

.info-text code {
  background: rgba(110, 118, 129, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--emu-success);
}

.info-text.small {
  font-size: 12px;
  color: var(--emu-muted);
  margin-top: 8px;
}

.debug-keys-container {
  padding: 12px 0 0;
}

.debug-info-title {
  margin: 0 0 10px 0;
  font-size: 12px;
  color: var(--emu-muted);
}

.debug-keys-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.debug-key-item {
  background: var(--emu-bg);
  border: 1px solid var(--emu-border);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.key-label {
  font-size: 11px;
  color: var(--emu-muted);
  text-align: center;
}

.key-binding {
  font-size: 14px;
  font-weight: 600;
  color: var(--emu-text);
  font-family: ui-monospace, monospace;
  padding: 4px 10px;
  background: rgba(110, 118, 129, 0.2);
  border-radius: 4px;
}
</style>
