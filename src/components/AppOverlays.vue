<!--
  AppOverlays - Componentes flutuantes/overlay da aplicação.
  
  Inclui:
  - ColorPalette: Seletor de cores (eyedropper)
  - Toast: Sistema de notificações
  - CommandPalette: Paleta de comandos (Ctrl+Shift+P)
  - CtrlKWidget: Edição inline com IA (Ctrl+K)
  
  PROPS: Estados de visibilidade e dados para cada overlay.
  EVENTS: Ações do usuário (close, execute, etc.)
-->
<script setup>
import { ref } from 'vue'
import ColorPalette from './ColorPalette.vue'
import Toast from './Toast.vue'
import CommandPalette from './CommandPalette.vue'
import CtrlKWidget from './CtrlKWidget.vue'

defineProps({
  showColorPalette: Boolean,
  showCommandPalette: Boolean,
  commandPaletteCommands: { type: Array, default: () => [] },
  showCtrlKPopup: Boolean,
  ctrlKInput: { type: String, default: '' },
  ctrlKLoading: Boolean,
  ctrlKShowPreview: Boolean,
  ctrlKInlineMode: Boolean,
  ctrlKWidgetPosition: { type: Object, default: () => ({ top: 0, left: 0 }) },
  ctrlKSuggestions: { type: Array, default: () => [] },
  ctrlKSelectedText: { type: String, default: '' },
  ctrlKPreviewCode: { type: String, default: '' }
})
const colorPaletteRef = ref(null)
const ctrlKWidgetRef = ref(null)
defineExpose({ colorPaletteRef, ctrlKWidgetRef })

defineEmits([
  'toggle-color-palette', 'color-picked',
  'command-palette-close', 'command-palette-execute',
  'ctrlk-update-input', 'ctrlk-submit', 'ctrlk-cancel', 'ctrlk-accept', 'ctrlk-reject', 'ctrlk-use-suggestion'
])
</script>

<template>
  <ColorPalette
    ref="colorPaletteRef"
    :is-open="showColorPalette"
    @close="$emit('toggle-color-palette')"
    @color-picked="$emit('color-picked', $event)"
  />
  <Toast />
  <CommandPalette
    :is-open="showCommandPalette"
    :commands="commandPaletteCommands"
    @close="$emit('command-palette-close')"
    @execute="$emit('command-palette-execute', $event)"
  />
  <CtrlKWidget
    ref="ctrlKWidgetRef"
    :is-open="showCtrlKPopup"
    :input="ctrlKInput"
    :loading="ctrlKLoading"
    :show-preview="ctrlKShowPreview"
    :inline-mode="ctrlKInlineMode"
    :widget-position="ctrlKWidgetPosition"
    :suggestions="ctrlKSuggestions"
    :selected-text="ctrlKSelectedText"
    :preview-code="ctrlKPreviewCode"
    @update:input="$emit('ctrlk-update-input', $event)"
    @submit="$emit('ctrlk-submit')"
    @cancel="$emit('ctrlk-cancel')"
    @accept="$emit('ctrlk-accept')"
    @reject="$emit('ctrlk-reject')"
    @use-suggestion="$emit('ctrlk-use-suggestion', $event)"
  />
</template>
