<template>
  <div ref="editorRoot" class="tilemap-editor" :class="{ embedded }" :inert="savingScenes || editorState.workspaceLeaving.value || editorState.loadingMap.value || editorState.saving.value || editorState.selectingMapPath.value" :aria-busy="savingScenes || editorState.workspaceLeaving.value || editorState.loadingMap.value || editorState.saving.value || editorState.selectingMapPath.value" tabindex="0" @keydown="onKeydown">
    <div v-if="editorState.mapRecovery.value && !sceneMode" class="map-recovery" role="status">
      <span>Há alterações não salvas deste mapa ({{ editorState.mapRecovery.value.savedAt }}). O arquivo do mapa não foi alterado.<strong v-if="editorState.mapDirty.value"> Decida antes de continuar: enquanto esta faixa estiver aberta, as edições novas não são guardadas como rascunho.</strong></span>
      <button type="button" @click="editorState.restoreMapDraft()">Restaurar alterações</button>
      <button type="button" @click="editorState.discardMapDraft()">Descartar</button>
    </div>
    <TilemapTitleBar v-show="!sceneMode"
      :state="editorState"
      :embedded="embedded"
      @close="$emit('close')"
    />
    <div v-show="!sceneMode || editorState.cutscenes.picking.value" ref="contentRef" class="te-content">
      <TilemapSidebar :state="editorState" :central-scenes="embedded" @open-scenes="$emit('scenes')" :style="{ width: `${sidebarWidth}px` }" />
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
        <details class="te-runtime-support" :open="editorState.runtimeSupport.value.unsupported.length > 0 || editorState.runtimeConfigError.value" aria-live="polite">
          <summary>{{ t('tilemap.runtimeSupport.title') }} — {{ t(editorState.runtimeConfigError.value || !editorState.runtimeSupport.value.valid ? 'tilemap.runtimeSupport.invalid' : !editorState.runtimeSupport.value.declared ? 'tilemap.runtimeSupport.unknown' : editorState.runtimeSupport.value.unsupported.length ? 'tilemap.runtimeSupport.partial' : 'tilemap.runtimeSupport.ready') }}</summary>
          <p>{{ t('tilemap.runtimeSupport.explanation') }}</p>
          <p v-if="editorState.runtimeConfigError.value || !editorState.runtimeSupport.value.valid">{{ t('tilemap.runtimeSupport.invalidHelp') }}</p>
          <p v-if="editorState.runtimeSupport.value.adapter">{{ t('tilemap.runtimeSupport.adapter') }}: {{ editorState.runtimeSupport.value.adapter }}</p>
          <ul v-if="editorState.runtimeSupport.value.unsupported.length">
            <li v-for="capability in editorState.runtimeSupport.value.unsupported" :key="capability">{{ t('tilemap.runtimeSupport.features.' + capability.replaceAll('.', '_')) }}</li>
          </ul>
          <p v-if="editorState.runtimeSupport.value.unknown.length && editorState.runtimeSupport.value.valid && !editorState.runtimeConfigError.value">{{ t('tilemap.runtimeSupport.legacy') }}</p>
        </details>

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
    <TilemapCutsceneEditor v-if="embedded" ref="sceneEditorRef" embedded :active="active && sceneMode" :state="editorState" @close="$emit('maps')" />
    <TilemapAutotileEditor v-if="editorState.autotile.open.value" :state="editorState" />
  </div>
</template>

<script setup>
import { watch, ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import TilemapTitleBar from './tilemap/TilemapTitleBar.vue'
import TilemapCutsceneEditor from './tilemap/TilemapCutsceneEditor.vue'
import TilemapSidebar from './tilemap/TilemapSidebar.vue'
import TilemapToolbar from './tilemap/TilemapToolbar.vue'
import TilemapCanvas from './tilemap/TilemapCanvas.vue'
import TilemapMinimap from './tilemap/TilemapMinimap.vue'
import TilemapAutotileEditor from './tilemap/TilemapAutotileEditor.vue'
import { useTilemapEditorState } from '@/composables/useTilemapEditorState.js'

const props = defineProps({
  asset: { type: Object, default: null },
  projectPath: { type: String, default: '' },
  assets: { type: Array, default: () => [] },
  sceneMode: { type: Boolean, default: false }, embedded: { type: Boolean, default: false }, active: { type: Boolean, default: true }
})

const emit = defineEmits(['close', 'saved', 'scenes', 'maps'])

const { t } = useI18n()
const contentRef = ref(null)
const editorRoot = ref(null)
const sceneEditorRef = ref(null)
const savingScenes = ref(false)
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

async function prepareLeave(forceSave = false) {
  const s = editorState
  if (savingScenes.value || s.workspaceLeaving.value || s.loadingMap.value || s.saving.value || s.selectingMapPath.value || s.packLoading.value || s.rasterMapBusy.value || s.packAuthor.exporting.value || s.cutscenes.busy.value) return false
  if (s.autotile?.open.value || s.packAuthor.authoring.value || s.packAuthor.brushDraftDirty.value || s.objectDraftDirty.value || s.kitDirty.value || (!props.embedded && (s.vocabularyDraftDirty.value || s.cutscenes.open.value || s.cutscenes.dirty.value))) {
    window.retroStudioToast?.warning?.(t('workspaceLayout.mapSubeditorPending'))
    return false
  }
  s.workspaceLeaving.value = true
  s.stopMusicPreview()
  try {
    if (props.embedded) {
      if (s.vocabularyDraftDirty.value && !await sceneEditorRef.value?.saveVocabulary?.()) { s.workspaceLeaving.value = false; return false }
      if ((s.cutscenes.dirty.value || s.cutscenes.exportFailure.value) && !await s.cutscenes.saveScene()) { s.workspaceLeaving.value = false; return false }
    }
    const needsSave = forceSave || s.mapDirty.value || !!s.exportFailure.value
    const saved = !needsSave || await s.saveMap()
    if (!saved) s.workspaceLeaving.value = false
    return saved
  } catch (error) { s.workspaceLeaving.value = false; throw error }
}
async function openScenes() {
  const opened = await editorState.cutscenes.openEditor()
  if (opened && props.active && props.sceneMode) { await nextTick(); sceneEditorRef.value?.focusEditor?.() }
  return opened
}
async function saveSceneEditor() {
  if (savingScenes.value || editorState.workspaceLeaving.value || editorState.cutscenes.busy.value) return false
  savingScenes.value = true
  try {
    if (editorState.vocabularyDraftDirty.value && !await sceneEditorRef.value?.saveVocabulary?.()) return false
    return await editorState.cutscenes.saveScene()
  } finally { savingScenes.value = false }
}

function resumeEditing() { editorState.workspaceLeaving.value = false }
async function saveCurrentMap(forceSave = true) {
  if (editorState.workspaceLeaving.value) return false
  try { return await prepareLeave(forceSave && editorState.canSave.value) } finally { resumeEditing() }
}
async function openAsset(asset) {
  // Entrou no modo Mapas sem escolher um mapa: traz de volta o último kit usado neste projeto.
  if (!asset?.path) { await editorState.restoreLastKit(); return true }
  const path = /^[A-Za-z]:[/\\]|^\//.test(asset.path) ? asset.path : `${props.projectPath}/${asset.path}`.replace(/\/+/g, '/')
  if (path === editorState.currentMapPath.value) return true
  if (!await prepareLeave()) return false
  // Mapa sem kit próprio: o último kit do projeto fica à mão mesmo assim.
  try { const opened = await editorState.openRecentMap({ path, name: asset.name }); if (opened) await editorState.restoreLastKit(); return opened } finally { resumeEditing() }
}
function focusEditor() { editorRoot.value?.focus() }
watch(() => props.active, active => {
  if (!active) { editorState.stopMusicPreview(); editorState.cutscenes.previewing.value = false }
})
// API de controle por IA (#93): mapa aberto e notas; foco numa nota para recortar a captura da tela.
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))
async function focusMapNote(path, id) {
  const notes = editorState.mapNotes, open = notes.context().path
  if (!props.active || props.sceneMode) return { error: 'O editor de mapas não está na tela. Abra o modo Mapas para a captura.' }
  if (open !== path) return { error: open ? `O mapa aberto é ${open}. Abra ${path} no editor de mapas.` : `Nenhum mapa salvo aberto. Abra ${path} no editor de mapas.` }
  const note = notes.focus(Number(id))
  if (!note) return { error: `A nota #${id} não existe em ${path}.` }
  await nextTick(); await frame(); await frame()
  const canvas = editorState.mapCanvas.value, wrap = editorState.mapWrapRef.value
  if (!canvas || !wrap) return { error: 'O mapa ainda não terminou de abrir.' }
  const box = canvas.getBoundingClientRect(), view = wrap.getBoundingClientRect()
  const k = box.width / ((editorState.mapWidth.value || 1) * editorState.TILE_SIZE_CONST), pad = 2 * editorState.TILE_SIZE_CONST
  const left = Math.max(view.left, box.left + (note.x - pad) * k), top = Math.max(view.top, box.top + (note.y - pad) * k)
  const right = Math.min(view.right, box.left + (note.x + note.width + pad) * k), bottom = Math.min(view.bottom, box.top + (note.y + note.height + pad) * k)
  if (right - left < 4 || bottom - top < 4) return { error: 'A nota não ficou visível na tela.' }
  return { rect: { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) }, cropped: right - left < (note.width + 2 * pad) * k - 1 || bottom - top < (note.height + 2 * pad) * k - 1 }
}
defineExpose({ prepareLeave, resumeEditing, save: saveCurrentMap, aiMapContext: () => editorState.mapNotes.context(), focusMapNote, mapNotesChanged: path => editorState.mapNotes.context().path === path ? editorState.mapNotes.reload().then(() => ({ open: true })) : Promise.resolve({ open: false }), openAsset, focusEditor, canSave: editorState.canSave, openScenes, openSceneFile: path => editorState.cutscenes.openScene(path), openKitFile: async path => editorState.assetPackPath.value === path || await editorState.openRecentKit({ path }), saveScene: saveSceneEditor, canSaveScene: computed(() => !!editorState.cutscenes.scene.value || editorState.vocabularyDraftDirty.value) })

// Map file opening/reloading handler
watch(() => props.asset, async (asset) => {
  if (editorState.loadingMap.value || editorState.saving.value || editorState.selectingMapPath.value) return
  if (asset?.path && props.projectPath) {
    const previousPath = editorState.currentMapPath.value
    const fullPath = `${props.projectPath}/${asset.path}`.replace(/\/+/g, '/')
    editorState.currentMapPath.value = fullPath
    const loaded = await editorState.loadExisting()
    if (!loaded && editorState.currentMapPath.value === fullPath) editorState.currentMapPath.value = previousPath
  } else {
    editorState.currentMapPath.value = null
    editorState.clearBackgroundImage()
  }
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
  if (editorState.autotile.open.value) return
  if ((props.sceneMode && !editorState.cutscenes.picking.value) || isEditableTarget(e.target)) return
  if (e.key === 'Escape' && editorState.colorInspector.picking.value) {
    editorState.colorInspector.picking.value = false
    e.preventDefault()
    return
  }

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
  const notes = editorState.mapNotes
  if (e.key === 'Delete' && editorState.drawTool.value === 'note' && notes.selected.value) {
    e.preventDefault()
    notes.remove(notes.selected.value.id)
    return
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
  else if (key === 'n') { editorState.selectDrawTool('note'); e.preventDefault() }
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
.te-runtime-support { flex-shrink:0; margin:4px 8px; padding:7px 10px; border:1px solid var(--border); border-radius:4px; font-size:11px; max-height:130px; overflow:auto; color:var(--text); background:var(--panel); }
.te-runtime-support summary { cursor:pointer; }
.te-runtime-support p { margin:6px 0; color:var(--muted); }
.te-runtime-support ul { padding-left:18px; margin:6px 0; }
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
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.te-content {
  flex: 1;
  min-height: 0;
  min-width: 0;
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
.map-recovery { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:6px 10px; background:var(--panel-2,#1e1e1e); border-bottom:1px solid var(--accent,#007acc); color:var(--text,#ccc); font-size:12px; }
.map-recovery button { font:inherit; color:inherit; background:var(--panel,#252526); border:1px solid var(--border,#3c3c3c); border-radius:3px; padding:4px 8px; cursor:pointer; }
.map-recovery button:focus-visible { outline:2px solid var(--accent,#007acc); outline-offset:1px; }
</style>
