<script setup>
import { ref } from 'vue'
import EditorTabs from './EditorTabs.vue'
import TerminalPanel from './Terminal.vue'
import StatusBar from './StatusBar.vue'
import ErrorPanel from './retro/ErrorPanel.vue'

defineProps({
  activeTab: { type: Object, default: null },
  tabs: { type: Array, default: () => [] },
  activePath: { type: String, default: null },
  isTerminalOpen: { type: Boolean, default: false },
  terminalHeight: { type: Number, default: 250 },
  compilationErrors: { type: Array, default: () => [] },
  projectPath: { type: String, default: '' },
  statusLineCol: { type: Object, default: () => ({ line: 1, col: 1 }) },
  pickedColor: { type: String, default: null },
  autocompleteEnabled: { type: Boolean, default: false },
  autocompleteLoading: { type: Boolean, default: false },
  lastError: { type: String, default: null }
})
const terminalRef = ref(null)
defineExpose({ terminalRef })

defineEmits([
  'update:activePath' , 'close-tab',
  'close-terminal', 'start-resize-terminal',
  'clear-compilation-errors', 'compilation-error-click',
  'activate-eyedropper', 'toggle-color-palette', 'copy-color', 'clear-picked-color', 'toggle-autocomplete'
])
</script>

<template>
  <main class="main">
    <div v-if="lastError" class="emptyState" style="color: var(--danger); border-bottom: 1px solid var(--border);">
      {{ lastError }}
    </div>

    <EditorTabs
      :tabs="tabs"
      :active-path="activePath"
      @select="$emit('update:activePath', $event)"
      @close="$emit('close-tab', $event)"
    />

    <div class="editor-terminal-container" :style="{ '--terminal-height': isTerminalOpen ? terminalHeight + 'px' : '0px' }">
      <slot />
      <div v-if="isTerminalOpen" class="terminal-sash" @mousedown="$emit('start-resize-terminal')"></div>
      <TerminalPanel
        v-if="isTerminalOpen"
        ref="terminalRef"
        :style="{ height: terminalHeight + 'px' }"
        @close="$emit('close-terminal')"
      />
    </div>

    <ErrorPanel
      v-if="compilationErrors.length > 0"
      :errors="compilationErrors"
      :project-path="projectPath"
      @close="$emit('clear-compilation-errors')"
      @error-click="$emit('compilation-error-click', $event)"
    />

    <StatusBar
      :file-name="activeTab?.name || ''"
      :language="activeTab?.language || ''"
      :line-col="statusLineCol"
      :picked-color="pickedColor"
      :autocomplete-enabled="autocompleteEnabled"
      :autocomplete-loading="autocompleteLoading"
      @activate-eyedropper="$emit('activate-eyedropper')"
      @toggle-color-palette="$emit('toggle-color-palette')"
      @copy-color="$emit('copy-color', $event)"
      @clear-picked-color="$emit('clear-picked-color')"
      @toggle-autocomplete="$emit('toggle-autocomplete')"
    />
  </main>
</template>
