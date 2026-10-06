<template>
  <div class="kit-editor">
    <button type="button" class="wide open-kit" :disabled="a.exporting.value" :aria-expanded="a.authoring.value" @click="openModal">
      <span aria-hidden="true">▦</span> {{ t(pack ? 'tilemap.pack.editKit' : 'tilemap.pack.createKit') }}
    </button>
    <Teleport to="body">
      <div v-if="a.authoring.value && pack" class="kit-backdrop" :class="{ expanded: expandedModal }" @click.self="closeModal" @keydown.esc.stop.prevent="closeModal" @keydown.tab="trapFocus">
        <section class="kit-dialog" :class="{ expanded: expandedModal }" role="dialog" aria-modal="true" :aria-label="t('tilemap.pack.editKit')" :aria-busy="a.exporting.value">
          <header class="kit-header">
            <div class="kit-heading">
              <span class="kit-mark" aria-hidden="true">▦</span>
              <div><small>{{ t('tilemap.pack.title') }}</small><h2>{{ pack.name || t('tilemap.pack.newName') }}</h2></div>
            </div>
            <div class="kit-window-controls">
              <button type="button" class="close-kit" :aria-label="t(expandedModal ? 'tilemap.pack.restoreModal' : 'tilemap.pack.expandModal')" :title="t(expandedModal ? 'tilemap.pack.restoreModal' : 'tilemap.pack.expandModal')" :aria-pressed="expandedModal" @click="expandedModal = !expandedModal"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path v-if="expandedModal" d="M5 5V2h9v9h-3M2 5h9v9H2z"/><rect v-else x="2" y="2" width="12" height="12"/></svg></button>
            <button ref="closeButton" type="button" class="close-kit" :aria-label="t('tilemap.pack.close')" @click="closeModal">×</button>
            </div>
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
              <section class="kit-palette-panel" :aria-label="t('tilemap.tilePalette')">
                <div class="kit-palette-heading">
                  <strong>{{ t('tilemap.tilePalette') }}</strong>
                  <div class="kit-palette-controls">
                    <label class="kit-palette-select">{{ t('tilemap.pack.chooseTileset') }}
                      <select :value="brushTileset?.id || ''" :disabled="!state.userTilesets.value.length" @change="selectBrushTileset($event.target.value)">
                        <option v-for="tileset in state.userTilesets.value" :key="tileset.id" :value="tileset.id">{{ tileset.name }}</option>
                      </select>
                    </label>
                    <button type="button" class="quiet-action add-palette-tileset" @click="state.addTileset()">＋ {{ t('tilemap.addTileset') }}</button>
                  </div>
                </div>
                <div v-if="brushTileset?.preview" class="kit-palette-scroll">
                  <div class="kit-palette-stage" :style="kitPaletteStageStyle" @pointerdown="onKitPalettePointerDown" @pointermove="onKitPalettePointerMove" @pointerup="stopKitPaletteSelection" @pointercancel="stopKitPaletteSelection">
                    <img ref="kitPaletteImage" :src="brushTileset.preview" alt="" draggable="false" @load="syncKitPaletteImage" />
                    <div class="kit-palette-selection" :style="kitPaletteSelectionStyle" aria-hidden="true" />
                  </div>
                </div>
                <div v-else class="kit-palette-empty">{{ t('tilemap.pack.addTilesetForPalette') }}</div>
                <p class="kit-palette-help">{{ t('tilemap.pack.paletteHelp') }}</p>
              </section>
              <div class="brush-layout">
                <div class="form-pane">
                  <div class="selection-preview">
                    <div class="brush-collision-visual" :class="`collision-${draft.collision || 'none'}`" :style="brushCollisionPreviewStyle" role="img" :aria-label="t(`tilemap.pack.collision_${draft.collision || 'none'}`)"><span class="collision-shape" aria-hidden="true" /></div>
                    <div class="brush-selection-copy"><span class="preview-caption">{{ t('tilemap.pack.currentSelection') }}</span><strong>{{ draft.name || t('tilemap.pack.regionSize', { w: state.selectedTileRegion.value.w, h: state.selectedTileRegion.value.h }) }}</strong><small>{{ t('tilemap.pack.regionSize', { w: state.selectedTileRegion.value.w, h: state.selectedTileRegion.value.h }) }} · {{ state.selectedTileset.value?.name || t('tilemap.pack.noTileset') }}</small><div class="brush-config-tags"><span class="collision-badge" :class="`collision-badge-${draft.collision || 'none'}`"><i aria-hidden="true">{{ draft.collision === 'solid' ? '■' : draft.collision === 'top' ? '━' : draft.collision === 'damage' ? '!' : '○' }}</i>{{ t(`tilemap.pack.collision_${draft.collision || 'none'}`) }}</span><span class="layer-badge">{{ t('tilemap.pack.layer') }}: {{ (draft.layer || 'bg').toUpperCase() }}</span></div></div>
                  </div>
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
                  <ul v-else class="entry-list"><li v-for="b in pack.brushes" :key="b.id" :class="{ active: a.editingBrushId.value === b.id }"><button type="button" class="entry-label" :aria-pressed="a.editingBrushId.value === b.id" @click="editSavedBrush(b)"><span class="entry-swatch" aria-hidden="true">▧</span><span><strong>{{ b.name }}</strong><small>{{ b.category || t('tilemap.pack.uncategorized') }} · {{ b.w }}×{{ b.h }}</small></span></button><button type="button" class="remove-entry" :aria-label="`${t('tilemap.pack.removeEntry')}: ${b.name}`" @click="a.removeBrush(b.id)">×</button></li></ul>
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
                      <span class="model-thumb"><TilemapObjectPreview v-if="previewFor(item.object)" :tileset="previewFor(item.object).tileset" :visual="item.object.visual" :object-width="item.object.width" :object-height="item.object.height" show-collision /><span v-else aria-hidden="true">◇</span></span>
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
                    <label>{{ t('tilemap.pack.objectCategory') }}<select v-model="objectDraft.category" @change="assetKindFilter = 'all'"><option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ t(`tilemap.pack.category_${cat.id}`) }}</option></select></label>
                    <div class="section-rule"><span>{{ t('tilemap.pack.visualAsset') }}</span></div>
                    <div v-if="hasVisualCatalog" class="asset-mode-switch" :aria-label="t('tilemap.pack.assetSelectionMode')">
                      <button type="button" :class="{ active: assetMode === 'catalog' }" @click="assetMode = 'catalog'">{{ t('tilemap.pack.assetCatalog') }}</button>
                      <button type="button" :class="{ active: assetMode === 'manual' }" @click="assetMode = 'manual'">{{ t('tilemap.pack.manualAtlas') }}</button>
                    </div>
                    <div v-if="hasVisualCatalog && assetMode === 'catalog'" class="visual-asset-library">
                      <div class="asset-library-heading"><strong>{{ t('tilemap.pack.assetsForCategory', { category: t(`tilemap.pack.category_${objectDraft.category}`) }) }}</strong><span>{{ visibleVisualAssets.length }}</span></div>
                      <div v-if="availableAssetKinds.length > 1" class="asset-kind-filter" :aria-label="t('tilemap.pack.assetKindFilter')">
                        <button v-for="kind in availableAssetKinds" :key="kind.id" type="button" :class="{ active: assetKindFilter === kind.id }" @click="assetKindFilter = kind.id">{{ t(`tilemap.pack.assetKind_${kind.id}`) }} <small>{{ kind.count }}</small></button>
                      </div>
                      <div v-if="visibleVisualAssets.length" class="visual-asset-grid">
                        <article v-for="asset in visibleVisualAssets" :key="asset.id" class="visual-asset-card" :class="{ chosen: assetMatchesDraft(asset) }">
                          <button type="button" class="visual-asset-select" :aria-pressed="assetMatchesDraft(asset)" @click="chooseVisualAsset(asset)">
                            <span class="visual-asset-thumb"><svg v-if="visualAssetPreview(asset)" :viewBox="visualAssetPreview(asset).viewBox" aria-hidden="true"><image :href="visualAssetPreview(asset).href" :width="visualAssetPreview(asset).imageWidth" :height="visualAssetPreview(asset).imageHeight" /></svg><span v-else>◇</span></span>
                            <span class="visual-asset-copy"><strong>{{ asset.name }}</strong><small>{{ t(`tilemap.pack.assetKind_${asset.kind || (asset.frames > 1 ? 'animation' : 'sprite')}`) }} · {{ asset.w }} × {{ asset.h }} {{ t('tilemap.pack.tilesUnit') }}<template v-if="asset.frames > 1"> · {{ t('tilemap.pack.animationSummary', { frames: asset.frames, fps: asset.fps }) }}</template></small></span>
                          </button>
                          <button type="button" class="visual-asset-remove" :title="t('tilemap.pack.removeAsset')" :aria-label="t('tilemap.pack.removeAsset') + ': ' + asset.name" @click="a.removeVisualAsset(asset.id)">×</button>
                        </article>
                      </div>
                      <div v-else class="asset-empty">{{ t('tilemap.pack.noAssetsForCategory') }} <button type="button" class="text-action" @click="assetMode = 'manual'">{{ t('tilemap.pack.manualAtlas') }}</button></div>
                    </div>
                    <div v-else class="manual-asset-picker">
                      <label>{{ t('tilemap.pack.chooseTileset') }}<select v-model="objectDraft.visual.tilesetId" @change="onTilesetChanged"><option value="">{{ t('tilemap.pack.noVisual') }}</option><option v-for="ts in state.userTilesets.value" :key="ts.id" :value="ts.id">{{ ts.name }}</option></select></label>
                      <div v-if="selectedTileset" class="asset-picker">
                        <TilemapAnimationEditor :tileset="selectedTileset" :visual="objectDraft.visual" @update="Object.assign(objectDraft.visual, $event)" />
                        <div class="asset-library-save">
                          <div class="form-row"><label>{{ t('tilemap.pack.assetName') }}<input v-model="catalogAssetName" maxlength="64" :placeholder="t('tilemap.pack.assetNameHint')" /></label><label>{{ t('tilemap.pack.objectCategory') }}<select v-model="catalogAssetCategory"><option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ t(`tilemap.pack.category_${cat.id}`) }}</option></select></label></div>
                          <button type="button" class="quiet-action" :disabled="!catalogAssetName.trim()" @click="saveCurrentVisualAsset">{{ t('tilemap.pack.saveAssetToCatalog') }}</button>
                        </div>
                      </div>
                      <div v-else class="asset-empty">{{ t('tilemap.pack.addTilesetForVisual') }}</div>
                    </div>
                    <div v-if="selectedTileset" class="asset-selection-preview">
                      <div class="sprite-preview"><svg :viewBox="`0 0 ${spriteStage.width} ${spriteStage.height}`" :aria-label="t('tilemap.pack.visualPreview')"><rect :x="spriteStage.boxX" :y="spriteStage.boxY" :width="objectDraft.width * 8" :height="objectDraft.height * 8" class="preview-collision"/><svg :x="spriteStage.spriteX" :y="spriteStage.spriteY" :width="spriteStage.spriteWidth" :height="spriteStage.spriteHeight" :viewBox="spriteViewBox" preserveAspectRatio="none"><image :href="selectedTileset.preview" :width="selectedTileset.columns * 8" :height="Math.ceil(selectedTileset.tilecount / selectedTileset.columns) * 8" /></svg></svg></div>
                      <div class="preview-info"><strong>{{ objectDraft.name || t('tilemap.pack.newObject') }}</strong><small>{{ objectDraft.visual.w }} × {{ objectDraft.visual.h }} {{ t('tilemap.pack.tilesUnit') }}</small><small v-if="objectDraft.visual.displayWidth || objectDraft.visual.displayHeight">{{ objectDraft.visual.displayWidth || objectDraft.width * 8 }} × {{ objectDraft.visual.displayHeight || objectDraft.height * 8 }} px · {{ t(objectDraft.visual.anchor === 'center' ? 'tilemap.pack.anchorCenter' : objectDraft.visual.anchor === 'bottom-center' ? 'tilemap.pack.anchorBottomCenter' : 'tilemap.pack.anchorTopLeft') }}</small><button v-if="objectDraft.visual.frames > 1" type="button" class="play-preview" :disabled="reducedMotion" @click="state.previewAnimations.value = !state.previewAnimations.value">{{ state.previewAnimations.value ? 'Ⅱ' : '▶' }} {{ t(state.previewAnimations.value ? 'tilemap.pack.pausePreview' : 'tilemap.pack.playPreview') }}</button><small v-if="objectDraft.visual.frames > 1">{{ t('tilemap.pack.animationSummary', { frames: objectDraft.visual.frames, fps: objectDraft.visual.fps }) }}</small></div>
                    </div>
                    <div v-if="selectedTileset" class="asset-configuration">
                      <div v-if="hasVisualCatalog && assetMode === 'catalog'" class="form-row source-size"><label>{{ t('tilemap.pack.sourceWidth') }}<input v-model.number="objectDraft.visual.w" type="number" min="1" max="64" /></label><label>{{ t('tilemap.pack.sourceHeight') }}<input v-model.number="objectDraft.visual.h" type="number" min="1" max="64" /></label></div>
                      <div class="section-rule"><span>{{ t('tilemap.pack.spritePlacement') }}</span></div>
                      <div class="form-row"><label>{{ t('tilemap.pack.previewWidth') }}<input v-model.number="objectDraft.visual.displayWidth" type="number" min="0" max="256" /></label><label>{{ t('tilemap.pack.previewHeight') }}<input v-model.number="objectDraft.visual.displayHeight" type="number" min="0" max="256" /></label></div>
                      <label>{{ t('tilemap.pack.spriteAnchor') }}<select v-model="objectDraft.visual.anchor"><option value="top-left">{{ t('tilemap.pack.anchorTopLeft') }}</option><option value="center">{{ t('tilemap.pack.anchorCenter') }}</option><option value="bottom-center">{{ t('tilemap.pack.anchorBottomCenter') }}</option></select></label>
                      <p class="field-hint">{{ t('tilemap.pack.spritePlacementHint') }}</p>
                      <template v-if="hasVisualCatalog && assetMode === 'catalog'">
                      <div class="section-rule"><span>{{ t('tilemap.pack.animation') }}</span></div>
                      <div class="form-row"><label>{{ t('tilemap.pack.frameCount') }}<input v-model.number="objectDraft.visual.frames" type="number" min="1" max="16" /></label><label>{{ t('tilemap.pack.frameRate') }}<input v-model.number="objectDraft.visual.fps" type="number" min="1" max="12" /></label></div>
                      <label class="check-field"><input v-model="objectDraft.visual.loop" type="checkbox" />{{ t('tilemap.pack.loopAnimation') }}</label>
                      <p class="field-hint">{{ t('tilemap.pack.animationHint') }}</p>
                      </template>
                    </div>
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
import TilemapAnimationEditor from './TilemapAnimationEditor.vue'
import TilemapObjectPreview from './TilemapObjectPreview.vue'
import { normalizeAssetPath } from '../../../utils/retro/tilemapAssetPack.js'

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
const assetMode = ref('catalog')
const catalogAssetName = ref('')
const catalogAssetCategory = ref('scenery')
const assetKindFilter = ref('all')
const reducedMotion = ref(false)
const closeButton = ref(null)
const expandedModal = ref(false)
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
const objectDraft = reactive({ name: '', type: '', category: 'scenery', width: 1, height: 1, properties: {}, visual: { tilesetId: '', x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 4, loop: true, displayWidth: null, displayHeight: null, anchor: 'top-left' } })
const selectedTileset = computed(() => props.state.userTilesets.value.find(ts => ts.id === objectDraft.visual.tilesetId) || null)
const hasVisualCatalog = computed(() => (pack.value?.visualAssets || []).length > 0)
const categoryVisualAssets = computed(() => (pack.value?.visualAssets || []).filter(asset => !asset.category || asset.category === objectDraft.category))
const availableAssetKinds = computed(() => {
  const kinds = ['sprite', 'animation'].map(id => ({ id, count: categoryVisualAssets.value.filter(asset => (asset.kind || (asset.frames > 1 ? 'animation' : 'sprite')) === id).length })).filter(kind => kind.count)
  return kinds.length > 1 ? [{ id: 'all', count: categoryVisualAssets.value.length }, ...kinds] : kinds
})
const visibleVisualAssets = computed(() => categoryVisualAssets.value.filter(asset => assetKindFilter.value === 'all' || (asset.kind || (asset.frames > 1 ? 'animation' : 'sprite')) === assetKindFilter.value))
const kitPaletteImage = ref(null)
const kitPaletteSize = ref({ width: 0, height: 0 })
const kitPaletteDragStart = ref(null)
const brushTileset = computed(() => props.state.selectedTileset.value || props.state.userTilesets.value[0] || null)
const kitPaletteTileSize = computed(() => props.state.TILE_SIZE_CONST || 8)
const kitPaletteZoom = 2
const kitPaletteColumns = computed(() => kitPaletteSize.value.width
  ? Math.max(1, Math.floor(kitPaletteSize.value.width / kitPaletteTileSize.value))
  : Math.max(1, brushTileset.value?.columns || 16))
const kitPaletteRows = computed(() => kitPaletteSize.value.height
  ? Math.max(1, Math.ceil(kitPaletteSize.value.height / kitPaletteTileSize.value))
  : Math.max(1, Math.ceil((brushTileset.value?.tilecount || 0) / kitPaletteColumns.value)))
const kitPaletteStageStyle = computed(() => ({
  width: `${kitPaletteColumns.value * kitPaletteTileSize.value * kitPaletteZoom}px`,
  height: `${kitPaletteRows.value * kitPaletteTileSize.value * kitPaletteZoom}px`
}))
const kitPaletteSelectionStyle = computed(() => {
  const region = props.state.selectedTileRegion.value || { idx: 0, w: 1, h: 1 }
  const x = region.idx % kitPaletteColumns.value
  const y = Math.floor(region.idx / kitPaletteColumns.value)
  const unit = kitPaletteTileSize.value * kitPaletteZoom
  return { left: `${x * unit}px`, top: `${y * unit}px`, width: `${Math.max(1, region.w) * unit}px`, height: `${Math.max(1, region.h) * unit}px` }
})
const spriteViewBox = computed(() => {
  const visual = objectDraft.visual
  const elapsedFrame = Math.floor(previewTime.value * visual.fps / 1000)
  const frame = visual.frames > 1 && props.state.previewAnimations.value && !reducedMotion.value
    ? (visual.loop ? elapsedFrame % visual.frames : Math.min(visual.frames - 1, elapsedFrame))
    : 0
  return `${(visual.x + frame * visual.w) * 8} ${visual.y * 8} ${visual.w * 8} ${visual.h * 8}`
})
const spriteStage = computed(() => {
  const boxWidth = Math.max(8, Number(objectDraft.width) || 1) * 8
  const boxHeight = Math.max(8, Number(objectDraft.height) || 1) * 8
  const spriteWidth = Math.max(1, Number(objectDraft.visual.displayWidth) || boxWidth)
  const spriteHeight = Math.max(1, Number(objectDraft.visual.displayHeight) || boxHeight)
  const width = Math.max(boxWidth, spriteWidth)
  const height = Math.max(boxHeight, spriteHeight)
  const boxX = (width - boxWidth) / 2
  const boxY = height - boxHeight
  const anchor = objectDraft.visual.anchor || 'top-left'
  let spriteX = boxX, spriteY = boxY
  if (anchor === 'center') { spriteX += (boxWidth - spriteWidth) / 2; spriteY += (boxHeight - spriteHeight) / 2 }
  else if (anchor === 'bottom-center') { spriteX += (boxWidth - spriteWidth) / 2; spriteY += boxHeight - spriteHeight }
  return { width, height, boxX, boxY, spriteX, spriteY, spriteWidth, spriteHeight }
})
const brushCollisionPreviewStyle = computed(() => {
  const tileset = props.state.selectedTileset.value
  const region = props.state.selectedTileRegion.value || { idx: 0, w: 1, h: 1 }
  const columns = Math.max(1, tileset?.columns || 16)
  const tileX = (region.idx || 0) % columns
  const tileY = Math.floor((region.idx || 0) / columns)
  const zoom = Math.min(2, 176 / (Math.max(1, region.w) * 8), 64 / (Math.max(1, region.h) * 8))
  const tilePixels = 8 * zoom
  return {
    width: `${Math.max(16, region.w * tilePixels)}px`,
    height: `${Math.max(16, region.h * tilePixels)}px`,
    backgroundImage: tileset?.preview ? `url("${tileset.preview}")` : 'linear-gradient(135deg, #26313b, #171c21)',
    backgroundSize: tileset?.preview ? `${columns * tilePixels}px auto` : undefined,
    backgroundPosition: tileset?.preview ? `${-tileX * tilePixels}px ${-tileY * tilePixels}px` : undefined
  }
})
const categoryObjects = computed(() => (pack.value?.objects || []).map((object, index) => ({ object, index })).filter(item => (item.object.category || 'marker') === selectedCategory.value))

function openModal() { openerElement = document.activeElement; a.openAuthoring() }
function selectBrushTileset(id) {
  const tileset = props.state.userTilesets.value.find(item => item.id === id)
  if (tileset) props.state.selectTileset(tileset)
}
function editSavedBrush(brush) {
  const sourcePath = props.state.assetPackTilesets.value[brush.tileset]
  const tileset = props.state.userTilesets.value.find(item => normalizeAssetPath(item.path) === normalizeAssetPath(sourcePath || ''))
  if (tileset) {
    props.state.selectTileset(tileset)
    const columns = Math.max(1, tileset.columns || 16)
    props.state.selectedTileRegion.value = {
      idx: (brush.y || 0) * columns + (brush.x || 0),
      w: Math.max(1, brush.w || 1),
      h: Math.max(1, brush.h || 1)
    }
  }
  a.editBrush(brush)
}
function syncKitPaletteImage(event) {
  const image = event?.target || kitPaletteImage.value
  if (!image?.naturalWidth || !image?.naturalHeight) return
  kitPaletteSize.value = { width: image.naturalWidth, height: image.naturalHeight }
  if (brushTileset.value) {
    brushTileset.value.columns = Math.max(1, Math.floor(image.naturalWidth / kitPaletteTileSize.value))
    brushTileset.value.tilecount = brushTileset.value.columns * Math.ceil(image.naturalHeight / kitPaletteTileSize.value)
  }
}
function paletteTileAt(event) {
  const stage = kitPaletteImage.value?.parentElement
  if (!stage) return null
  const rect = stage.getBoundingClientRect()
  const unit = kitPaletteTileSize.value * kitPaletteZoom
  const x = Math.max(0, Math.min(kitPaletteColumns.value - 1, Math.floor((event.clientX - rect.left) / unit)))
  const y = Math.max(0, Math.min(kitPaletteRows.value - 1, Math.floor((event.clientY - rect.top) / unit)))
  return { x, y, idx: y * kitPaletteColumns.value + x }
}
function setPaletteRegion(start, end) {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  props.state.selectedTileRegion.value = {
    idx: top * kitPaletteColumns.value + left,
    w: Math.abs(end.x - start.x) + 1,
    h: Math.abs(end.y - start.y) + 1
  }
}
function onKitPalettePointerDown(event) {
  if (event.button !== 0) return
  const tile = paletteTileAt(event)
  if (!tile) return
  event.preventDefault()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  kitPaletteDragStart.value = tile
  setPaletteRegion(tile, tile)
}
function onKitPalettePointerMove(event) {
  if (!kitPaletteDragStart.value) return
  const tile = paletteTileAt(event)
  if (tile) setPaletteRegion(kitPaletteDragStart.value, tile)
}
function stopKitPaletteSelection() { kitPaletteDragStart.value = null }
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
function visualAssetPreview(asset) {
  const source = props.state.assetPackTilesets.value[asset.tileset]
  const ts = props.state.userTilesets.value.find(item => item.path === source)
  if (!ts?.preview) return null
  return { href: ts.preview, viewBox: `${asset.x * 8} ${asset.y * 8} ${asset.w * 8} ${asset.h * 8}`, imageWidth: ts.columns * 8, imageHeight: Math.ceil(ts.tilecount / ts.columns) * 8 }
}
function assetMatchesDraft(asset) {
  const source = props.state.assetPackTilesets.value[asset.tileset]
  const ts = props.state.userTilesets.value.find(item => item.id === objectDraft.visual.tilesetId)
  return !!ts && ts.path === source && asset.x === objectDraft.visual.x && asset.y === objectDraft.visual.y && asset.w === objectDraft.visual.w && asset.h === objectDraft.visual.h && (asset.frames || 1) === objectDraft.visual.frames
}
function chooseVisualAsset(asset) {
  const source = props.state.assetPackTilesets.value[asset.tileset]
  const ts = props.state.userTilesets.value.find(item => item.path === source)
  if (!ts) return
  Object.assign(objectDraft.visual, {
    tilesetId: ts.id, x: asset.x, y: asset.y, w: asset.w, h: asset.h,
    frames: asset.frames || 1, fps: asset.fps || 4, loop: asset.loop !== false,
    displayWidth: asset.displayWidth || null, displayHeight: asset.displayHeight || null,
    anchor: asset.anchor || 'top-left'
  })
}
function saveCurrentVisualAsset() {
  if (!selectedTileset.value || !catalogAssetName.value.trim()) return
  if (a.saveVisualAsset({ name: catalogAssetName.value, category: catalogAssetCategory.value, kind: objectDraft.visual.frames > 1 ? 'animation' : 'sprite', visual: { ...objectDraft.visual } })) {
    catalogAssetName.value = ''
    assetMode.value = 'catalog'
  }
}
function previewFor(object) {
  const visual = object?.visual
  if (!visual?.tileset || !pack.value) return null
  const path = props.state.assetPackTilesets.value[visual.tileset]
  const ts = props.state.userTilesets.value.find(item => item.path === path)
  if (!ts?.preview) return null
  return { tileset: ts }
}
function resetObjectDraft(category = selectedCategory.value) {
  catalogAssetCategory.value = category
  assetKindFilter.value = 'all'
  Object.assign(objectDraft, { name: '', type: '', category, width: 1, height: 1, properties: {}, visual: { tilesetId: selectedTileset.value?.id || '', x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 4, loop: true, displayWidth: null, displayHeight: null, anchor: 'top-left' } })
  propertiesText.value = '{}'
  previewTime.value = 0
  editingObjectIndex.value = -1
}
function newObject(category = selectedCategory.value) { resetObjectDraft(category) }
function loadObject(object, index) {
  previewTime.value = 0
  assetKindFilter.value = String(object.type || '').toLowerCase().includes('animation') ? 'animation' : 'all'
  const visual = object.visual || {}
  const sourcePath = visual.tileset ? props.state.assetPackTilesets.value[visual.tileset] : ''
  const mappedTileset = props.state.userTilesets.value.find(ts => ts.path === sourcePath)
  const columns = mappedTileset?.columns || 16
  Object.assign(objectDraft, {
    name: object.name, type: object.type, category: object.category || 'marker', width: object.width, height: object.height,
    properties: JSON.parse(JSON.stringify(object.properties || {})),
    visual: visual.tileset ? { tilesetId: mappedTileset?.id || '', x: visual.x, y: visual.y, w: visual.w, h: visual.h, frames: visual.frames || 1, fps: visual.fps || 4, loop: visual.loop !== false, displayWidth: visual.displayWidth || null, displayHeight: visual.displayHeight || null, anchor: visual.anchor || 'top-left' } : { tilesetId: selectedTileset.value?.id || '', x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 4, loop: true, displayWidth: null, displayHeight: null, anchor: 'top-left' }
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
  if (visual && (visual.displayWidth == null || visual.displayWidth === 0)) delete visual.displayWidth
  if (visual && (visual.displayHeight == null || visual.displayHeight === 0)) delete visual.displayHeight
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
watch(() => brushTileset.value?.id, async () => {
  kitPaletteSize.value = { width: 0, height: 0 }
  await nextTick()
  if (kitPaletteImage.value?.complete) syncKitPaletteImage()
})
onMounted(() => {
  if (!props.state.selectedTileset.value && props.state.userTilesets.value[0]) props.state.selectTileset(props.state.userTilesets.value[0])
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
.kit-backdrop.expanded { padding:0; }
.kit-dialog.expanded { width:100vw; height:100dvh; max-width:none; max-height:none; border-radius:0; box-sizing:border-box; }
.kit-window-controls { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.kit-window-controls button { display:grid; place-items:center; }
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
.kit-palette-panel { margin:0 0 20px; padding:13px; border:1px solid var(--border); border-radius:6px; background:rgb(0 0 0 / 12%); }
.kit-palette-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:14px; margin-bottom:9px; font-size:12px; }
.kit-palette-controls { display:flex; align-items:flex-end; gap:8px; }
.kit-palette-select { min-width:210px; margin:0; }
.add-palette-tileset { margin:0; white-space:nowrap; }
.kit-palette-scroll { max-height:260px; overflow:auto; border:1px solid var(--border); background:#101419; touch-action:none; }
.kit-palette-stage { position:relative; user-select:none; cursor:crosshair; }
.kit-palette-stage::after { position:absolute; inset:0; content:""; pointer-events:none; background-image:linear-gradient(to right, rgb(190 215 230 / 14%) 1px, transparent 1px),linear-gradient(to bottom, rgb(190 215 230 / 14%) 1px, transparent 1px); background-size:16px 16px; }
.kit-palette-stage img { display:block; width:100%; height:100%; image-rendering:pixelated; pointer-events:none; user-select:none; }
.kit-palette-selection { position:absolute; z-index:1; box-sizing:border-box; border:2px solid #ffbd64; background:rgb(255 189 100 / 22%); pointer-events:none; }
.kit-palette-empty { display:grid; place-items:center; min-height:90px; padding:14px; border:1px dashed var(--border); color:var(--muted); text-align:center; font-size:12px; }
.kit-palette-help { margin:8px 0 0; color:var(--muted); font-size:11px; }
.brush-layout { display:grid; grid-template-columns:minmax(260px,.8fr) minmax(300px,1.2fr); gap:22px; }
.form-pane,.entry-pane,.object-list-pane,.object-form-pane { min-width:0; }
.selection-preview { display:flex; align-items:center; gap:13px; min-height:88px; padding:10px; border:1px solid var(--border); border-radius:6px; background:rgb(0 0 0 / 12%); }
.brush-collision-visual { position:relative; display:grid; flex:none; place-items:center; max-width:176px; max-height:64px; overflow:hidden; border:1px solid #62717e; background-color:#202a32; background-repeat:no-repeat; image-rendering:pixelated; }
.collision-shape { position:absolute; inset:0; pointer-events:none; }
.collision-solid .collision-shape { border:2px solid #59baff; background:rgb(58 165 235 / 29%); box-shadow:inset 0 0 0 1px rgb(8 32 49 / 65%); }
.collision-top .collision-shape { border-top:4px solid #ffcf68; background:linear-gradient(to bottom, rgb(255 207 104 / 32%), transparent 55%); }
.collision-damage .collision-shape { border:2px solid #ff6666; background:repeating-linear-gradient(135deg, rgb(255 57 57 / 40%) 0 4px, rgb(90 12 18 / 30%) 4px 8px); }
.brush-selection-copy { display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0; }
.collision-badge { display:inline-flex; align-items:center; gap:6px; margin-top:3px; padding:3px 7px; border:1px solid var(--border); border-radius:12px; color:#b9c4cd; background:#252b31; font-size:10px; }
.collision-badge i { font-style:normal; font-size:11px; }
.collision-badge-solid { border-color:#357ba2; color:#9edbff; background:#1b3442; }
.collision-badge-top { border-color:#90733b; color:#ffe09a; background:#382f1d; }
.collision-badge-damage { border-color:#a34b4b; color:#ffaaaa; background:#3b2022; }
.brush-config-tags { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }
.layer-badge { display:inline-flex; align-items:center; min-height:20px; padding:2px 7px; border:1px solid #42505b; border-radius:12px; color:#c2d0da; background:#252b31; font-size:10px; }
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
.entry-list li.active { border-color:#4b91bd; background:#1b303c; box-shadow:inset 2px 0 #73c5f8; }
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
.asset-mode-switch { display:flex; gap:4px; margin:8px 0; padding:3px; width:max-content; max-width:100%; border:1px solid var(--border); border-radius:7px; background:#11171c; }
.asset-mode-switch button { border:0; padding:6px 11px; color:var(--muted); background:transparent; }
.asset-mode-switch button.active { color:var(--text); background:#273541; box-shadow:inset 0 0 0 1px #42647a; }
.visual-asset-library { margin:8px 0; }
.asset-kind-filter { display:flex; gap:4px; margin:-1px 0 7px; flex-wrap:wrap; }
.asset-kind-filter button { padding:4px 8px; color:var(--muted); background:#161c21; border:1px solid var(--border); border-radius:12px; font-size:10px; }
.asset-kind-filter button.active { color:var(--text); background:#283944; border-color:#52758b; }
.asset-kind-filter small { margin-left:3px; opacity:.7; }
.asset-library-heading { display:flex; justify-content:space-between; align-items:center; margin:4px 0 7px; color:var(--muted); font-size:11px; }
.visual-asset-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(185px,1fr)); gap:6px; max-height:210px; overflow:auto; padding:1px 3px 4px 1px; }
.visual-asset-card { display:flex; min-width:0; border:1px solid var(--border); border-radius:6px; background:#171d22; }
.visual-asset-card.chosen { border-color:var(--accent,#4b9bd5); background:#1c2d38; }
.visual-asset-select { display:flex; flex:1; gap:9px; align-items:center; min-width:0; padding:7px; border:0; background:transparent; text-align:left; }
.visual-asset-thumb { display:grid; flex:none; place-items:center; width:52px; height:46px; overflow:hidden; border:1px solid #2d3941; border-radius:4px; background-color:#10171c; background-image:linear-gradient(45deg,#1b252c 25%,transparent 25%),linear-gradient(-45deg,#1b252c 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1b252c 75%),linear-gradient(-45deg,transparent 75%,#1b252c 75%); background-size:12px 12px; background-position:0 0,0 6px,6px -6px,-6px 0; image-rendering:pixelated; }
.visual-asset-thumb svg { width:100%; height:100%; image-rendering:pixelated; }
.visual-asset-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.visual-asset-copy strong { overflow:hidden; color:var(--text); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.visual-asset-copy small { color:var(--muted); font-size:10px; }
.visual-asset-remove { align-self:center; flex:none; margin:0 5px; padding:2px 6px; color:var(--muted); background:transparent; border:0; font-size:16px; }
.visual-asset-remove:hover { color:#ff9b9b; background:#392729; }
.asset-library-save { margin-top:8px; padding:8px; border:1px solid var(--border); border-radius:6px; background:#141a1f; }
.asset-library-save .quiet-action { margin-top:7px; }
.text-action { padding:2px 4px; color:var(--accent); background:transparent; border:0; text-decoration:underline; }
.asset-picker-title { display:flex; justify-content:space-between; gap:8px; margin-bottom:7px; font-size:11px; }
.asset-tile-grid { display:grid; gap:1px; max-height:128px; overflow:auto; padding:3px; border:1px solid #353e46; background:#101419; }
.asset-tile { width:24px; height:24px; padding:0; border:1px solid transparent; background-color:#1b262e; background-repeat:no-repeat; image-rendering:pixelated; cursor:pointer; }
.asset-tile:hover { border-color:#98c9e7; }
.asset-tile.chosen { position:relative; z-index:1; border:2px solid #ffbd64; }
.asset-selection-preview { display:flex; align-items:center; gap:10px; min-height:80px; margin-top:9px; padding:7px; border:1px solid var(--border); background:#101419; }
.sprite-preview { display:grid; flex:none; place-items:center; width:112px; height:84px; overflow:hidden; background:#18212a; image-rendering:pixelated; }
.sprite-preview > svg { width:100%; height:100%; image-rendering:pixelated; overflow:hidden; }
.sprite-preview svg svg { overflow:hidden; }
.preview-collision { fill:rgba(94,168,216,.12); stroke:#86c7f3; stroke-width:1; stroke-dasharray:2 2; vector-effect:non-scaling-stroke; }
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
  .kit-palette-heading,.kit-palette-controls { align-items:stretch; flex-direction:column; }
  .kit-palette-select { min-width:0; }
  .kit-summary { gap:5px; }
  .kit-summary div { padding:10px; }
}
</style>
