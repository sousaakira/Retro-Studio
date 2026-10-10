<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import HardwareBudgetEditor from './HardwareBudgetEditor.vue'

const props = defineProps({ projectPath: { type: String, required: true } })
const emit = defineEmits(['close'])
const { t } = useI18n()
const dialog = ref(null), report = ref(null), loading = ref(false), error = ref(''), abi = ref(''), filter = ref('')
const budgetEditor = ref(null), configuration = ref(null)
function requestClose() { if (!budgetEditor.value || budgetEditor.value.canClose()) emit('close') }
let sequence = 0
let abiProject = props.projectPath
const resources = computed(() => (report.value?.resources || []).filter(item =>
  (item.symbol + ' ' + item.origin).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())))
const bytes = value => value === null || value === undefined ? '—' : value.toLocaleString() + ' B'
const hex = value => '0x' + value.toString(16).toUpperCase().padStart(4, '0')
async function refresh() {
  const request = ++sequence, projectPath = props.projectPath
  loading.value = true; error.value = ''; report.value = null
  try {
    const api = window.retroStudio?.retro?.inspectCompiledResources
    if (!api) throw new Error(t('hardwareReport.unavailable'))
    const result = await api({ projectPath, abi: abi.value || undefined })
    if (request !== sequence || projectPath !== props.projectPath) return
    if (!result?.success || result.projectPath !== projectPath) throw new Error(t('hardwareReport.unavailable'))
    report.value = result
    configuration.value = { ...result.configuration, projectPath }
  } catch (failure) { if (request === sequence) error.value = failure.message }
  finally { if (request === sequence) loading.value = false }
}
watch([() => props.projectPath, abi], ([projectPath]) => {
  if (projectPath !== abiProject) {
    abiProject = projectPath
    report.value = null; configuration.value = null; filter.value = ''
    if (abi.value) { sequence++; abi.value = ''; return }
  }
  void refresh()
}, { immediate: true })
onMounted(async () => { await nextTick(); dialog.value?.showModal() })
onBeforeUnmount(() => { sequence++; dialog.value?.close() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="hardware-report" aria-labelledby="hardware-report-title" @cancel.prevent="requestClose">
      <header>
        <div><small>Mega Drive · ResComp / ELF</small><h2 id="hardware-report-title">{{ t('hardwareReport.title') }}</h2></div>
        <button type="button" :aria-label="t('hardwareReport.close')" @click="requestClose"><span aria-hidden="true">×</span></button>
      </header>
      <div class="report-controls">
        <label>{{ t('hardwareReport.reader') }}
          <select v-model="abi"><option value="">{{ t('hardwareReport.auto') }}</option><option value="sgdk-1.81">SGDK 1.81</option></select>
        </label>
        <button type="button" :disabled="loading" @click="refresh">{{ t('hardwareReport.refresh') }}</button>
        <label class="report-search">{{ t('hardwareReport.filter') }}<input v-model="filter" type="search" /></label>
      </div>
      <main :aria-busy="loading">
        <p v-if="loading" role="status">{{ t('hardwareReport.loading') }}</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <HardwareBudgetEditor ref="budgetEditor" :project-path="projectPath" :configuration="configuration" :resources="report?.resources || []" :busy="loading" @saved="refresh" />
        <template v-if="report">
          <p class="report-note">{{ t('hardwareReport.freshness') }}</p>
          <details v-if="report.buildSnapshot" class="build-snapshot">
            <summary>{{ t('hardwareBuild.title') }} · {{ t('hardwareBuild.' + report.buildSnapshot.status) }}</summary>
            <p>{{ t('hardwareBuild.scope') }}</p>
            <p v-if="report.buildSnapshot.artifactAssociation === 'unproven'">{{ t('hardwareBuild.artifactsUnproven') }}</p>
            <p v-if="report.buildSnapshot.finishedAt">{{ report.buildSnapshot.finishedAt }}</p>
            <p v-if="report.buildSnapshot.inputStability === 'changed-during-build' || report.buildSnapshot.incomplete" role="status">{{ t('hardwareBuild.incomplete') }}</p>
            <template v-for="kind in ['changed', 'missing', 'added']" :key="kind">
              <template v-if="report.buildSnapshot[kind]?.length"><h4>{{ t('hardwareBuild.' + kind) }}</h4><ul><li v-for="file in report.buildSnapshot[kind]" :key="file"><code>{{ file }}</code></li></ul></template>
            </template>
            <p v-if="report.buildSnapshot.error" role="alert">{{ report.buildSnapshot.error }}</p>
          </details>
          <p v-if="!report.elf">{{ t('hardwareReport.notBuilt') }}</p>
          <p v-if="report.abi">{{ t('hardwareReport.abiAssumption') }}</p>
          <p v-else>{{ t('hardwareReport.chooseReader') }}</p>
          <dl class="report-totals">
            <div><dt>{{ t('hardwareReport.rom') }}</dt><dd>{{ bytes(report.rom?.size) }}</dd></div>
            <div><dt>{{ t('hardwareReport.staticRam') }}</dt><dd>{{ bytes(report.staticRAM) }}</dd></div>
            <div><dt>{{ t('hardwareReport.videoMode') }}</dt><dd>{{ report.budget.videoMode }} · {{ t('hardwareReport.planning') }}</dd></div>
          </dl>
          <small>{{ t('hardwareReport.ramUnknown') }}</small>
          <details v-if="report.elf"><summary>{{ report.elf.path }} · SHA-256</summary><code>{{ report.elf.hash }}</code><small>{{ report.elf.modifiedAt }}</small></details>
          <h3>{{ t('hardwareReport.resources') }}</h3>
          <p v-if="!resources.length">{{ t('hardwareReport.empty') }}</p>
          <div v-else class="report-table-wrap">
            <table>
              <thead><tr><th>{{ t('hardwareReport.resource') }}</th><th>{{ t('hardwareReport.authoring') }}</th><th>{{ t('hardwareReport.compiledTiles') }}</th><th>{{ t('hardwareReport.hardwareSprites') }}</th><th>{{ t('hardwareReport.frames') }}</th><th>{{ t('hardwareReport.palette') }}</th></tr></thead>
              <tbody><tr v-for="item in resources" :key="item.symbol">
                <th scope="row"><code>{{ item.symbol }}</code><small>{{ item.kind }} · {{ item.origin }}</small><small>{{ item.declaration }}</small><small>{{ t('hardwareReport.status.' + item.status) }}</small><small v-if="item.facts?.romBytes">{{ t(item.facts.romBytesEvidence === 'symbol-size' ? 'hardwareReport.romBytes' : 'hardwareReport.romBytesUpTo', { bytes: item.facts.romBytes }) }}</small></th>
                <td>{{ item.authoring ? item.authoring.width + ' × ' + item.authoring.height + ' px' : '—' }}<small v-if="item.authoring">{{ item.authoring.gridTiles }} · {{ t('hardwareReport.unoptimizedGrid') }}</small></td>
                <td>{{ item.facts?.maxNumTile ?? item.facts?.tileCount ?? '—' }}<small v-if="item.facts?.maxNumTile !== undefined">{{ t('hardwareReport.perInstance') }}</small><small v-if="item.facts?.tilePayloadRomBytes !== undefined">{{ t('hardwareReport.tilePayload') }}: {{ bytes(item.facts.tilePayloadRomBytes) }}</small></td>
                <td>{{ item.facts?.maxNumSprite ?? '—' }}</td>
                <td>{{ item.facts?.frameCount ?? '—' }}<small v-if="item.facts?.animationCount">{{ item.facts.animationCount }} · {{ t('hardwareReport.animations') }}</small></td>
                <td>{{ item.facts?.paletteEntries ?? '—' }}<details v-if="item.facts?.paletteWords"><summary>{{ t('hardwareReport.colors') }}</summary><code>{{ item.facts.paletteWords.map(hex).join(' ') }}</code></details></td>
              </tr></tbody>
            </table>
          </div>
          <h3>{{ t('hardwareReport.vramPlan') }}</h3>
          <p>{{ t('hardwareReport.planHelp') }}</p>
          <p>{{ t('hardwareReport.limits', { sprites: report.budget.limits.hardwareSprites, line: report.budget.limits.spritesPerLine }) }}</p>
          <p v-if="report.budget.planes">{{ t('hardwareReport.planes') }}: {{ report.budget.planes.width }} × {{ report.budget.planes.height }} · {{ bytes(report.budget.planes.nameTableBytesEach) }} {{ t('hardwareReport.perPlane') }}</p>
          <p v-if="report.budget.tileArena">{{ t('hardwareReport.tileArena') }}: {{ hex(report.budget.tileArena.start) }} · {{ bytes(report.budget.tileArena.bytes) }}</p>
          <div v-if="report.budget.reservations.length" class="vram-address-map" role="img" :aria-label="t('hardwareReport.addressMap')">
            <span v-for="item in report.budget.reservations" :key="item.id" :style="{ left: (item.start / 65536 * 100) + '%', width: (item.bytes / 65536 * 100) + '%' }" :title="item.id + ' · ' + hex(item.start) + ' · ' + bytes(item.bytes)"></span>
          </div>
          <div v-if="report.budget.reservations.length" class="report-table-wrap"><table><thead><tr><th>{{ t('hardwareReport.reservation') }}</th><th>{{ t('hardwareReport.address') }}</th><th>{{ t('hardwareReport.bytes') }}</th></tr></thead><tbody><tr v-for="item in report.budget.reservations" :key="item.id"><th scope="row">{{ item.id }}</th><td>{{ hex(item.start) }}</td><td>{{ bytes(item.bytes) }}</td></tr></tbody></table></div>
          <div v-if="report.budget.consumers.length" class="report-table-wrap"><table><thead><tr><th>{{ t('hardwareReport.resource') }}</th><th>{{ t('hardwareReport.instances') }}</th><th>{{ t('hardwareReport.compiledTiles') }}</th><th>{{ t('hardwareReport.hardwareSprites') }}</th></tr></thead><tbody><tr v-for="(item, index) in report.budget.consumers" :key="index"><th scope="row">{{ item.resourceId }}<small>{{ item.origin }} · {{ item.mode }}</small></th><td>{{ item.instances }}</td><td>{{ item.tiles ?? '—' }}</td><td>{{ item.hardwareSprites ?? '—' }}</td></tr></tbody></table><p>{{ t('hardwareReport.plannedTiles') }}: {{ bytes(report.budget.plannedTileBytes) }}</p></div>
          <ul v-if="report.budget.warnings.length"><li v-for="(warning, index) in report.budget.warnings" :key="index">{{ t('hardwareReport.warning.' + warning) }}</li></ul>
          <template v-if="report.suggestions?.length"><h4>{{ t('hardwareReport.suggestions') }}</h4><ul><li v-for="(item, index) in report.suggestions" :key="'s' + index"><code v-if="item.symbol">{{ item.symbol }}</code><span v-if="item.origin"> · {{ item.origin }}</span><span v-if="item.symbol">: </span>{{ t('hardwareReport.suggestion.' + item.code, item.values) }}</li></ul></template>
          <p>{{ t('hardwareReport.unknowns') }}</p>
          <details v-if="report.sections.length"><summary>{{ t('hardwareReport.sections') }}</summary><ul><li v-for="section in report.sections" :key="section.name">{{ section.name }} · {{ section.memory }} · {{ hex(section.address) }} · {{ bytes(section.bytes) }}</li></ul></details>
          <details v-if="report.diagnostics.length" open><summary>{{ t('hardwareReport.diagnostics') }}</summary><ul><li v-for="(item, index) in report.diagnostics" :key="index">{{ item.source || item.symbol || '' }} · {{ item.code }}</li></ul></details>
        </template>
      </main>
    </dialog>
  </Teleport>
</template>

<style scoped>
.hardware-report { color:var(--text,#ddd); background:var(--bg,#202020); border:1px solid var(--border,#444); border-radius:6px; padding:0; width:min(1100px,94vw); max-height:90vh; }
.hardware-report::backdrop { background:rgba(0,0,0,.6); }
header { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:14px 18px; border-bottom:1px solid var(--border,#444); }
h2 { margin:4px 0 0; font-size:18px; } h3 { font-size:14px; margin:22px 0 8px; }
button,input,select { font:inherit; color:var(--text,#ddd); background:var(--bg-secondary,#2b2b2b); border:1px solid var(--border,#555); border-radius:3px; padding:6px 9px; }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible { outline:2px solid var(--accent,#007acc); outline-offset:2px; }
.report-controls { display:flex; align-items:end; flex-wrap:wrap; gap:12px; padding:12px 18px; border-bottom:1px solid var(--border,#444); }
label { display:flex; flex-direction:column; gap:5px; font-size:12px; }.report-search { margin-left:auto; }
main { padding:0 18px 18px; overflow:auto; max-height:calc(90vh - 160px); font-size:12px; }
.report-note { border-left:3px solid var(--accent,#007acc); padding:8px 12px; background:var(--bg-secondary,#292929); }
.report-totals { display:flex; flex-wrap:wrap; gap:24px; border-block:1px solid var(--border,#444); padding:12px 0; }
dt,small { color:var(--text-secondary,#aaa); } dd { margin:5px 0 0; font:600 14px monospace; }
small { display:block; margin-top:4px; overflow-wrap:anywhere; } code { font-family:monospace; overflow-wrap:anywhere; }
.report-table-wrap { overflow-x:auto; } table { border-collapse:collapse; width:100%; } th,td { text-align:left; vertical-align:top; padding:9px; border-bottom:1px solid var(--border,#444); } thead th { color:var(--text-secondary,#aaa); font-weight:500; white-space:nowrap; } tbody th { font-weight:400; min-width:210px; }
.vram-address-map { position:relative; height:24px; background:var(--bg-secondary,#292929); border:1px solid var(--border,#444); overflow:hidden; }
.vram-address-map span { position:absolute; top:0; height:100%; background:var(--accent,#007acc); border-right:1px solid var(--bg,#202020); }
details { margin:10px 0; } summary { cursor:pointer; } details code { display:block; margin:8px 0; max-width:200px; } li { margin-block:5px; }
@media (max-width:640px) { .report-search { margin-left:0; } main { max-height:calc(90vh - 220px); } }
</style>
