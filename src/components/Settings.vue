<template>
  <div class="settings-overlay" @click.self="close">
    <div class="settings-panel">
      <!-- Header -->
      <div class="settings-header">
        <div class="settings-title">
          <span class="settings-icon">⚙️</span>
          <span>{{ t('settings.title') }}</span>
        </div>
        <button class="settings-close" @click="close" :title="t('settings.close')">×</button>
      </div>

      <!-- Search -->
      <div class="settings-search">
        <input 
          type="text" 
          v-model="searchQuery" 
          :placeholder="t('settings.searchPlaceholder')"
          class="search-input"
        />
      </div>

      <!-- Content -->
      <div class="settings-content">
        <!-- Sidebar Categories -->
        <div class="settings-sidebar">
          <div 
            v-for="category in categories" 
            :key="category.id"
            class="sidebar-item"
            :class="{ active: activeCategory === category.id }"
            @click="activeCategory = category.id"
          >
            <span class="sidebar-icon">{{ category.icon }}</span>
            <span class="sidebar-label">{{ category.label }}</span>
          </div>
        </div>

        <!-- Settings List -->
        <div class="settings-list">
          <!-- Editor Settings -->
          <div v-show="activeCategory === 'editor' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionEditor') }}</h3>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.fontSize') }}</label>
                <p class="setting-description">{{ t('settings.fontSizeDesc') }}</p>
              </div>
              <div class="setting-control">
                <input 
                  type="number" 
                  v-model.number="localSettings.editor.fontSize" 
                  min="10" 
                  max="30"
                  class="control-input control-input--small"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.wordWrap') }}</label>
                <p class="setting-description">{{ t('settings.wordWrapDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.editor.wordWrap" class="control-select">
                  <option value="off">{{ t('settings.wrapOff') }}</option>
                  <option value="on">{{ t('settings.wrapOn') }}</option>
                  <option value="wordWrapColumn">{{ t('settings.wrapColumn') }}</option>
                  <option value="bounded">{{ t('settings.wrapBounded') }}</option>
                </select>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.tabSize') }}</label>
                <p class="setting-description">{{ t('settings.tabSizeDesc') }}</p>
              </div>
              <div class="setting-control">
                <input 
                  type="number" 
                  v-model.number="localSettings.editor.tabSize" 
                  min="1" 
                  max="8"
                  class="control-input control-input--small"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.minimap') }}</label>
                <p class="setting-description">{{ t('settings.minimapDesc') }}</p>
              </div>
              <div class="setting-control">
                <label class="control-toggle">
                  <input type="checkbox" v-model="localSettings.editor.minimap" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.lineNumbers') }}</label>
                <p class="setting-description">{{ t('settings.lineNumbersDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.editor.lineNumbers" class="control-select">
                  <option value="on">{{ t('settings.lineOn') }}</option>
                  <option value="off">{{ t('settings.lineOff') }}</option>
                  <option value="relative">{{ t('settings.lineRelative') }}</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Conta (Loja retrostudio.dev) -->
          <div v-show="activeCategory === 'account' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionAccount') }}</h3>
            <p class="setting-description" style="margin-bottom: 12px;">{{ t('settings.accountIntro') }}</p>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.apiUrl') }}</label>
                <p class="setting-description">{{ t('settings.storeApiUrlDesc') }}</p>
              </div>
              <div class="setting-control setting-control--wide">
                <input 
                  type="text" 
                  v-model="localSettings.store.apiUrl" 
                  placeholder="https://api.retrostudio.dev"
                  class="control-input"
                />
              </div>
            </div>

            <div v-if="!storeUser" class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.email') }}</label>
              </div>
              <div class="setting-control setting-control--wide">
                <input 
                  type="email" 
                  v-model="accountEmail" 
                  placeholder="seu@email.com"
                  class="control-input"
                  autocomplete="email"
                />
              </div>
            </div>

            <div v-if="!storeUser" class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.password') }}</label>
              </div>
              <div class="setting-control setting-control--wide">
                <input 
                  type="password" 
                  v-model="accountPassword" 
                  placeholder="••••••••"
                  class="control-input"
                  autocomplete="current-password"
                />
              </div>
            </div>

            <div v-if="storeUser" class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.connected') }}</label>
                <p class="setting-description">{{ storeUser.name }} ({{ storeUser.email }})</p>
              </div>
              <div class="setting-control">
                <button class="btn btn--secondary" @click="storeLogout" :disabled="storeLoggingOut">{{ t('settings.logout') }}</button>
              </div>
            </div>

            <div v-else class="setting-item">
              <div class="setting-control">
                <button 
                  class="btn btn--primary" 
                  @click="storeLogin" 
                  :disabled="storeLoggingIn || !accountEmail || !accountPassword"
                >
                  {{ storeLoggingIn ? t('settings.loggingIn') : t('settings.login') }}
                </button>
                <p v-if="storeLoginError" class="setting-error">{{ storeLoginError }}</p>
              </div>
            </div>
          </div>

          <!-- AI Settings -->
          <div v-show="activeCategory === 'ai' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionAiTitle') }}</h3>
            <p class="section-description">{{ t('settings.aiIntro', { url: 'http://localhost:11434/api/generate' }) }}</p>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.provider') }}</label>
                <p class="setting-description">{{ t('settings.providerDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.ai.provider" class="control-select" @change="onProviderChange">
                  <option v-for="(cfg, id) in aiProviders" :key="id" :value="id">{{ cfg.name }}</option>
                </select>
              </div>
            </div>
            <p v-if="currentProvider?.description" class="setting-hint">{{ currentProvider.description }}</p>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.apiUrl') }}</label>
                <p class="setting-description">{{ t('settings.apiUrlAiDesc') }}</p>
              </div>
              <div class="setting-control setting-control--wide">
                <input 
                  type="text" 
                  v-model="localSettings.ai.apiUrl" 
                  :placeholder="currentProvider?.apiType === 'ollama' ? 'http://localhost:11434/api/generate' : 'http://localhost:8000/v1/chat/completions'"
                  class="control-input"
                />
              </div>
            </div>

            <div v-if="currentProvider?.needsApiKey" class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.apiKey') }}</label>
                <p class="setting-description">{{ t('settings.apiKeyDesc') }} <a v-if="currentProvider?.endpoint?.includes('dashscope')" href="https://www.alibabacloud.com/help/en/model-studio/get-api-key" target="_blank" rel="noopener">{{ t('settings.getDashscopeKey') }}</a></p>
              </div>
              <div class="setting-control setting-control--wide">
                <input 
                  type="password" 
                  v-model="localSettings.ai.apiKey" 
                  :placeholder="currentProvider?.apiType === 'ollama' ? 'API_KEY_...' : 'sk-...'"
                  class="control-input"
                  autocomplete="off"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.model') }}</label>
                <p class="setting-description">{{ currentProvider?.apiType === 'ollama' ? t('settings.modelDescOllama') : t('settings.modelDescVllm') }}</p>
              </div>
              <div class="setting-control setting-control--wide">
                <div class="path-input-group">
                  <input 
                    type="text" 
                    v-model="localSettings.ai.model" 
                    :placeholder="currentProvider?.defaultModel || 'modelo'"
                    class="control-input"
                    list="ai-models-list"
                  />
                  <button
                    type="button"
                    class="btn-browse"
                    :disabled="isLoadingModels"
                    @click="fetchModelsList"
                    :title="currentProvider?.apiType === 'ollama' ? t('settings.listModelsTitleOllama') : t('settings.listModelsTitleVllm')"
                  >
                    {{ isLoadingModels ? '…' : t('settings.listModels') }}
                  </button>
                </div>
                <datalist id="ai-models-list">
                  <option v-for="m in availableModels" :key="m" :value="m" />
                </datalist>
                <p v-if="fetchModelsError" class="setting-error">{{ fetchModelsError }}</p>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.temperature') }}</label>
                <p class="setting-description">{{ t('settings.temperatureDesc') }}</p>
              </div>
              <div class="setting-control">
                <input 
                  type="number" 
                  v-model.number="localSettings.ai.temperature" 
                  min="0" 
                  max="2"
                  step="0.1"
                  class="control-input control-input--small"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.maxTokens') }}</label>
                <p class="setting-description">{{ t('settings.maxTokensDesc') }}</p>
              </div>
              <div class="setting-control">
                <input 
                  type="number" 
                  v-model.number="localSettings.ai.maxTokens" 
                  min="100" 
                  max="8000"
                  step="100"
                  class="control-input control-input--small"
                />
              </div>
            </div>
          </div>

          <!-- Retro Studio Settings -->
          <div v-show="activeCategory === 'retro' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionRetroTitle') }}</h3>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.toolkitPath') }}</label>
                <p class="setting-description">{{ t('settings.toolkitPathDesc') }}</p>
              </div>
              <div class="setting-control setting-control--wide">
                <div class="path-input-group">
                  <input 
                    type="text" 
                    v-model="localSettings.retro.toolkitPath" 
                    placeholder="~/.retrostudio/toolkit/marsdev/mars"
                    class="control-input"
                  />
                  <button type="button" class="btn-browse" @click="browseToolkitPath" :title="t('settings.browse')">📂</button>
                </div>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.clangdTitle') }}</label>
                <p class="setting-description">{{ t('settings.clangdDesc') }}</p>
                <p v-if="clangdStatus" class="setting-description" :class="clangdStatus.available ? 'clangd-ok' : 'clangd-missing'">
                  {{ clangdStatus.available
                    ? t('settings.clangdFound', { path: clangdStatus.path })
                    : t('settings.clangdMissing', { hint: clangdStatus.installHint || '' }) }}
                </p>
              </div>
              <div class="setting-control setting-control--wide">
                <div class="path-input-group">
                  <input
                    type="text"
                    v-model="localSettings.retro.clangdPath"
                    :placeholder="t('settings.clangdPathPlaceholder')"
                    class="control-input"
                  />
                  <button type="button" class="btn-browse" @click="refreshClangdStatus" :title="t('settings.clangdRecheck')">↻</button>
                </div>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.downloadToolkit') }}</label>
                <p class="setting-description">{{ t('settings.downloadToolkitDesc') }}</p>
              </div>
              <div class="setting-control">
                <ToolkitDownloads />
              </div>
            </div>

            <div class="setting-item setting-item--block">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.externalTools') }}</label>
                <p class="setting-description">{{ t('settings.externalToolsDesc') }}</p>
              </div>
              <div class="setting-control setting-control--full">
                <div class="path-row">
                  <label>{{ t('settings.imageEditor') }}</label>
                  <div class="path-input-group">
                    <input type="text" v-model="localSettings.retro.imageEditorPath" placeholder="Aseprite, GIMP, etc." class="control-input" />
                    <button type="button" class="btn-browse" @click="browseImageEditorPath" :title="t('settings.browse')">📂</button>
                  </div>
                </div>
                <div class="path-row">
                  <label>{{ t('settings.mapEditor') }}</label>
                  <div class="path-input-group">
                    <input type="text" v-model="localSettings.retro.mapEditorPath" placeholder="Tiled, etc." class="control-input" />
                    <button type="button" class="btn-browse" @click="browseMapEditorPath" :title="t('settings.browse')">📂</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="setting-item setting-item--block">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.emulators') }}</label>
                <p class="setting-description">{{ t('settings.emulatorsDesc') }}</p>
              </div>
              <div class="setting-control setting-control--full">
                <EmulatorSettings />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.cartVendorId') }}</label>
                <p class="setting-description">{{ t('settings.cartVendorDesc') }}</p>
              </div>
              <div class="setting-control">
                <input type="text" v-model="localSettings.retro.cartridgeVendorId" placeholder="0x2e8a" class="control-input control-input--small" />
              </div>
            </div>
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.baudRate') }}</label>
                <p class="setting-description">{{ t('settings.baudRateDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.retro.cartridgeBaudRate" class="control-select">
                  <option value="9600">9600</option>
                  <option value="19200">19200</option>
                  <option value="38400">38400</option>
                  <option value="57600">57600</option>
                  <option value="115200">{{ t('settings.baudRecommended') }}</option>
                  <option value="230400">230400</option>
                  <option value="460800">460800</option>
                  <option value="921600">921600</option>
                </select>
              </div>
            </div>
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.chunkSize') }}</label>
                <p class="setting-description">{{ t('settings.chunkSizeDesc') }}</p>
              </div>
              <div class="setting-control">
                <input type="number" v-model.number="localSettings.retro.cartridgeChunkSize" min="64" max="8192" step="64" class="control-input control-input--small" />
              </div>
            </div>
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.swapEndian') }}</label>
                <p class="setting-description">{{ t('settings.swapEndianDesc') }}</p>
              </div>
              <div class="setting-control">
                <label class="control-toggle">
                  <input type="checkbox" v-model="localSettings.retro.cartridgeSwapEndianness" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- Appearance Settings -->
          <div v-show="activeCategory === 'appearance' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionAppearance') }}</h3>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.language') }}</label>
                <p class="setting-description">{{ t('settings.languageDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.appearance.locale" class="control-select" @change="onLocaleChange">
                  <option value="pt-BR">{{ t('settings.langPtBR') }}</option>
                  <option value="en">{{ t('settings.langEn') }}</option>
                  <option value="es">{{ t('settings.langEs') }}</option>
                  <option value="ja">{{ t('settings.langJa') }}</option>
                </select>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.theme') }}</label>
                <p class="setting-description">{{ t('settings.themeDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.appearance.theme" class="control-select">
                  <option value="dark">{{ t('settings.themeDark') }}</option>
                  <option value="light">{{ t('settings.themeLight') }}</option>
                  <option value="system">{{ t('settings.themeSystem') }}</option>
                </select>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.windowControls') }}</label>
                <p class="setting-description">{{ t('settings.windowControlsDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.appearance.windowControlsPosition" class="control-select">
                  <option value="left">{{ t('settings.left') }}</option>
                  <option value="right">{{ t('settings.right') }}</option>
                </select>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.sidebar') }}</label>
                <p class="setting-description">{{ t('settings.sidebarDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.appearance.sidebarPosition" class="control-select">
                  <option value="left">{{ t('settings.left') }}</option>
                  <option value="right">{{ t('settings.right') }}</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Keyboard Shortcuts -->
          <div v-show="activeCategory === 'keyboard' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionShortcuts') }}</h3>
            
            <div class="shortcuts-list">
              <div class="shortcut-item" v-for="shortcut in shortcuts" :key="shortcut.id">
                <span class="shortcut-label">{{ shortcut.label }}</span>
                <div class="shortcut-keys">
                  <span class="kbd" v-for="key in shortcut.keys" :key="key">{{ key }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Terminal Settings -->
          <div v-show="activeCategory === 'terminal' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionTerminal') }}</h3>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.termFontSize') }}</label>
                <p class="setting-description">{{ t('settings.termFontSizeDesc') }}</p>
              </div>
              <div class="setting-control">
                <input 
                  type="number" 
                  v-model.number="localSettings.terminal.fontSize" 
                  min="10" 
                  max="24"
                  class="control-input control-input--small"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.termFontFamily') }}</label>
                <p class="setting-description">{{ t('settings.termFontFamilyDesc') }}</p>
              </div>
              <div class="setting-control setting-control--wide">
                <input 
                  type="text" 
                  v-model="localSettings.terminal.fontFamily" 
                  class="control-input"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.termCursorBlink') }}</label>
                <p class="setting-description">{{ t('settings.termCursorBlinkDesc') }}</p>
              </div>
              <div class="setting-control">
                <label class="control-toggle">
                  <input type="checkbox" v-model="localSettings.terminal.cursorBlink" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.termCursorStyle') }}</label>
                <p class="setting-description">{{ t('settings.termCursorStyleDesc') }}</p>
              </div>
              <div class="setting-control">
                <select v-model="localSettings.terminal.cursorStyle" class="control-select">
                  <option value="block">{{ t('settings.cursorBlock') }}</option>
                  <option value="underline">{{ t('settings.cursorUnderline') }}</option>
                  <option value="bar">{{ t('settings.cursorBar') }}</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Advanced Settings -->
          <div v-show="activeCategory === 'advanced' || searchQuery" class="settings-section">
            <h3 class="section-title">{{ t('settings.sectionAdvanced') }}</h3>
            
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.configDir') }}</label>
                <p class="setting-description">{{ t('settings.configDirDesc') }}</p>
              </div>
              <div class="setting-control">
                <button class="btn btn--secondary" @click="openConfigDir">{{ t('settings.openConfigFolder') }}</button>
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">{{ t('settings.configPathLabel') }}</label>
                <p class="setting-description">{{ configPath || t('settings.loadingPath') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="settings-footer">
        <button class="btn btn--secondary" @click="resetToDefaults">{{ t('settings.resetDefaults') }}</button>
        <div class="footer-actions">
          <button class="btn btn--secondary" @click="close">{{ t('openWorkspace.cancel') }}</button>
          <button class="btn btn--primary" @click="save">{{ t('settings.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { setAppLocale } from '../i18n'
import ToolkitDownloads from './retro/ToolkitDownloads.vue'
import EmulatorSettings from './retro/EmulatorSettings.vue'

const { t } = useI18n()

const props = defineProps({
  isOpen: Boolean
})

const emit = defineEmits(['close', 'save'])

const searchQuery = ref('')
const activeCategory = ref('editor')

const categories = computed(() => [
  { id: 'editor', label: t('settings.catEditor'), icon: '📝' },
  { id: 'ai', label: t('settings.catAi'), icon: '🤖' },
  { id: 'account', label: t('settings.catAccount'), icon: '👤' },
  { id: 'retro', label: t('settings.catRetro'), icon: '🎮' },
  { id: 'appearance', label: t('settings.catAppearance'), icon: '🎨' },
  { id: 'terminal', label: t('settings.catTerminal'), icon: '💻' },
  { id: 'keyboard', label: t('settings.catKeyboard'), icon: '⌨️' },
  { id: 'advanced', label: t('settings.catAdvanced'), icon: '⚙️' }
])

const shortcuts = computed(() => [
  { id: 'save', label: t('settings.scSave'), keys: ['Ctrl', 'S'] },
  { id: 'find', label: t('settings.scFind'), keys: ['Ctrl', 'F'] },
  { id: 'openAI', label: t('settings.scOpenAI'), keys: ['Ctrl', 'L'] },
  { id: 'terminal', label: t('settings.scTerminal'), keys: ['Ctrl', '`'] },
  { id: 'settings', label: t('settings.scSettings'), keys: ['Ctrl', 'Shift', ','] },
  { id: 'newFile', label: t('settings.scNewFile'), keys: ['Ctrl', 'N'] },
  { id: 'closeTab', label: t('settings.scCloseTab'), keys: ['Ctrl', 'W'] }
])

function onLocaleChange() {
  const loc = localSettings.appearance.locale
  if (loc) setAppLocale(loc)
}

const defaultSettings = {
  editor: {
    fontSize: 14,
    wordWrap: 'off',
    tabSize: 2,
    minimap: true,
    lineNumbers: 'on'
  },
  ai: {
    provider: 'vllm',
    apiKey: '',
    apiUrl: 'https://ia.auth.com.br/v1/chat/completions',
    model: 'Qwen/Qwen2.5-Coder-3B-Instruct',
    temperature: 0.2,
    maxTokens: 2048
  },
  appearance: {
    theme: 'dark',
    windowControlsPosition: 'right',
    sidebarPosition: 'left',
    locale: 'pt-BR'
  },
  terminal: {
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    cursorBlink: true,
    cursorStyle: 'block'
  },
  retro: {
    toolkitPath: '',
    clangdPath: '',
    enableVisualMode: false,
    imageEditorPath: '',
    mapEditorPath: '',
    cartridgeVendorId: '0x2e8a',
    cartridgeBaudRate: '115200',
    cartridgeChunkSize: 1024,
    cartridgeSwapEndianness: true
  },
  store: {
    apiUrl: 'https://api.retrostudio.dev',
    token: ''
  }
}

const localSettings = reactive(JSON.parse(JSON.stringify(defaultSettings)))
const configPath = ref('')
const availableModels = ref([])
const storeUser = ref(null)
const accountEmail = ref('')
const accountPassword = ref('')
const storeLoggingIn = ref(false)
const storeLoggingOut = ref(false)
const storeLoginError = ref('')
const isLoadingModels = ref(false)
const fetchModelsError = ref('')
const aiProviders = ref({})
const clangdStatus = ref(null)

const currentProvider = computed(() => aiProviders.value[localSettings.ai.provider] || null)

function onProviderChange() {
  const p = aiProviders.value[localSettings.ai.provider]
  if (p) {
    localSettings.ai.apiUrl = p.endpoint
    localSettings.ai.model = p.defaultModel || localSettings.ai.model
  }
}

const loadSettings = async () => {
  try {
    if (window.retroStudio?.settings) {
      const settings = await window.retroStudio.settings.load()
      if (settings.editor) Object.assign(localSettings.editor, settings.editor)
      if (settings.appearance) {
        Object.assign(localSettings.appearance, settings.appearance)
        if (!localSettings.appearance.locale) localSettings.appearance.locale = 'pt-BR'
      }
      if (settings.terminal) Object.assign(localSettings.terminal, settings.terminal)
      if (settings.retro) Object.assign(localSettings.retro, settings.retro)
      if (settings.store) Object.assign(localSettings.store, settings.store)
      if (settings.ai) {
        localSettings.ai.provider = settings.ai.provider ?? localSettings.ai.provider
        localSettings.ai.apiKey = settings.ai.apiKey ?? localSettings.ai.apiKey
        localSettings.ai.apiUrl = settings.ai.endpoint ?? settings.ai.apiUrl ?? localSettings.ai.apiUrl
        localSettings.ai.model = settings.ai.model ?? localSettings.ai.model
        localSettings.ai.temperature = settings.ai.temperature ?? localSettings.ai.temperature
        localSettings.ai.maxTokens = settings.ai.maxTokens ?? localSettings.ai.maxTokens
      }

      const retroSettings = await window.retroStudio?.retro?.getUiSettings?.()
      if (retroSettings) Object.assign(localSettings.retro, retroSettings)
      
      configPath.value = await window.retroStudio.settings.getConfigPath()
      if (window.retroStudio?.store?.me) {
        const r = await window.retroStudio.store.me()
        storeUser.value = r?.user ?? null
      }
      if (window.retroStudio?.ai?.getProviders) {
        aiProviders.value = await window.retroStudio.ai.getProviders()
      }
      await refreshClangdStatus()
    }
  } catch (e) {
    console.error('Erro ao carregar configurações:', e)
  }
}

async function refreshClangdStatus() {
  try {
    clangdStatus.value = await window.retroStudio?.retro?.lspStatus?.({
      clangdPath: localSettings.retro.clangdPath || ''
    }) || null
  } catch {
    clangdStatus.value = { available: false, path: null, installHint: 'sudo apt install clangd' }
  }
}

const storeLogin = async () => {
  storeLoginError.value = ''
  storeLoggingIn.value = true
  try {
    const apiUrl = (localSettings.store?.apiUrl || '').trim() || 'https://api.retrostudio.dev'
    const r = await window.retroStudio?.store?.login?.(apiUrl, accountEmail.value.trim(), accountPassword.value)
    if (r?.success) {
      storeUser.value = r.user
      localSettings.store.token = r.token
      accountPassword.value = ''
    } else {
      storeLoginError.value = r?.error || 'Falha no login'
    }
  } catch (e) {
    storeLoginError.value = e?.message || 'Erro ao conectar'
  } finally {
    storeLoggingIn.value = false
  }
}

const storeLogout = async () => {
  storeLoggingOut.value = true
  try {
    await window.retroStudio?.store?.logout?.()
    storeUser.value = null
    localSettings.store.token = ''
    accountEmail.value = ''
    accountPassword.value = ''
  } finally {
    storeLoggingOut.value = false
  }
}

const browseToolkitPath = async () => {
  const res = await window.retroStudio?.retro?.selectFolder?.({ context: 'toolkit', title: 'Selecionar pasta MarsDev' })
  if (res?.path) localSettings.retro.toolkitPath = res.path
}

const browseImageEditorPath = async () => {
  const res = await window.retroStudio?.retro?.selectFile?.({ context: 'editor-image', title: 'Selecionar Editor de Imagens' })
  if (res?.path) localSettings.retro.imageEditorPath = res.path
}

const browseMapEditorPath = async () => {
  const res = await window.retroStudio?.retro?.selectFile?.({ context: 'editor-map', title: 'Selecionar Editor de Mapas' })
  if (res?.path) localSettings.retro.mapEditorPath = res.path
}

const fetchModelsList = async () => {
  if (!window.retroStudio?.ai?.fetchModels) return
  fetchModelsError.value = ''
  availableModels.value = []
  isLoadingModels.value = true
  try {
    const apiUrl = localSettings.ai.apiUrl || ''
    const endpoint = apiUrl.trim() || (currentProvider.value?.endpoint ?? 'http://localhost:8000')
    const models = await window.retroStudio.ai.fetchModels(endpoint, localSettings.ai.provider)
    availableModels.value = models
    if (models.length === 0) fetchModelsError.value = 'Nenhum modelo encontrado'
  } catch (e) {
    fetchModelsError.value = e?.message || 'Erro ao conectar. Verifique a URL e se o servidor está rodando (vLLM: 8000, Ollama: 11434).'
  } finally {
    isLoadingModels.value = false
  }
}

const save = async () => {
  try {
    const retroPlain = JSON.parse(JSON.stringify(localSettings.retro))
    await window.retroStudio?.retro?.saveUiSettings?.(retroPlain)
    emit('save', JSON.parse(JSON.stringify(localSettings)))
    emit('close')
  } catch (e) {
    console.error('Erro ao salvar configurações:', e)
  }
}

const openConfigDir = async () => {
  try {
    if (window.retroStudio?.settings) {
      await window.retroStudio.settings.openConfigDir()
    }
  } catch (e) {
    console.error('Erro ao abrir diretório:', e)
  }
}

const close = () => {
  emit('close')
}

const resetToDefaults = () => {
  Object.assign(localSettings, JSON.parse(JSON.stringify(defaultSettings)))
}

onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-panel {
  width: 900px;
  max-width: 95vw;
  height: 80vh;
  max-height: 700px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

/* Header */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}

.settings-icon {
  font-size: 18px;
}

.settings-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.settings-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

/* Search */
.settings-search {
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  border-color: var(--accent);
}

.search-input::placeholder {
  color: var(--muted);
}

/* Content */
.settings-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Sidebar */
.settings-sidebar {
  width: 200px;
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  background: var(--panel-2);
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
  transition: all 0.15s ease;
}

.sidebar-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}

.sidebar-item.active {
  background: var(--accent);
  color: #fff;
}

.sidebar-icon {
  font-size: 14px;
}

/* Settings List */
.settings-list {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.settings-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.section-description {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 12px 0;
}
.section-description code {
  font-size: 11px;
  background: var(--bg-secondary, rgba(255,255,255,0.06));
  padding: 2px 6px;
  border-radius: 4px;
}
.setting-hint {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 16px 0;
  padding: 8px 10px;
  background: var(--bg-secondary, rgba(255,255,255,0.04));
  border-radius: 4px;
}

.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.setting-info {
  flex: 1;
  padding-right: 20px;
}

.setting-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  display: block;
  margin-bottom: 4px;
}

.setting-description {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  line-height: 1.4;
}

.setting-error {
  font-size: 12px;
  color: var(--error, #e74c3c);
  margin: 4px 0 0;
  line-height: 1.4;
}

.setting-control {
  flex-shrink: 0;
}

.setting-control--wide {
  width: 300px;
}

.setting-control--full {
  width: 100%;
}

.setting-item--block {
  flex-direction: column;
  align-items: stretch;
}

.setting-item--block .setting-control--full {
  margin-top: 8px;
}

.path-input-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.path-input-group .control-input {
  flex: 1;
}

.btn-browse {
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
  flex-shrink: 0;
}

.btn-browse:hover {
  border-color: var(--accent);
}

.path-row {
  margin-bottom: 12px;
}

.path-row:last-child {
  margin-bottom: 0;
}

.path-row > label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  margin-bottom: 6px;
}

/* Controls */
.control-input {
  padding: 8px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  width: 100%;
  transition: border-color 0.15s ease;
}

.control-input:focus {
  border-color: var(--accent);
}

.control-input--small {
  width: 80px;
}

.control-select {
  padding: 8px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  cursor: pointer;
  min-width: 140px;
}

.control-select:focus {
  border-color: var(--accent);
}

/* Toggle */
.control-toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.control-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--border);
  border-radius: 24px;
  transition: 0.2s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: 0.2s;
}

.control-toggle input:checked + .toggle-slider {
  background: var(--accent);
}

.control-toggle input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

/* Shortcuts */
.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--panel-2);
  border-radius: 6px;
}

.shortcut-label {
  font-size: 13px;
  color: var(--text);
}

.shortcut-keys {
  display: flex;
  gap: 4px;
}

.kbd {
  padding: 4px 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: var(--text);
}

/* Footer */
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
}

.footer-actions {
  display: flex;
  gap: 10px;
}

.clangd-ok {
  color: #3fb950 !important;
}

.clangd-missing {
  color: #f85149 !important;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.btn--secondary {
  background: var(--panel);
  border-color: var(--border);
  color: var(--text);
}

.btn--secondary:hover {
  background: rgba(255, 255, 255, 0.08);
}

.btn--primary {
  background: var(--accent);
  color: #fff;
}

.btn--primary:hover {
  background: #1a8ad4;
}

/* Scrollbar */
.settings-list::-webkit-scrollbar {
  width: 8px;
}

.settings-list::-webkit-scrollbar-track {
  background: transparent;
}

.settings-list::-webkit-scrollbar-thumb {
  background: rgba(121, 121, 121, 0.4);
  border-radius: 4px;
}

.settings-list::-webkit-scrollbar-thumb:hover {
  background: rgba(121, 121, 121, 0.6);
}
</style>
