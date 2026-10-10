<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
// #45: Alt+1…5 (Ctrl+1…5 on macOS) switch modes.
const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
const hint = (label, digit) => `${label} (${mac ? 'Ctrl' : 'Alt'}+${digit})`
const keys = digit => `${mac ? 'Control' : 'Alt'}+${digit}`
defineProps({ projectName: String, editorMode: { type: String, default: 'code' }, retro: Boolean, building: Boolean, playing: Boolean, packaging: Boolean, progress: String, sidebarVisible: Boolean, terminalVisible: Boolean, aiVisible: Boolean })
defineEmits(['code','maps','scenes','characters','run','resources','build','play','stop','sidebar','terminal','ai','reset'])
</script>
<template>
  <nav class="workspace-toolbar" :aria-label="t('workspaceLayout.title')">
    <span class="workspace-name" :title="projectName">{{ projectName }}</span>
    <div class="workspace-tools">
      <button type="button" :aria-pressed="editorMode === 'code'" :title="hint(t('workspaceLayout.code'), 1)" :aria-keyshortcuts="keys(1)" @click="$emit('code')"><span class="icon-folder-tree" aria-hidden="true"></span>{{ t('workspaceLayout.code') }}</button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'maps'" :title="hint(t('workspaceLayout.maps'), 2)" :aria-keyshortcuts="keys(2)" @click="$emit('maps')"><span class="icon-grid-2" aria-hidden="true"></span>{{ t('workspaceLayout.maps') }}</button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'characters'" :title="hint(t('workspaceLayout.characters'), 3)" :aria-keyshortcuts="keys(3)" @click="$emit('characters')"><span class="icon-user" aria-hidden="true"></span>{{ t('workspaceLayout.characters') }}</button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'scenes'" :title="hint(t('workspaceLayout.scenes'), 4)" :aria-keyshortcuts="keys(4)" @click="$emit('scenes')"><span class="icon-list-check" aria-hidden="true"></span>{{ t('workspaceLayout.scenes') }}</button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'run'" :title="hint(t('workspaceLayout.run'), 5)" :aria-keyshortcuts="keys(5)" @click="$emit('run')"><span class="icon-microchip" aria-hidden="true"></span>{{ t('workspaceLayout.run') }}</button>
      <button type="button" :disabled="!retro" @click="$emit('resources')"><span class="icon-image" aria-hidden="true"></span>{{ t('workspaceLayout.resources') }}</button>
    </div>
    <div class="workspace-tools workspace-build">
      <span v-if="building || playing || packaging" class="workspace-progress" role="status" :title="progress">{{ progress || t('workspaceLayout.working') }}</span>
      <button type="button" :disabled="!retro || building || playing || packaging" @click="$emit('build')"><span class="icon-hammer" aria-hidden="true"></span>{{ t('workspaceLayout.build') }}</button>
      <button type="button" :disabled="!retro || building || playing || packaging" @click="$emit('play')"><span class="icon-play" aria-hidden="true"></span>{{ t('workspaceLayout.play') }}</button>
      <button type="button" :disabled="!retro || packaging" @click="$emit('stop')"><span class="icon-stop" aria-hidden="true"></span>{{ t('workspaceLayout.stop') }}</button>
    </div>
    <div class="workspace-tools workspace-docks">
      <button type="button" :aria-pressed="sidebarVisible" @click="$emit('sidebar')"><span class="icon-folder-tree" aria-hidden="true"></span>{{ t('workspaceLayout.sidebar') }}</button>
      <button type="button" :aria-pressed="terminalVisible" @click="$emit('terminal')"><span class="icon-terminal" aria-hidden="true"></span>{{ t('workspaceLayout.terminal') }}</button>
      <button type="button" :aria-pressed="aiVisible" @click="$emit('ai')"><span class="icon-terminal-ai" aria-hidden="true"></span>{{ t('workspaceLayout.ai') }}</button>
      <!-- Ícone próprio: as setas circulares são do botão de atualizações, na barra de título. -->
      <button type="button" :title="t('workspaceLayout.reset')" :aria-label="t('workspaceLayout.reset')" @click="$emit('reset')"><span class="icon-window-restore" aria-hidden="true"></span></button>
    </div>
  </nav>
</template>
<style scoped>
.workspace-toolbar { display:flex; align-items:center; flex-shrink:0; gap:10px; padding:5px 10px; background:var(--panel); color:var(--text); border-bottom:1px solid var(--border); overflow-x:auto; }
.workspace-name { max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:600; flex-shrink:0; }
.workspace-progress { max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--text); }
.workspace-tools { display:flex; align-items:center; gap:3px; flex-shrink:0; }.workspace-build { margin-left:auto; padding-left:10px; border-left:1px solid var(--border); }.workspace-docks { padding-left:10px; border-left:1px solid var(--border); }
button { display:flex; align-items:center; gap:6px; padding:5px 7px; border:1px solid transparent; border-radius:3px; background:transparent; color:var(--muted); font:inherit; font-size:12px; white-space:nowrap; cursor:pointer; }
button:hover:not(:disabled),button[aria-pressed="true"] { color:var(--text); background:var(--panel-2); border-color:var(--border); } button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }button:disabled { opacity:.45; cursor:default; }button span { font-size:14px; }
</style>
