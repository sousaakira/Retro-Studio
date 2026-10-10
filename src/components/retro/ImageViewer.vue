<script setup>
// Visualizador de imagens do projeto: clique em um PNG/GIF/JPG/BMP no explorador. Só mostra; não altera o arquivo.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
const props = defineProps({ filePath: { type: String, required: true }, projectPath: { type: String, default: '' } })
const emit = defineEmits(['close'])
const dialogElement = ref(null), stage = ref(null), source = ref(''), info = ref(null), error = ref(''), loading = ref(false), zoom = ref(0), fit = ref(1)
const ZOOMS = [1, 2, 4, 8]
let request = 0, observer = null
const name = computed(() => props.filePath.replace(/\\/g, '/').split('/').pop())
const relative = computed(() => {
  const root = props.projectPath.replace(/\\/g, '/').replace(/\/+$/, ''), file = props.filePath.replace(/\\/g, '/')
  return root && file.startsWith(root + '/') ? file.slice(root.length + 1) : file
})
const scale = computed(() => zoom.value || fit.value)
const size = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MiB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KiB' : bytes + ' B'
// Mega Drive: tiles de 8 px e até 16 cores por paleta. Conta as cores só em imagens pequenas o bastante.
function describe(image, bytes) {
  const width = image.naturalWidth, height = image.naturalHeight, details = { width, height, bytes, tiles: width % 8 || height % 8 ? null : { columns: width / 8, rows: height / 8 }, colors: null, transparent: false }
  if (width * height <= 4194304) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0)
      const pixels = new Uint32Array(context.getImageData(0, 0, width, height).data.buffer), seen = new Set()
      for (let index = 0; index < pixels.length && seen.size <= 4096; index++) { if (pixels[index] >>> 24 < 255) details.transparent = true; seen.add(pixels[index]) }
      details.colors = seen.size > 4096 ? null : seen.size
    } catch { /* sem contagem de cores */ }
  }
  return details
}
function measure() {
  if (!info.value || !stage.value) return
  const room = stage.value.getBoundingClientRect(), value = Math.min((room.width - 32) / info.value.width, (room.height - 32) / info.value.height)
  // Ajustar: pixel art cresce em múltiplos inteiros; imagem maior que a área encolhe para caber.
  fit.value = value >= 1 ? Math.max(1, Math.min(16, Math.floor(value))) : Math.max(0.05, value)
}
async function load() {
  const id = ++request
  loading.value = true; error.value = ''; source.value = ''; info.value = null; zoom.value = 0
  try {
    const result = await window.retroStudio?.retro?.readImageFile?.(props.filePath)
    if (id !== request) return
    if (!result?.success) throw new Error(result?.error || 'Não foi possível abrir esta imagem.')
    const url = `data:${result.mime};base64,${result.base64}`, image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('O arquivo não é uma imagem válida.')); image.src = url })
    if (id !== request) return
    info.value = describe(image, result.size); source.value = url; measure()
  } catch (problem) { if (id === request) error.value = problem.message }
  finally { if (id === request) loading.value = false }
}
function close() { emit('close') }
watch(() => props.filePath, load)
onMounted(() => {
  dialogElement.value?.showModal?.()
  observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  if (stage.value) observer?.observe(stage.value)
  void load()
})
onBeforeUnmount(() => { request++; observer?.disconnect() })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialogElement" class="image-viewer" aria-labelledby="image-viewer-title" @cancel.prevent="close" @close="close">
      <header>
        <div><small>Imagem do projeto</small><h2 id="image-viewer-title" :title="relative">{{ name }}</h2></div>
        <div class="zoom" role="group" aria-label="Zoom">
          <button type="button" :aria-pressed="zoom === 0" @click="zoom = 0">Ajustar</button>
          <button v-for="value in ZOOMS" :key="value" type="button" :aria-pressed="zoom === value" @click="zoom = value">{{ value }}×</button>
        </div>
        <button type="button" class="close" aria-label="Fechar visualizador" title="Fechar (Esc)" @click="close">×</button>
      </header>
      <div ref="stage" class="stage">
        <p v-if="loading" role="status">Abrindo imagem…</p>
        <p v-else-if="error" role="alert" class="problem">{{ error }}</p>
        <img v-else-if="source" :src="source" :alt="name" :style="{ width: info.width * scale + 'px', height: info.height * scale + 'px' }" draggable="false" />
      </div>
      <footer v-if="info">
        <span>{{ info.width }} × {{ info.height }} px</span>
        <span v-if="info.tiles">{{ info.tiles.columns }} × {{ info.tiles.rows }} tiles de 8 px</span>
        <span v-else class="warn">Tamanho não é múltiplo de 8 px</span>
        <span v-if="info.colors !== null" :class="{ warn: info.colors > 16 }">{{ info.colors }} {{ info.colors === 1 ? 'cor' : 'cores' }}<template v-if="info.transparent"> (com transparência)</template><template v-if="info.colors > 16"> · mais de 16</template></span>
        <span>{{ size(info.bytes) }}</span>
        <span>Zoom {{ scale >= 1 ? scale + '×' : Math.round(scale * 100) + '%' }}</span>
        <span class="path" :title="relative">{{ relative }}</span>
      </footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.image-viewer{box-sizing:border-box;display:flex;flex-direction:column;width:min(1240px,96vw);height:min(860px,94vh);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.image-viewer:not([open]){display:none}.image-viewer::backdrop{background:rgba(0,0,0,.55)}
header{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border,#41464d);flex-shrink:0}
header>div:first-child{min-width:0;flex:1}h2{margin:2px 0 0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:var(--muted,#a7b2b9)}
.zoom{display:flex;gap:4px;flex-shrink:0}
button{font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:5px 9px;cursor:pointer}
button[aria-pressed="true"]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.close{font-size:16px;line-height:1;padding:4px 9px}
/* Xadrez atrás da imagem para a transparência aparecer. */
.stage{flex:1;min-height:0;overflow:auto;display:grid;place-items:safe center;padding:16px;background-color:#2b2f34;background-image:linear-gradient(45deg,#353a40 25%,transparent 25%,transparent 75%,#353a40 75%),linear-gradient(45deg,#353a40 25%,transparent 25%,transparent 75%,#353a40 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.stage img{display:block;image-rendering:pixelated;max-width:none;flex-shrink:0}
.stage p{margin:0;padding:10px 12px;border:1px solid var(--border,#41464d);border-radius:3px;background:var(--panel,#20252a)}.problem{border-color:#e38269!important;color:#f0b3a3}
footer{display:flex;flex-wrap:wrap;gap:6px 16px;padding:8px 14px;border-top:1px solid var(--border,#41464d);color:var(--muted,#a7b2b9);flex-shrink:0}
.warn{color:#e5c07b}.path{margin-left:auto;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
