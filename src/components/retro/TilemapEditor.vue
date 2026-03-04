<template>
  <div class="tilemap-editor" tabindex="0" @keydown="onKeydown">
    <TilemapTitleBar
      :state="editorState"
      @close="$emit('close')"
    />
    <div class="te-content">
      <TilemapSidebar :state="editorState" />
      <div class="te-main">
        <TilemapToolbar :state="editorState" />
        <TilemapCanvas :state="editorState" />
        <TilemapMinimap :state="editorState" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { watch } from 'vue'
import TilemapTitleBar from './tilemap/TilemapTitleBar.vue'
import TilemapSidebar from './tilemap/TilemapSidebar.vue'
import TilemapToolbar from './tilemap/TilemapToolbar.vue'
import TilemapCanvas from './tilemap/TilemapCanvas.vue'
import TilemapMinimap from './tilemap/TilemapMinimap.vue'
import { useTilemapEditorState } from '@/composables/useTilemapEditorState.js'

const props = defineProps({
  asset: { type: Object, default: null },
  projectPath: { type: String, default: '' },
  assets: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'saved'])

// Initialize the central state logic
const editorState = useTilemapEditorState(props, emit)

// Map file opening/reloading handler
watch(() => props.asset, (asset) => {
  if (asset?.path && props.projectPath) {
    editorState.currentMapPath.value = `${props.projectPath}/${asset.path}`.replace(/\/+/g, '/')
  } else {
    editorState.currentMapPath.value = null
  }
  if (asset) editorState.loadExisting()
}, { immediate: true })

// Global keyboard shortcuts
function onKeydown(e) {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      e.preventDefault()
      if (e.shiftKey) editorState.redo()
      else editorState.undo()
      return
    }
    if (e.key === 'y') {
      e.preventDefault()
      editorState.redo()
      return
    }
    if (e.key === 'c') {
      e.preventDefault()
      editorState.copySelection()
      return
    }
    if (e.key === 'v') {
      e.preventDefault()
      editorState.pasteSelection()
      return
    }
    if (e.key === 'd') {
      e.preventDefault()
      editorState.duplicateSelection()
      return
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 's') { editorState.drawTool.value = 'select'; editorState.editCollision.value = false; editorState.editPriority.value = false; e.preventDefault() }
  else if (key === 'p') { editorState.drawTool.value = 'pencil'; editorState.editCollision.value = false; editorState.editPriority.value = false; e.preventDefault() }
  else if (key === 'e') { editorState.drawTool.value = 'eraser'; editorState.editCollision.value = false; editorState.editPriority.value = false; e.preventDefault() }
  else if (key === 'f') { editorState.drawTool.value = 'fill'; e.preventDefault() }
  else if (key === 'r') { editorState.drawTool.value = 'rect'; e.preventDefault() }
  else if (key === 'l') { editorState.drawTool.value = 'line'; e.preventDefault() }
  else if (key === 'c') { editorState.editCollision.value = !editorState.editCollision.value; editorState.editPriority.value = false; e.preventDefault() }
  else if (key === 'o') { editorState.editPriority.value = !editorState.editPriority.value; editorState.editCollision.value = false; e.preventDefault() }
  else if (key === 'm') { editorState.showMinimap.value = !editorState.showMinimap.value; e.preventDefault() }
  else if (/^[1-9]$/.test(key)) {
    const n = parseInt(key, 10) - 1
    const tilePx = editorState.TILE_SIZE_CONST * editorState.PALETTE_ZOOM
    const cols = editorState.selectedTileset.value ? Math.floor((editorState.tilesetCanvas.value?.width || 256) / tilePx) : 32
    const rows = editorState.selectedTileset.value ? Math.ceil((editorState.tilesetCanvas.value?.height || 128) / tilePx) : 16
    const maxIdx = cols * rows - 1
    if (n <= maxIdx) editorState.selectedTileIndex.value = n
    e.preventDefault()
  }
}
</script>

<style scoped>
.tilemap-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.te-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.te-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
