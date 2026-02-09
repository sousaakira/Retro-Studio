<template>
  <div
    class="terminal-container"
    ref="terminalRef"
    @contextmenu.prevent="showContextMenu"
  >
    <div
      v-if="contextMenu.visible"
      class="terminal-context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <button
        type="button"
        class="context-menu-item"
        :disabled="!contextMenu.hasSelection"
        @click="copySelection"
      >
        <i class="fas fa-copy"></i> Copiar
      </button>
      <button
        type="button"
        class="context-menu-item"
        @click="pasteFromClipboard"
      >
        <i class="fas fa-paste"></i> Colar
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps({
  cwd: {
    type: String,
    default: null
  }
});

const terminalRef = ref(null);
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  hasSelection: false
});
let term = null;
let fitAddon = null;

const copySelection = async () => {
  if (!term) return;
  const text = term.getSelection?.() ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('Clipboard write failed:', e);
  }
  contextMenu.value.visible = false;
};

const pasteFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && window.ipc) window.ipc.send('terminal-write', text);
  } catch (e) {
    console.warn('Clipboard read failed:', e);
  }
  contextMenu.value.visible = false;
};

const showContextMenu = (e) => {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    hasSelection: term?.hasSelection?.() ?? false
  };
};

const closeContextMenu = () => {
  contextMenu.value.visible = false;
};

const initTerminal = () => {
  if (!terminalRef.value) return;

  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#121212',
      foreground: '#cccccc',
      cursor: '#00ff00'
    },
    fontSize: 13,
    fontFamily: 'Consolas, "Courier New", monospace'
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(terminalRef.value);

  // Ctrl+C / Cmd+C: com seleção copia; sem seleção envia para o processo
  // Ctrl+V / Cmd+V: cola do clipboard
  term.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') {
        if (term?.hasSelection?.()) {
          const text = term.getSelection?.() ?? '';
          if (text) {
            navigator.clipboard.writeText(text).catch(() => {});
            return false;
          }
        }
      }
      if (e.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text && window.ipc) window.ipc.send('terminal-write', text);
        }).catch(() => {});
        return false;
      }
    }
    return true;
  });

  setTimeout(() => {
    if (fitAddon) fitAddon.fit();
  }, 100);

  window.ipc.send('terminal-spawn', { cwd: props.cwd });

  term.onData(data => {
    window.ipc.send('terminal-write', data);
  });

  const onIncomingData = (data) => {
    if (term) term.write(data);
  };

  window.ipc.on('terminal-incoming-data', onIncomingData);
  window.addEventListener('resize', handleResize);
  document.addEventListener('click', closeContextMenu);
};

const handleResize = () => {
  if (fitAddon && term) {
    try {
        fitAddon.fit();
        const { cols, rows } = term;
        window.ipc.send('terminal-resize', { cols, rows });
    } catch (e) {
        console.warn('Erro ao redimensionar terminal:', e);
    }
  }
};

onMounted(() => {
  initTerminal();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('click', closeContextMenu);
  if (term) {
    term.dispose();
    term = null;
  }
});

watch(() => props.cwd, (newCwd) => {
  window.ipc.send('terminal-spawn', { cwd: newCwd });
});
</script>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: #121212;
  overflow: hidden;
  position: relative;
}

:deep(.xterm-viewport) {
  background-color: #121212 !important;
}

.terminal-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  padding: 4px 0;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: #cccccc;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.context-menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.context-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
