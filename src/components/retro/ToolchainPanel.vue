<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),status=ref(null),loading=ref(false),saving=ref(false),error=ref(''),saved=ref(false)
let request=0,disposed=false
const blocked=computed(()=>loading.value||saving.value)
// Two lists on purpose: what this machine lacks is not the game's fault, and vice versa.
const scopes=computed(()=>[['environment','Ambiente (esta máquina)'],['project','Projeto']].map(([scope,title])=>({scope,title,items:(status.value?.issues||[]).filter(item=>item.scope===scope)})))
const labels={error:'Erro',warning:'Aviso',info:'Informação'}
const tools=computed(()=>{
 const d=status.value?.detected;if(!d)return []
 return [['SDK',d.sdk?d.sdk.name.toUpperCase()+' '+d.sdk.version:''],['Compilador',d.compiler],['rescomp',d.rescomp?'presente':''],['make',d.tools.make],['Java',d.tools.java],['Python',d.tools.python3]]
})
const recordedModules=computed(()=>Object.entries(status.value?.record?.runtime.modules||{}).map(([id,version])=>id+' v'+version).join(', '))
const outdated=computed(()=>{const s=status.value;return !!s?.record&&JSON.stringify(s.installed)!==JSON.stringify(s.record.runtime.modules)})
const canRecord=computed(()=>!!status.value&&!blocked.value&&!!status.value.detected.sdk&&!status.value.recordInvalid)
async function load(){
 if(saving.value)return
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value='';status.value=null;saved.value=false
 try{
  const result=await window.retroStudio?.retro?.toolchainStatus?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.revision)throw Error(result?.error||'Diagnóstico da base técnica indisponível.')
  status.value=result
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function record(){
 if(!canRecord.value)return
 const projectPath=props.projectPath,id=request
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.recordToolchain?.({projectPath,revision:status.value.revision})
  if(!result?.success)throw Error(result?.error||'Não foi possível registrar a base técnica.')
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
  <dialog ref="dialogElement" class="toolchain-dialog" aria-labelledby="toolchain-title" @cancel.prevent="close()">
   <header><div><small>MEGA DRIVE · PROJETO</small><h2 id="toolchain-title">Base técnica do projeto</h2></div><button type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <div class="toolchain-body">
    <p class="help">O projeto registra com quais versões de SDK, módulos de runtime e geradores ele foi feito. A IDE compara esse registro com as ferramentas desta máquina e separa o que é problema do ambiente do que é do projeto. Registrar não altera o código do jogo.</p>
    <p v-if="loading" role="status" class="notice">Verificando ferramentas…</p>
    <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
    <template v-if="status">
     <h3>Nesta máquina</h3>
     <dl class="metrics"><div v-for="tool in tools" :key="tool[0]" :class="{missing:!tool[1]}"><dt>{{ tool[0] }}</dt><dd>{{ tool[1] || 'não encontrado' }}</dd></div></dl>
     <h3>Registrado no projeto</h3>
     <p v-if="status.record" class="recorded">{{ status.record.sdk.name.toUpperCase() }} {{ status.record.sdk.version }}{{ status.record.compiler ? ' · '+status.record.compiler : '' }}{{ status.record.ide ? ' · Retro Studio '+status.record.ide : '' }}<br><small>Módulos: {{ recordedModules || 'nenhum' }}</small></p>
     <p v-else class="help">{{ status.recordInvalid ? 'O registro existente não pôde ser lido e foi preservado.' : 'Nada registrado ainda.' }}</p>
     <p v-if="outdated" class="notice">Os módulos instalados no projeto mudaram desde o último registro.</p>
     <section v-for="group in scopes" :key="group.scope" :aria-label="group.title">
      <h3>{{ group.title }} · {{ group.items.length ? group.items.length+' ponto(s)' : 'sem pendências' }}</h3>
      <ul v-if="group.items.length"><li v-for="(item,index) in group.items" :key="index" :class="item.severity"><strong>{{ labels[item.severity] }}:</strong> {{ item.message }}</li></ul>
     </section>
    </template>
   </div>
   <footer><div><small role="status">{{ saving ? 'Registrando…' : saved ? 'Base técnica registrada.' : 'retro-studio.toolchain.json' }}</small><small>O arquivo acompanha o projeto; caminhos desta máquina não são gravados.</small></div><button type="button" :disabled="blocked" @click="load">Verificar de novo</button><button type="button" class="primary" :disabled="!canRecord" @click="record">{{ status?.record ? 'Atualizar registro' : 'Registrar base técnica' }}</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.toolchain-dialog{box-sizing:border-box;width:min(760px,96vw);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.toolchain-dialog[open]{display:flex;flex-direction:column}.toolchain-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer>div{display:flex;flex-direction:column;gap:2px;flex:1;min-width:180px}
.toolchain-body{padding:14px;overflow:auto;min-height:0}
h2{margin:3px 0;font-size:19px}h3{margin:14px 0 6px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help,.recorded{margin:6px 0;line-height:1.5}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4}.problem{border-color:#e38269;color:#f0b3a3}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:6px 0}.metrics div{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}.metrics .missing{border-color:#e38269}.metrics .missing dd{color:#f0b3a3}dt{color:var(--muted,#a7b2b9)}dd{margin:3px 0 0;overflow-wrap:anywhere}
ul{margin:4px 0;padding-left:18px;line-height:1.5}li.error strong{color:#f0b3a3}li.warning strong{color:#f2d16b}
</style>
