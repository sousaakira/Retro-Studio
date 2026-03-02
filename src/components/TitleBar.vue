<template>
  <div class="titlebar" @dblclick="$emit('toggle-maximize')">
    <div class="titlebarLeft">
      <div v-if="windowControlsPosition === 'left'" class="windowControls">
        <button class="tbBtn close" title="Close" @click="$emit('close')">
          <span class="icon-xmark"></span>
        </button>
        <button class="tbBtn" title="Minimize" @click="$emit('minimize')">
          <span class="icon-window-minimize"></span>
        </button>
        <button class="tbBtn" :title="isMaximized ? 'Restore' : 'Maximize'" @click="$emit('toggle-maximize')">
          <span v-if="!isMaximized" class="icon-window-maximize"></span>
          <span v-else class="icon-window-restore"></span>
        </button>
      </div>

      <div class="app-title">
        <div class="retro-studio-logo" title="Retro Studio">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="6" width="16" height="12" rx="1" />
            <rect x="6" y="8" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </div>
        Retro Studio
      </div>

      <div class="toolbar-section">
        <button class="tbBtn" title="Novo Projeto Retro" @click="$emit('menu-action', 'newRetroProject')">
          <span class="icon-plus"></span>
        </button>
        <button class="tbBtn" title="Abrir Pasta (Ctrl+O)" @click="$emit('menu-action', 'openFolder')">
          <span class="icon-folder-open"></span>
        </button>
        <button
          class="tbBtn"
          :class="{ active: showAIChat }"
          title="IA Chat (Ctrl+L)"
          @click="$emit('toggle-ai-chat')"
        >
          <span class="icon-comment-dots"></span>
        </button>
      </div>

      <template v-if="isRetroProject">
        <span class="tb-sep"></span>
        <button
          class="mode-btn"
          title="Editor de Mapas"
          @click="$emit('open-map-editor')"
        >
          <span class="icon-grid-2"></span> Mapas
        </button>
      </template>
    </div>

    <div class="titlebarCenter">{{ title }}</div>

    <div class="titlebarRight">
      <button class="tbBtn" title="Ajuda (F1)" @click="$emit('help')">
        <span class="icon-circle-question"></span>
      </button>
      <button class="tbBtn" title="Command Palette (Ctrl+Shift+P)" @click="$emit('command-palette')">
        <span class="icon-palette"></span>
      </button>
      <button
        class="tbBtn"
        :class="{ active: showTerminal }"
        title="Terminal (Ctrl+`)"
        @click="$emit('toggle-terminal')"
      >
        <span class="icon-terminal"></span>
      </button>
      <button class="tbBtn" title="Buscar (Ctrl+Shift+F)" @click="$emit('search')">
        <span class="icon-magnifying-glass"></span>
      </button>
      <button
        class="tbBtn"
        :disabled="!hasDirtyTabs && !hasDirtyActiveTab"
        title="Salvar (Ctrl+S)"
        @click="$emit('save-active')"
      >
        <span class="icon-floppy-disk"></span>
      </button>

      <div v-if="availableEmulators?.length" class="emulator-selector">
        <select
          :value="selectedEmulator"
          @change="$emit('emulator-change', $event.target.value)"
          class="emulator-select"
          title="Emulador"
          :disabled="!isRetroProject"
        >
          <option v-for="emu in availableEmulators" :key="emu" :value="emu">
            {{ formatEmulatorName(emu) }}
          </option>
        </select>
      </div>

      <button
        class="tbBtn buildBtn"
        :class="{ compiling: isRetroCompiling }"
        :disabled="!isRetroProject && !isRetroCompiling"
        :title="isRetroCompiling ? 'Parar build' : 'Build (Ctrl+Shift+B)'"
        @click="isRetroCompiling ? $emit('stop-retro') : $emit('build-retro')"
      >
        <span v-if="!isRetroCompiling" class="icon-hammer"></span>
        <span v-else class="icon-stop"></span>
      </button>

      <button
        class="tbBtn playBtn"
        :class="{ compiling: isRetroCompiling }"
        :disabled="!isRetroProject && !isRetroCompiling"
        :title="isRetroCompiling ? 'Parar (F5)' : 'Play (F5)'"
        @click="isRetroCompiling ? $emit('stop-retro') : $emit('play-retro')"
      >
        <span v-if="!isRetroCompiling" class="icon-play"></span>
        <span v-else class="icon-stop"></span>
      </button>

      <button
        class="tbBtn packageBtn"
        :class="{ packaging: isPackaging }"
        :disabled="!isRetroProject || isRetroCompiling"
        :title="isPackaging ? 'Empacotando...' : 'Empacotar para Steam (Linux)'"
        @click="$emit('package-retro')"
      >
        <span class="icon-cube"></span>
      </button>

      <button
        class="tbBtn cartridgeBtn"
        :class="{ active: showCartridge }"
        :disabled="!isRetroProject"
        title="Cartridge Programmer (Ctrl+P)"
        @click="$emit('toggle-cartridge')"
      >
        <span class="icon-microchip"></span>
      </button>

      <button
        class="tbBtn storeLoginBtn"
        :class="{ active: storeUser }"
        :title="storeUser ? `${storeUser.name || storeUser.email} (clique para conta)` : 'Minha Conta'"
        @click="$emit('open-store-login')"
      >
        <span class="icon-user"></span>
      </button>

      <div v-if="windowControlsPosition === 'right'" class="windowControls">
        <button class="tbBtn" title="Minimize" @click="$emit('minimize')">
          <span class="icon-window-minimize"></span>
        </button>
        <button class="tbBtn" :title="isMaximized ? 'Restore' : 'Maximize'" @click="$emit('toggle-maximize')">
          <span v-if="!isMaximized" class="icon-window-maximize"></span>
          <span v-else class="icon-window-restore"></span>
        </button>
        <button class="tbBtn close" title="Close" @click="$emit('close')">
          <span class="icon-xmark"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: String,
  windowControlsPosition: String,
  isMaximized: Boolean,
  hasDirtyTabs: Boolean,
  hasDirtyActiveTab: Boolean,
  isRetroProject: { type: Boolean, default: false },
  isRetroCompiling: { type: Boolean, default: false },
  isPackaging: { type: Boolean, default: false },
  showTerminal: { type: Boolean, default: false },
  showAIChat: { type: Boolean, default: false },
  showCartridge: { type: Boolean, default: false },
  storeUser: { type: Object, default: null },
  availableEmulators: { type: Array, default: () => [] },
  selectedEmulator: { type: String, default: '' }
})

defineEmits([
  'minimize',
  'toggle-maximize',
  'close',
  'save-active',
  'open-settings',
  'menu-action',
  'build-retro',
  'play-retro',
  'stop-retro',
  'package-retro',
  'open-map-editor',
  'help',
  'command-palette',
  'toggle-terminal',
  'toggle-ai-chat',
  'search',
  'toggle-cartridge',
  'open-store-login',
  'emulator-change'
])

function formatEmulatorName(name) {
  if (!name) return ''
  const map = {
    gen_sdl2: 'Genesis Plus GX (SDL2)',
    blastem: 'BlastEm',
    picodrive: 'PicoDrive',
    md: 'MD (DGen)',
    'retroarch.exe': 'RetroArch'
  }
  return map[name] || name
}
</script>

<style scoped>
.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 36px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  padding: 0 4px;
}

.titlebarLeft,
.titlebarRight {
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.titlebarLeft {
  justify-self: start;
}

.titlebarRight {
  justify-self: end;
}

.titlebarCenter {
  justify-self: center;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.app-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.retro-studio-logo {
  display: flex;
  align-items: center;
  color: var(--accent);
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 12px;
}

.tb-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 6px;
}

.mode-section {
  display: flex;
  gap: 2px;
}

.mode-btn {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.mode-btn.active {
  background: var(--accent);
  color: var(--bg);
}

.scene-name {
  padding: 0 10px;
  color: var(--muted);
  font-size: 12px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tbBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.tbBtn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.tbBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tbBtn.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent);
}

.buildBtn.compiling,
.playBtn.compiling,
.tbBtn.packaging {
  color: #f85149 !important;
  animation: pulse 1s ease-in-out infinite;
}

.playBtn {
  color: #3fb950 !important;
}
.playBtn:hover:not(:disabled) {
  background: rgba(63, 185, 80, 0.2) !important;
}

.buildBtn:hover:not(:disabled) {
  background: rgba(255, 165, 0, 0.2) !important;
}
.buildBtn {
  color: #d4a574 !important;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.storeLoginBtn.active {
  background: rgba(76, 175, 80, 0.2);
  color: #4caf50;
}

.cartridgeBtn.active {
  background: rgba(255, 107, 53, 0.2);
  color: #ff6b35;
}

.windowControls {
  display: flex;
  align-items: center;
}

.emulator-selector {
  margin-left: 4px;
}

.emulator-select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  outline: none;
  cursor: pointer;
  height: 24px;
}

.emulator-select:hover {
  border-color: var(--accent);
}
</style>
