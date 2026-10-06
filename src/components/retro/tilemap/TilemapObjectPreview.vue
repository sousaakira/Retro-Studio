<template>
  <canvas ref="canvas" class="tilemap-object-preview" :class="{ 'show-collision': showCollision }" aria-hidden="true" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  tileset: { type: Object, default: null },
  visual: { type: Object, default: null },
  objectWidth: { type: Number, default: 1 },
  objectHeight: { type: Number, default: 1 },
  offsetX: { type: Number, default: 0 },
  offsetY: { type: Number, default: 0 },
  showCollision: { type: Boolean, default: false },
  regionOnly: { type: Boolean, default: false }
})

const canvas = ref(null)
let image = null
let imageSource = ''
let resizeObserver = null

function getStage() {
  const visual = props.visual || {}
  const regionWidth = Math.max(1, Number(visual.w) || 1) * 8
  const regionHeight = Math.max(1, Number(visual.h) || 1) * 8
  const boxWidth = props.regionOnly ? regionWidth : Math.max(1, Number(props.objectWidth) || 1) * 8
  const boxHeight = props.regionOnly ? regionHeight : Math.max(1, Number(props.objectHeight) || 1) * 8
  const spriteWidth = props.regionOnly ? regionWidth : Math.max(1, Number(visual.displayWidth) || boxWidth)
  const spriteHeight = props.regionOnly ? regionHeight : Math.max(1, Number(visual.displayHeight) || boxHeight)
  let spriteX = Number(props.offsetX) || 0
  let spriteY = Number(props.offsetY) || 0
  if (!props.regionOnly && visual.anchor === 'center') {
    spriteX += (boxWidth - spriteWidth) / 2
    spriteY += (boxHeight - spriteHeight) / 2
  } else if (!props.regionOnly && visual.anchor === 'bottom-center') {
    spriteX += (boxWidth - spriteWidth) / 2
    spriteY += boxHeight - spriteHeight
  }
  const minX = Math.min(0, spriteX), minY = Math.min(0, spriteY)
  const maxX = Math.max(boxWidth, spriteX + spriteWidth), maxY = Math.max(boxHeight, spriteY + spriteHeight)
  return { width: maxX - minX, height: maxY - minY, boxWidth, boxHeight, collisionX: -minX, collisionY: -minY, spriteX: spriteX - minX, spriteY: spriteY - minY, spriteWidth, spriteHeight }
}

function draw() {
  const target = canvas.value
  if (!target) return
  const ctx = target.getContext('2d')
  const width = Math.max(1, target.width), height = Math.max(1, target.height)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#172329'
  ctx.fillRect(0, 0, width, height)
  const visual = props.visual
  if (!visual || !image || !image.naturalWidth || !image.naturalHeight) return

  const stage = getStage()
  const scale = Math.min(width / stage.width, height / stage.height)
  const originX = (width - stage.width * scale) / 2
  const originY = (height - stage.height * scale) / 2
  if (props.showCollision) {
    ctx.fillStyle = 'rgba(78,166,222,.08)'
    ctx.strokeStyle = '#73b6de'
    ctx.lineWidth = Math.max(1, scale)
    ctx.setLineDash([Math.max(2, scale * 2), Math.max(1, scale)])
    ctx.fillRect(originX + stage.collisionX * scale, originY + stage.collisionY * scale, stage.boxWidth * scale, stage.boxHeight * scale)
    ctx.strokeRect(originX + stage.collisionX * scale, originY + stage.collisionY * scale, stage.boxWidth * scale, stage.boxHeight * scale)
    ctx.setLineDash([])
  }
  const columns = Math.max(1, Number(props.tileset?.columns) || Math.floor(image.naturalWidth / 8))
  const sx = Math.max(0, Number(visual.x) || 0) * 8
  const sy = Math.max(0, Number(visual.y) || 0) * 8
  const sw = Math.max(1, Number(visual.w) || 1) * 8
  const sh = Math.max(1, Number(visual.h) || 1) * 8
  if (sx + sw > image.naturalWidth || sy + sh > image.naturalHeight || columns * 8 > image.naturalWidth) return
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, sx, sy, sw, sh,
    originX + stage.spriteX * scale, originY + stage.spriteY * scale,
    stage.spriteWidth * scale, stage.spriteHeight * scale)
}

function loadImage() {
  const source = props.tileset?.preview || ''
  if (source === imageSource) { draw(); return }
  imageSource = source
  image = null
  if (!source) { draw(); return }
  const next = new Image()
  next.onload = () => { if (imageSource === source) { image = next; draw() } }
  next.onerror = () => { if (imageSource === source) { image = null; draw() } }
  next.src = source
}

onMounted(() => {
  resizeObserver = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect
    if (!rect || !canvas.value) return
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    canvas.value.width = Math.max(1, Math.round(rect.width * ratio))
    canvas.value.height = Math.max(1, Math.round(rect.height * ratio))
    draw()
  })
  if (canvas.value) resizeObserver.observe(canvas.value)
  loadImage()
})
watch(() => [props.tileset?.preview, JSON.stringify(props.visual), props.objectWidth, props.objectHeight, props.offsetX, props.offsetY, props.showCollision, props.regionOnly], loadImage)
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.tilemap-object-preview { display:block; width:100%; height:100%; image-rendering:pixelated; }
</style>
