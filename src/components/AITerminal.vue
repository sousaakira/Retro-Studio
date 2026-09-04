<template>
  <div class="ai-terminal-panel">
    <div class="ai-terminal-header">
      <div class="ai-terminal-tabs">
        <div
          v-for="ai in availableAIs"
          :key="ai.id"
          class="ai-terminal-tab"
          :class="{ active: selectedAI?.id === ai.id }"
          @click="selectAI(ai)"
        >
          <span class="ai-icon">{{ ai.icon }}</span>
          <span class="ai-tab-name">{{ ai.name }}</span>
          <button
            v-if="ai.hasSettings"
            class="ai-settings-btn"
            @click.stop="openSettings(ai)"
            :title="t('aiTerminal.settings')"
          >
            ⚙️
          </button>
        </div>
      </div>
      <div class="ai-terminal-actions">
        <button class="ai-terminal-action-btn" @click="restartSession" :title="t('aiTerminal.restart')" :disabled="isStarting">
          ↻
        </button>
        <button class="ai-terminal-action-btn" @click="emit('open-ai-chat')" :title="t('aiChat.openTerminal')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
        <button class="ai-terminal-action-btn" @click="copyFromTerminal" :title="t('aiTerminal.copy')">
          <span class="icon-copy"></span>
        </button>
        <button class="ai-terminal-action-btn" @click="pasteToTerminal" :title="t('aiTerminal.paste')">
          <span class="icon-paste"></span>
        </button>
        <button class="ai-terminal-action-btn" @click="$emit('close')" :title="t('aiTerminal.close')">
          <span class="icon-xmark"></span>
        </button>
      </div>
    </div>

    <div v-if="selectedAI" class="ai-info-bar">
      <div class="ai-info-left">
        <span class="ai-info-icon">{{ selectedAI.icon }}</span>
        <span class="ai-info-name">{{ selectedAI.name }}</span>
        <span class="ai-info-status" :class="sessionStatus">{{ sessionStatusText }}</span>
      </div>
      <div class="ai-info-right">
        <span v-if="resolvedBinary" class="ai-model-badge" :title="resolvedBinary">{{ binaryLabel }}</span>
        <span v-if="workspaceLabel" class="ai-model-badge" :title="workspacePath">{{ workspaceLabel }}</span>
      </div>
    </div>

    <div ref="terminalContainer" class="ai-terminal-container" @contextmenu.prevent="showContextMenu"></div>

    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="terminal-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="ctxCopy"><span class="icon-copy"></span> {{ t('aiTerminal.copy') }}</button>
        <button class="ctx-item" @click="ctxPaste"><span class="icon-paste"></span> {{ t('aiTerminal.paste') }}</button>
        <div class="ctx-separator"></div>
        <button class="ctx-item" @click="restartSession">↻ {{ t('aiTerminal.restart') }}</button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showSettingsModal" class="ai-settings-modal-overlay" @click.self="closeSettings">
        <div class="ai-settings-modal">
          <div class="ai-settings-header">
            <h3>{{ t('aiTerminal.settingsTitle', { name: editingAI?.name }) }}</h3>
            <button class="ai-settings-close" @click="closeSettings">×</button>
          </div>
          <div class="ai-settings-content">
            <template v-if="editingAI?.id === 'opencode'">
              <div class="ai-settings-section">
                <h4>{{ t('aiTerminal.opencodeBinary') }}</h4>
                <p class="ai-settings-hint">{{ t('aiTerminal.opencodeBinaryHint') }}</p>
                <div class="ai-setting-item">
                  <label>{{ t('aiTerminal.commandPath') }}</label>
                  <input
                    type="text"
                    v-model="editingConfig.commandPath"
                    placeholder="~/.opencode/bin/opencode"
                    class="ai-settings-input"
                  />
                </div>
              </div>
            </template>
            <template v-else>
              <div class="ai-settings-section">
                <h4>{{ t('aiTerminal.envVars') }}</h4>
                <p class="ai-settings-hint">{{ t('aiTerminal.envVarsHint') }}</p>
                <div class="ai-setting-item">
                  <label>{{ t('aiTerminal.useOpenAI') }}</label>
                  <input type="checkbox" v-model="editingConfig.useOpenAI" />
                </div>
                <div class="ai-setting-item">
                  <label>{{ t('aiTerminal.openaiBaseUrl') }}</label>
                  <input type="text" v-model="editingConfig.baseUrl" placeholder="http://localhost:11434/v1" class="ai-settings-input" />
                </div>
                <div class="ai-setting-item">
                  <label>{{ t('aiTerminal.openaiModel') }}</label>
                  <input type="text" v-model="editingConfig.model" placeholder="glm-4:cloud" class="ai-settings-input" />
                </div>
                <div class="ai-setting-item">
                  <label>{{ t('aiTerminal.openaiApiKey') }}</label>
                  <input type="password" v-model="editingConfig.apiKey" class="ai-settings-input" />
                </div>
                <div class="ai-setting-item">
                  <label>{{ t('aiTerminal.customEnv') }}</label>
                  <textarea v-model="editingConfig.customEnvVars" rows="4" class="ai-settings-input" placeholder="KEY=value" />
                </div>
              </div>
            </template>
          </div>
          <div class="ai-settings-footer">
            <button class="ai-settings-cancel" @click="closeSettings">{{ t('common.cancel') }}</button>
            <button class="ai-settings-save" @click="saveSettings">{{ t('common.save') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

const emit = defineEmits(['close', 'open-ai-chat'])
const { t } = useI18n()

const terminalContainer = ref(null)
const selectedAI = ref(null)
const showSettingsModal = ref(false)
const editingAI = ref(null)
const isStarting = ref(false)
const sessionStatus = ref('idle') // idle | starting | running | exited | missing
const resolvedBinary = ref('')
const workspacePath = ref('')
const ptyId = ref(null)

const editingConfig = reactive({
  useOpenAI: false,
  baseUrl: '',
  model: '',
  apiKey: '',
  customEnvVars: '',
  commandPath: ''
})

const contextMenu = ref({ visible: false, x: 0, y: 0 })
let contextMenuCleanup = null

let activeXterm = null
let activeFitAddon = null
let resizeObserver = null
let dataUnsubscribe = null
let exitUnsubscribe = null

const defaultAIs = [
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '🔗',
    hasSettings: true,
    config: { commandPath: '', extraArgs: [] }
  },
  {
    id: 'openclaude',
    name: 'OpenClaude',
    icon: '🤖',
    hasSettings: true,
    config: {
      useOpenAI: false,
      baseUrl: 'http://localhost:11434/v1',
      model: 'glm-4:cloud',
      apiKey: '',
      customEnvVars: ''
    }
  }
]

const availableAIs = ref(defaultAIs.map((ai) => ({ ...ai, config: { ...ai.config } })))

const sessionStatusText = computed(() => {
  const map = {
    idle: t('aiTerminal.statusIdle'),
    starting: t('aiTerminal.statusStarting'),
    running: t('aiTerminal.statusRunning'),
    exited: t('aiTerminal.statusExited'),
    missing: t('aiTerminal.statusMissing')
  }
  return map[sessionStatus.value] || sessionStatus.value
})

const binaryLabel = computed(() => {
  if (!resolvedBinary.value) return ''
  const parts = resolvedBinary.value.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || resolvedBinary.value
})

const workspaceLabel = computed(() => {
  if (!workspacePath.value) return ''
  const parts = workspacePath.value.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || workspacePath.value
})

const termTheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}

async function loadAIConfigs() {
  try {
    const settings = await window.retroStudio?.settings?.load?.()
    const stored = settings?.aiTerminal || {}
    availableAIs.value = availableAIs.value.map((ai) => {
      if (!stored[ai.id]) return ai
      return { ...ai, config: { ...ai.config, ...stored[ai.id] } }
    })
  } catch (e) {
    console.error('Erro ao carregar AI Terminal settings:', e)
  }
}

async function persistAIConfigs() {
  try {
    const configs = {}
    for (const ai of availableAIs.value) {
      configs[ai.id] = { ...(ai.config || {}) }
    }
    if (window.retroStudio?.settings?.savePartial) {
      await window.retroStudio.settings.savePartial({ aiTerminal: configs })
      return
    }
    const settings = await window.retroStudio.settings.load()
    settings.aiTerminal = configs
    await window.retroStudio.settings.save(settings)
  } catch (e) {
    console.error('Erro ao salvar AI Terminal settings:', e)
  }
}

function ensureListeners() {
  if (!dataUnsubscribe && window.retroStudio?.terminal?.onData) {
    dataUnsubscribe = window.retroStudio.terminal.onData((id, data) => {
      if (id === ptyId.value && activeXterm) activeXterm.write(data)
    })
  }
  if (!exitUnsubscribe && window.retroStudio?.terminal?.onExit) {
    exitUnsubscribe = window.retroStudio.terminal.onExit((id, code) => {
      if (id !== ptyId.value) return
      sessionStatus.value = 'exited'
      ptyId.value = null
      if (activeXterm) {
        activeXterm.writeln('')
        activeXterm.writeln(`\x1b[33m[${selectedAI.value?.name || 'AI'}] processo encerrado (code ${code ?? '?'})\x1b[0m`)
        activeXterm.writeln(`\x1b[90m${t('aiTerminal.pressRestart')}\x1b[0m`)
      }
    })
  }
}

function initXterm() {
  if (!terminalContainer.value) return

  if (activeXterm) {
    activeXterm.dispose()
    activeXterm = null
  }
  terminalContainer.value.innerHTML = ''

  const term = new Terminal({
    theme: termTheme,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 10000,
    allowProposedApi: true
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  term.onData((data) => {
    if (ptyId.value && window.retroStudio?.terminal?.write) {
      window.retroStudio.terminal.write(ptyId.value, data)
    }
  })

  term.attachCustomKeyEventHandler((e) => {
    const isCtrlShiftC = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C'
    const isCtrlShiftV = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V'
    if (isCtrlShiftC) {
      const sel = term.getSelection()
      if (sel) {
        navigator.clipboard.writeText(sel).catch(() => {})
        return false
      }
    }
    if (isCtrlShiftV) {
      navigator.clipboard.readText().then((text) => {
        if (ptyId.value) window.retroStudio.terminal.write(ptyId.value, text)
        else term.paste(text)
      }).catch(() => {})
      return false
    }
    return true
  })

  term.open(terminalContainer.value)
  fitAddon.fit()
  term.focus()
  activeXterm = term
  activeFitAddon = fitAddon

  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = new ResizeObserver(() => {
    if (!activeFitAddon || !activeXterm) return
    activeFitAddon.fit()
    if (ptyId.value) {
      window.retroStudio.terminal.resize(ptyId.value, activeXterm.cols, activeXterm.rows)
    }
  })
  resizeObserver.observe(terminalContainer.value)
}

async function destroyPty() {
  if (ptyId.value && window.retroStudio?.terminal?.destroy) {
    try {
      await window.retroStudio.terminal.destroy(ptyId.value)
    } catch (_) { /* ignore */ }
  }
  ptyId.value = null
}

async function resolveWorkspace() {
  try {
    workspacePath.value = (await window.retroStudio?.terminal?.getCwd?.()) || ''
  } catch (_) {
    workspacePath.value = ''
  }
  return workspacePath.value || undefined
}

async function resolveOpenCodeBinary() {
  const configured = selectedAI.value?.config?.commandPath?.trim()
  if (configured) {
    const res = await window.retroStudio?.which?.(configured)
    if (res?.found) return res.path
    // path absoluto informado mesmo se which falhar na string
    return configured
  }
  const res = await window.retroStudio?.which?.('opencode')
  if (res?.found) return res.path
  return null
}

async function startOpenCode() {
  ensureListeners()
  initXterm()
  await destroyPty()
  isStarting.value = true
  sessionStatus.value = 'starting'

  const cwd = await resolveWorkspace()
  const bin = await resolveOpenCodeBinary()
  resolvedBinary.value = bin || ''

  if (!bin) {
    sessionStatus.value = 'missing'
    activeXterm?.writeln(`\x1b[31m[OpenCode] ${t('aiTerminal.opencodeNotFound')}\x1b[0m`)
    activeXterm?.writeln(`\x1b[90m${t('aiTerminal.opencodeInstallHint')}\x1b[0m`)
    isStarting.value = false
    return
  }

  try {
    const cols = activeXterm?.cols || 80
    const rows = activeXterm?.rows || 24
    const args = []
    if (cwd) args.push(cwd)

    const id = await window.retroStudio.terminal.create({
      file: bin,
      args,
      cwd: cwd || undefined,
      cols,
      rows
    })
    ptyId.value = id
    sessionStatus.value = 'running'
    window.retroStudio.terminal.resize(id, cols, rows)
    activeXterm?.focus()
  } catch (e) {
    sessionStatus.value = 'exited'
    activeXterm?.writeln(`\x1b[31m[OpenCode] ${e?.message || e}\x1b[0m`)
  } finally {
    isStarting.value = false
  }
}

async function startOpenClaude() {
  ensureListeners()
  initXterm()
  await destroyPty()
  isStarting.value = true
  sessionStatus.value = 'starting'

  const cwd = await resolveWorkspace()
  const config = selectedAI.value?.config || {}
  let systemEnv = {}
  try {
    systemEnv = await window.retroStudio.getEnv()
  } catch (_) { /* ignore */ }

  const env = { ...systemEnv }
  if (config.useOpenAI) env.CLAUDE_CODE_USE_OPENAI = '1'
  if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl
  if (config.model) env.OPENAI_MODEL = config.model
  if (config.apiKey) env.OPENAI_API_KEY = config.apiKey
  if (config.customEnvVars) {
    config.customEnvVars.split('\n').forEach((line) => {
      const [key, ...rest] = line.split('=')
      if (key && rest.length) env[key.trim()] = rest.join('=').trim()
    })
  }

  const which = await window.retroStudio?.which?.('openclaude')
  resolvedBinary.value = which?.path || 'openclaude'
  if (!which?.found) {
    sessionStatus.value = 'missing'
    activeXterm?.writeln(`\x1b[31m[OpenClaude] ${t('aiTerminal.binaryNotFound', { name: 'openclaude' })}\x1b[0m`)
    isStarting.value = false
    return
  }

  try {
    const cols = activeXterm?.cols || 80
    const rows = activeXterm?.rows || 24
    const id = await window.retroStudio.terminal.create({
      file: which.path,
      args: [],
      cwd: cwd || undefined,
      cols,
      rows,
      env
    })
    ptyId.value = id
    sessionStatus.value = 'running'
    window.retroStudio.terminal.resize(id, cols, rows)
    activeXterm?.focus()
  } catch (e) {
    sessionStatus.value = 'exited'
    activeXterm?.writeln(`\x1b[31m[OpenClaude] ${e?.message || e}\x1b[0m`)
  } finally {
    isStarting.value = false
  }
}

async function startSelected() {
  if (!selectedAI.value) return
  if (selectedAI.value.id === 'opencode') return startOpenCode()
  if (selectedAI.value.id === 'openclaude') return startOpenClaude()
}

async function selectAI(ai) {
  selectedAI.value = ai
  await nextTick()
  await startSelected()
}

async function restartSession() {
  await startSelected()
}

function openSettings(ai) {
  editingAI.value = ai
  editingConfig.useOpenAI = ai.config?.useOpenAI ?? false
  editingConfig.baseUrl = ai.config?.baseUrl ?? ''
  editingConfig.model = ai.config?.model ?? ''
  editingConfig.apiKey = ai.config?.apiKey ?? ''
  editingConfig.customEnvVars = ai.config?.customEnvVars ?? ''
  editingConfig.commandPath = ai.config?.commandPath ?? ''
  showSettingsModal.value = true
}

function closeSettings() {
  showSettingsModal.value = false
  editingAI.value = null
}

async function saveSettings() {
  if (!editingAI.value) return
  const id = editingAI.value.id
  const idx = availableAIs.value.findIndex((a) => a.id === id)
  if (idx === -1) return

  if (id === 'opencode') {
    availableAIs.value[idx] = {
      ...availableAIs.value[idx],
      config: {
        ...availableAIs.value[idx].config,
        commandPath: editingConfig.commandPath.trim()
      }
    }
  } else {
    availableAIs.value[idx] = {
      ...availableAIs.value[idx],
      config: {
        useOpenAI: editingConfig.useOpenAI,
        baseUrl: editingConfig.baseUrl,
        model: editingConfig.model,
        apiKey: editingConfig.apiKey,
        customEnvVars: editingConfig.customEnvVars
      }
    }
  }

  if (selectedAI.value?.id === id) {
    selectedAI.value = availableAIs.value[idx]
  }
  await persistAIConfigs()
  closeSettings()
  await restartSession()
}

async function copyFromTerminal() {
  const sel = activeXterm?.getSelection()
  if (sel) await navigator.clipboard.writeText(sel).catch(() => {})
}

async function pasteToTerminal() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    if (ptyId.value) window.retroStudio.terminal.write(ptyId.value, text)
    else activeXterm?.paste(text)
  } catch (_) { /* ignore */ }
}

function showContextMenu(e) {
  contextMenuCleanup?.()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY }
  nextTick(() => {
    const close = () => {
      contextMenu.value.visible = false
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onEscape)
      contextMenuCleanup = null
    }
    const onEscape = (ev) => {
      if (ev.key === 'Escape') close()
    }
    document.addEventListener('click', close, { once: true })
    document.addEventListener('keydown', onEscape, { once: true })
    contextMenuCleanup = close
  })
}

async function ctxCopy() {
  contextMenuCleanup?.()
  contextMenu.value.visible = false
  await copyFromTerminal()
}

async function ctxPaste() {
  contextMenuCleanup?.()
  contextMenu.value.visible = false
  await pasteToTerminal()
}

function fitTerminal() {
  if (activeFitAddon && activeXterm) {
    activeFitAddon.fit()
    if (ptyId.value) {
      window.retroStudio.terminal.resize(ptyId.value, activeXterm.cols, activeXterm.rows)
    }
  }
}

onMounted(async () => {
  await loadAIConfigs()
  if (availableAIs.value.length > 0) {
    await selectAI(availableAIs.value[0])
  }
})

onUnmounted(async () => {
  contextMenuCleanup?.()
  if (resizeObserver) resizeObserver.disconnect()
  dataUnsubscribe?.()
  exitUnsubscribe?.()
  await destroyPty()
  if (activeXterm) {
    activeXterm.dispose()
    activeXterm = null
  }
})

defineExpose({ fit: fitTerminal, selectAI, restartSession })
</script>

<style scoped>
.ai-terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-left: 1px solid var(--border);
}

.ai-terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
  flex-shrink: 0;
}

.ai-terminal-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex: 1;
}

.ai-terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.ai-terminal-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.ai-terminal-tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.ai-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-settings-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}

.ai-terminal-tab:hover .ai-settings-btn,
.ai-terminal-tab.active .ai-settings-btn {
  opacity: 0.8;
}

.ai-terminal-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.ai-terminal-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
}

.ai-terminal-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.ai-terminal-action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ai-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
  font-size: 11px;
  flex-shrink: 0;
}

.ai-info-left,
.ai-info-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ai-info-status {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
}

.ai-info-status.running {
  color: #23d18b;
}

.ai-info-status.starting {
  color: #e5e510;
}

.ai-info-status.missing,
.ai-info-status.exited {
  color: #f14c4c;
}

.ai-model-badge {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
}

.ai-terminal-container {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

.ai-terminal-container :deep(.xterm) {
  height: 100%;
}

.terminal-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: none;
  border: none;
  color: var(--text);
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}

.ctx-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ctx-separator {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}

.ai-settings-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.ai-settings-modal {
  width: min(480px, 92vw);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.ai-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.ai-settings-header h3 {
  margin: 0;
  font-size: 14px;
}

.ai-settings-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
}

.ai-settings-content {
  padding: 16px;
  max-height: 60vh;
  overflow: auto;
}

.ai-settings-section h4 {
  margin: 0 0 6px;
  font-size: 13px;
}

.ai-settings-hint {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 12px;
}

.ai-setting-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.ai-setting-item label {
  font-size: 12px;
  color: var(--muted);
}

.ai-settings-input {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  padding: 6px 8px;
  font-size: 12px;
}

.ai-settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.ai-settings-cancel,
.ai-settings-save {
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.ai-settings-cancel {
  background: transparent;
  color: var(--muted);
}

.ai-settings-save {
  background: #0e639c;
  color: #fff;
}
</style>
