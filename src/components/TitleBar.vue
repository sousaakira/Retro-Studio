<template>
  <div class="titlebar" :class="{ 'with-workspace': hasWorkspace }" @dblclick="$emit('toggle-maximize')">
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
        <span v-if="!hasWorkspace">{{ t('app.name') }}</span>
      </div>

      <div class="toolbar-section">
        <button class="tbBtn" :title="t('titlebar.newRetroProject')" @click="$emit('menu-action', 'newRetroProject')">
          <span class="icon-plus"></span>
        </button>
        <button class="tbBtn" :title="t('titlebar.openFolder')" @click="$emit('menu-action', 'openFolder')">
          <span class="icon-folder-open"></span>
        </button>
        <!-- Com um projeto aberto, IA e terminal ficam só na barra de modos (sem ação repetida nas duas barras). -->
        <button
          v-if="!hasWorkspace"
          class="tbBtn"
          :class="{ active: showAITerminal }"
          :title="t('titlebar.ai')"
          @click="$emit('toggle-ai-terminal')"
        >
          <span class="icon-terminal-ai"></span>
        </button>
      </div>

    </div>

    <!-- #67: com um projeto aberto, modos e painéis ficam aqui (uma barra só). -->
    <div class="titlebarCenter"><slot name="workspace">{{ title }}</slot></div>

    <div class="titlebarRight">
      <button class="tbBtn" :title="t('titlebar.help')" @click="$emit('help')">
        <span class="icon-circle-question"></span>
      </button>
      <button class="tbBtn" :title="t('titlebar.updates')" @click="$emit('updates')">
        <span class="icon-arrows-rotate"></span>
      </button>
      <button class="tbBtn" :title="t('titlebar.commandPalette')" @click="$emit('command-palette')">
        <span class="icon-palette"></span>
      </button>
      <button
        v-if="!hasWorkspace"
        class="tbBtn"
        :class="{ active: showTerminal }"
        :title="t('titlebar.terminal')"
        @click="$emit('toggle-terminal')"
      >
        <span class="icon-terminal"></span>
      </button>
      <button class="tbBtn" :title="t('titlebar.search')" @click="$emit('search')">
        <span class="icon-magnifying-glass"></span>
      </button>
      <button
        class="tbBtn"
        :disabled="!canSaveEditor && !hasDirtyTabs && !hasDirtyActiveTab"
        :title="t('titlebar.save')"
        @click="$emit('save-active')"
      >
        <span class="icon-floppy-disk"></span>
      </button>

      <div v-if="availableEmulators?.length" class="emulator-selector">
        <select
          :value="selectedEmulator"
          @change="$emit('emulator-change', $event.target.value)"
          class="emulator-select"
          :title="t('titlebar.emulator')"
          :disabled="!isRetroProject"
        >
          <option v-for="emu in availableEmulators" :key="emu" :value="emu">
            {{ formatEmulatorName(emu) }}
          </option>
        </select>
      </div>

      <!-- Construir, jogar e parar: ao lado do emulador que vai rodar o jogo. -->
      <div v-if="hasWorkspace" class="build-section">
        <button class="tbBtn buildBtn" :disabled="!isRetroProject || isBuilding || isPlaying || isPackaging" :title="t('workspaceLayout.build')" :aria-label="t('workspaceLayout.build')" @click="$emit('build-retro')">
          <span class="icon-hammer" aria-hidden="true"></span>
        </button>
        <button class="tbBtn playBtn" :disabled="!isRetroProject || isBuilding || isPlaying || isPackaging" :title="t('workspaceLayout.play')" :aria-label="t('workspaceLayout.play')" @click="$emit('play-retro')">
          <span class="icon-play" aria-hidden="true"></span>
        </button>
        <button class="tbBtn stopBtn" :disabled="!isRetroProject || isPackaging" :title="t('workspaceLayout.stop')" :aria-label="t('workspaceLayout.stop')" @click="$emit('stop-retro')">
          <span class="icon-stop" aria-hidden="true"></span>
        </button>
      </div>

      <button
        class="tbBtn packageBtn"
        :class="{ packaging: isPackaging }"
        :disabled="!isRetroProject || isBuilding || isPlaying"
        :title="isPackaging ? t('titlebar.packaging') : t('titlebar.packageSteam')"
        @click="$emit('package-retro')"
      >
        <span class="icon-cube"></span>
      </button>

      <button
        class="tbBtn cartridgeBtn"
        :class="{ active: showCartridge }"
        :disabled="!isRetroProject"
        :title="t('titlebar.cartridgeShortcut')"
        @click="$emit('toggle-cartridge')"
      >
        <span class="icon-microchip"></span>
      </button>

      <button
        class="tbBtn storeLoginBtn"
        :class="{ active: storeUser }"
        :title="storeUser ? t('titlebar.storeAccountHint', { name: storeUser.name || storeUser.email }) : t('titlebar.myAccount')"
        @click="$emit('open-store-login')"
      >
        <!-- Conta: boneco dentro de um círculo; o boneco de corpo inteiro é o modo Personagens. -->
        <svg class="tbGlyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="2.6"/><path d="M6.8 18.2c1-2.4 3-3.6 5.200-3.6s4.2 1.2 5.2 3.6"/></svg>
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
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps({
  title: String,
  windowControlsPosition: String,
  isMaximized: Boolean,
  hasDirtyTabs: Boolean,
  hasDirtyActiveTab: Boolean,
  canSaveEditor: { type: Boolean, default: false },
  isRetroProject: { type: Boolean, default: false },
  // Há um projeto aberto: a barra de modos existe e é o lugar de modos, construir/jogar, terminal e IA.
  hasWorkspace: { type: Boolean, default: false },
  isBuilding: { type: Boolean, default: false },
  isPlaying: { type: Boolean, default: false },
  isPackaging: { type: Boolean, default: false },
  showTerminal: { type: Boolean, default: false },
  showAITerminal: { type: Boolean, default: false },
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
  'package-retro',
  'build-retro',
  'play-retro',
  'stop-retro',
  'help',
  'updates',
  'command-palette',
  'toggle-terminal',
  'toggle-ai-terminal',
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

.titlebar.with-workspace {
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
}
.titlebar.with-workspace .titlebarCenter {
  justify-self: stretch;
  max-width: none;
  min-width: 0;
  overflow: hidden;
  height: 100%;
  font-weight: 400;
}
.titlebar.with-workspace .app-title { margin-left: 6px; }
.titlebar.with-workspace .toolbar-section { margin-left: 6px; }
.storeLoginBtn.active .tbGlyph { color: #4caf50; }
.tbGlyph { width: 16px; height: 16px; color: #fff; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

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
.tbBtn.packaging {
  color: #f85149 !important;
  animation: pulse 1s ease-in-out infinite;
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

.build-section {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 4px 0 2px;
  padding-right: 4px;
  border-right: 1px solid var(--border);
}
.buildBtn:hover:not(:disabled) { color: #dcdcaa; }
.playBtn:hover:not(:disabled) { color: #4ec9b0; }
.stopBtn:hover:not(:disabled) { color: #f48771; }

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

/* Janela estreita: o seletor de emulador encolhe antes de qualquer botão ficar escondido. */
@media (max-width: 1280px) { .emulator-select { max-width: 104px; } }

.emulator-select:hover {
  border-color: var(--accent);
}
</style>
