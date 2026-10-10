<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EditorTabs from './EditorTabs.vue'
import TerminalPanel from './Terminal.vue'
import ErrorPanel from './retro/ErrorPanel.vue'

const props = defineProps({
  activeTab: { type: Object, default: null },
  showCodeTabs: { type: Boolean, default: true },
  tabs: { type: Array, default: () => [] },
  activePath: { type: String, default: null },
  isTerminalOpen: { type: Boolean, default: false },
  terminalHeight: { type: Number, default: 250 },
  compilationErrors: { type: Array, default: () => [] },
  projectPath: { type: String, default: '' },
  lastError: { type: String, default: null },
  // #45: the bottom dock is shared by every mode. `mode` keeps one selected tab per
  // mode; `contextLabel` names the tab of the current mode ('' = this mode has none).
  mode: { type: String, default: 'code' },
  contextLabel: { type: String, default: '' },
  // Chosen tab of each mode; kept by the owner so it is stored with the project layout.
  dockTabs: { type: Object, default: () => ({}) }
})
const { t } = useI18n()
const terminalRef = ref(null)
const terminalActivated = ref(false)
const current = computed(() => {
  const wanted = props.dockTabs[props.mode] || 'terminal'
  return wanted === 'context' && !props.contextLabel ? 'terminal' : wanted
})
const dockTabs = computed(() => [
  { id: 'terminal', label: t('dock.terminal') },
  { id: 'problems', label: t('dock.problems'), count: props.compilationErrors.length },
  ...(props.contextLabel ? [{ id: 'context', label: props.contextLabel }] : [])
])
const emit = defineEmits([
  'update:activePath' , 'close-tab',
  'close-terminal', 'start-resize-terminal',
  'clear-compilation-errors', 'compilation-error-click',
  'open-dock', 'dock-context-active', 'update:dockTabs'
])
function select(id) { if (props.dockTabs[props.mode] !== id) emit('update:dockTabs', { ...props.dockTabs, [props.mode]: id }) }
// Arrow keys move between tabs, as in any tab list.
function onTabKey(event) {
  const ids = dockTabs.value.map(tab => tab.id), index = ids.indexOf(current.value)
  const next = event.key === 'ArrowRight' ? ids[(index + 1) % ids.length] : event.key === 'ArrowLeft' ? ids[(index + ids.length - 1) % ids.length] : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[ids.length - 1] : null
  if (!next) return
  event.preventDefault(); select(next)
  event.currentTarget.parentElement?.querySelector('#dock-tab-' + next)?.focus()
}
// The terminal (and its shell process) starts only when its tab is really shown.
watch(() => props.isTerminalOpen && current.value === 'terminal', shown => { if (shown) terminalActivated.value = true }, { immediate: true })
watch(() => props.isTerminalOpen && current.value === 'context', active => emit('dock-context-active', active), { immediate: true })
// New build ERRORS bring the list forward, as the old error panel did by appearing. Warnings
// and notes of a build that succeeded only show in the tab counter.
const errorCount = computed(() => props.compilationErrors.filter(item => (item?.severity || item?.type || 'error') === 'error').length)
watch(errorCount, (count, before) => { if (count > 0 && !before) { select('problems'); emit('open-dock') } })
defineExpose({ terminalRef, selectDockTab: select })
</script>

<template>
  <main class="main">
    <div v-if="lastError" class="emptyState" style="color: var(--danger); border-bottom: 1px solid var(--border);">
      {{ lastError }}
    </div>

    <EditorTabs
      v-show="showCodeTabs"
      :tabs="tabs"
      :active-path="activePath"
      @select="$emit('update:activePath', $event)"
      @close="$emit('close-tab', $event)"
    />

    <div class="editor-terminal-container" :style="{ '--terminal-height': isTerminalOpen ? terminalHeight + 'px' : '0px' }">
      <slot />
      <div v-if="isTerminalOpen" class="terminal-sash" @mousedown="$emit('start-resize-terminal')"></div>
      <section v-show="isTerminalOpen" class="bottom-dock" :style="{ height: terminalHeight + 'px' }" :aria-label="t('dock.title')">
        <div class="dock-tabs">
          <div role="tablist" :aria-label="t('dock.tabs')">
            <button v-for="tab in dockTabs" :id="'dock-tab-' + tab.id" :key="tab.id" type="button" role="tab"
              :aria-selected="current === tab.id" :aria-controls="'dock-panel-' + tab.id" :tabindex="current === tab.id ? 0 : -1"
              @click="select(tab.id)" @keydown="onTabKey">{{ tab.label }}<span v-if="tab.count" class="dock-count">{{ tab.count }}</span></button>
          </div>
          <button type="button" class="dock-close" :aria-label="t('dock.close')" :title="t('dock.close')" @click="$emit('close-terminal')">×</button>
        </div>
        <div v-show="current === 'terminal'" id="dock-panel-terminal" class="dock-panel" role="tabpanel" aria-labelledby="dock-tab-terminal">
          <TerminalPanel v-if="terminalActivated" ref="terminalRef" style="height: 100%" @close="$emit('close-terminal')" />
        </div>
        <div v-show="current === 'problems'" id="dock-panel-problems" class="dock-panel" role="tabpanel" aria-labelledby="dock-tab-problems">
          <p v-if="!compilationErrors.length" class="dock-empty" tabindex="0">{{ t('dock.noProblems') }}</p>
          <ErrorPanel v-else embedded :errors="compilationErrors" :project-path="projectPath"
            @close="$emit('clear-compilation-errors')" @error-click="$emit('compilation-error-click', $event)" />
        </div>
        <div v-show="current === 'context'" id="dock-panel-context" class="dock-panel" role="tabpanel" aria-labelledby="dock-tab-context">
          <slot name="dock-context" />
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.bottom-dock { display: flex; flex-direction: column; flex-shrink: 0; min-height: 0; background: var(--panel); border-top: 1px solid var(--border); }
.dock-tabs { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 6px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.dock-tabs [role="tablist"] { display: flex; gap: 2px; min-width: 0; overflow-x: auto; }
.dock-tabs button { padding: 5px 9px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dock-tabs button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.dock-tabs button:hover { color: var(--text); }
.dock-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.dock-count { margin-left: 6px; padding: 0 5px; border-radius: 8px; background: var(--danger, #c0564a); color: #fff; font-size: 10px; }
.dock-panel { flex: 1; min-height: 0; overflow: auto; }
.dock-empty { margin: 0; padding: 12px; color: var(--muted); font-size: 12px; }
</style>
