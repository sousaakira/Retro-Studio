<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),overview=ref(null),loading=ref(false),error=ref('')
let request=0,disposed=false
const labels={current:'Exportado e em dia',stale:'Desatualizado',unexported:'Salvo, não exportado',conflict:'Alterado fora da IDE',failed:'Falhou',absent:'Não usado'}
const order=['failed','conflict','stale','unexported','current','absent']
const rows=computed(()=>[...(overview.value?.rows||[])].sort((a,b)=>order.indexOf(a.state)-order.indexOf(b.state)))
const headline=computed(()=>{
 const o=overview.value;if(!o)return ''
 if(o.blocksBuild.length)return 'O build pela IDE será recusado até '+o.blocksBuild.length+' exportação(ões) ser(em) resolvida(s).'
 if(o.summary.attention)return o.summary.attention+' exportação(ões) pede(m) atenção, mas não bloqueia(m) o build.'
 return o.summary.current?'Tudo o que o projeto usa está exportado e em dia.':'O projeto ainda não usa nenhuma exportação gerenciada.'
})
async function load(){
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value='';overview.value=null
 try{
  const result=await window.retroStudio?.retro?.exportOverview?.({projectPath})
  if(disposed||id!==request)return
  if(!Array.isArray(result?.rows))throw Error(result?.error||'Estado das exportações indisponível.')
  overview.value=result
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
function close(){emit('close')}
watch(()=>props.projectPath,()=>{void load()},{immediate:true})
onMounted(()=>dialogElement.value?.showModal())
onBeforeUnmount(()=>{disposed=true;request++;dialogElement.value?.close()})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="overview-dialog" aria-labelledby="overview-title" @cancel.prevent="close()">
   <header><div><small>MEGA DRIVE · PROJETO</small><h2 id="overview-title">Estado das exportações</h2></div><button type="button" autofocus @click="close()">Fechar</button></header>
   <div class="overview-body">
    <p class="help">Cada editor salva uma fonte e exporta os arquivos que o jogo compila. Esta tela só confere; para corrigir, abra o editor indicado e use “Salvar e exportar”. O build pelo terminal usa os mesmos arquivos.</p>
    <p v-if="loading" role="status" class="notice">Conferindo exportações…</p>
    <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
    <template v-if="overview">
     <p role="status" :class="['notice',{problem:overview.blocksBuild.length}]">{{ headline }}</p>
     <ul class="rows">
      <li v-for="item in rows" :key="item.id" :class="item.state">
       <div class="top"><strong>{{ item.title }}</strong><span class="state">{{ labels[item.state] }}{{ overview.blocksBuild.includes(item.id) ? ' · bloqueia o build' : '' }}</span></div>
       <p v-if="item.message" class="message">{{ item.message }}</p>
       <p v-if="item.state!=='absent'" class="where"><span v-if="item.state!=='current'">Corrigir em: {{ item.editor }} · </span><code>{{ item.files.join(' · ') }}</code></p>
      </li>
     </ul>
    </template>
   </div>
   <footer><small>Nada é exportado nem alterado por esta tela.</small><button type="button" :disabled="loading" @click="load">Verificar de novo</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.overview-dialog{box-sizing:border-box;width:min(760px,96vw);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.overview-dialog[open]{display:flex;flex-direction:column}.overview-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;flex-shrink:0}header{border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d)}
.overview-body{padding:14px;overflow:auto;min-height:0}
h2{margin:3px 0;font-size:19px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}code{font-size:11px;overflow-wrap:anywhere}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;cursor:pointer}button:disabled{opacity:.5;cursor:default}
button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4}.problem{border-color:#e38269;color:#f0b3a3}
.rows{list-style:none;margin:10px 0 0;padding:0}.rows li{padding:8px;border:1px solid var(--border,#41464d);border-left-width:4px;border-radius:3px;margin-bottom:6px}
.top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.message,.where{margin:4px 0 0;line-height:1.4}.where{color:var(--muted,#a7b2b9)}
li.current{border-left-color:var(--accent,#5bbda5)}li.current .state{color:var(--accent,#5bbda5)}
li.stale,li.unexported{border-left-color:#f2d16b}li.stale .state,li.unexported .state{color:#f2d16b}
li.conflict,li.failed{border-left-color:#e38269}li.conflict .state,li.failed .state{color:#f0b3a3}
li.absent{opacity:.65}
</style>
