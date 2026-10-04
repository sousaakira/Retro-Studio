<template>
  <div class="kit-editor">
    <button type="button" class="wide" :disabled="a.exporting.value" :aria-expanded="a.authoring.value" @click="a.openAuthoring()">
      {{ t(pack ? 'tilemap.pack.editKit' : 'tilemap.pack.createKit') }}
    </button>
    <fieldset v-if="a.authoring.value && pack" :disabled="a.exporting.value">
      <legend>{{ t('tilemap.pack.editKit') }}</legend>
      <label>{{ t('tilemap.pack.kitName') }}<input v-model="pack.name" /></label>
      <p>{{ t('tilemap.pack.authorHint') }}</p>
      <p class="selection">{{ t('tilemap.pack.regionSize', { w: state.selectedTileRegion.value.w, h: state.selectedTileRegion.value.h }) }}</p>
      <label>{{ t('tilemap.pack.brushName') }}<input v-model="draft.name" /></label>
      <label>{{ t('tilemap.pack.category') }}<input v-model="draft.category" /></label>
      <div class="columns">
        <label>{{ t('tilemap.pack.layer') }}<select v-model="draft.layer"><option value="bg">BG</option><option value="fg">FG</option></select></label>
        <label>{{ t('tilemap.pack.collision') }}<select v-model="draft.collision"><option v-for="v in ['none','solid','top','damage']" :key="v" :value="v">{{ t(`tilemap.pack.collision_${v}`) }}</option></select></label>
      </div>
      <button type="button" class="wide" @click="a.saveBrush()">{{ t(a.editingBrushId.value ? 'tilemap.pack.updateBrush' : 'tilemap.pack.addBrush') }}</button>
      <button v-if="a.editingBrushId.value" type="button" class="wide" @click="a.resetDraft()">{{ t('tilemap.pack.cancelEdit') }}</button>
      <ul class="entries">
        <li v-for="b in pack.brushes" :key="b.id">
          <button type="button" class="entry-name" @click="a.editBrush(b)">{{ b.name }} ({{ b.w }}×{{ b.h }})</button>
          <button type="button" :aria-label="`${t('tilemap.pack.removeEntry')}: ${b.name}`" @click="a.removeBrush(b.id)">×</button>
        </li>
      </ul>
      <p>{{ t('tilemap.pack.objectAuthorHint') }}</p>
      <button type="button" class="wide" :disabled="!state.selectedObject.value" @click="a.addObjectTemplate()">{{ t('tilemap.pack.addTemplate') }}</button>
      <ul class="entries">
        <li v-for="(o, i) in pack.objects" :key="i"><span class="entry-name">{{ o.name }}</span><button type="button" :aria-label="`${t('tilemap.pack.removeEntry')}: ${o.name}`" @click="a.removeObjectTemplate(i)">×</button></li>
      </ul>
      <p>{{ t('tilemap.pack.exportHint') }}</p>
      <button type="button" class="wide save" @click="a.exportPack()">{{ t(a.exporting.value ? 'tilemap.pack.loading' : 'tilemap.pack.saveKit') }}</button>
    </fieldset>
    <p v-if="a.error.value" role="alert" class="error">{{ a.error.value }}</p>
    <p v-if="a.savedPath.value" role="status" class="saved">{{ t('tilemap.pack.savedKit') }}: {{ a.savedPath.value }}</p>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
const props = defineProps({ state: { type: Object, required: true } })
const { t } = useI18n()
const a = props.state.packAuthor
const pack = computed(() => props.state.assetPack.value)
const draft = computed(() => a.brushDraft.value)
</script>
<style scoped>
.kit-editor { margin:12px 0; }
fieldset { margin:8px 0; padding:8px; border:1px solid var(--border); min-width:0; }
legend { font-weight:600; }
label { display:flex; flex-direction:column; gap:4px; margin:8px 0; }
button,input,select { font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px; min-width:0; }
button { cursor:pointer; } button:disabled,fieldset:disabled { opacity:.6; }
button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
p { line-height:1.4; } .selection { font-family:monospace; }
.wide { display:block; width:100%; margin:6px 0; }
.columns { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.entries { list-style:none; padding:0; margin:8px 0; max-height:160px; overflow:auto; }
.entries li { display:flex; gap:4px; align-items:center; margin:4px 0; }
.entry-name { flex:1; min-width:0; overflow-wrap:anywhere; text-align:left; }
.save { border-color:var(--accent); }
.error { color:var(--error, #f48771); } .saved { overflow-wrap:anywhere; }
</style>
