<template>
  <div class="statusbar">
    <div class="status-left">
      <span v-if="fileName">{{ fileName }}</span>
      <span v-else>Nenhum arquivo</span>
      
      <!-- Cor capturada -->
      <div 
        v-if="pickedColor" 
        class="picked-color-display" 
        @click="$emit('copyColor', pickedColor)" 
        :title="'Clique para copiar: ' + pickedColor"
      >
        <div class="picked-color-swatch" :style="{ backgroundColor: pickedColor }"></div>
        <span>{{ pickedColor }}</span>
        <button class="picked-color-close" @click.stop="$emit('clearPickedColor')">×</button>
      </div>
    </div>
    
    <div class="status-right">
      <!-- Indicador de Autocomplete IA -->
      <button 
        class="statusbar-btn" 
        :class="{ 'autocomplete-active': autocompleteEnabled, 'autocomplete-loading': autocompleteLoading }"
        @click="$emit('toggleAutocomplete')" 
        :title="autocompleteEnabled ? 'AI Autocomplete: Ativo (clique para desativar)' : 'AI Autocomplete: Desativado (clique para ativar)'"
      >
        <span v-if="autocompleteLoading" class="spinner-icon"></span>
        <span v-else class="icon-wand-magic-sparkles"></span>
        <span>{{ autocompleteEnabled ? 'AI' : 'AI Off' }}</span>
      </button>
      
      <button 
        class="statusbar-btn" 
        @click="$emit('activateEyedropper')" 
        title="Capturar cor (clique e depois clique em qualquer lugar)"
      >
        <span class="icon-palette"></span> Capturar Cor
      </button>
      <button 
        class="statusbar-btn" 
        @click="$emit('toggleColorPalette')" 
        title="Histórico de cores"
      >
        Histórico
      </button>
      <span v-if="language">{{ language }}</span>
      <span v-if="lineCol">Ln {{ lineCol.line }}, Col {{ lineCol.col }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  fileName: {
    type: String,
    default: ''
  },
  language: {
    type: String,
    default: ''
  },
  lineCol: {
    type: Object,
    default: () => ({ line: 1, col: 1 })
  },
  pickedColor: {
    type: String,
    default: null
  },
  autocompleteEnabled: {
    type: Boolean,
    default: true
  },
  autocompleteLoading: {
    type: Boolean,
    default: false
  }
})

defineEmits(['activateEyedropper', 'toggleColorPalette', 'copyColor', 'clearPickedColor', 'toggleAutocomplete'])
</script>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 10px;
  background: var(--statusbar-bg, var(--monaco-statusbar-bg, #007acc));
  color: var(--statusbar-fg, var(--monaco-statusbar-fg, #fff));
  font-size: 12px;
  flex-shrink: 0;
}

.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.statusbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.statusbar-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.picked-color-display {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.picked-color-display:hover {
  background: rgba(255, 255, 255, 0.2);
}

.picked-color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.picked-color-close {
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
  font-size: 12px;
  line-height: 1;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.picked-color-close:hover {
  background: rgba(255, 255, 255, 0.35);
}

/* Autocomplete button states */
.autocomplete-active {
  background: rgba(100, 255, 150, 0.2) !important;
}

.autocomplete-active:hover {
  background: rgba(100, 255, 150, 0.3) !important;
}

.autocomplete-loading {
  background: rgba(255, 200, 100, 0.2) !important;
}

.spinner-icon {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
