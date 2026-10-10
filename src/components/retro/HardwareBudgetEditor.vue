<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({ projectPath: { type: String, required: true }, configuration: Object, resources: { type: Array, default: () => [] }, busy: Boolean })
const emit = defineEmits(['saved'])
const { t } = useI18n()
const draft = ref(null), revision = ref(null), baseline = ref(''), saving = ref(false), error = ref(''), saved = ref(false)
const drafts = new Map()
let activeProject = ''
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
const conflict = computed(() => dirty.value && props.configuration?.projectPath === activeProject && props.configuration.revision !== revision.value)
const usable = computed(() => props.configuration?.projectPath === activeProject && props.configuration.editable && !!draft.value)
const available = computed(() => props.resources.filter(item => ['SPRITE', 'TILESET', 'IMAGE'].includes(item.kind)))
const listId = 'hardware-resources-' + Math.random().toString(36).slice(2)
const clone = value => JSON.parse(JSON.stringify(value))
function load(configuration) {
  const raw = configuration.budget
  draft.value = raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw) : { videoMode: 'H40' }
  draft.value.videoMode ||= 'H40'
  if (!Array.isArray(draft.value.reservations)) draft.value.reservations = []
  if (!Array.isArray(draft.value.consumers)) draft.value.consumers = []
  revision.value = configuration.revision
  baseline.value = JSON.stringify(draft.value)
}
watch([() => props.projectPath, () => props.configuration], () => {
  if (activeProject !== props.projectPath) {
    if (dirty.value) drafts.set(activeProject, { budget: clone(draft.value), revision: revision.value, baseline: baseline.value })
    activeProject = props.projectPath
    draft.value = null; baseline.value = ''; error.value = ''; saved.value = false
  }
  const configuration = props.configuration
  if (!configuration || configuration.projectPath !== activeProject || !configuration.editable || dirty.value) return
  const cached = drafts.get(activeProject)
  if (cached) { draft.value = cached.budget; revision.value = cached.revision; baseline.value = cached.baseline; drafts.delete(activeProject) }
  else load(configuration)
}, { immediate: true })
function discard() {
  if (dirty.value && !window.confirm(t('hardwareBudget.discardConfirm'))) return
  drafts.delete(activeProject); load(props.configuration); error.value = ''; saved.value = false
}
function addReservation() {
  const ids = new Set(draft.value.reservations.map(item => item.id))
  let index = 1
  while (ids.has('reserve_' + index)) index++
  draft.value.reservations.push({ id: 'reserve_' + index, start: 0, bytes: 32 })
}
function addConsumer() {
  const resource = available.value[0]
  draft.value.consumers.push({ resourceId: resource?.symbol || '', mode: resource?.kind === 'SPRITE' ? 'sprite-stream' : 'tiles-resident', instances: 1 })
}
async function save() {
  if (!usable.value || !dirty.value || saving.value || props.busy || conflict.value) return
  const projectPath = activeProject, submitted = clone(draft.value), submittedRevision = revision.value
  saving.value = true; error.value = ''; saved.value = false
  try {
    const result = await window.retroStudio?.retro?.saveHardwareBudget?.({ projectPath, budget: submitted, revision: submittedRevision })
    if (!result?.success || result.projectPath !== projectPath) throw new Error(t('hardwareBudget.saveFailed'))
    drafts.delete(projectPath)
    if (activeProject !== projectPath) return
    draft.value = clone(result.budget); revision.value = result.revision; baseline.value = JSON.stringify(draft.value)
    saved.value = true; emit('saved')
  } catch (failure) { if (activeProject === projectPath) error.value = failure.message }
  finally { saving.value = false }
}
function canClose() {
  return !saving.value && (!dirty.value && !drafts.size || window.confirm(t('hardwareBudget.discardConfirm')))
}
defineExpose({ canClose, hasUnsavedChanges: dirty })
</script>

<template>
  <details class="budget-editor" v-if="configuration?.projectPath === projectPath">
    <summary>{{ t('hardwareBudget.title') }}<span v-if="dirty"> · {{ t('hardwareBudget.unsaved') }}</span></summary>
    <p>{{ t('hardwareBudget.planningOnly') }}</p>
    <p v-if="!configuration.editable" role="alert">{{ t('hardwareBudget.invalidSource') }}</p>
    <form v-else-if="usable" @submit.prevent="save">
      <fieldset :disabled="busy || saving">
        <div class="budget-fields">
          <label>{{ t('hardwareReport.videoMode') }}<select v-model="draft.videoMode"><option>H32</option><option>H40</option></select></label>
          <label>{{ t('hardwareReport.reader') }}<select v-model="draft.resourceAbi"><option :value="undefined">{{ t('hardwareBudget.unknownReader') }}</option><option value="sgdk-1.81">SGDK 1.81</option><option v-if="draft.resourceAbi && draft.resourceAbi !== 'sgdk-1.81'" :value="draft.resourceAbi">{{ draft.resourceAbi }}</option></select></label>
        </div>
        <label class="budget-toggle"><input type="checkbox" :checked="!!draft.planes" @change="draft.planes = $event.target.checked ? { width: 64, height: 32 } : undefined" />{{ t('hardwareReport.planes') }}</label>
        <div v-if="draft.planes" class="budget-fields"><label>{{ t('hardwareBudget.width') }}<select v-model="draft.planes.width"><option v-for="size in [32,64,128]" :key="size" :value="size">{{ size }}</option></select></label><label>{{ t('hardwareBudget.height') }}<select v-model="draft.planes.height"><option v-for="size in [32,64,128]" :key="size" :value="size">{{ size }}</option></select></label></div>
        <label class="budget-toggle"><input type="checkbox" :checked="!!draft.tileArena" @change="draft.tileArena = $event.target.checked ? { start: 512, bytes: 45568 } : undefined" />{{ t('hardwareReport.tileArena') }}</label>
        <div v-if="draft.tileArena" class="budget-fields"><label>{{ t('hardwareReport.address') }}<input v-model.number="draft.tileArena.start" type="number" min="0" max="65536" step="32" /></label><label>{{ t('hardwareReport.bytes') }}<input v-model.number="draft.tileArena.bytes" type="number" min="0" max="65536" step="32" /></label></div>
        <h4>{{ t('hardwareBudget.reservations') }}</h4>
        <div class="budget-table"><table><thead><tr><th>{{ t('hardwareBudget.id') }}</th><th>{{ t('hardwareReport.address') }}</th><th>{{ t('hardwareReport.bytes') }}</th><th>{{ t('hardwareBudget.actions') }}</th></tr></thead><tbody><tr v-for="(item,index) in draft.reservations" :key="index"><td><input v-model="item.id" :aria-label="t('hardwareBudget.id')" maxlength="64" required /></td><td><input v-model.number="item.start" :aria-label="t('hardwareReport.address')" type="number" min="0" max="65536" required /></td><td><input v-model.number="item.bytes" :aria-label="t('hardwareReport.bytes')" type="number" min="0" max="65536" required /></td><td><button type="button" @click="draft.reservations.splice(index,1)">{{ t('hardwareBudget.remove') }}</button></td></tr></tbody></table></div>
        <button type="button" :disabled="draft.reservations.length >= 128" @click="addReservation">{{ t('hardwareBudget.addReservation') }}</button>
        <h4>{{ t('hardwareBudget.consumers') }}</h4>
        <datalist :id="listId"><option v-for="item in available" :key="item.symbol" :value="item.symbol">{{ item.origin }}</option></datalist>
        <div class="budget-table"><table><thead><tr><th>{{ t('hardwareReport.resource') }}</th><th>{{ t('hardwareBudget.mode') }}</th><th>{{ t('hardwareReport.instances') }}</th><th>{{ t('hardwareBudget.actions') }}</th></tr></thead><tbody><tr v-for="(item,index) in draft.consumers" :key="index"><td><input v-model="item.resourceId" :list="listId" :aria-label="t('hardwareReport.resource')" maxlength="256" required /></td><td><select v-model="item.mode" :aria-label="t('hardwareBudget.mode')"><option value="sprite-stream">{{ t('hardwareBudget.spriteMode') }}</option><option value="tiles-resident">{{ t('hardwareBudget.tileMode') }}</option></select></td><td><input v-model.number="item.instances" :aria-label="t('hardwareReport.instances')" type="number" min="0" max="4096" required /></td><td><button type="button" @click="draft.consumers.splice(index,1)">{{ t('hardwareBudget.remove') }}</button></td></tr></tbody></table></div>
        <button type="button" :disabled="draft.consumers.length >= 128" @click="addConsumer">{{ t('hardwareBudget.addConsumer') }}</button>
        <p v-if="conflict" role="alert">{{ t('hardwareBudget.conflict') }}</p>
        <p v-if="error" role="alert">{{ error }}</p><p v-if="saved && !dirty" role="status">{{ t('hardwareBudget.saved') }}</p>
        <div class="budget-buttons"><button type="submit" :disabled="!dirty || conflict">{{ saving ? t('hardwareBudget.saving') : t('hardwareBudget.save') }}</button><button type="button" :disabled="!dirty" @click="discard">{{ t('hardwareBudget.reload') }}</button></div>
      </fieldset>
    </form>
  </details>
</template>

<style scoped>
.budget-editor { border-block:1px solid var(--border,#444); margin:18px 0; padding:12px 0; } summary { cursor:pointer; font-weight:600; }
fieldset { border:0; margin:0; padding:0; min-width:0; }.budget-fields { display:flex; flex-wrap:wrap; gap:12px; margin:10px 0; } label { display:flex; flex-direction:column; gap:4px; }.budget-toggle { flex-direction:row; align-items:center; margin-top:12px; } h4 { margin:16px 0 8px; }
button,input,select { font:inherit; color:var(--text,#ddd); background:var(--bg-secondary,#2b2b2b); border:1px solid var(--border,#555); border-radius:3px; padding:6px 8px; max-width:100%; box-sizing:border-box; } button { cursor:pointer; } :disabled { opacity:.5; cursor:default; }
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible { outline:2px solid var(--accent,#007acc); outline-offset:2px; }
.budget-table { overflow-x:auto; } table { border-collapse:collapse; width:100%; } th,td { text-align:left; padding:6px; } th { font-weight:500; color:var(--text-secondary,#aaa); } td input,td select { width:100%; min-width:90px; } .budget-buttons { display:flex; gap:8px; margin-top:14px; }
</style>
