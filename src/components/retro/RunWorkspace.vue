<script setup>
// #45: modo Executar. Uma tela para o ciclo construir → conferir → jogar: o que impede o
// build, o que foi compilado por último e os problemas encontrados. Nada é exportado daqui.
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {useI18n} from 'vue-i18n'
import RomDebugger from './RomDebugger.vue'
const {t,locale}=useI18n()
const props=defineProps({projectPath:{type:String,default:''},active:Boolean,retro:Boolean,building:Boolean,playing:Boolean,running:Boolean,packaging:Boolean,progress:{type:String,default:''},errors:{type:Array,default:()=>[]}})
const emit=defineEmits(['build','play','stop','open-error','open-mode'])
const overview=ref(null),compiled=ref(null),loading=ref(false),error=ref(''),heading=ref(null),debugBuilding=ref(false)
let request=0,disposed=false
// O build para depurar usa o mesmo out/: enquanto ele roda, os outros botões esperam.
const busy=computed(()=>props.building||props.playing||props.packaging||debugBuilding.value)
// playing = construindo para jogar; running = o emulador está aberto com o jogo.
const state=computed(()=>t('runMode.'+(props.packaging?'packaging':props.building?'building':props.playing?'buildingToPlay':props.running?'running':'ready')))
const STATES={current:'stateCurrent',stale:'stateStale',unexported:'stateUnexported',conflict:'stateConflict',failed:'stateFailed'}
const MODES={world:'maps',cutscenes:'scenes','cutscene-adapter':'scenes',camera:'game',audio:'game',progress:'game',debug:'game',palettes:'game',hud:'game',game:'game'}
const pending=computed(()=>(overview.value?.rows||[]).filter(row=>!['current','absent'].includes(row.state)))
const current=computed(()=>(overview.value?.rows||[]).filter(row=>row.state==='current'))
const blocking=computed(()=>new Set(overview.value?.blocksBuild||[]))
const kind=item=>['warning','note'].includes(item?.type)?item.type:'error'
const KINDS={error:'kindError',warning:'kindWarning',note:'kindNote'}
const problems=computed(()=>props.errors.filter(item=>kind(item)==='error').length)
const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(2)+' MiB':Math.ceil(bytes/1024)+' KiB'
const when=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?t('runMode.unknownDate'):date.toLocaleString(locale.value)}
const freshness=computed(()=>{
 const status=compiled.value?.buildSnapshot?.status
 return t('runMode.'+(status==='matches-recorded-files'?'fresh':status==='changed-since-build'?'stale':'unknownFreshness'))
})
async function load(){
 if(!props.projectPath||!props.retro){overview.value=null;compiled.value=null;return}
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value=''
 try{
  const [rows,report]=await Promise.all([window.retroStudio?.retro?.exportOverview?.({projectPath}),window.retroStudio?.retro?.inspectCompiledResources?.({projectPath})])
  if(disposed||id!==request)return
  if(!rows?.rows)throw Error(rows?.error||t('runMode.checkFailed'))
  overview.value=rows;compiled.value=report?.success===false?null:report||null
 }catch(e){if(!disposed&&id===request){error.value=e.message;overview.value=null;compiled.value=null}}
 finally{if(!disposed&&id===request)loading.value=false}
}
function focus(){heading.value?.focus?.()}
defineExpose({load,focus})
watch(()=>[props.projectPath,props.active,props.retro],()=>{if(props.active)void load();else request++},{immediate:true})
// Fim de um build ou de uma execução: a ROM e as pendências podem ter mudado.
watch(busy,(now,before)=>{if(before&&!now&&props.active)void load()})
onBeforeUnmount(()=>{disposed=true;request++})
</script>
<template>
 <section class="run" aria-labelledby="run-title">
  <header>
   <div><small>{{ t('runMode.eyebrow') }}</small><h2 id="run-title" ref="heading" tabindex="-1">{{ t('runMode.title') }}</h2></div>
   <p class="status" role="status" :class="{busy:busy||running}">{{ state }}<span v-if="busy&&progress"> · {{ progress }}</span></p>
   <div class="actions">
    <button type="button" class="primary" :disabled="!retro||busy" @click="emit('build')">{{ t('runMode.build') }}</button>
    <button type="button" :disabled="!retro||busy" @click="emit('play')">{{ t('runMode.buildAndPlay') }}</button>
    <button type="button" :disabled="!retro||packaging||debugBuilding||!(busy||running)" @click="emit('stop')">{{ t('runMode.stop') }}</button>
    <button type="button" :disabled="loading||!retro" @click="load">{{ loading ? t('runMode.checking') : t('runMode.check') }}</button>
   </div>
  </header>
  <div class="run-body">
   <p v-if="!retro" class="notice">{{ t('runMode.notRetro') }}</p>
   <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
   <template v-if="retro">
    <section aria-labelledby="run-pending">
     <h3 id="run-pending">{{ t('runMode.before') }}</h3>
     <p v-if="loading&&!overview" role="status" class="notice">{{ t('runMode.checkingProject') }}</p>
     <template v-else-if="overview">
      <p v-if="!pending.length" class="notice ok">{{ t('runMode.nothingPending') }}<span v-if="current.length"> {{ t('runMode.upToDate',{list:current.map(row=>row.title).join(', ')}) }}</span></p>
      <ul v-else class="rows">
       <li v-for="row in pending" :key="row.id" :class="{blocks:blocking.has(row.id)}">
        <div><strong>{{ row.title }}</strong> <span class="badge">{{ STATES[row.state] ? t('runMode.'+STATES[row.state]) : row.state }}</span><span v-if="blocking.has(row.id)" class="badge blocker">{{ t('runMode.blocks') }}</span><span v-else class="badge">{{ t('runMode.warns') }}</span></div>
        <p>{{ row.message }}</p>
        <p class="where">{{ t('runMode.where',{editor:row.editor}) }}<button v-if="MODES[row.id]" type="button" @click="emit('open-mode',MODES[row.id])">{{ t('runMode.open') }}</button></p>
       </li>
      </ul>
     </template>
    </section>
    <section aria-labelledby="run-rom">
     <h3 id="run-rom">{{ t('runMode.lastGame') }}</h3>
     <p v-if="!compiled?.rom" class="notice">{{ t('runMode.noRom') }}</p>
     <template v-else>
      <dl><dt>{{ t('runMode.file') }}</dt><dd>{{ compiled.rom.path }}</dd><dt>{{ t('runMode.size') }}</dt><dd>{{ size(compiled.rom.size) }} <small>{{ t('runMode.compiledData') }}</small></dd><dt>{{ t('runMode.builtAt') }}</dt><dd>{{ when(compiled.rom.modifiedAt) }}</dd></dl>
      <p class="notice" :class="{problem:compiled.buildSnapshot?.status==='changed-since-build'}">{{ freshness }}</p>
     </template>
    </section>
    <section aria-labelledby="run-problems">
     <h3 id="run-problems">{{ t('runMode.problems') }}</h3>
     <p v-if="!errors.length" class="notice">{{ t('runMode.noProblems') }}</p>
     <template v-else>
      <p class="help">{{ t('runMode.problemSummary',{errors:problems,others:errors.length-problems}) }}</p>
      <ul class="rows">
       <li v-for="(item,index) in errors.slice(0,50)" :key="index"><button type="button" class="link" @click="emit('open-error',item)">{{ item.file||t('runMode.unknownFile') }}<span v-if="item.line">:{{ item.line }}</span></button> <span class="badge" :class="{blocker:kind(item)==='error'}">{{ t('runMode.'+KINDS[kind(item)]) }}</span><p>{{ item.message }}</p></li>
      </ul>
      <p v-if="errors.length>50" class="help">{{ t('runMode.more',{total:errors.length}) }}</p>
     </template>
    </section>
    <RomDebugger :project-path="projectPath" :active="active" :busy="building||playing||packaging" @open-source="emit('open-error',$event)" @built="load" @building="debugBuilding=$event" />
   </template>
  </div>
 </section>
</template>
<style scoped>
.run{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border,#41464d);flex-shrink:0}
h2{margin:3px 0;font-size:19px}h2:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:3px}h3{margin:16px 0 6px;font-size:13px}small,.help,.where{color:var(--muted,#a7b2b9)}
.status{margin:0 0 0 auto;padding:4px 8px;border:1px solid var(--border,#41464d);border-radius:3px}.status.busy{border-color:var(--accent,#5bbda5)}
.actions{display:flex;flex-wrap:wrap;gap:6px}.run-body{padding:4px 16px 16px;overflow:auto;min-height:0;flex:1}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.55;cursor:default}
.primary{border-color:var(--accent,#5bbda5)}button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}.link{border:0;padding:0;background:transparent;text-decoration:underline;overflow-wrap:anywhere;text-align:left}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:8px}.rows li{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;overflow-wrap:anywhere}.rows li.blocks{border-color:#e38269}.rows p{margin:5px 0 0;line-height:1.45}.where button{margin-left:8px;padding:2px 8px}
.badge{display:inline-block;margin-left:6px;padding:1px 6px;border:1px solid var(--border,#41464d);border-radius:10px;font-size:11px;color:var(--muted,#a7b2b9)}.badge.blocker{border-color:#e38269;color:#f0b3a3}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:6px 0}dt{color:var(--muted,#a7b2b9)}dd{margin:0;overflow-wrap:anywhere}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}.ok{border-color:var(--accent,#5bbda5)}
</style>
