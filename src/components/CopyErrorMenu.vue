<script setup>
// Botão direito em uma mensagem de erro ou aviso (balão, painel de problemas, alerta de um editor)
// abre um menu para copiar o texto. Onde já existe menu de contexto próprio, nada muda.
import { ref, onMounted, onBeforeUnmount } from 'vue'
const props = defineProps({ errors: { type: Array, default: () => [] } })
const SURFACES = '.toast, .error-item, .te-export-failure, [role="alert"], .notice, .rows li, .inline-error, .emptyState'
const PROBLEM_LISTS = '.error-panel, [aria-labelledby="run-problems"]'
const menu = ref(null), host = ref('body')
const clean = text => String(text || '').split('\n').map(line => line.trim()).filter(line => line && !/^[✓✕⚠ℹ×→▼]$/.test(line)).join('\n')
const problemLine = error => `${error.file || 'arquivo desconhecido'}${error.line ? ':' + error.line : ''}${error.column > 1 ? ':' + error.column : ''}: ${error.type || 'error'}: ${error.message || ''}`
function onContextMenu(event) {
  if (event.defaultPrevented) return
  const target = event.target instanceof Element ? event.target : event.target?.parentElement
  if (!target || target.closest('input, textarea, [contenteditable="true"], .monaco-editor, .xterm, .copy-error-menu')) return
  const surface = target.closest(SURFACES), selection = String(window.getSelection?.() || '').trim()
  const list = target.closest(PROBLEM_LISTS) && props.errors.length ? props.errors : null
  const items = []
  if (selection) items.push({ label: 'Copiar seleção', text: selection })
  if (surface && clean(surface.innerText)) items.push({ label: 'Copiar mensagem', text: clean(surface.innerText) })
  if (list) items.push({ label: `Copiar todos os problemas (${list.length})`, text: list.map(problemLine).join('\n') })
  if (!items.length) return
  event.preventDefault()
  // Dentro de uma janela modal o menu precisa ficar na mesma camada, senão aparece atrás dela.
  host.value = target.closest('dialog[open]') || 'body'
  menu.value = { x: Math.max(4, Math.min(event.clientX, window.innerWidth - 250)), y: Math.max(4, Math.min(event.clientY, window.innerHeight - 12 - items.length * 30)), items }
}
async function copy(item) {
  menu.value = null
  try { await navigator.clipboard.writeText(item.text); window.retroStudioToast?.success?.('Copiado.', { duration: 1500 }) }
  catch (error) { window.retroStudioToast?.error?.('Não foi possível copiar: ' + (error.message || error)) }
}
const close = event => { if (menu.value && !event?.target?.closest?.('.copy-error-menu')) menu.value = null }
const onKey = event => { if (event.key === 'Escape' && menu.value) { menu.value = null; event.stopPropagation() } }
onMounted(() => { document.addEventListener('contextmenu', onContextMenu); document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', onKey, true); window.addEventListener('blur', close) })
onBeforeUnmount(() => { document.removeEventListener('contextmenu', onContextMenu); document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', close) })
</script>
<template>
  <Teleport :to="host">
    <div v-if="menu" class="copy-error-menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @contextmenu.prevent>
      <button v-for="item in menu.items" :key="item.label" type="button" role="menuitem" @click="copy(item)">{{ item.label }}</button>
    </div>
  </Teleport>
</template>
<style scoped>
.copy-error-menu{position:fixed;z-index:10050;display:grid;min-width:200px;max-width:240px;padding:4px;border:1px solid var(--border,#41464d);border-radius:5px;background:var(--panel,#20252a);box-shadow:0 6px 18px rgba(0,0,0,.45)}
button{padding:6px 10px;border:0;border-radius:3px;background:transparent;color:var(--text,#ddd);font:inherit;font-size:12px;text-align:left;cursor:pointer}
button:hover,button:focus-visible{background:rgba(255,255,255,.1);outline:none}
</style>
