<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
// #45: Alt+1…5 (Ctrl+1…5 on macOS) switch modes.
// #67: lives inside the title bar (one bar for the whole IDE). Every action has one
// place and every icon one meaning; buttons are icon-only, with the name in the tooltip and
// aria-label. Build/play/stop sit next to the emulator selector in TitleBar.
const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
const hint = (label, digit) => `${label} (${mac ? 'Ctrl' : 'Alt'}+${digit})`
const keys = digit => `${mac ? 'Control' : 'Alt'}+${digit}`
defineProps({ projectName: String, editorMode: { type: String, default: 'code' }, retro: Boolean, building: Boolean, playing: Boolean, packaging: Boolean, progress: String, resourcesVisible: Boolean, sidebarVisible: Boolean, terminalVisible: Boolean, aiVisible: Boolean })
defineEmits(['code','maps','scenes','characters','run','game','resources','sidebar','terminal','ai','reset'])
</script>
<template>
  <nav class="workspace-toolbar" :aria-label="t('workspaceLayout.title')">
    <span class="workspace-name" :title="projectName">{{ projectName }}</span>
    <div class="workspace-tools workspace-modes">
      <button type="button" :aria-pressed="editorMode === 'code'" :aria-label="t('workspaceLayout.code')" :title="hint(t('workspaceLayout.code'), 1)" :aria-keyshortcuts="keys(1)" @click="$emit('code')"><span class="icon-code" aria-hidden="true"></span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'maps'" :aria-label="t('workspaceLayout.maps')" :title="hint(t('workspaceLayout.maps'), 2)" :aria-keyshortcuts="keys(2)" @click="$emit('maps')"><span class="icon-grid-2" aria-hidden="true"></span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'characters'" :aria-label="t('workspaceLayout.characters')" :title="hint(t('workspaceLayout.characters'), 3)" :aria-keyshortcuts="keys(3)" @click="$emit('characters')">
        <!-- Personagem em quadro de animação: o boneco simples é da conta. -->
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><path d="M12 8v7M7.5 11l4.5-2 4.5 2M12 15l-3.5 5M12 15l3.5 5"/></svg></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'scenes'" :aria-label="t('workspaceLayout.scenes')" :title="hint(t('workspaceLayout.scenes'), 4)" :aria-keyshortcuts="keys(4)" @click="$emit('scenes')"><span class="icon-list-check" aria-hidden="true"></span></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'run'" :aria-label="t('workspaceLayout.run')" :title="hint(t('workspaceLayout.run'), 5)" :aria-keyshortcuts="keys(5)" @click="$emit('run')">
        <!-- Controle de jogo: o chip é do gravador de cartucho. -->
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14 15h-4l-.7.6A3.5 3.5 0 0 1 3 13.500V12a4 4 0 0 1 4-4z"/><path d="M7.5 10.800v3M6 12.300h3"/><circle cx="16.5" cy="12.3" r=".9" fill="currentColor" stroke="none"/></svg></button>
      <button type="button" :disabled="!retro" :aria-pressed="editorMode === 'game'" :aria-label="t('workspaceLayout.game')" :title="hint(t('workspaceLayout.gameHint'), 6)" :aria-keyshortcuts="keys(6)" @click="$emit('game')">
        <!-- Sistemas do jogo: controles deslizantes (a engrenagem é das configurações da IDE). -->
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg></button>
      <button type="button" :disabled="!retro" :aria-pressed="resourcesVisible" :title="t('workspaceLayout.resources')" :aria-label="t('workspaceLayout.resources')" @click="$emit('resources')"><span class="icon-image" aria-hidden="true"></span></button>
    </div>
    <span v-if="building || playing || packaging" class="workspace-progress" role="status" :title="progress">{{ progress || t('workspaceLayout.working') }}</span>
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
.workspace-modes,.workspace-docks { padding-left:8px; border-left:1px solid var(--border); }
.workspace-progress { margin-left:auto; }
.workspace-progress + .workspace-docks { margin-left:0; }
.workspace-docks { margin-left:auto; }
button { display:flex; align-items:center; justify-content:center; width:30px; height:28px; padding:0; border:1px solid transparent; border-radius:4px; background:transparent; color:var(--muted); font:inherit; font-size:12px; font-weight:500; white-space:nowrap; cursor:pointer; -webkit-app-region:no-drag; }
button:hover:not(:disabled),button[aria-pressed="true"] { color:var(--text); background:rgba(255,255,255,.08); border-color:var(--border); }
.workspace-modes button[aria-pressed="true"] { color:var(--accent); }
button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }button:disabled { opacity:.45; cursor:default; }
button > span[class^="icon-"] { font-size:15px; }
/* Mesma cor dos ícones de fonte (sempre claros; só a opacidade muda quando desabilitado). */
.glyph { width:18px; height:18px; color:#fff; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; }
/* Janela estreita: some o nome do projeto. Todo botão continua com ícone, dica e nome acessível. */
@media (max-width: 1280px) { .workspace-name { display:none; } .workspace-modes { border-left:0; padding-left:0; } }
/* Mais estreito que isso, o que não couber rola na horizontal (nada some). */
.workspace-toolbar::-webkit-scrollbar { display:none; }
</style>
