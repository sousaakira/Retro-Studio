<template>
  <section class="map-library">
    <div class="library-heading">
      <strong>{{ t('tilemap.pack.title') }}</strong>
      <div class="library-actions">
      <button type="button" @click="state.openMap()">{{ t('tilemap.openMap') }}</button>
      <button type="button" :disabled="state.packLoading.value || state.packAuthor.exporting.value" @click="state.importAssetPack()">{{ t(state.packLoading.value ? 'tilemap.pack.loading' : 'tilemap.pack.import') }}</button>
      </div>
    </div>
    <section class="recent-maps" :aria-label="t('tilemap.recentKits')">
      <div class="recent-heading">
        <span>{{ t('tilemap.recentKits') }}</span>
        <button v-if="state.recentKits.value.length" type="button" class="clear-recent" @click="state.clearRecentKits()">
          {{ t('tilemap.clearRecentKits') }}
        </button>
      </div>
      <p v-if="!state.recentKits.value.length" class="library-hint recent-empty">{{ t('tilemap.noRecentKits') }}</p>
      <div v-else class="recent-list">
        <div v-for="kit in state.recentKits.value" :key="kit.path" class="recent-row">
          <button type="button" class="recent-open" :class="{ current: kit.path === state.assetPackPath.value }" :title="kit.path" @click="state.openRecentKit(kit)">
            <span aria-hidden="true">▦</span>
            <span class="recent-info"><strong>{{ kit.name }}</strong><small>{{ kit.path }}</small></span>
          </button>
          <button type="button" class="recent-remove" :title="t('tilemap.removeRecentKit')" :aria-label="t('tilemap.removeRecentKit') + ': ' + kit.name" @click="state.removeRecentKit(kit)">×</button>
        </div>
      </div>
    </section>
    <section v-if="pack" class="kit-maps">
      <div class="recent-heading"><span>{{ t('tilemap.kitMaps') }}</span></div>
      <p v-if="!state.assetPackMaps.value.length" class="library-hint recent-empty">{{ t('tilemap.noKitMaps') }}</p>
      <div v-else class="recent-list">
        <button v-for="map in state.assetPackMaps.value" :key="map.path" type="button" class="kit-map-open" :class="{ current: map.path === state.currentMapPath.value }" :title="map.path" @click="state.openRecentMap(map)">
          <span aria-hidden="true">▧</span>
          <span class="recent-info"><strong>{{ map.name }}</strong><small>{{ map.path }}</small></span>
        </button>
      </div>
    </section>
    <TilemapKitEditor :state="state" />
    <p v-if="!pack" class="library-hint">{{ t('tilemap.pack.hint') }}</p>
    <template v-else>
      <p class="library-hint">{{ pack.name }}</p>
      <label>{{ t('tilemap.pack.category') }}
        <select v-model="category"><option value="">{{ t('tilemap.pack.all') }}</option><option v-for="c in categories" :key="c">{{ c }}</option></select>
      </label>
      <div class="brush-grid">
        <button v-for="brush in brushes" :key="brush.id" type="button" class="brush" :class="{ selected: state.selectedPackBrush.value?.id === brush.id }" :aria-pressed="state.selectedPackBrush.value?.id === brush.id" @click="state.selectPackBrush(brush)">
          <svg :viewBox="`${brush.x*8} ${brush.y*8} ${brush.w*8} ${brush.h*8}`" aria-hidden="true">
            <image :href="tileset(brush)?.preview" :width="(tileset(brush)?.columns || 1)*8" :height="Math.ceil((tileset(brush)?.tilecount || 1)/(tileset(brush)?.columns || 1))*8" />
          </svg>
          <span>{{ brush.name }}</span>
        </button>
      </div>
      <p class="library-hint">{{ t('tilemap.pack.paintHint') }}</p>
    </template>
    <h4>{{ t('tilemap.pack.objects') }}</h4>
    <div class="object-category-filter" :aria-label="t('tilemap.pack.objectCategory')">
      <button v-for="cat in objectCategories" :key="cat" type="button" :class="{ active: objectCategory === cat }" @click="objectCategory = cat">{{ t(`tilemap.pack.category_${cat}`) }}</button>
    </div>
    <div v-if="!visibleObjectTemplates.length" class="object-empty">{{ t('tilemap.pack.emptyCategory') }}</div>
    <div v-else class="object-template-grid">
      <button v-for="item in visibleObjectTemplates" :key="item.index" type="button" class="object-template" :class="{ selected: state.objectTemplateIndex.value === item.index }" :aria-pressed="state.objectTemplateIndex.value === item.index" @click="state.objectTemplateIndex.value = item.index">
        <span class="object-template-preview"><svg v-if="templatePreview(item.object)" :viewBox="templatePreview(item.object).viewBox" aria-hidden="true"><image :href="templatePreview(item.object).href" :width="templatePreview(item.object).imageWidth" :height="templatePreview(item.object).imageHeight" /></svg><span v-else aria-hidden="true">◇</span><i v-if="(item.object.visual?.frames || 1) > 1">↻</i></span>
        <span class="object-template-name">{{ item.object.name }}</span>
      </button>
    </div>
    <button type="button" class="wide" @click="state.selectDrawTool('object')">{{ t('tilemap.pack.placeObject') }}</button>
    <p class="library-hint">{{ t('tilemap.pack.objectHint') }}</p>
    <fieldset v-if="selected">
      <legend>{{ t('tilemap.pack.selected') }} #{{ selected.id }}</legend>
      <label v-for="field in ['name', 'type']" :key="field">{{ t(`tilemap.pack.${field}`) }}
        <input :value="selected[field]" @change="state.updateSelectedObject(field, $event.target.value)" />
      </label>
      <div class="object-dimensions">
        <label v-for="field in ['x', 'y', 'width', 'height']" :key="field">{{ t(`tilemap.pack.${field}`) }}
          <input type="number" :min="field === 'width' || field === 'height' ? 1 : 0" :value="selected[field] ?? 1" @change="state.updateSelectedObject(field, $event.target.value)" />
        </label>
      </div>
      <div class="sprite-nudge" :aria-label="t('tilemap.pack.finePlacement')">
        <strong>{{ t('tilemap.pack.finePlacement') }}</strong>
        <button v-for="direction in spriteDirections" :key="direction.key" type="button" :title="t(`tilemap.pack.nudge_${direction.key}`)" :aria-label="t(`tilemap.pack.nudge_${direction.key}`)" @click="state.updateSelectedObject(direction.field, Number(selected.properties?.[direction.field] || 0) + direction.delta)">{{ direction.icon }}</button>
        <span>1 px</span>
      </div>
      <div class="object-dimensions sprite-offsets">
        <label>{{ t('tilemap.pack.spriteOffsetX') }}
          <input type="number" min="-32" max="32" step="1" :value="selected.properties?.spriteOffsetX ?? 0" @change="state.updateSelectedObject('spriteOffsetX', $event.target.value)" />
        </label>
        <label>{{ t('tilemap.pack.spriteOffsetY') }}
          <input type="number" min="-32" max="32" step="1" :value="selected.properties?.spriteOffsetY ?? 0" @change="state.updateSelectedObject('spriteOffsetY', $event.target.value)" />
        </label>
      </div>
      <p class="library-hint">{{ t('tilemap.pack.spriteOffsetHint') }}</p>
      <label class="ai-request-label">{{ t('tilemap.pack.aiRequest') }}
        <textarea v-model="aiRequest" rows="3" :placeholder="t('tilemap.pack.aiRequestHint')" />
      </label>
      <button type="button" class="wide ai-context-button" @click="copySelectedObjectContext">{{ t('tilemap.pack.copyAiContext') }}</button>
      <p class="library-hint">{{ t('tilemap.pack.aiContextHint') }}</p>
      <label>{{ t('tilemap.pack.properties') }}
        <textarea :value="JSON.stringify(selected.properties || {}, null, 2)" rows="5" spellcheck="false" @change="state.updateSelectedObject('properties', $event.target.value)" />
      </label>
      <button type="button" class="wide" @click="state.deleteSelectedObject()">{{ t('tilemap.pack.deleteObject') }}</button>
    </fieldset>
  </section>
</template>
<script setup>
import TilemapKitEditor from './TilemapKitEditor.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
const props = defineProps({ state: { type: Object, required: true } })
const { t } = useI18n()
const category = ref('')
const objectCategory = ref('scenery')
const aiRequest = ref('')
const objectCategories = ['scenery', 'item', 'enemy', 'interaction', 'marker']
const pack = computed(() => props.state.assetPack.value)
const categories = computed(() => [...new Set((pack.value?.brushes || []).map(b => b.category || ''))])
const brushes = computed(() => (pack.value?.brushes || []).filter(b => !category.value || b.category === category.value))
const visibleObjectTemplates = computed(() => (props.state.objectTemplates.value || []).map((object, index) => ({ object, index })).filter(item => (item.object.category || 'marker') === objectCategory.value))
const spriteDirections = [
  { key: 'left', icon: '←', field: 'spriteOffsetX', delta: -1 },
  { key: 'up', icon: '↑', field: 'spriteOffsetY', delta: -1 },
  { key: 'down', icon: '↓', field: 'spriteOffsetY', delta: 1 },
  { key: 'right', icon: '→', field: 'spriteOffsetX', delta: 1 }
]
const selected = computed(() => props.state.selectedObject.value)
async function copySelectedObjectContext() {
  if (!selected.value) return
  const object = selected.value
  const tileSize = Number(props.state.TILE_SIZE_CONST) || 8
  const centerX = object.x + (object.width || 1) / 2
  const centerY = object.y + (object.height || 1) / 2
  const mapWidth = props.state.mapWidth.value
  const mapHeight = props.state.mapHeight.value
  const region = {
    x: Math.max(0, Math.floor(object.x) - 6),
    y: Math.max(0, Math.floor(object.y) - 6),
    right: Math.min(mapWidth - 1, Math.ceil(object.x + (object.width || 1) - 1) + 6),
    bottom: Math.min(mapHeight - 1, Math.ceil(object.y + (object.height || 1) - 1) + 6)
  }
  const tileGrid = plane => Array.from({ length: region.bottom - region.y + 1 }, (_, row) =>
    Array.from({ length: region.right - region.x + 1 }, (_, column) => plane[(region.y + row) * mapWidth + region.x + column] ?? 0))
  const nearbyObjects = (props.state.objects.value || [])
    .filter(item => item.id !== object.id && Math.max(Math.abs(item.x + (item.width || 1) / 2 - centerX), Math.abs(item.y + (item.height || 1) / 2 - centerY)) <= 12)
    .sort((a, b) => Math.hypot(a.x - object.x, a.y - object.y) - Math.hypot(b.x - object.x, b.y - object.y))
    .slice(0, 20)
    .map(({ animationStart, ...item }) => item)
  const { animationStart, ...selectedObject } = object
  const context = {
    map: {
      name: props.state.currentMapName.value,
      sizeTiles: { width: props.state.mapWidth.value, height: props.state.mapHeight.value },
      sizePixels: { width: props.state.mapWidth.value * tileSize, height: props.state.mapHeight.value * tileSize },
      tileSizePx: tileSize,
      tilesets: (props.state.userTilesets.value || []).map(({ name, firstgid, columns, tilecount }) => ({ name, firstgid, columns, tilecount }))
    },
    mapAreaAroundSelection: {
      originTile: { x: region.x, y: region.y },
      sizeTiles: { width: region.right - region.x + 1, height: region.bottom - region.y + 1 },
      backgroundTileIds: tileGrid(props.state.tiles.value || []),
      foregroundTileIds: tileGrid(props.state.tiles2.value || []),
      collisionValues: tileGrid(props.state.collisionMap.value || [])
    },
    selectedObject: {
      ...selectedObject,
      positionPixels: { x: object.x * tileSize, y: object.y * tileSize },
      sizePixels: { width: (object.width || 1) * tileSize, height: (object.height || 1) * tileSize }
    },
    nearbyObjects,
    nearbyObjectsRadiusTiles: 12,
    request: aiRequest.value.trim() || undefined
  }
  const text = `${t('tilemap.pack.aiContextIntro')}\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``
  try {
    await navigator.clipboard.writeText(text)
    window.retroStudioToast?.success?.(t('tilemap.pack.aiContextCopied'))
  } catch {
    window.retroStudioToast?.error?.(t('tilemap.pack.aiContextCopyError'))
  }
}
function tileset(b) { return props.state.userTilesets.value.find(ts => ts.path === props.state.assetPackTilesets.value[b.tileset]) }
function templatePreview(object) {
  const visual = object?.visual
  if (!visual?.tileset || !pack.value) return null
  const source = props.state.assetPackTilesets.value[visual.tileset]
  const ts = props.state.userTilesets.value.find(item => item.path === source)
  if (!ts?.preview) return null
  return { href: ts.preview, viewBox: `${visual.x * 8} ${visual.y * 8} ${visual.w * 8} ${visual.h * 8}`, imageWidth: ts.columns * 8, imageHeight: Math.ceil(ts.tilecount / ts.columns) * 8 }
}
</script>
<style scoped>
.sprite-nudge { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:14px; font-size:11px; }
.ai-request-label { margin-top:14px; }
.ai-context-button { border-color:var(--accent, #7fa9cb); }
.sprite-nudge strong { flex-basis:100%; font-weight:500; margin-bottom:3px; }
.sprite-nudge button { min-width:34px; min-height:30px; font-size:17px; }
.map-library { padding: 12px; border-bottom: 1px solid var(--border); color: var(--text); font-size: 12px; }
.library-heading { display:flex; flex-direction:column; align-items:stretch; gap:8px; }
.library-actions { display:flex; flex-wrap:wrap; gap:6px; }
.library-actions button { flex:1; white-space:nowrap; }
.recent-maps { margin:10px 0 12px; }
.recent-heading { display:flex; align-items:center; justify-content:space-between; gap:6px; font-weight:600; }
.clear-recent, .recent-remove { flex:none; padding:3px 7px; font-size:11px; }
.recent-list { display:flex; flex-direction:column; gap:4px; margin-top:6px; max-height:156px; overflow:auto; }
.recent-row { display:flex; align-items:stretch; gap:4px; min-width:0; }
.recent-open { display:flex; flex:1; align-items:center; gap:8px; min-width:0; text-align:left; }
.recent-open.current { border-color:var(--accent, #7fa9cb); }
.recent-info { display:flex; flex-direction:column; min-width:0; line-height:1.25; }
.recent-info strong, .recent-info small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.recent-info small { opacity:.65; font-size:10px; }
.recent-empty { margin:5px 0; }
.kit-maps { margin:10px 0 12px; padding-top:8px; border-top:1px solid var(--border); }
.kit-map-open { display:flex; width:100%; align-items:center; gap:8px; min-width:0; margin-top:4px; text-align:left; }
.kit-map-open.current { border-color:var(--accent, #7fa9cb); }
.library-hint { opacity:.75; line-height:1.45; margin:8px 0; }
label { display:flex; flex-direction:column; gap:4px; margin:8px 0; }
button, input, select, textarea { font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px; min-width:0; }
button { cursor:pointer; } button:disabled { opacity:.6; cursor:wait; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline:2px solid var(--accent, #7fa9cb); outline-offset:2px; }
.brush-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:6px; margin:10px 0; max-height:300px; overflow:auto; }
.brush { display:flex; flex-direction:column; align-items:center; gap:4px; }
.brush.selected { border-color:var(--accent, #7fa9cb); box-shadow:inset 0 0 0 1px var(--accent, #7fa9cb); }
.brush svg { width:100%; height:60px; image-rendering:pixelated; background:#172329; }
.brush span { line-height:1.3; }
.object-dimensions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 8px; }
.object-category-filter { display:flex; flex-wrap:wrap; gap:3px; margin:7px 0; }
.object-category-filter button { padding:4px 6px; font-size:10px; }
.object-category-filter button.active { border-color:var(--accent, #7fa9cb); color:var(--text); background:rgba(68,145,194,.16); }
.object-template-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; max-height:190px; overflow:auto; }
.object-template { display:flex; min-width:0; flex-direction:column; align-items:center; gap:4px; padding:4px; border:1px solid var(--border); border-radius:4px; color:var(--text); background:var(--bg); cursor:pointer; }
.object-template.selected { border-color:var(--accent, #7fa9cb); box-shadow:inset 0 0 0 1px var(--accent, #7fa9cb); }
.object-template-preview { position:relative; display:grid; place-items:center; width:100%; height:42px; overflow:hidden; color:#86bfdf; background:#172329; image-rendering:pixelated; }
.object-template-preview svg { width:100%; height:100%; image-rendering:pixelated; }
.object-template-preview i { position:absolute; top:1px; right:3px; color:#fff; font-size:12px; font-style:normal; text-shadow:0 1px 2px #000; }
.object-template-name { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
.object-empty { padding:10px; color:var(--muted, #999); font-size:11px; line-height:1.4; }
fieldset { border:1px solid var(--border); padding:8px; margin:10px 0 0; min-width:0; }
textarea { resize:vertical; font-family:monospace; } .wide { width:100%; } h4 { margin:16px 0 8px; }
</style>
