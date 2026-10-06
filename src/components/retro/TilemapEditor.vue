<template>
  <div class="tilemap-editor" tabindex="0" @keydown="onKeydown">
    <TilemapTitleBar
      :state="editorState"
      @close="$emit('close')"
    />
    <div ref="contentRef" class="te-content">
      <TilemapSidebar :state="editorState" :style="{ width: `${sidebarWidth}px` }" />
      <div
        class="te-sidebar-resizer"
        :class="{ dragging: sidebarDrag !== null }"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('tilemap.resizeLibrary')"
        :title="t('tilemap.resizeLibrary')"
        :aria-valuemin="sidebarMin"
        :aria-valuemax="sidebarMax"
        :aria-valuenow="sidebarWidth"
        @pointerdown="startSidebarResize"
        @pointermove="moveSidebarResize"
        @pointerup="endSidebarResize"
        @pointercancel="endSidebarResize"
        @lostpointercapture="endSidebarResize"
        @keydown.stop="resizeSidebarWithKeyboard"
        @dblclick="setSidebarWidth(264)"
      />
      <div class="te-main">
        <TilemapToolbar :state="editorState" />
        <section v-if="editorState.exportFailure.value" class="te-export-failure" role="alert">
          <button type="button" class="te-export-dismiss" :aria-label="t('tilemap.dismissExportError')" @click="editorState.exportFailure.value = null">×</button>
          <strong>{{ t('tilemap.savedExportFailed', { error: editorState.exportFailure.value.message }) }}</strong>
          <div class="te-export-path">{{ editorState.exportFailure.value.mapPath }}</div>
          <details v-if="editorState.exportFailure.value.details">
            <summary>{{ t('tilemap.exportErrorDetails') }}</summary>
            <pre>{{ editorState.exportFailure.value.details }}</pre>
          </details>
        </section>
        <TilemapCanvas :state="editorState" />
        <TilemapMinimap :state="editorState" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { watch, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
const contentRef = ref(null)
const contentWidth = ref(1000)
const sidebarMin = computed(() => Math.min(220, sidebarMax.value))
const sidebarMax = computed(() => Math.max(0, Math.min(640, contentWidth.value - 206)))
const sidebarWidth = ref(264)
const sidebarDrag = ref(null)
const sidebarStorageKey = 'retrostudio.tilemap.sidebarWidth'
let sidebarObserver

function setSidebarWidth(width, persist = true) {
  sidebarWidth.value = Math.round(Math.max(sidebarMin.value, Math.min(sidebarMax.value, width)))
  if (persist) {
    try { localStorage.setItem(sidebarStorageKey, String(sidebarWidth.value)) } catch {}
  }
}

function startSidebarResize(event) {
  if (event.button !== 0) return
  event.preventDefault()
  event.currentTarget.focus()
  event.currentTarget.setPointerCapture(event.pointerId)
  sidebarDrag.value = { id: event.pointerId, x: event.clientX, width: sidebarWidth.value }
}

function moveSidebarResize(event) {
  const drag = sidebarDrag.value
  if (!drag || drag.id !== event.pointerId) return
  setSidebarWidth(drag.width + event.clientX - drag.x, false)
}

function endSidebarResize(event) {
  if (!sidebarDrag.value || sidebarDrag.value.id !== event.pointerId) return
  sidebarDrag.value = null
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  setSidebarWidth(sidebarWidth.value)
}

function resizeSidebarWithKeyboard(event) {
  const step = event.shiftKey ? 40 : 16
  const widths = { ArrowLeft: sidebarWidth.value - step, ArrowRight: sidebarWidth.value + step,
    Home: sidebarMin.value, End: sidebarMax.value, Enter: 264 }
  if (!(event.key in widths)) return
  event.preventDefault()
  setSidebarWidth(widths[event.key])
}

onMounted(() => {
  contentWidth.value = contentRef.value.clientWidth
  let saved = 264
  try {
    const value = Number(localStorage.getItem(sidebarStorageKey))
    if (Number.isFinite(value) && value > 0) saved = value
  } catch {}
  setSidebarWidth(saved, false)
  sidebarObserver = new ResizeObserver(([entry]) => {
    contentWidth.value = entry.contentRect.width
    setSidebarWidth(sidebarWidth.value, false)
  })
  sidebarObserver.observe(contentRef.value)
})
onBeforeUnmount(() => sidebarObserver?.disconnect())


// Initialize the central state logic
const editorState = useTilemapEditorState(props, emit)

// Map file opening/reloading handler
watch(() => props.asset, (asset) => {
  editorState.clearBackgroundImage()
  if (asset?.path && props.projectPath) {
    editorState.currentMapPath.value = `${props.projectPath}/${asset.path}`.replace(/\/+/g, '/')
  } else {
    editorState.currentMapPath.value = null
  }
  if (asset) editorState.loadExisting()
}, { immediate: true })

// Tool shortcuts — ignore when typing in form fields (name, dims, etc.)
function isEditableTarget(el) {
  if (!el) return false
  const tag = (el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return !!el.closest?.('input, textarea, select, [contenteditable="true"]')
}

function onKeydown(e) {
  if (isEditableTarget(e.target)) return

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
  if (e.key === 'Delete' && editorState.selectedObject.value) {
    e.preventDefault()
    editorState.deleteSelectedObject()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 's') { editorState.selectDrawTool('select'); e.preventDefault() }
  else if (key === 'p') { editorState.selectDrawTool('pencil'); e.preventDefault() }
  else if (key === 'e') { editorState.selectDrawTool('eraser'); e.preventDefault() }
  else if (key === 'f') { editorState.selectDrawTool('fill'); e.preventDefault() }
  else if (key === 'r') { editorState.selectDrawTool('rect'); e.preventDefault() }
  else if (key === 'l') { editorState.selectDrawTool('line'); e.preventDefault() }
  else if (key === 'c') { editorState.editCollision.value = !editorState.editCollision.value; editorState.editPriority.value = false; editorState.editFlipH.value = false; editorState.editFlipV.value = false; editorState.editPalette.value = false; e.preventDefault() }
  else if (key === 'o') { editorState.editPriority.value = !editorState.editPriority.value; editorState.editCollision.value = false; editorState.editFlipH.value = false; editorState.editFlipV.value = false; editorState.editPalette.value = false; e.preventDefault() }
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
.te-export-failure { margin: 8px; padding: 12px; border: 1px solid #bd7258; border-radius: 6px; background: #33251f; color: #ffe0d1; overflow-wrap: anywhere; max-height: 40%; overflow: auto; flex-shrink: 0; }
.te-export-failure strong { display: block; padding-right: 24px; }
.te-export-path { font-size: 12px; margin: 6px 0; }
.te-export-failure summary { cursor: pointer; }
.te-export-failure pre { white-space: pre-wrap; user-select: text; font-size: 12px; }
.te-export-dismiss { float: right; cursor: pointer; background: transparent; border: 0; color: inherit; font-size: 20px; }

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

.te-sidebar-resizer {
  flex: 0 0 6px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  background: var(--border);
}
.te-sidebar-resizer:hover,
.te-sidebar-resizer:focus-visible,
.te-sidebar-resizer.dragging {
  background: var(--accent, #007acc);
  outline: none;
}

.te-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
