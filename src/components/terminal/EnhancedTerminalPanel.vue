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
        <i class="fas fa-copy"></i> Copy
      </button>
      <button
        type="button"
        class="context-menu-item"
        @click="pasteFromClipboard"
      >
        <i class="fas fa-paste"></i> Paste
      </button>
      <div class="context-menu-separator"></div>
      <button
        type="button"
        class="context-menu-item"
        @click="selectAll"
      >
        <i class="fas fa-select-all"></i> Select All
      </button>
      <button
        type="button"
        class="context-menu-item"
        @click="clearTerminal"
      >
        <i class="fas fa-eraser"></i> Clear
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
  terminalId: {
    type: String,
    default: 'default'
  },
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

// Methods
const copySelection = async () => {
  if (!term) return;
  const text = term.getSelection() || '';
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
    if (text && window.ipc) {
      window.ipc.send('terminal-write', text);
    }
  } catch (e) {
    console.warn('Clipboard read failed:', e);
  }
  contextMenu.value.visible = false;
};

const selectAll = () => {
  if (term) {
    term.selectAll();
  }
  contextMenu.value.visible = false;
};

const clearTerminal = () => {
  if (term) {
    term.clear();
  }
  contextMenu.value.visible = false;
};

const showContextMenu = (e) => {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    hasSelection: term?.hasSelection() || false
  };
};

const closeContextMenu = () => {
  contextMenu.value.visible = false;
};

const initTerminal = () => {
  if (!terminalRef.value) return;

  // Create terminal with dark theme
  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#cccccc'
    },
    fontSize: 13,
    fontFamily: 'Consolas, "Courier New", monospace',
    scrollback: 1000
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(terminalRef.value);

  // Fit terminal to container
  setTimeout(() => {
    if (fitAddon) fitAddon.fit();
    if (term) term.focus();
  }, 100);

  // Spawn terminal in backend
  window.ipc.send('terminal-spawn', {
    terminalId: props.terminalId,
    cwd: props.cwd
  });

  // Handle data from terminal - send to backend
  term.onData((data) => {
    window.ipc.send('terminal-write', data);
  });
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

// Lifecycle
onMounted(() => {
  initTerminal();
  window.addEventListener('resize', handleResize);
  document.addEventListener('click', closeContextMenu);
  
  // Listen for data from backend
  window.ipc.on('terminal-incoming-data', (data) => {
    if (term && data) {
      term.write(data);
    }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('click', closeContextMenu);
  
  // Cleanup terminal
  if (term) {
    term.dispose();
    term = null;
  }
  
  // Cleanup backend terminal
  window.ipc.send('terminal-cleanup');
});
</script>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  overflow: hidden;
  position: relative;
}

:deep(.xterm-viewport) {
  background-color: #1e1e1e !important;
}

.terminal-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
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

.context-menu-separator {
  height: 1px;
  background: #454545;
  margin: 4px 0;
}
</style>
