<script setup>
// #103: VGM/VGZ clicado no explorador abre aqui e já começa a tocar (chips emulados da IDE).
import { computed, onMounted, ref } from 'vue'
import VgmPlayer from './VgmPlayer.vue'
import { playVgm, projectVgm } from '../../audio/vgmPlayer.js'
const props = defineProps({ filePath: { type: String, required: true }, projectPath: { type: String, default: '' } })
const emit = defineEmits(['close'])
const dialogElement = ref(null)
const name = computed(() => props.filePath.replace(/\\/g, '/').split('/').pop())
const relative = computed(() => {
  const root = props.projectPath.replace(/\\/g, '/').replace(/\/+$/, ''), file = props.filePath.replace(/\\/g, '/')
  return root && file.startsWith(root + '/') ? file.slice(root.length + 1) : file
})
function close() { emit('close') }
onMounted(() => {
  dialogElement.value?.showModal?.()
  // A mesma chave do player abaixo (projeto + arquivo), para ele mostrar esta música tocando.
  void playVgm({ key: props.projectPath + '::' + relative.value, name: name.value, load: () => projectVgm(props.projectPath, relative.value) })
})
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialogElement" class="vgm-viewer" aria-labelledby="vgm-viewer-title" @cancel.prevent="close" @close="close">
      <header>
        <div><small>Música do projeto (VGM)</small><h2 id="vgm-viewer-title" :title="relative">{{ name }}</h2></div>
        <button type="button" class="close" aria-label="Fechar player" title="Fechar (Esc)" @click="close">×</button>
      </header>
      <VgmPlayer :project-path="projectPath" :file="relative" :name="name" />
      <p class="help">Tocado nos chips emulados da IDE (YM2612 + PSG): parecido com o console, bom para reconhecer a música. Fechar para a música.</p>
    </dialog>
  </Teleport>
</template>
<style scoped>
.vgm-viewer{box-sizing:border-box;width:min(520px,94vw);padding:0 14px 12px;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.vgm-viewer::backdrop{background:rgba(0,0,0,.55)}
header{display:flex;align-items:center;gap:12px;padding:10px 0;margin-bottom:8px;border-bottom:1px solid var(--border,#41464d)}
header>div{min-width:0;flex:1}h2{margin:2px 0 0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:var(--muted,#a7b2b9)}
.close{font:inherit;font-size:16px;line-height:1;padding:4px 9px;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;cursor:pointer}
.help{margin:10px 0 0;color:var(--muted,#a7b2b9);line-height:1.4}
</style>
