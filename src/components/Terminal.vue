<template>
  <div class="terminal-panel">
    <div class="terminal-header">
      <div class="terminal-tabs">
        <div 
          v-for="(term, index) in terminals" 
          :key="term.id"
          class="terminal-tab"
          :class="{ active: term.id === activeTerminalId }"
          @click="selectTerminal(term.id)"
        >
          <span class="icon-terminal"></span>
          <span class="terminal-tab-name">Terminal {{ index + 1 }}</span>
          <button class="terminal-tab-close" @click.stop="closeTerminal(term.id)">×</button>
        </div>
        <button class="terminal-add-btn" @click="createTerminal" title="Novo Terminal">
          <span class="icon-plus"></span>
        </button>
      </div>
      <div class="terminal-actions">
        <button class="terminal-action-btn" @click="copyFromTerminal" title="Copiar (Ctrl+Shift+C)">
          <span class="icon-copy"></span>
        </button>
        <button class="terminal-action-btn" @click="pasteToTerminal" title="Colar (Ctrl+Shift+V)">
          <span class="icon-paste"></span>
        </button>
        <button class="terminal-action-btn" @click="clearTerminal" title="Limpar">
          <span class="icon-trash"></span>
        </button>
        <button class="terminal-action-btn" @click="$emit('close')" title="Fechar Painel">
          <span class="icon-xmark"></span>
        </button>
      </div>
    </div>
    <div ref="terminalContainer" class="terminal-container" @contextmenu.prevent="showContextMenu"></div>
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="terminal-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="ctxCopy">
          <span class="icon-copy"></span> Copiar
        </button>
        <button class="ctx-item" @click="ctxPaste">
          <span class="icon-paste"></span> Colar
        </button>
        <div class="ctx-separator"></div>
        <button class="ctx-item" @click="ctxClear">
          <span class="icon-trash"></span> Limpar
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

const emit = defineEmits(['close'])

const terminalContainer = ref(null)
const terminals = ref([])
const activeTerminalId = ref(null)
const contextMenu = ref({ visible: false, x: 0, y: 0 })
let contextMenuCleanup = null

let activeXterm = null
let activeFitAddon = null
let resizeObserver = null
let dataUnsubscribe = null
let exitUnsubscribe = null

// Buffer to catch retro data sent before xterm mounts
const preMountBuffer = []

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

async function createTerminal() {
  if (!window.retroStudio?.terminal) {
    console.error('Terminal API not available')
    return
  }

  try {
    const cwd = await window.retroStudio.terminal.getCwd()
    const terminalId = await window.retroStudio.terminal.create({
      cwd,
      cols: 80,
      rows: 24
    })

    const term = {
      id: terminalId,
      xterm: null,
      fitAddon: null
    }

    // Criar instância xterm
    term.xterm = new Terminal({
      theme: termTheme,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true
    })

    // Addons
    term.fitAddon = new FitAddon()
    term.xterm.loadAddon(term.fitAddon)
    term.xterm.loadAddon(new WebLinksAddon())

    // Enviar input para o PTY
    term.xterm.onData((data) => {
      window.retroStudio.terminal.write(terminalId, data)
    })

    // Copy/Paste: Ctrl+Shift+C e Ctrl+Shift+V
    term.xterm.attachCustomKeyEventHandler((e) => {
      const isCtrlShiftC = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C'
      const isCtrlShiftV = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V'
      if (isCtrlShiftC) {
        const sel = term.xterm.getSelection()
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {})
          return false
        }
      }
      if (isCtrlShiftV) {
        navigator.clipboard.readText().then((text) => {
          term.xterm.paste(text)
        }).catch(() => {})
        return false
      }
      return true
    })

    terminals.value.push(term)
    activeTerminalId.value = terminalId

    await nextTick()
    mountTerminal(term)

  } catch (e) {
    console.error('Failed to create terminal:', e)
  }
}

function mountTerminal(term) {
  if (!terminalContainer.value) return

  // Limpar container
  terminalContainer.value.innerHTML = ''

  // Montar terminal
  term.xterm.open(terminalContainer.value)
  term.fitAddon.fit()
  term.xterm.focus()

  activeXterm = term.xterm
  activeFitAddon = term.fitAddon

  // Atualizar dimensões no PTY
  const { cols, rows } = term.xterm
  window.retroStudio.terminal.resize(term.id, cols, rows)
  
  // Flush pre-mount buffer
  if (preMountBuffer.length > 0) {
    const data = preMountBuffer.join('')
    term.xterm.write(data)
    preMountBuffer.length = 0
  }
}

function selectTerminal(terminalId) {
  if (activeTerminalId.value === terminalId) return

  activeTerminalId.value = terminalId
  const term = terminals.value.find(t => t.id === terminalId)
  if (term) {
    nextTick(() => {
      mountTerminal(term)
    })
  }
}

function closeTerminal(terminalId) {
  const index = terminals.value.findIndex(t => t.id === terminalId)
  if (index === -1) return

  const term = terminals.value[index]
  
  // Destruir xterm
  if (term.xterm) {
    term.xterm.dispose()
  }
  
  // Destruir PTY
  window.retroStudio.terminal.destroy(terminalId)

  terminals.value.splice(index, 1)

  // Se era o terminal ativo, selecionar outro
  if (activeTerminalId.value === terminalId) {
    if (terminals.value.length > 0) {
      const nextIndex = Math.min(index, terminals.value.length - 1)
      selectTerminal(terminals.value[nextIndex].id)
    } else {
      activeTerminalId.value = null
      activeXterm = null
      activeFitAddon = null
      if (terminalContainer.value) {
        terminalContainer.value.innerHTML = ''
      }
    }
  }
}

function clearTerminal() {
  if (activeXterm) {
    activeXterm.clear()
  }
}

async function copyFromTerminal() {
  if (!activeXterm) return
  const sel = activeXterm.getSelection()
  if (sel) {
    try {
      await navigator.clipboard.writeText(sel)
    } catch (_) {}
  }
}

async function pasteToTerminal() {
  if (!activeXterm || !activeTerminalId.value) return
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      activeXterm.paste(text)
    }
  } catch (_) {}
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

function ctxClear() {
  contextMenuCleanup?.()
  contextMenu.value.visible = false
  clearTerminal()
}

function writeRetroData(data) {
  if (activeXterm) {
    activeXterm.write(data)
  } else {
    preMountBuffer.push(data)
  }
}

function fitTerminal() {
  if (activeFitAddon && activeXterm) {
    activeFitAddon.fit()
    const { cols, rows } = activeXterm
    if (activeTerminalId.value) {
      window.retroStudio.terminal.resize(activeTerminalId.value, cols, rows)
    }
  }
}

function handleTerminalData(terminalId, data) {
  const term = terminals.value.find(t => t.id === terminalId)
  if (term && term.xterm) {
    term.xterm.write(data)
  }
}

function handleTerminalExit(terminalId, exitCode) {
  console.log(`Terminal ${terminalId} exited with code ${exitCode}`)
  // Opcional: fechar a aba automaticamente ou mostrar mensagem
}

onMounted(async () => {
  // Criar terminal inicial
  await createTerminal()

  // Observer para redimensionamento
  if (terminalContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    resizeObserver.observe(terminalContainer.value)
  }

  // Listeners de dados do terminal
  if (window.retroStudio?.terminal) {
    dataUnsubscribe = window.retroStudio.terminal.onData(handleTerminalData)
    exitUnsubscribe = window.retroStudio.terminal.onExit(handleTerminalExit)
  }
})

onUnmounted(() => {
  // Limpar observer
  if (resizeObserver) {
    resizeObserver.disconnect()
  }

  // Remover listeners
  if (dataUnsubscribe) {
    dataUnsubscribe()
  }
  if (exitUnsubscribe) {
    exitUnsubscribe()
  }

  // Destruir todos os terminais
  terminals.value.forEach(term => {
    if (term.xterm) {
      term.xterm.dispose()
    }
    window.retroStudio?.terminal?.destroy(term.id)
  })
})

// Expor método para redimensionar externamente
defineExpose({
  fit: fitTerminal,
  createTerminal,
  writeRetroData
})
</script>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-top: 1px solid var(--border);
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
  flex-shrink: 0;
}

.terminal-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex: 1;
}

.terminal-tab {
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
  transition: all 0.1s ease;
}

.terminal-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.terminal-tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.terminal-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-tab-close {
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.terminal-tab:hover .terminal-tab-close {
  opacity: 1;
}

.terminal-tab-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.terminal-add-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.terminal-add-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.terminal-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.terminal-action-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.terminal-action-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.terminal-container {
  flex: 1;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
}

/* Ajustes para xterm */
.terminal-container :deep(.xterm) {
  height: 100%;
}

.terminal-container :deep(.xterm-viewport) {
  /* Scrollbar estilo VS Code */
  scrollbar-width: thin;
  scrollbar-color: rgba(121, 121, 121, 0.4) transparent;
}

.terminal-container :deep(.xterm-viewport::-webkit-scrollbar) {
  width: 10px;
}

.terminal-container :deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}

.terminal-container :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background: rgba(121, 121, 121, 0.4);
  border-radius: 5px;
}

.terminal-container :deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background: rgba(121, 121, 121, 0.6);
}

/* Context menu */
.terminal-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  padding: 4px 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.ctx-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ctx-item .icon-copy,
.ctx-item .icon-paste,
.ctx-item .icon-trash {
  width: 14px;
  height: 14px;
}

.ctx-separator {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}
</style>
