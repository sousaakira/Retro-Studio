<template>
  <div class="terminal-container" ref="terminalRef"></div>
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
let term = null;
let fitAddon = null;

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
  
  // Timeout para garantir que o DOM foi renderizado antes do fit
  setTimeout(() => {
    if (fitAddon) fitAddon.fit();
  }, 100);

  // Iniciar PTY no backend
  window.ipc.send('terminal-spawn', { cwd: props.cwd });

  term.onData(data => {
    window.ipc.send('terminal-write', data);
  });

  const onIncomingData = (data) => {
    if (term) term.write(data);
  };

  window.ipc.on('terminal-incoming-data', onIncomingData);

  window.addEventListener('resize', handleResize);
  
  // Limpar listener do IPC ao desmontar (gerenciado internamente pelo preload.js simplificado?)
  // No preload.js fornecido, window.ipc.on não retorna um unsubscriber facilmente, 
  // mas vamos assumir que precisamos limpar se possível.
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
}

:deep(.xterm-viewport) {
    background-color: #121212 !important;
}
</style>
