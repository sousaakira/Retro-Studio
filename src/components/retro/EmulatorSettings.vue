<template>
  <div class="emulator-settings">
    <div class="section-header">
      <span class="section-icon">🎮</span>
      <h4>Emuladores</h4>
      <button type="button" class="refresh-btn" @click="refreshEmulators" :disabled="isLoading" title="Detectar emuladores">
        <span :class="isLoading ? 'icon-spin' : ''">{{ isLoading ? '⟳' : '↻' }}</span>
      </button>
    </div>

    <div v-if="autoDetected.length > 0" class="sub-section">
      <span class="sub-label">Auto-detectados</span>
      <div class="emulator-list">
        <div v-for="emulator in autoDetected" :key="emulator.id" class="emulator-card">
          <div class="emulator-status" :class="{ available: emulator.available }">
            {{ emulator.available ? '✓' : '✗' }}
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
            <button class="browse-btn" @click="browsePath(emulator.id)" title="Procurar...">📂</button>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-info">
      <p class="info-text"><strong>Emulador selecionado:</strong> {{ selectedEmulatorDisplayName }}</p>
      <p class="info-text small">Detectados em <code>~/.retrostudio/emulators/</code>, pacotes baixados ou MarsDev <code>dgen</code>.</p>
    </div>

    <div v-if="selectedEmulator === 'blastem'" class="sub-section">
      <span class="sub-label">BlastEm — teclas de debug</span>
      <div class="debug-keys-container">
        <p class="debug-info-title">Teclas durante emulação:</p>
        <div class="debug-keys-grid">
          <div class="debug-key-item"><span class="key-label">CPU Debugger</span><span class="key-binding">U</span></div>
          <div class="debug-key-item"><span class="key-label">Plane Debugger</span><span class="key-binding">B</span></div>
          <div class="debug-key-item"><span class="key-label">VRAM Debugger</span><span class="key-binding">V</span></div>
          <div class="debug-key-item"><span class="key-label">CRAM Debugger</span><span class="key-binding">C</span></div>
          <div class="debug-key-item"><span class="key-label">Layer Debugger</span><span class="key-binding">N</span></div>
          <div class="debug-key-item"><span class="key-label">Cycle Mode/PAL</span><span class="key-binding">[</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'

const isLoading = ref(false)
const autoDetected = ref([])
const customPaths = ref({})
const selectedEmulator = ref('gen_sdl2')

const selectedEmulatorDisplayName = computed(() => {
  const emu = autoDetected.value.find((e) => e.id === selectedEmulator.value)
  return emu ? emu.displayName : selectedEmulator.value
})

const refreshEmulators = async () => {
  isLoading.value = true
  try {
    const res = await window.retroStudio?.retro?.getAvailableEmulators?.()
    if (res?.success && res?.list?.length > 0) {
      autoDetected.value = res.list
    } else if (res?.success && res?.emulators?.length > 0) {
      autoDetected.value = (res.emulators || []).map((id) => ({
        id,
        displayName: id,
        path: res.paths?.[id] || '',
        available: !!res.paths?.[id]
      }))
    } else {
      autoDetected.value = res?.list || []
    }
  } finally {
    isLoading.value = false
  }
}

const saveEmulatorConfig = async () => {
  await window.retroStudio?.retro?.setEmulatorConfig?.({ selectedEmulator: selectedEmulator.value })
}

const saveCustomPaths = async () => {
  await window.retroStudio?.retro?.setCustomEmulatorPaths?.(JSON.parse(JSON.stringify(customPaths.value)))
  setTimeout(() => refreshEmulators(), 500)
}

const browsePath = async (emulatorName) => {
  const res = await window.retroStudio?.retro?.browseEmulatorPath?.(emulatorName)
  if (res?.path && res?.emulator) {
    customPaths.value[res.emulator] = res.path
    await saveCustomPaths()
  }
}

onMounted(async () => {
  const pathsRes = await window.retroStudio?.retro?.getCustomEmulatorPaths?.()
  if (pathsRes?.success && pathsRes?.paths) {
    customPaths.value = { ...pathsRes.paths }
  }
  const configRes = await window.retroStudio?.retro?.getEmulatorConfig?.()
  if (configRes?.success && configRes?.config?.selectedEmulator) {
    selectedEmulator.value = configRes.config.selectedEmulator
  }
  await refreshEmulators()
})
</script>

<style scoped>
.emulator-settings {
  font-size: 13px;
}

.emulator-settings .section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.emulator-settings .section-icon {
  font-size: 14px;
}

.emulator-settings .section-header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}

.emulator-settings .refresh-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
}

.emulator-settings .refresh-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}

.emulator-settings .refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.emulator-settings .sub-section {
  margin-bottom: 16px;
}

.emulator-settings .sub-label {
  display: block;
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.emulator-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.emulator-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.emulator-status {
  font-size: 14px;
  color: var(--muted);
  flex-shrink: 0;
}

.emulator-status.available {
  color: #3fb950;
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
  font-size: 13px;
}

.status-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(110, 118, 129, 0.2);
  color: var(--muted);
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 600;
}

.status-badge.error {
  background: rgba(248, 81, 73, 0.15);
  color: #f85149;
}

.emulator-path {
  font-size: 11px;
  color: var(--muted);
  word-break: break-all;
  font-family: ui-monospace, monospace;
}

.radio-wrapper input[type="radio"] {
  accent-color: var(--accent);
  cursor: pointer;
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
  color: var(--muted);
}

.input-row {
  display: flex;
  gap: 8px;
}

.emulator-settings .path-input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.emulator-settings .browse-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.emulator-settings .browse-btn:hover {
  border-color: var(--accent);
}

.settings-info {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.info-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.info-text code {
  background: rgba(110, 118, 129, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.info-text.small {
  font-size: 12px;
  color: var(--muted);
  margin-top: 8px;
}

.debug-keys-container {
  padding: 12px 0 0;
}

.debug-info-title {
  margin: 0 0 10px 0;
  font-size: 12px;
  color: var(--muted);
}

.debug-keys-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.debug-key-item {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.key-label {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
}

.key-binding {
  font-size: 14px;
  font-weight: 600;
  font-family: ui-monospace, monospace;
  padding: 4px 10px;
  background: rgba(110, 118, 129, 0.2);
  border-radius: 4px;
}
</style>
