<template>
  <section class="animation-editor">
    <div class="frame-controls">
      <label>{{ t('tilemap.pack.framePreset') }}<select @change="setPreset($event.target.value)"><option value="">{{ t('tilemap.pack.customFrame') }}</option><option v-for="size in presets" :key="size" :value="size">{{ size }} px</option></select></label>
      <label>{{ t('tilemap.pack.frameWidthPx') }}<input :value="fw" type="number" min="8" :max="Math.min(512, imageWidth)" step="8" @change="resizeFrame('w', $event.target.value)" /></label>
      <label>{{ t('tilemap.pack.frameHeightPx') }}<input :value="fh" type="number" min="8" :max="Math.min(512, imageHeight)" step="8" @change="resizeFrame('h', $event.target.value)" /></label>
      <label>{{ t('tilemap.pack.frameCount') }}<input :value="visual.frames" type="number" min="1" :max="maxFrames" @change="update({ frames: bounded($event.target.value, 1, maxFrames) })" /></label>
    </div>
    <div class="sheet-toolbar">
      <span>{{ imageWidth }} × {{ imageHeight }} px</span>
      <label class="inline-label"><input v-model="drawRegion" type="checkbox" />{{ t('tilemap.pack.drawFrame') }}</label>
      <label class="inline-label">Zoom <select v-model.number="zoom"><option v-for="scale in [1, 2, 3, 4]" :key="scale" :value="scale">{{ scale }}×</option></select></label>
    </div>
    <p class="sheet-hint">{{ t(drawRegion ? 'tilemap.pack.drawFrameHint' : 'tilemap.pack.selectFrameHint') }}</p>
    <div class="sheet-scroll">
      <div class="sheet-image" :style="{ width: imageWidth * zoom + 'px', height: imageHeight * zoom + 'px' }"
        tabindex="0" role="group" :aria-label="t('tilemap.pack.selectFrameHint')"
        @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="endDrag" @pointercancel="endDrag" @keydown="moveSelection">
        <img :src="tileset.preview" alt="" draggable="false" />
        <div class="frame-grid" :style="{ backgroundSize: `${fw * zoom}px ${fh * zoom}px` }" />
        <div v-for="i in count" :key="i" class="frame-outline" :class="{ first: i === 1 }" :style="{ left: (visual.x * 8 + (i - 1) * fw) * zoom + 'px', top: visual.y * 8 * zoom + 'px', width: fw * zoom + 'px', height: fh * zoom + 'px' }"><span>{{ i }}</span></div>
      </div>
    </div>
    <div class="animation-workbench">
      <div class="large-preview"><TilemapSpriteFrame :view-box="frameViewBox(currentFrame)" :href="tileset.preview" :image-width="imageWidth" :image-height="imageHeight" :aria-label="t('tilemap.pack.visualPreview')" /></div>
      <div class="playback-panel">
        <div class="playback-controls"><button type="button" @click="togglePlayback" :disabled="count < 2">{{ playing ? 'Ⅱ' : '▶' }} {{ t(playing ? 'tilemap.pack.pausePreview' : 'tilemap.pack.playPreview') }}</button><span>{{ currentFrame + 1 }} / {{ count }}</span><label>{{ t('tilemap.pack.frameRate') }}<input :value="visual.fps" type="number" min="1" max="12" @change="update({ fps: bounded($event.target.value, 1, 12) })" /></label></div>
        <label class="inline-label"><input :checked="visual.loop" type="checkbox" @change="update({ loop: $event.target.checked })" />{{ t('tilemap.pack.loopAnimation') }}</label>
        <div class="frame-strip" :aria-label="t('tilemap.pack.animation')"><button v-for="i in count" :key="i" type="button" :class="{ active: currentFrame === i - 1 }" :aria-label="t('tilemap.pack.frameNumber', { n: i })" :aria-pressed="currentFrame === i - 1" @click="playing = false; currentFrame = i - 1"><TilemapSpriteFrame :view-box="frameViewBox(i - 1)" :href="tileset.preview" :image-width="imageWidth" :image-height="imageHeight" aria-hidden="true" /><span>{{ i }}</span></button></div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import TilemapSpriteFrame from './TilemapSpriteFrame.vue'
const props = defineProps({ tileset: { type: Object, required: true }, visual: { type: Object, required: true } })
const emit = defineEmits(['update'])
const { t } = useI18n()
const presets = ['16×16', '24×24', '32×32', '32×48', '48×48', '64×48']
const zoom = ref(2), drawRegion = ref(false), playing = ref(false), currentFrame = ref(0)
const imageWidth = computed(() => props.tileset.columns * 8)
const imageHeight = computed(() => Math.ceil(props.tileset.tilecount / props.tileset.columns) * 8)
const fw = computed(() => bounded(props.visual.w, 1, 64) * 8)
const fh = computed(() => bounded(props.visual.h, 1, 64) * 8)
const maxFrames = computed(() => Math.max(1, Math.min(16, Math.floor((imageWidth.value - props.visual.x * 8) / fw.value))))
const count = computed(() => bounded(props.visual.frames, 1, maxFrames.value))
let dragStart = null, timer
function bounded(value, min, max) { return Math.max(min, Math.min(max, Math.round(Number(value) || min))) }
function update(patch) { emit('update', patch); playing.value = false; currentFrame.value = 0 }
function setRegion(x, y, w, h) {
  w = bounded(w, 1, Math.min(64, props.tileset.columns))
  h = bounded(h, 1, Math.min(64, imageHeight.value / 8))
  x = bounded(x, 0, props.tileset.columns - w)
  y = bounded(y, 0, imageHeight.value / 8 - h)
  update({ x, y, w, h, frames: bounded(props.visual.frames, 1, Math.min(16, Math.floor((props.tileset.columns - x) / w))) })
}
function resizeFrame(axis, value) { setRegion(props.visual.x, props.visual.y, axis === 'w' ? Number(value) / 8 : props.visual.w, axis === 'h' ? Number(value) / 8 : props.visual.h) }
function setPreset(value) { if (!value) return; const [w, h] = value.split('×').map(Number); setRegion(0, 0, w / 8, h / 8) }
function position(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: bounded(Math.floor((event.clientX - rect.left) / (zoom.value * 8)), 0, props.tileset.columns - 1), y: bounded(Math.floor((event.clientY - rect.top) / (zoom.value * 8)), 0, imageHeight.value / 8 - 1) }
}
function pointerDown(event) {
  if (event.button !== 0) return
  event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
  const p = position(event)
  if (drawRegion.value) { dragStart = p; update({ x: p.x, y: p.y, w: 1, h: 1, frames: 1 }) }
  else setRegion(Math.floor(p.x / props.visual.w) * props.visual.w, Math.floor(p.y / props.visual.h) * props.visual.h, props.visual.w, props.visual.h)
}
function pointerMove(event) {
  if (!dragStart) return
  const p = position(event)
  setRegion(Math.min(p.x, dragStart.x), Math.min(p.y, dragStart.y), Math.abs(p.x - dragStart.x) + 1, Math.abs(p.y - dragStart.y) + 1)
}
function endDrag() { dragStart = null }
function moveSelection(event) {
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  if (!directions[event.key]) return
  event.preventDefault()
  const [x, y] = directions[event.key]
  setRegion(props.visual.x + x * (event.shiftKey ? 1 : props.visual.w), props.visual.y + y * (event.shiftKey ? 1 : props.visual.h), props.visual.w, props.visual.h)
}
function frameViewBox(frame) { return `${props.visual.x * 8 + frame * fw.value} ${props.visual.y * 8} ${fw.value} ${fh.value}` }
function togglePlayback() { if (!playing.value) currentFrame.value = 0; playing.value = !playing.value }
watch([playing, () => props.visual.fps], () => {
  clearInterval(timer)
  if (playing.value) timer = setInterval(() => {
    if (currentFrame.value + 1 < count.value) currentFrame.value++
    else if (props.visual.loop) currentFrame.value = 0
    else playing.value = false
  }, 1000 / bounded(props.visual.fps, 1, 12))
})
watch(() => [props.tileset.id, props.visual.x, props.visual.y, props.visual.w, props.visual.h, props.visual.frames], () => { playing.value = false; currentFrame.value = 0 })
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.animation-editor { --line:var(--border-color,#414141); border:1px solid var(--line); border-radius:6px; overflow:hidden; margin-top:12px; background:#202426; color:var(--text-color,#ccc); }
.frame-controls { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; padding:12px; }
label { display:flex; flex-direction:column; gap:5px; font-size:11px; }
input, select, button { background:#252525; border:1px solid var(--line); border-radius:4px; color:inherit; font:inherit; padding:6px; min-width:0; }
button { cursor:pointer; }
button:disabled { opacity:.5; cursor:default; }
:focus-visible { outline:2px solid #77c5f0; outline-offset:2px; }
.sheet-toolbar, .playback-controls { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.sheet-toolbar { padding:8px 12px; border-top:1px solid var(--line); font-size:11px; }
.sheet-toolbar > span { margin-right:auto; font-variant-numeric:tabular-nums; }
.inline-label { flex-direction:row; align-items:center; }
.sheet-hint { margin:0; padding:0 12px 10px; color:#b7bec3; font-size:11px; }
.sheet-scroll { height:340px; min-height:200px; max-height:65vh; overflow:auto; resize:vertical; border-block:1px solid var(--line); background:#15191c; }
.sheet-image { position:relative; touch-action:none; cursor:crosshair; background:repeating-conic-gradient(#273139 0% 25%,#20282f 0% 50%) 0 0/16px 16px; }
.sheet-image img { width:100%; height:100%; display:block; image-rendering:pixelated; pointer-events:none; }
.frame-grid { position:absolute; inset:0; pointer-events:none; background-image:linear-gradient(to right,#ffffff22 1px,transparent 1px),linear-gradient(to bottom,#ffffff22 1px,transparent 1px); }
.frame-outline { position:absolute; box-sizing:border-box; border:1px solid #7bcafa; background:#65bdff0c; pointer-events:none; }
.frame-outline.first { border:2px solid #ffc361; }
.frame-outline span { position:absolute; left:0; top:0; padding:1px 4px; background:#1a2935; color:#fff; font:10px monospace; }
.animation-workbench { display:grid; grid-template-columns:160px minmax(0,1fr); gap:14px; padding:12px; }
.large-preview { height:180px; background:repeating-conic-gradient(#273139 0% 25%,#20282f 0% 50%) 0 0/16px 16px; display:flex; align-items:center; justify-content:center; border-radius:4px; }
.large-preview svg { width:85%; height:85%; image-rendering:pixelated; overflow:hidden; }
.playback-panel { min-width:0; display:flex; flex-direction:column; gap:10px; }
.playback-controls { font-size:11px; gap:8px; }
.playback-controls label { flex-direction:row; align-items:center; }
.playback-controls input { width:45px; }
.frame-strip { display:flex; overflow:auto; gap:6px; padding:3px; }
.frame-strip button { flex:0 0 64px; padding:3px; }
.frame-strip button.active { outline:2px solid #ffc361; outline-offset:0; }
.frame-strip svg { display:block; width:56px; height:65px; image-rendering:pixelated; overflow:hidden; }
.frame-strip span { font:10px monospace; }
@media(max-width:850px) { .frame-controls { grid-template-columns:repeat(2,minmax(0,1fr)); } .animation-workbench { grid-template-columns:110px minmax(0,1fr); } }
</style>
