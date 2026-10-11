<script setup>
// Arrastar imagens do sistema para a janela importa como recurso do projeto (pasta de recursos +
// resources.res), pela mesma importação segura do painel Recursos: nada é sobrescrito.
// A árvore de arquivos e as áreas que já aceitam arquivos continuam com o comportamento delas.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { isViewableImage } from '../../utils/retro/authoringFiles.js'
const props = defineProps({ projectPath: { type: String, default: '' }, enabled: Boolean })
const emit = defineEmits(['imported'])
const dragging = ref(false), importing = ref(false)
const OWN_TARGETS = '.treeArea, .drop-zone, dialog, [data-own-file-drop]'
const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files')
const ours = event => props.enabled && !!props.projectPath && hasFiles(event) && !event.target?.closest?.(OWN_TARGETS) && !document.querySelector('dialog[open]')
let leaveTimer = 0
function onDragOver(event) {
  if (!ours(event)) { dragging.value = false; return }
  event.preventDefault(); event.dataTransfer.dropEffect = importing.value ? 'none' : 'copy'
  clearTimeout(leaveTimer); dragging.value = true
}
// dragleave dispara a cada elemento atravessado: só some se nenhum dragover vier logo depois.
function onDragLeave() { clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { dragging.value = false }, 120) }
async function onDrop(event) {
  clearTimeout(leaveTimer); dragging.value = false
  if (!ours(event)) return
  event.preventDefault(); event.stopPropagation()
  if (importing.value) return
  const toast = window.retroStudioToast, projectPath = props.projectPath
  const paths = [...(event.dataTransfer?.files || [])].map(file => window.retroStudio?.getPathForFile?.(file) || '').filter(Boolean)
  const images = paths.filter(isViewableImage), others = paths.length - images.length
  if (!images.length) { toast?.warning?.('Só imagens (PNG, GIF, JPG, BMP) são importadas ao soltar aqui. Para copiar outros arquivos, solte na pasta desejada da árvore de arquivos.', { duration: 7000 }); return }
  if (!window.retroStudio?.retro?.importAssetFromPath) { toast?.error?.('A importação de recursos não está disponível.'); return }
  importing.value = true
  const done = [], failed = []
  try {
    for (const assetPath of images) {
      const name = assetPath.split(/[/\\]/).pop()
      try {
        const result = await window.retroStudio.retro.importAssetFromPath({ projectPath, assetPath, asset: { type: 'sprite' } })
        if (result?.success) done.push({ name, path: result.assetPath,  reused: !!result.reused, renamed: !!result.renamed })
        else failed.push(`${name}: ${result?.error || 'erro ao importar'}`)
      } catch (error) { failed.push(`${name}: ${error.message || 'erro ao importar'}`) }
    }
  } finally { importing.value = false }
  if (done.length) {
    const copied = done.filter(item => !item.reused), reused = done.filter(item => item.reused), renamed = copied.filter(item => item.renamed)
    const parts = []
    if (copied.length) parts.push(copied.length === 1 ? `${copied[0].path} importada` : `${copied.length} imagens importadas`)
    if (reused.length) parts.push(reused.length === 1 ? `${reused[0].name} já estava no projeto (${reused[0].path}); nada foi copiado` : `${reused.length} já estavam no projeto; nada foi copiado`)
    toast?.success?.(parts.join('; ') + '.', { description: [renamed.length ? `Já existia outro arquivo com o mesmo nome e conteúdo diferente; ele foi mantido e a imagem nova entrou como ${renamed.map(item => item.path).join(', ')}.` : '', others ? `${others} arquivo(s) que não são imagem foram ignorados.` : ''].filter(Boolean).join(' ') || null, duration: 6000 })
    emit('imported', done.map(item => item.path))
  }
  if (failed.length) toast?.error?.(failed.length === 1 ? failed[0] : `${failed.length} imagens não foram importadas.`, { description: failed.length > 1 ? failed.slice(0, 4).join(' · ') : null, duration: 9000 })
}
onMounted(() => {
  window.addEventListener('dragover', onDragOver, true); window.addEventListener('dragleave', onDragLeave, true); window.addEventListener('drop', onDrop, true)
})
onBeforeUnmount(() => {
  clearTimeout(leaveTimer)
  window.removeEventListener('dragover', onDragOver, true); window.removeEventListener('dragleave', onDragLeave, true); window.removeEventListener('drop', onDrop, true)
})
</script>
<template>
  <Teleport to="body">
    <div v-if="dragging || importing" class="image-drop" role="status">
      <div><strong>{{ importing ? 'Importando imagens…' : 'Solte para importar no projeto' }}</strong>
        <span v-if="!importing">As imagens vão para a pasta de recursos e entram em resources.res. Nada é sobrescrito.</span></div>
    </div>
  </Teleport>
</template>
<style scoped>
/* Só visual: os eventos de arrastar continuam chegando à janela. */
.image-drop{position:fixed;inset:36px 0 0 36px;z-index:9000;display:grid;place-items:center;pointer-events:none;background:rgba(15,20,24,.62);border:2px dashed var(--accent,#5bbda5)}
.image-drop div{display:grid;gap:6px;max-width:440px;padding:16px 20px;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);text-align:center;font-size:13px}
.image-drop span{color:var(--muted,#a7b2b9);font-size:12px;line-height:1.4}
</style>
