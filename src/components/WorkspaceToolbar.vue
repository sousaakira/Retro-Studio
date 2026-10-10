<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
// #45: Alt+1…5 (Ctrl+1…5 on macOS) switch modes.
// #67: lives inside the title bar (one bar for the whole IDE). Every action has one
// place and every icon one meaning; labels give way to icons as the window narrows.
const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
const hint = (label, digit) => `${label} (${mac ? 'Ctrl' : 'Alt'}+${digit})`
const keys = digit => `${mac ? 'Control' : 'Alt'}+${digit}`
defineProps({ projectName: String, editorMode: { type: String, default: 'code' }, retro: Boolean, building: Boolean, playing: Boolean, packaging: Boolean, progress: String, sidebarVisible: Boolean, terminalVisible: Boolean, aiVisible: Boolean })
defineEmits(['code','maps','scenes','characters','run','resources','build','play','stop','sidebar','terminal','ai','reset'])
</script>
<template>
  <nav class="workspace-toolbar" :aria-label="t('workspaceLayout.title')">
    <span class="workspace-name" :title="projectName">{{ projectName }}</span>
    <div class="workspace-tools workspace-modes">
      <button type="button" :aria-pressed="editorMode === 'code'" :title="hint(t('workspaceLayout.code'), 1)" :aria-keyshortcuts="keys(1)" @click="$emit('code')"><span class="icon-code" aria-hidden="true"></span><span class="label">{{ t('workspaceLayout.code') }}</span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'maps'" :title="hint(t('workspaceLayout.maps'), 2)" :aria-keyshortcuts="keys(2)" @click="$emit('maps')"><span class="icon-grid-2" aria-hidden="true"></span><span class="label">{{ t('workspaceLayout.maps') }}</span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'characters'" :title="hint(t('workspaceLayout.characters'), 3)" :aria-keyshortcuts="keys(3)" @click="$emit('characters')">
        <!-- Personagem em quadro de animação: o boneco simples é da conta. -->
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><path d="M12 8v7M7.5 11l4.5-2 4.5 2M12 15l-3.5 5M12 15l3.5 5"/></svg><span class="label">{{ t('workspaceLayout.characters') }}</span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'scenes'" :title="hint(t('workspaceLayout.scenes'), 4)" :aria-keyshortcuts="keys(4)" @click="$emit('scenes')"><span class="icon-list-check" aria-hidden="true"></span><span class="label">{{ t('workspaceLayout.scenes') }}</span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'run'" :title="hint(t('workspaceLayout.run'), 5)" :aria-keyshortcuts="keys(5)" @click="$emit('run')">
        <!-- Controle de jogo: o chip é do gravador de cartucho. -->
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14 15h-4l-.7.6A3.5 3.5 0 0 1 3 13.500V12a4 4 0 0 1 4-4z"/><path d="M7.5 10.800v3M6 12.300h3"/><circle cx="16.5" cy="12.3" r=".9" fill="currentColor" stroke="none"/></svg><span class="label">{{ t('workspaceLayout.run') }}</span></button>
      <button type="button" :disabled="!retro" :title="t('workspaceLayout.resources')" @click="$emit('resources')"><span class="icon-image" aria-hidden="true"></span><span class="label">{{ t('workspaceLayout.resources') }}</span></button>
    </div>
    <div class="workspace-tools workspace-build">
      <span v-if="building || playing || packaging" class="workspace-progress" role="status" :title="progress">{{ progress || t('workspaceLayout.working') }}</span>
      <button type="button" class="build" :disabled="!retro || building || playing || packaging" :title="t('workspaceLayout.build')" @click="$emit('build')"><span class="icon-hammer" aria-hidden="true"></span><span class="label optional">{{ t('workspaceLayout.build') }}</span></button>
      <button type="button" class="play" :disabled="!retro || building || playing || packaging" :title="t('workspaceLayout.play')" @click="$emit('play')"><span class="icon-play" aria-hidden="true"></span><span class="label optional">{{ t('workspaceLayout.play') }}</span></button>
      <button type="button" class="stop" :disabled="!retro || packaging" :title="t('workspaceLayout.stop')" @click="$emit('stop')"><span class="icon-stop" aria-hidden="true"></span><span class="label optional">{{ t('workspaceLayout.stop') }}</span></button>
    </div>
    <div class="workspace-tools workspace-docks">
      <button type="button" :aria-pressed="sidebarVisible" :title="t('workspaceLayout.sidebar')" :aria-label="t('workspaceLayout.sidebar')" @click="$emit('sidebar')">
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M9.5 5v14"/></svg></button>
      <button type="button" :aria-pressed="terminalVisible" :title="t('workspaceLayout.terminal')" :aria-label="t('workspaceLayout.terminal')" @click="$emit('terminal')">
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 14h17"/></svg></button>
      <button type="button" :aria-pressed="aiVisible" :title="t('workspaceLayout.ai')" :aria-label="t('workspaceLayout.ai')" @click="$emit('ai')"><span class="icon-terminal-ai" aria-hidden="true"></span></button>
      <button type="button" :title="t('workspaceLayout.reset')" :aria-label="t('workspaceLayout.reset')" @click="$emit('reset')">
        <!-- Layout de volta ao padrão: as setas circulares são do botão de atualizações. -->
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M9.5 5v14M9.5 12h11"/></svg></button>
    </div>
  </nav>
</template>
<style scoped>
.workspace-toolbar { display:flex; align-items:center; gap:8px; min-width:0; height:100%; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; color:var(--text); font-weight:400; }
.workspace-name { max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:600; flex-shrink:0; color:var(--text); padding:0 2px 0 4px; }
.workspace-progress { max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--text); }
.workspace-tools { display:flex; align-items:center; gap:2px; flex-shrink:0; }
.workspace-modes,.workspace-build,.workspace-docks { padding-left:8px; border-left:1px solid var(--border); }
.workspace-build { margin-left:auto; }
button { display:flex; align-items:center; gap:6px; height:28px; padding:0 7px; border:1px solid transparent; border-radius:4px; background:transparent; color:var(--muted); font:inherit; font-size:12px; font-weight:500; white-space:nowrap; cursor:pointer; -webkit-app-region:no-drag; }
button:hover:not(:disabled),button[aria-pressed="true"] { color:var(--text); background:rgba(255,255,255,.08); border-color:var(--border); }
.workspace-modes button[aria-pressed="true"] { color:var(--accent); }
button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }button:disabled { opacity:.45; cursor:default; }
button > span[class^="icon-"] { font-size:15px; }
.glyph { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; }
.play:hover:not(:disabled) { color:#4ec9b0; }.stop:hover:not(:disabled) { color:#f48771; }.build:hover:not(:disabled) { color:#dcdcaa; }
/* Janela estreita: primeiro somem os rótulos de construir/jogar/parar; depois os dos modos (menos o do
   modo atual); por fim o nome do projeto. Todo botão continua com ícone, dica e nome acessível. */
@media (max-width: 1700px) { .label.optional { display:none; } }
@media (max-width: 1515px) { .workspace-modes button:not([aria-pressed="true"]) .label { display:none; } }
@media (max-width: 1280px) { .workspace-name { display:none; } .workspace-modes { border-left:0; padding-left:0; } }
@media (max-width: 1180px) { .workspace-modes .label { display:none; } .workspace-toolbar { gap:5px; } .workspace-build,.workspace-docks { padding-left:5px; } }
/* Mais estreito que isso, o que não couber rola na horizontal (nada some). */
.workspace-toolbar::-webkit-scrollbar { display:none; }
</style>
