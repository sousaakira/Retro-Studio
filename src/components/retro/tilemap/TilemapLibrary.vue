<template>
  <section class="map-library">
    <div class="library-heading">
      <strong>{{ t('tilemap.pack.title') }}</strong>
      <div class="library-actions">
      <button type="button" @click="state.openMap()">{{ t('tilemap.openMap') }}</button>
      <button type="button" :disabled="state.packLoading.value || state.packAuthor.exporting.value" @click="state.importAssetPack()">{{ t(state.packLoading.value ? 'tilemap.pack.loading' : 'tilemap.pack.import') }}</button>
      </div>
    </div>
    <section class="recent-maps" :aria-label="t('tilemap.recentMaps')">
      <div class="recent-heading">
        <span>{{ t('tilemap.recentMaps') }}</span>
        <button v-if="state.recentMaps.value.length" type="button" class="clear-recent" @click="state.clearRecentMaps()">
          {{ t('tilemap.clearRecentMaps') }}
        </button>
      </div>
      <p v-if="!state.recentMaps.value.length" class="library-hint recent-empty">{{ t('tilemap.noRecentMaps') }}</p>
      <div v-else class="recent-list">
        <div v-for="map in state.recentMaps.value" :key="map.path" class="recent-row">
          <button type="button" class="recent-open" :class="{ current: map.path === state.currentMapPath.value }" :title="map.path" @click="state.openRecentMap(map)">
            <span class="icon-map" aria-hidden="true">▧</span>
            <span class="recent-info"><strong>{{ map.name }}</strong><small>{{ map.path }}</small></span>
          </button>
          <button type="button" class="recent-remove" :title="t('tilemap.removeRecentMap')" :aria-label="t('tilemap.removeRecentMap') + ': ' + map.name" @click="state.removeRecentMap(map)">×</button>
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
    <label>{{ t('tilemap.pack.template') }}
      <select v-model.number="state.objectTemplateIndex.value" @change="state.selectDrawTool('object')">
        <option v-for="(o, i) in state.objectTemplates.value" :key="i" :value="i">{{ o.name }}</option>
      </select>
    </label>
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
const pack = computed(() => props.state.assetPack.value)
const categories = computed(() => [...new Set((pack.value?.brushes || []).map(b => b.category || ''))])
const brushes = computed(() => (pack.value?.brushes || []).filter(b => !category.value || b.category === category.value))
const selected = computed(() => props.state.selectedObject.value)
function tileset(b) { return props.state.userTilesets.value.find(ts => ts.path === props.state.assetPackTilesets.value[b.tileset]) }
</script>
<style scoped>
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
fieldset { border:1px solid var(--border); padding:8px; margin:10px 0 0; min-width:0; }
textarea { resize:vertical; font-family:monospace; } .wide { width:100%; } h4 { margin:16px 0 8px; }
</style>
