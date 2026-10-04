<template>
  <div class="kit-editor">
    <button type="button" class="wide open-kit" :disabled="a.exporting.value" :aria-expanded="a.authoring.value" @click="openModal">
      <span aria-hidden="true">▦</span> {{ t(pack ? 'tilemap.pack.editKit' : 'tilemap.pack.createKit') }}
    </button>
    <Teleport to="body">
      <div v-if="a.authoring.value && pack" class="kit-backdrop" @click.self="closeModal" @keydown.esc.stop.prevent="closeModal" @keydown.tab="trapFocus">
        <section class="kit-dialog" role="dialog" aria-modal="true" :aria-label="t('tilemap.pack.editKit')" :aria-busy="a.exporting.value">
          <header class="kit-header">
            <div class="kit-heading">
              <span class="kit-mark" aria-hidden="true">▦</span>
              <div><small>{{ t('tilemap.pack.title') }}</small><h2>{{ pack.name || t('tilemap.pack.newName') }}</h2></div>
            </div>
            <button ref="closeButton" type="button" class="close-kit" :aria-label="t('tilemap.pack.close')" @click="closeModal">×</button>
          </header>

          <nav class="kit-tabs" role="tablist" :aria-label="t('tilemap.pack.kitSections')">
            <button v-for="item in tabs" :key="item.id" type="button" role="tab" :id="`kit-tab-${item.id}`" :aria-selected="activeTab === item.id" :aria-controls="`kit-panel-${item.id}`" :class="{ active: activeTab === item.id }" @click="activeTab = item.id">{{ t(item.label) }}</button>
          </nav>

          <div class="kit-body" :id="`kit-panel-${activeTab}`" role="tabpanel" :aria-labelledby="`kit-tab-${activeTab}`">
            <section v-if="activeTab === 'identity'" class="identity-panel">
              <div class="panel-intro"><span class="eyebrow">{{ t('tilemap.pack.startHere') }}</span><h3>{{ t('tilemap.pack.kitIdentityTitle') }}</h3><p>{{ t('tilemap.pack.kitIdentityHint') }}</p></div>
              <label class="field-large">{{ t('tilemap.pack.kitName') }}<input v-model="pack.name" maxlength="80" /></label>
              <div class="identity-note"><span aria-hidden="true">✦</span><p>{{ t('tilemap.pack.authorHint') }}</p></div>
            </section>

            <section v-else-if="activeTab === 'brushes'" class="brush-panel">
              <div class="panel-intro"><span class="eyebrow">{{ t('tilemap.pack.tileTab') }}</span><h3>{{ t('tilemap.pack.brushesTitle') }}</h3><p>{{ t('tilemap.pack.brushesHint') }}</p></div>
              <div class="brush-layout">
                <div class="form-pane">
                  <div class="selection-preview"><span class="preview-caption">{{ t('tilemap.pack.currentSelection') }}</span><strong>{{ t('tilemap.pack.regionSize', { w: state.selectedTileRegion.value.w, h: state.selectedTileRegion.value.h }) }}</strong><small>{{ state.selectedTileset.value?.name || t('tilemap.pack.noTileset') }}</small></div>
                  <label>{{ t('tilemap.pack.brushName') }}<input v-model="draft.name" maxlength="64" /></label>
                  <label>{{ t('tilemap.pack.category') }}<input v-model="draft.category" maxlength="40" :placeholder="t('tilemap.pack.categoryExample')" /></label>
                  <div class="form-row">
                    <label>{{ t('tilemap.pack.layer') }}<select v-model="draft.layer"><option value="bg">BG</option><option value="fg">FG</option></select></label>
                    <label>{{ t('tilemap.pack.collision') }}<select v-model="draft.collision"><option v-for="v in ['none','solid','top','damage']" :key="v" :value="v">{{ t(`tilemap.pack.collision_${v}`) }}</option></select></label>
                  </div>
                  <button type="button" class="primary-action" :disabled="!state.selectedTileset.value" @click="a.saveBrush()">{{ t(a.editingBrushId.value ? 'tilemap.pack.updateBrush' : 'tilemap.pack.addBrush') }}</button>
                  <button v-if="a.editingBrushId.value" type="button" class="quiet-action" @click="a.resetDraft()">{{ t('tilemap.pack.cancelEdit') }}</button>
                </div>
                <div class="entry-pane">
                  <div class="list-heading"><strong>{{ t('tilemap.pack.savedBrushes', { count: pack.brushes.length }) }}</strong><span>{{ pack.brushes.length }}</span></div>
                  <div v-if="!pack.brushes.length" class="empty-state">{{ t('tilemap.pack.noBrushes') }}</div>
                  <ul v-else class="entry-list"><li v-for="b in pack.brushes" :key="b.id"><button type="button" class="entry-label" @click="a.editBrush(b)"><span class="entry-swatch" aria-hidden="true">▧</span><span><strong>{{ b.name }}</strong><small>{{ b.category || t('tilemap.pack.uncategorized') }} · {{ b.w }}×{{ b.h }}</small></span></button><button type="button" class="remove-entry" :aria-label="`${t('tilemap.pack.removeEntry')}: ${b.name}`" @click="a.removeBrush(b.id)">×</button></li></ul>
                </div>
              </div>
            </section>

            <section v-else-if="activeTab === 'objects'" class="objects-panel">
              <div class="panel-intro"><span class="eyebrow">{{ t('tilemap.pack.objectTab') }}</span><h3>{{ t('tilemap.pack.objectsTitle') }}</h3><p>{{ t('tilemap.pack.objectsHint') }}</p></div>
              <div class="objects-layout">
                <aside class="category-rail" :aria-label="t('tilemap.pack.objectCategory')">
                  <button v-for="cat in categories" :key="cat.id" type="button" :class="{ active: selectedCategory === cat.id }" @click="selectCategory(cat.id)"><span class="category-symbol" aria-hidden="true">{{ cat.icon }}</span><span>{{ t(`tilemap.pack.category_${cat.id}`) }}</span><small>{{ categoryCount(cat.id) }}</small></button>
                </aside>

                <div class="object-list-pane">
                  <div class="list-heading"><strong>{{ t(`tilemap.pack.category_${selectedCategory}`) }}</strong><span>{{ categoryObjects.length }}</span></div>
                  <div v-if="!categoryObjects.length" class="empty-state">{{ t('tilemap.pack.emptyCategory') }}</div>
                  <div v-else class="object-model-list">
                    <button v-for="item in categoryObjects" :key="item.index" type="button" class="model-row" :class="{ active: editingObjectIndex === item.index }" @click="loadObject(item.object, item.index)">
                      <span class="model-thumb"><svg v-if="previewFor(item.object)" :viewBox="previewFor(item.object).viewBox" aria-hidden="true"><image :href="previewFor(item.object).href" :width="previewFor(item.object).imageWidth" :height="previewFor(item.object).imageHeight" /></svg><span v-else aria-hidden="true">◇</span></span>
                      <span class="model-copy"><strong>{{ item.object.name }}</strong><small>{{ item.object.type }}</small></span>
                      <span v-if="(item.object.visual?.frames || 1) > 1" class="animated-tag" :title="t('tilemap.pack.animated')">↻</span>
                    </button>
                  </div>
                  <button type="button" class="new-model" @click="newObject">＋ {{ t('tilemap.pack.newObject') }}</button>
                </div>

                <div class="object-form-pane">
                  <div class="object-form-head"><div><span class="eyebrow">{{ t('tilemap.pack.objectDetails') }}</span><h4>{{ editingObjectIndex >= 0 ? t('tilemap.pack.editObjectModel') : t('tilemap.pack.newObject') }}</h4></div><button v-if="editingObjectIndex >= 0" type="button" class="remove-model" @click="removeObject">{{ t('tilemap.pack.removeEntry') }}</button></div>
                  <div class="object-form-scroll">
                    <div class="form-row">
                      <label>{{ t('tilemap.pack.name') }}<input v-model="objectDraft.name" maxlength="64" /></label>
                      <label>{{ t('tilemap.pack.type') }}<input v-model="objectDraft.type" maxlength="48" :placeholder="t('tilemap.pack.typeExample')" /></label>
                    </div>
                    <label>{{ t('tilemap.pack.objectCategory') }}<select v-model="objectDraft.category"><option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ t(`tilemap.pack.category_${cat.id}`) }}</option></select></label>
                    <div class="section-rule"><span>{{ t('tilemap.pack.visualAsset') }}</span></div>
                    <label>{{ t('tilemap.pack.chooseTileset') }}<select v-model="objectDraft.visual.tilesetId" @change="onTilesetChanged"><option value="">{{ t('tilemap.pack.noVisual') }}</option><option v-for="ts in state.userTilesets.value" :key="ts.id" :value="ts.id">{{ ts.name }}</option></select></label>
                    <div v-if="selectedTileset" class="asset-picker">
                      <div class="asset-picker-title"><span>{{ t('tilemap.pack.chooseTile') }}</span><small>{{ t('tilemap.pack.tileCoords', { x: objectDraft.visual.x, y: objectDraft.visual.y }) }}</small></div>
                      <div class="asset-tile-grid" :style="assetGridStyle" :aria-label="t('tilemap.pack.assetTileGrid')">
                        <button v-for="tile in assetTileCount" :key="tile - 1" type="button" class="asset-tile" :class="{ chosen: tile - 1 === objectDraft.visual.y * selectedTileset.columns + objectDraft.visual.x }" :style="assetTileStyle(tile - 1)" :aria-label="t('tilemap.pack.chooseTileNumber', { n: tile - 1 })" :aria-pressed="tile - 1 === objectDraft.visual.y * selectedTileset.columns + objectDraft.visual.x" @click="chooseAssetTile(tile - 1)" />
                      </div>
                      <div class="asset-selection-preview">
                        <div class="sprite-preview"><svg :viewBox="spriteViewBox" :aria-label="t('tilemap.pack.visualPreview')"><image :href="selectedTileset.preview" :width="selectedTileset.columns * 8" :height="Math.ceil(selectedTileset.tilecount / selectedTileset.columns) * 8" /></svg></div>
                        <div class="preview-info"><strong>{{ objectDraft.name || t('tilemap.pack.newObject') }}</strong><small>{{ objectDraft.visual.w }} × {{ objectDraft.visual.h }} {{ t('tilemap.pack.tilesUnit') }}</small><button v-if="objectDraft.visual.frames > 1" type="button" class="play-preview" :disabled="reducedMotion" @click="state.previewAnimations.value = !state.previewAnimations.value">{{ state.previewAnimations.value ? 'Ⅱ' : '▶' }} {{ t(state.previewAnimations.value ? 'tilemap.pack.pausePreview' : 'tilemap.pack.playPreview') }}</button><small v-if="objectDraft.visual.frames > 1">{{ t('tilemap.pack.animationSummary', { frames: objectDraft.visual.frames, fps: objectDraft.visual.fps }) }}</small></div>
                      </div>
                      <div class="form-row source-size"><label>{{ t('tilemap.pack.sourceWidth') }}<input v-model.number="objectDraft.visual.w" type="number" min="1" max="64" /></label><label>{{ t('tilemap.pack.sourceHeight') }}<input v-model.number="objectDraft.visual.h" type="number" min="1" max="64" /></label></div>
                      <div class="section-rule"><span>{{ t('tilemap.pack.animation') }}</span></div>
                      <div class="form-row"><label>{{ t('tilemap.pack.frameCount') }}<input v-model.number="objectDraft.visual.frames" type="number" min="1" max="16" /></label><label>{{ t('tilemap.pack.frameRate') }}<input v-model.number="objectDraft.visual.fps" type="number" min="1" max="12" /></label></div>
                      <label class="check-field"><input v-model="objectDraft.visual.loop" type="checkbox" />{{ t('tilemap.pack.loopAnimation') }}</label>
                      <p class="field-hint">{{ t('tilemap.pack.animationHint') }}</p>
                    </div>
                    <div v-else class="asset-empty">{{ t('tilemap.pack.addTilesetForVisual') }}</div>
                    <div class="section-rule"><span>{{ t('tilemap.pack.gameplay') }}</span></div>
                    <div class="form-row"><label>{{ t('tilemap.pack.width') }}<input v-model.number="objectDraft.width" type="number" min="1" max="64" /></label><label>{{ t('tilemap.pack.height') }}<input v-model.number="objectDraft.height" type="number" min="1" max="64" /></label></div>
                    <label>{{ t('tilemap.pack.properties') }}<textarea v-model="propertiesText" rows="4" spellcheck="false" /></label>
                  </div>
                  <div class="object-form-actions"><button type="button" class="primary-action" @click="saveObject">{{ t(editingObjectIndex >= 0 ? 'tilemap.pack.updateObjectModel' : 'tilemap.pack.addObjectModel') }}</button><button type="button" class="quiet-action" @click="newObject">{{ t('tilemap.pack.clearObjectForm') }}</button></div>
                </div>
              </div>
            </section>

            <section v-else class="save-panel">
              <div class="panel-intro"><span class="eyebrow">{{ t('tilemap.pack.exportTab') }}</span><h3>{{ t('tilemap.pack.saveKit') }}</h3><p>{{ t('tilemap.pack.exportHint') }}</p></div>
              <div class="kit-summary"><div><strong>{{ pack.brushes.length }}</strong><span>{{ t('tilemap.pack.brushesTitle') }}</span></div><div><strong>{{ pack.objects.length }}</strong><span>{{ t('tilemap.pack.objectsTitle') }}</span></div><div><strong>{{ pack.tilesets.length }}</strong><span>{{ t('tilemap.pack.assetsCount') }}</span></div></div>
              <button type="button" class="primary-action save-kit" :disabled="a.exporting.value" @click="a.exportPack()">{{ t(a.exporting.value ? 'tilemap.pack.loading' : 'tilemap.pack.saveKit') }}</button>
              <p v-if="a.savedPath.value" class="save-location" role="status">{{ t('tilemap.pack.savedKit') }}: {{ a.savedPath.value }}</p>
            </section>
          </div>

          <footer class="kit-footer">
            <p v-if="a.error.value" role="alert" class="error">{{ a.error.value }}</p>
            <p v-else-if="activeTab !== 'save'" class="footer-hint">{{ t('tilemap.pack.footerHelp') }}</p>
            <button type="button" class="footer-close" @click="closeModal">{{ t('tilemap.pack.close') }}</button>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ state: { type: Object, required: true } })
const { t } = useI18n()
const a = props.state.packAuthor
const pack = computed(() => props.state.assetPack.value)
const draft = computed(() => a.brushDraft.value)
const activeTab = ref('identity')
const selectedCategory = ref('scenery')
const editingObjectIndex = ref(-1)
const propertiesText = ref('{}')
const previewTime = ref(0)
const reducedMotion = ref(false)
const closeButton = ref(null)
let openerElement = null
let mediaQuery
let previewInterval
const tabs = [
  { id: 'identity', label: 'tilemap.pack.tabIdentity' },
  { id: 'brushes', label: 'tilemap.pack.tabBrushes' },
  { id: 'objects', label: 'tilemap.pack.tabObjects' },
  { id: 'save', label: 'tilemap.pack.tabSave' }
]
const categories = [
  { id: 'scenery', icon: '▧' }, { id: 'item', icon: '✦' }, { id: 'enemy', icon: '♟' },
  { id: 'interaction', icon: '↔' }, { id: 'marker', icon: '⌖' }
]
const objectDraft = reactive({ name: '', type: '', category: 'scenery', width: 1, height: 1, properties: {}, visual: { tilesetId: '', x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 4, loop: true } })
const selectedTileset = computed(() => props.state.userTilesets.value.find(ts => ts.id === objectDraft.visual.tilesetId) || null)
const assetTileCount = computed(() => Math.min(selectedTileset.value?.tilecount || 0, 2048))
const assetGridStyle = computed(() => ({ gridTemplateColumns: `repeat(${Math.max(1, selectedTileset.value?.columns || 16)}, 24px)` }))
const spriteViewBox = computed(() => {
  const visual = objectDraft.visual
  const elapsedFrame = Math.floor(previewTime.value * visual.fps / 1000)
  const frame = visual.frames > 1 && props.state.previewAnimations.value && !reducedMotion.value
    ? (visual.loop ? elapsedFrame % visual.frames : Math.min(visual.frames - 1, elapsedFrame))
    : 0
  return `${(visual.x + frame * visual.w) * 8} ${visual.y * 8} ${visual.w * 8} ${visual.h * 8}`
})
const categoryObjects = computed(() => (pack.value?.objects || []).map((object, index) => ({ object, index })).filter(item => (item.object.category || 'marker') === selectedCategory.value))

function openModal() { openerElement = document.activeElement; a.openAuthoring() }
function closeModal() {
  a.authoring.value = false
  nextTick(() => openerElement?.focus?.())
}
function trapFocus(event) {
  const focusables = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
  if (!focusables.length) return
  const first = focusables[0], last = focusables.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function categoryCount(category) { return (pack.value?.objects || []).filter(item => (item.category || 'marker') === category).length }
function selectCategory(category) { selectedCategory.value = category; newObject(category) }
function onTilesetChanged() { objectDraft.visual.x = 0; objectDraft.visual.y = 0 }
function chooseAssetTile(index) {
  const columns = selectedTileset.value?.columns || 16
  objectDraft.visual.x = index % columns
  objectDraft.visual.y = Math.floor(index / columns)
}
function assetTileStyle(index) {
  const ts = selectedTileset.value
  if (!ts?.preview) return {}
  return { backgroundImage: `url("${ts.preview}")`, backgroundSize: `${(ts.columns || 16) * 24}px auto`, backgroundPosition: `${-(index % (ts.columns || 16)) * 24}px ${-Math.floor(index / (ts.columns || 16)) * 24}px` }
}
function previewFor(object) {
  const visual = object?.visual
  if (!visual?.tileset || !pack.value) return null
  const path = props.state.assetPackTilesets.value[visual.tileset]
  const ts = props.state.userTilesets.value.find(item => item.path === path)
  if (!ts?.preview) return null
  return { href: ts.preview, viewBox: `${visual.x * 8} ${visual.y * 8} ${visual.w * 8} ${visual.h * 8}`, imageWidth: ts.columns * 8, imageHeight: Math.ceil(ts.tilecount / ts.columns) * 8 }
}
function resetObjectDraft(category = selectedCategory.value) {
  Object.assign(objectDraft, { name: '', type: '', category, width: 1, height: 1, properties: {}, visual: { tilesetId: selectedTileset.value?.id || '', x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 4, loop: true } })
  propertiesText.value = '{}'
  previewTime.value = 0
  editingObjectIndex.value = -1
}
function newObject(category = selectedCategory.value) { resetObjectDraft(category) }
function loadObject(object, index) {
  previewTime.value = 0
  const visual = object.visual || {}
  const sourcePath = visual.tileset ? props.state.assetPackTilesets.value[visual.tileset] : ''
  const mappedTileset = props.state.userTilesets.value.find(ts => ts.path === sourcePath)
  const columns = mappedTileset?.columns || 16
  Object.assign(objectDraft, {
    name: object.name, type: object.type, category: object.category || 'marker', width: object.width, height: object.height,
    properties: JSON.parse(JSON.stringify(object.properties || {})),
    visual: visual.tileset ? { tilesetId: mappedTileset?.id || '', x: visual.x, y: visual.y, w: visual.w, h: visual.h, frames: visual.frames || 1, fps: visual.fps || 4, loop: visual.loop !== false } : { tilesetId: selectedTileset.value?.id || '', x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 4, loop: true }
  })
  if (visual.gid && mappedTileset) {
    const local = visual.gid - mappedTileset.firstgid
    objectDraft.visual.x = local % columns
    objectDraft.visual.y = Math.floor(local / columns)
    objectDraft.visual.w = visual.width || 1
    objectDraft.visual.h = visual.height || 1
  }
  propertiesText.value = JSON.stringify(object.properties || {}, null, 2)
  editingObjectIndex.value = index
}
function saveObject() {
  let properties
  try {
    properties = JSON.parse(propertiesText.value)
    if (!properties || Array.isArray(properties) || typeof properties !== 'object' || Object.values(properties).some(value => !['string', 'number', 'boolean'].includes(typeof value))) throw new Error()
  } catch { a.error.value = t('tilemap.pack.invalidProperties'); return }
  const visual = objectDraft.visual.tilesetId ? { ...objectDraft.visual } : null
  const saved = a.saveObjectTemplate({ ...objectDraft, properties, visual }, editingObjectIndex.value)
  if (saved) { selectedCategory.value = objectDraft.category; editingObjectIndex.value = editingObjectIndex.value >= 0 ? editingObjectIndex.value : pack.value.objects.length - 1; activeTab.value = 'objects' }
}
function removeObject() {
  if (editingObjectIndex.value < 0) return
  a.removeObjectTemplate(editingObjectIndex.value)
  resetObjectDraft()
}
function onReducedMotionChange(event) { reducedMotion.value = event.matches }

watch(() => a.authoring.value, open => { if (open) { activeTab.value = 'identity'; a.error.value = ''; nextTick(() => closeButton.value?.focus()) } })
onMounted(() => {
  mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  reducedMotion.value = !!mediaQuery?.matches
  mediaQuery?.addEventListener?.('change', onReducedMotionChange)
  previewInterval = setInterval(() => {
    if (a.authoring.value && activeTab.value === 'objects' && props.state.previewAnimations.value && !reducedMotion.value && objectDraft.visual.frames > 1) {
      // Updating only the frame index keeps the editor responsive while the map preview is paused.
      previewTime.value += 100
    }
  }, 100)
})
onBeforeUnmount(() => { clearInterval(previewInterval); mediaQuery?.removeEventListener?.('change', onReducedMotionChange) })
</script>

<style scoped>
.kit-editor { margin: 12px 0; }
.open-kit { width: 100%; min-height: 34px; border: 1px solid var(--accent, #2387d9); color: var(--text); background: color-mix(in srgb, var(--accent, #2387d9) 13%, var(--bg)); border-radius: 5px; cursor: pointer; font: inherit; font-weight: 600; }
.kit-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 3vh 3vw; background: rgb(5 8 12 / 78%); }
.kit-dialog { display: grid; grid-template-rows: auto auto minmax(0,1fr) auto; width: min(1240px, 94vw); height: min(900px, 92vh); color: var(--text, #e6eaf0); background: var(--panel, #20252b); border: 1px solid var(--border, #3a4148); border-radius: 9px; box-shadow: 0 22px 80px rgb(0 0 0 / 60%); overflow: hidden; }
.kit-header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 22px; border-bottom:1px solid var(--border, #3a4148); background:linear-gradient(110deg, rgb(35 135 217 / 12%), transparent 42%); }
.kit-heading { display:flex; align-items:center; gap:13px; min-width:0; }
.kit-mark { display:grid; place-items:center; width:40px; height:40px; border:1px solid rgb(80 170 238 / 45%); background:#173044; color:#8ccfff; border-radius:7px; font-size:22px; }
.kit-heading small,.eyebrow { color:var(--muted, #a8b0b8); font-size:10px; letter-spacing:.09em; text-transform:uppercase; }
.kit-heading h2 { overflow:hidden; margin:2px 0 0; text-overflow:ellipsis; white-space:nowrap; font-size:17px; }
.close-kit { width:32px; height:32px; border:1px solid var(--border); border-radius:5px; color:var(--text); background:transparent; font-size:21px; cursor:pointer; }
.kit-tabs { display:flex; gap:4px; padding:0 18px; border-bottom:1px solid var(--border); background:rgb(0 0 0 / 10%); }
.kit-tabs button { position:relative; min-width:110px; padding:12px 15px; border:0; color:var(--muted, #a8b0b8); background:transparent; font:inherit; cursor:pointer; }
.kit-tabs button.active { color:var(--text); }
.kit-tabs button.active::after { position:absolute; right:10px; bottom:-1px; left:10px; height:2px; content:""; background:#56b2f4; }
.kit-body { min-height:0; overflow:auto; padding:22px 24px; }
.panel-intro { max-width:700px; margin-bottom:18px; }
.panel-intro h3 { margin:5px 0; font-size:20px; }
.panel-intro p,.identity-note p { margin:0; color:var(--muted, #a8b0b8); line-height:1.5; font-size:13px; }
.identity-panel { width:min(700px,100%); margin:20px auto; }
.field-large { max-width:560px; margin-top:26px!important; }
label { display:flex; flex-direction:column; gap:6px; margin:11px 0; color:var(--text); font-size:12px; }
input,select,textarea { min-width:0; padding:8px 9px; border:1px solid var(--border, #3a4148); border-radius:5px; color:var(--text); background:var(--bg, #191d22); font:inherit; }
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible { outline:2px solid #55b7ff; outline-offset:2px; }
.identity-note { display:flex; align-items:flex-start; gap:11px; margin-top:24px; padding:14px; border-left:2px solid #439ce0; background:rgb(43 121 180 / 9%); }
.identity-note span { color:#82caff; font-size:18px; }
.brush-layout { display:grid; grid-template-columns:minmax(260px,.8fr) minmax(300px,1.2fr); gap:22px; }
.form-pane,.entry-pane,.object-list-pane,.object-form-pane { min-width:0; }
.selection-preview { display:flex; flex-direction:column; gap:5px; padding:12px; border:1px solid var(--border); border-radius:6px; background:rgb(0 0 0 / 12%); }
.preview-caption,.selection-preview small,.entry-label small,.model-copy small,.asset-picker-title small,.preview-info small { color:var(--muted,#a8b0b8); font-size:11px; }
.form-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.primary-action,.quiet-action,.new-model,.footer-close,.remove-model,.play-preview { border:1px solid var(--border); border-radius:5px; padding:8px 11px; color:var(--text); background:var(--bg,#191d22); font:inherit; cursor:pointer; }
.primary-action { border-color:#247ab6; color:#fff; background:#176da8; font-weight:600; }
.primary-action:disabled { opacity:.5; cursor:not-allowed; }
.quiet-action { margin-left:6px; }
.list-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; font-size:12px; }
.list-heading span { min-width:22px; padding:2px 6px; border-radius:10px; color:#a8cbe2; background:#293947; text-align:center; font-size:10px; }
.entry-list,.object-model-list { display:flex; flex-direction:column; gap:5px; max-height:490px; overflow:auto; margin:0; padding:0; list-style:none; }
.entry-list li { display:flex; align-items:center; gap:7px; padding:5px; border:1px solid transparent; border-radius:5px; background:rgb(0 0 0 / 11%); }
.entry-label { display:flex; flex:1; align-items:center; gap:10px; min-width:0; padding:5px; border:0; color:var(--text); background:transparent; text-align:left; cursor:pointer; }
.entry-label span:last-child,.model-copy { display:flex; flex-direction:column; min-width:0; gap:3px; }
.entry-swatch { display:grid; place-items:center; width:34px; height:30px; border:1px solid var(--border); color:#8dcaff; background:#172b38; }
.remove-entry,.remove-model { flex:none; border:1px solid var(--border); border-radius:4px; color:var(--muted); background:transparent; cursor:pointer; }
.objects-layout { display:grid; grid-template-columns:154px minmax(210px,260px) minmax(360px,1fr); gap:16px; min-height:450px; }
.category-rail { display:flex; flex-direction:column; gap:5px; padding-right:11px; border-right:1px solid var(--border); }
.category-rail button { display:grid; grid-template-columns:22px 1fr auto; align-items:center; gap:7px; padding:9px 8px; border:1px solid transparent; border-radius:5px; color:var(--muted); background:transparent; text-align:left; font:inherit; font-size:12px; cursor:pointer; }
.category-rail button.active { border-color:#34627d; color:var(--text); background:#1d303c; }
.category-symbol { color:#83caff; font-size:15px; text-align:center; }
.category-rail small { opacity:.7; font-size:10px; }
.object-list-pane { display:flex; flex-direction:column; min-height:0; }
.object-model-list { max-height:420px; }
.model-row { display:flex; align-items:center; gap:9px; min-width:0; padding:7px; border:1px solid var(--border); border-radius:5px; color:var(--text); background:rgb(0 0 0 / 12%); text-align:left; cursor:pointer; }
.model-row.active { border-color:#4e9bcc; background:#1c303d; }
.model-thumb { display:grid; flex:none; place-items:center; width:44px; height:40px; overflow:hidden; border:1px solid #3a454e; background:#141a20; color:#81b8db; image-rendering:pixelated; }
.model-thumb svg { width:100%; height:100%; image-rendering:pixelated; }
.model-copy strong,.entry-label strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
.model-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.animated-tag { margin-left:auto; color:#8ccfff; }
.new-model { margin-top:10px; color:#a7d7fa; border-color:#34627d; text-align:left; }
.object-form-pane { display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-height:0; border:1px solid var(--border); border-radius:6px; background:rgb(0 0 0 / 9%); }
.object-form-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 13px 8px; border-bottom:1px solid var(--border); }
.object-form-head h4 { margin:3px 0 0; font-size:14px; }
.remove-model { padding:5px 7px; font-size:11px; }
.object-form-scroll { min-height:0; overflow:auto; padding:0 13px 12px; }
.object-form-scroll label { font-size:11px; }
.section-rule { display:flex; align-items:center; gap:10px; margin:15px 0 4px; color:#9fc4dc; font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
.section-rule::after { height:1px; flex:1; content:""; background:var(--border); }
.asset-picker { padding:9px; border:1px solid var(--border); border-radius:5px; background:#171c21; }
.asset-picker-title { display:flex; justify-content:space-between; gap:8px; margin-bottom:7px; font-size:11px; }
.asset-tile-grid { display:grid; gap:1px; max-height:128px; overflow:auto; padding:3px; border:1px solid #353e46; background:#101419; }
.asset-tile { width:24px; height:24px; padding:0; border:1px solid transparent; background-color:#1b262e; background-repeat:no-repeat; image-rendering:pixelated; cursor:pointer; }
.asset-tile:hover { border-color:#98c9e7; }
.asset-tile.chosen { position:relative; z-index:1; border:2px solid #ffbd64; }
.asset-selection-preview { display:flex; align-items:center; gap:10px; min-height:80px; margin-top:9px; padding:7px; border:1px solid var(--border); background:#101419; }
.sprite-preview { display:grid; flex:none; place-items:center; width:72px; height:64px; overflow:hidden; background:#18212a; image-rendering:pixelated; }
.sprite-preview svg { width:100%; height:100%; image-rendering:pixelated; }
.preview-info { display:flex; flex-direction:column; gap:4px; min-width:0; }
.preview-info strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
.play-preview { padding:3px 6px; font-size:10px; }
.source-size { gap:8px; }
.source-size input { padding:6px; }
.check-field { flex-direction:row!important; align-items:center; gap:7px!important; }
.check-field input { accent-color:#49a2dc; }
.field-hint { color:var(--muted); font-size:10px; line-height:1.4; }
.asset-empty,.empty-state { display:grid; place-items:center; min-height:100px; padding:15px; border:1px dashed var(--border); color:var(--muted); text-align:center; line-height:1.45; font-size:12px; }
.object-form-actions { display:flex; gap:7px; padding:9px 13px; border-top:1px solid var(--border); }
.object-form-actions button { flex:1; font-size:11px; }
.save-panel { max-width:720px; margin:28px auto; }
.kit-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:22px 0; }
.kit-summary div { display:flex; flex-direction:column; gap:5px; padding:15px; border:1px solid var(--border); border-radius:6px; background:rgb(0 0 0 / 12%); }
.kit-summary strong { color:#a4d9ff; font-size:22px; }
.kit-summary span { color:var(--muted); font-size:11px; }
.save-kit { min-width:200px; }
.save-location { color:#9dc88d; overflow-wrap:anywhere; font-size:12px; }
.kit-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:54px; padding:8px 20px; border-top:1px solid var(--border); background:rgb(0 0 0 / 11%); }
.footer-hint,.error { margin:0; color:var(--muted); line-height:1.4; font-size:11px; }
.error { color:#ff9b87; }
.footer-close { min-width:90px; }
@media (max-width: 900px) {
  .kit-dialog { width:96vw; height:95vh; }
  .objects-layout { grid-template-columns:130px minmax(170px,220px) minmax(300px,1fr); gap:9px; }
}
@media (max-width: 720px) {
  .kit-backdrop { padding:0; }
  .kit-dialog { width:100vw; height:100dvh; border-radius:0; }
  .kit-body { padding:15px; }
  .kit-tabs { overflow:auto; padding:0 8px; }
  .kit-tabs button { min-width:92px; padding:11px 8px; font-size:11px; }
  .objects-layout { grid-template-columns:112px minmax(0,1fr); }
  .object-form-pane { grid-column:1 / -1; min-height:480px; }
  .brush-layout { grid-template-columns:1fr; }
  .kit-summary { gap:5px; }
  .kit-summary div { padding:10px; }
}
</style>
