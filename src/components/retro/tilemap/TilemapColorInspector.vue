<template>
  <section class="map-colors" :aria-label="t('tilemap.colors.title')" :aria-busy="inspector.busy.value">
    <header class="colors-heading">
      <span class="colors-kicker">{{ t('tilemap.colors.kicker') }}</span>
      <div><h3>{{ t('tilemap.colors.title') }}</h3><strong>{{ number(inspector.colors.value.length) }}</strong></div>
      <p>{{ t(inspector.scope.value === 'composition' ? 'tilemap.colors.description' : 'tilemap.colors.isolatedDescription') }}</p>
    </header>
    <label class="color-scope">{{ t('tilemap.colors.scope') }}
      <select v-model="inspector.scope.value"><option value="composition">{{ t('tilemap.colors.composition') }}</option><option value="scenery">{{ t('tilemap.colors.scenery') }}</option><option value="sprites">{{ t('tilemap.colors.sprites') }}</option></select>
    </label>
    <label v-if="inspector.scope.value === 'sprites'" class="color-scope">{{ t('tilemap.colors.object') }}
      <select v-model="inspector.spriteId.value"><option value="all">{{ t('tilemap.colors.allSprites') }}</option><option v-for="obj in spriteObjects" :key="obj.id" :value="String(obj.id)">{{ obj.name || obj.type || obj.id }}</option></select>
    </label>
    <label v-if="inspector.scope.value !== 'composition'" class="color-scope">{{ t('tilemap.colors.bankFilter') }}
      <select v-model="inspector.bank.value"><option value="all">{{ t('tilemap.colors.allBanks') }}</option><option v-for="n in 4" :key="n" :value="String(n-1)">PAL{{ n-1 }}</option><option value="unknown">{{ t('tilemap.colors.unknownBank') }}</option></select>
    </label>
    <details class="color-banks" open>
      <summary>{{ t('tilemap.colors.banks') }}</summary>
      <div class="color-bank-rows"><div v-for="(row, index) in bankUsage" :key="index"><span>{{ ['background','parallax'].includes(row.source) ? t('tilemap.colors.' + row.source) : row.source }}</span><strong>{{ row.bank === 'unknown' ? t('tilemap.colors.unknownBank') : 'PAL' + row.bank }}</strong><small>{{ number(row.count) }} {{ row.unit === 'tiles' ? 'tiles' : row.unit === 'sprites' ? 'sprites' : t('tilemap.colors.images') }}</small></div></div>
      <p class="colors-note">{{ t('tilemap.colors.bankNote') }}</p>
    </details>
    <div v-if="inspector.colors.value.length" class="color-spectrum" aria-hidden="true">
      <span v-for="color in inspector.colors.value.slice(0, 256)" :key="color.key" :style="{ background: color.hex, flexGrow: color.count }" />
    </div>
    <p v-if="inspector.busy.value" class="colors-note" role="status">{{ t('tilemap.colors.loading') }}</p>
    <p v-else-if="inspector.error.value" class="colors-error" role="alert">{{ t('tilemap.colors.' + inspector.error.value) }}</p>
    <p v-else-if="!inspector.total.value" class="colors-note">{{ t('tilemap.colors.empty') }}</p>
    <template v-if="inspector.colors.value.length">
      <div class="color-selected">
        <input class="color-picker" type="color" :value="inspector.selectedHex.value || '#000000'" :aria-label="t('tilemap.colors.choose')" @input="selectColor($event.target.value)" />
        <div class="color-values">
          <strong>{{ inspector.selectedHex.value || t('tilemap.colors.selectPrompt') }}</strong>
          <span v-if="selectedColor">RGB {{ selectedColor.r }}, {{ selectedColor.g }}, {{ selectedColor.b }}</span>
          <span v-else>{{ t('tilemap.colors.pickPrompt') }}</span>
        </div>
        <button v-if="inspector.selectedHex.value" type="button" class="colors-clear" :aria-label="t('tilemap.colors.clear')" :title="t('tilemap.colors.clear')" @click="inspector.selectedHex.value = ''">×</button>
      </div>
      <div v-if="inspector.selectedHex.value" class="color-usage" aria-live="polite">
        <strong>{{ number(inspector.matchCount.value) }} <small>px</small></strong>
        <span>{{ percent }}% · {{ t('tilemap.colors.tiles', { count: number(inspector.locations.value.length) }) }}</span>
      </div>
      <label class="color-highlight"><input v-model="inspector.highlight.value" type="checkbox" /> {{ t('tilemap.colors.highlight') }}</label>
      <div class="color-actions">
        <button type="button" :class="{ active: inspector.picking.value }" :aria-pressed="inspector.picking.value" :disabled="inspector.busy.value || !!inspector.error.value" @click="inspector.picking.value = !inspector.picking.value">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m14 5 5 5M4 20l3-1L20 6a2.1 2.1 0 0 0-3-3L4 16v4Z"/></svg>{{ t('tilemap.colors.eyedropper') }}
        </button>
        <button type="button" :disabled="!inspector.matchCount.value || inspector.busy.value" @click="locate">{{ t('tilemap.colors.locate') }}</button>
      </div>
      <p v-if="inspector.picking.value" class="colors-picking" role="status">{{ t('tilemap.colors.picking') }}</p>
      <div class="color-list-controls">
        <input v-model="filter" type="search" :placeholder="t('tilemap.colors.search')" :aria-label="t('tilemap.colors.search')" />
        <select v-model="sort" :aria-label="t('tilemap.colors.sort')"><option value="usage">{{ t('tilemap.colors.byUsage') }}</option><option value="hue">{{ t('tilemap.colors.byHue') }}</option></select>
      </div>
      <div class="color-swatches" role="group" :aria-label="t('tilemap.colors.swatches')">
        <button v-for="color in filteredColors.slice(0, limit)" :key="color.key" type="button" class="color-swatch" :class="{ selected: inspector.selectedHex.value === color.hex }"
          :style="{ backgroundColor: color.hex, color: color.lightness > 0.55 ? '#111' : '#fff' }" :aria-pressed="inspector.selectedHex.value === color.hex" :aria-label="colorLabel(color)" :title="colorLabel(color)" @click="selectColor(color.hex)">
          <svg v-if="inspector.selectedHex.value === color.hex" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
        </button>
      </div>
      <p v-if="!filteredColors.length" class="colors-note">{{ t('tilemap.colors.noResults') }}</p>
      <button v-if="filteredColors.length > limit" type="button" class="colors-more" @click="limit += 256">{{ t('tilemap.colors.more') }}</button>
      <p class="colors-footnote">{{ t('tilemap.colors.summary', { colors: number(inspector.colors.value.length), pixels: number(inspector.total.value) }) }}</p>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch, unref } from 'vue'
import { useI18n } from 'vue-i18n'
import { colorKey, mapPaletteUsage } from '@/utils/retro/mapColors.js'
const props = defineProps({ state: { type: Object, required: true } })
const inspector = props.state.colorInspector
const { t, locale } = useI18n()
const filter = ref(''), sort = ref('hue'), limit = ref(256)
const spriteObjects = computed(() => unref(props.state.objects)?.filter(obj => obj.visual?.gid) || [])
const bankUsage = computed(() => mapPaletteUsage({ scope:inspector.scope.value, spriteId:inspector.spriteId.value,
  tiles:unref(props.state.tiles),tiles2:unref(props.state.tiles2),palette:unref(props.state.paletteMap),palette2:unref(props.state.paletteMap2),
  objects:unref(props.state.objects),background:unref(props.state.backgroundImage),parallax:unref(props.state.parallaxLayers) }))
watch(spriteObjects, list => { if (inspector.spriteId.value !== 'all' && !list.some(obj => String(obj.id) === inspector.spriteId.value)) inspector.spriteId.value = 'all' })
const number = value => Number(value).toLocaleString(locale.value)
const selectedColor = computed(() => {
  const key = colorKey(inspector.selectedHex.value)
  return key === null ? null : { r: key >>> 16, g: (key >>> 8) & 255, b: key & 255 }
})
const percent = computed(() => inspector.total.value ? (100 * inspector.matchCount.value / inspector.total.value).toLocaleString(locale.value, { maximumFractionDigits: 2 }) : '0')
const filteredColors = computed(() => {
  const query = filter.value.trim().toUpperCase().replace(/^#/, '')
  const colors = inspector.colors.value.filter(color => color.hex.slice(1).includes(query))
  return sort.value === 'usage' ? colors : colors.sort((a, b) => a.hue - b.hue || a.lightness - b.lightness || a.key - b.key)
})
watch([filter, sort], () => { limit.value = 256 })
function selectColor(hex) { inspector.selectedHex.value = hex.toUpperCase() }
function colorLabel(color) { return `${color.hex} · RGB ${color.r}, ${color.g}, ${color.b} · ${number(color.count)} px` }
function locate() {
  const point = inspector.nextLocation(), viewport = unref(props.state.viewport)
  if (point) props.state.setViewportPosition(Math.max(0, point.x + 4 - (viewport?.w || 0) / 2), Math.max(0, point.y + 4 - (viewport?.h || 0) / 2))
}
</script>

<style scoped>
.map-colors { display:flex; flex-direction:column; gap:12px; min-width:0; color:var(--text,#ddd); }
.color-scope { display:flex; flex-direction:column; gap:5px; font-size:11px; }
.color-scope select { width:100%; padding:6px; color:inherit; background:var(--input-bg,#1e1e1e); border:1px solid var(--border,#444); border-radius:3px; font:inherit; }
.color-banks { padding:8px; border:1px solid var(--border,#444); border-radius:3px; font-size:11px; }
.color-banks summary { cursor:pointer; }
.color-bank-rows { max-height:140px; overflow:auto; margin:8px 0; }
.color-bank-rows > div { display:flex; flex-wrap:wrap; gap:4px 8px; padding:5px 0; border-bottom:1px solid var(--border,#444); }
.color-bank-rows span { flex:1; min-width:40px; overflow-wrap:anywhere; }
.color-bank-rows strong { font-size:10px; }
.color-bank-rows small { color:var(--muted,#aaa); }
.colors-heading h3 { font-size:15px; margin:0; font-weight:600; }
.colors-heading > div { display:flex; align-items:center; justify-content:space-between; gap:6px; margin:6px 0; }
.colors-heading > div > strong { font:600 24px/1.2 ui-monospace,monospace; font-variant-numeric:tabular-nums; }
.colors-kicker { font-size:9px; letter-spacing:.14em; color:var(--muted,#aaa); text-transform:uppercase; }
.colors-heading p,.colors-note,.colors-footnote { margin:0; color:var(--muted,#aaa); font-size:11px; line-height:1.5; }
.color-spectrum { display:flex; height:24px; border:1px solid var(--border,#444); border-radius:3px; overflow:hidden; }
.color-spectrum span { flex-basis:0; }
.color-selected { display:flex; align-items:center; gap:9px; padding:10px 0; border-bottom:1px solid var(--border,#444); }
.color-picker { width:46px; height:46px; padding:2px; border:1px solid var(--border,#555); border-radius:3px; background:var(--panel,#252526); cursor:pointer; flex:none; }
.color-values { min-width:0; display:flex; flex-direction:column; gap:4px; }
.color-values strong { font:600 13px ui-monospace,monospace; }
.color-values span { font-size:10px; color:var(--muted,#aaa); }
.colors-clear { margin-left:auto; border:0; background:transparent; color:inherit; cursor:pointer; font-size:20px; }
.color-usage { display:flex; flex-direction:column; gap:3px; }
.color-usage strong { font:600 22px ui-monospace,monospace; font-variant-numeric:tabular-nums; }
.color-usage small { font:11px system-ui,sans-serif; color:var(--muted,#aaa); }
.color-usage > span { font-size:11px; color:var(--muted,#aaa); }
.color-highlight { display:flex; gap:6px; align-items:center; font-size:11px; }
.color-actions { display:flex; gap:5px; flex-wrap:wrap; }
.color-actions button,.colors-more { display:flex; gap:5px; align-items:center; justify-content:center; flex:1; padding:7px; font:inherit; font-size:11px; color:inherit; background:var(--panel,#252526); border:1px solid var(--border,#444); border-radius:3px; cursor:pointer; }
.color-actions svg { width:14px; height:14px; flex:none; }
.color-actions .active { border-color:var(--accent,#1687cf); background:var(--accent,#1687cf); color:white; }
.color-actions button:disabled { opacity:.45; cursor:default; }
.colors-picking { padding:8px; margin:0; font-size:11px; line-height:1.5; border-left:2px solid var(--accent,#1687cf); background:var(--panel,#252526); }
.color-list-controls { display:flex; flex-wrap:wrap; gap:6px; }
.color-list-controls input,.color-list-controls select { min-width:0; max-width:100%; padding:6px; color:inherit; background:var(--input-bg,#1e1e1e); border:1px solid var(--border,#444); border-radius:3px; font:inherit; font-size:11px; }
.color-list-controls input { flex:1 1 70px; }
.color-swatches { display:grid; grid-template-columns:repeat(auto-fill,minmax(30px,1fr)); gap:5px; }
.color-swatch { height:32px; min-width:0; padding:5px; border:1px solid #ffffff35; border-radius:3px; cursor:pointer; }
.color-swatch.selected { outline:2px solid var(--text,#fff); outline-offset:1px; }
.color-swatch svg { display:block; width:20px; height:20px; margin:auto; filter:drop-shadow(0 1px 1px #0007); }
.map-colors button:focus-visible,.map-colors input:focus-visible,.map-colors select:focus-visible { outline:2px solid var(--accent,#1687cf); outline-offset:2px; }
.colors-error { font-size:11px; line-height:1.5; color:var(--danger,#ffa58f); }
.colors-footnote { padding-top:6px; border-top:1px solid var(--border,#444); }
</style>
