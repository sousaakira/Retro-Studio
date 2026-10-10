<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),status=ref(null),loading=ref(false),saving=ref(false),error=ref(''),saved=ref(false)
let request=0,disposed=false
const blocked=computed(()=>loading.value||saving.value)
const report=computed(()=>status.value?.report||null)
const groups=computed(()=>['error','warning','info'].map(severity=>({severity,items:(report.value?.issues||[]).filter(item=>item.severity===severity)})).filter(group=>group.items.length))
const labels={error:'Erros',warning:'Avisos',info:'Informações'}
// Derived data only: what can be exported is decided by the sources, never edited here.
const state=computed(()=>{
 const s=status.value
 if(!s)return ''
 if(s.error)return s.error
 if(s.headerConflict)return 'O header foi personalizado e será preservado.'
 if(report.value?.errors)return 'Corrija os erros nos mapas ou nas cenas para exportar.'
 if(!s.exported)return 'Ainda não exportado: o build ignora os gatilhos dos mapas.'
 return s.current?'O header exportado está em dia.':'As fontes mudaram: exporte de novo antes do build.'
})
const canExport=computed(()=>!!status.value&&!blocked.value&&!status.value.error&&!status.value.headerConflict&&!report.value?.errors&&!(status.value.exported&&status.value.current))
async function load(){
 if(saving.value)return
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value='';status.value=null;saved.value=false
 try{
  const result=await window.retroStudio?.retro?.cutsceneAdapter?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.revision)throw Error(result?.error||'Adaptador de cutscenes indisponível.')
  status.value=result
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(!canExport.value)return
 const projectPath=props.projectPath,id=request
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveCutsceneAdapter?.({projectPath,revision:status.value.revision})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar gatilhos e flags.')
  if(disposed||id!==request||projectPath!==props.projectPath)return
  status.value=result;saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed){saving.value=false;if(id!==request)void load()}}
}
function close(){if(!saving.value)emit('close')}
function canClose(){return !saving.value}
defineExpose({canClose})
watch(()=>props.projectPath,()=>{saving.value=false;void load()},{immediate:true})
onMounted(()=>dialogElement.value?.showModal())
onBeforeUnmount(()=>{disposed=true;request++;dialogElement.value?.close()})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="adapter-dialog" aria-labelledby="adapter-title" @cancel.prevent="close()">
   <header><div><small>MEGA DRIVE · CUTSCENES</small><h2 id="adapter-title">Adaptador de cutscenes</h2></div><button type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <div class="adapter-body">
    <p class="help">Exporta para o jogo os gatilhos de cena desenhados nos mapas (objetos <code>cutscene_trigger</code>) e a ligação entre as flags das cenas e as flags do progresso. Nada é editado aqui: os dados vêm dos mapas, das cenas e do progresso.</p>
    <p v-if="loading" role="status" class="notice">Lendo mapas, cenas e progresso…</p>
    <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
    <template v-if="status">
     <p role="status" :class="['notice',{problem:status.error || status.headerConflict || report?.errors}]">{{ state }}</p>
     <template v-if="report">
      <dl class="metrics">
       <div><dt>Cenas</dt><dd>{{ report.scenes }}</dd></div>
       <div><dt>Gatilhos</dt><dd>{{ report.rooms.reduce((n,room)=>n+room.triggers,0) }} em {{ report.rooms.filter(room=>room.triggers).length }} sala(s)</dd></div>
       <div><dt>Flags salvas</dt><dd>{{ report.links.length }} de {{ report.flags }}</dd></div>
       <div><dt>Histórico de cenas vistas</dt><dd>{{ report.played ? 'salvo em '+report.played.bytes+' byte(s)' : 'não salvo' }}</dd></div>
      </dl>
      <table v-if="report.rooms.length"><thead><tr><th scope="col">Sala</th><th scope="col">Gatilhos</th></tr></thead><tbody><tr v-for="room in report.rooms" :key="room.id"><td>{{ room.id }}</td><td>{{ room.triggers }}</td></tr></tbody></table>
      <div v-for="group in groups" :key="group.severity" :class="['issues',group.severity]"><h3>{{ labels[group.severity] }} · {{ group.items.length }}</h3><ul><li v-for="(item,index) in group.items" :key="index">{{ item.message }}</li></ul></div>
      <p class="help">Para salvar uma flag de cena, crie em “Progresso e save” uma flag com o mesmo ID. Para lembrar as cenas de execução única, crie o campo <code>cutscenes_played</code>.</p>
     </template>
    </template>
   </div>
   <footer><div><small role="status">{{ saving ? 'Exportando…' : saved ? 'Gatilhos e flags exportados.' : 'src/generated/cutscene_adapter.h' }}</small><small>O game precisa instalar o módulo cutscene-host e o runtime de cutscenes.</small></div><button type="button" :disabled="blocked" @click="load">Recarregar</button><button type="button" class="primary" :disabled="!canExport" @click="save">Exportar gatilhos e flags</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.adapter-dialog{box-sizing:border-box;width:min(720px,96vw);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.adapter-dialog[open]{display:flex;flex-direction:column}.adapter-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer>div{display:flex;flex-direction:column;gap:2px;flex:1;min-width:180px}
.adapter-body{padding:14px;overflow:auto;min-height:0}
h2{margin:3px 0;font-size:19px}h3{margin:12px 0 6px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}code{font-size:11px}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4}.problem{border-color:#e38269;color:#f0b3a3}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}.metrics div{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}dt{color:var(--muted,#a7b2b9)}dd{margin:3px 0 0}
table{width:100%;border-collapse:collapse;margin:8px 0}th{text-align:left;font-weight:400;color:var(--muted,#a7b2b9)}th,td{padding:4px 6px;border-bottom:1px solid var(--border,#41464d)}
.issues ul{margin:4px 0;padding-left:18px;line-height:1.5}.issues.error h3{color:#f0b3a3}.issues.warning h3{color:#f2d16b}
</style>
