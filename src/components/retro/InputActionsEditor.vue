<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="input-overlay" aria-labelledby="input-title" @cancel.prevent="cancel" @keydown.stop="onDialogKeydown">
   <section class="input-editor">
    <header><div><small>MEGA DRIVE · CONTROLES</small><h2 id="input-title">Ações do jogo</h2></div><button type="button" @click="$emit('close')" :disabled="busy" autofocus>{{ dirty ? 'Descartar e fechar' : 'Fechar' }}</button></header>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="loading">Carregando controles…</p>
    <template v-if="config && !loading">
     <div class="input-settings">
      <label>Jogador <select v-model.number="playerIndex" :disabled="busy" @change="resetPreview"><option :value="0">1</option><option :value="1">2</option></select></label>
      <label><input v-model="player.enabled" type="checkbox" :disabled="busy" @change="edited" /> Ativo</label>
      <label>Controle <select v-model.number="player.pad" :disabled="busy" @change="edited"><option :value="3">3 botões</option><option :value="6">6 botões</option></select></label>
      <button type="button" :disabled="busy" @click="preset">Usar preset {{ player.pad }} botões</button>
     </div>
     <p>Combine botões para uma ação. A alternativa também ativa a ação; “Bloquear com” impede o acionamento enquanto a combinação estiver mantida.</p>
     <div class="input-columns">
      <div class="input-actions">
       <button v-for="binding in player.bindings" :key="binding.id" type="button" :class="{selected:action===binding.id}" :aria-pressed="action===binding.id" @click="action=binding.id">
        <strong>{{ names[binding.id] }}</strong><small>{{ maskLabel(binding.primary) }}<template v-if="binding.alternate"> / {{ maskLabel(binding.alternate) }}</template></small>
       </button>
      </div>
      <div class="input-binding">
       <h3>{{ names[action] }}</h3>
       <fieldset v-for="kind in kinds" :key="kind.id" :disabled="busy"><legend>{{ kind.label }}</legend><div class="button-grid">
        <button v-for="(mask,label) in INPUT_BUTTONS" :key="label" type="button" :aria-pressed="!!(binding[kind.id]&mask)" :class="{selected:binding[kind.id]&mask,unsupported:mask & ~inputPadMask(player.pad)}" @click="toggle(kind.id,mask)">{{ label }}</button>
       </div><small>{{ maskLabel(binding[kind.id]) }}</small></fieldset>
       <label>Buffer (quadros) <input type="number" min="0" max="255" v-model.number="binding.bufferFrames" :disabled="busy" @input="edited" /></label>
       <p>Inclui o quadro do pressionamento. Zero permite consumir somente no quadro atual. O consumo ocorre uma vez.</p>
      </div>
      <aside class="input-preview" aria-label="Prévia dos controles">
       <h3>Prévia por quadro</h3><p>Clique para manter ou soltar botões; avance para verificar bordas e buffers.</p>
       <div class="button-grid"><button v-for="(mask,label) in INPUT_BUTTONS" :key="label" type="button" :aria-pressed="!!(physical&mask)" :class="{selected:physical&mask}" :disabled="!player.enabled || !!(mask & ~inputPadMask(player.pad))" @click="physical ^= mask; step()">{{ label }}</button></div>
       <button type="button" @click="step">Avançar quadro</button><button type="button" @click="resetPreview">Soltar tudo</button>
       <ul><li v-for="(id,index) in INPUT_ACTIONS" :key="id"><strong>{{ names[id] }}</strong> <span>{{ previewLabel(index) }}</span><button v-if="preview.pending&(1<<index)" type="button" @click="consumeInputPreview(preview,index)" :aria-label="'Consumir '+names[id]">Consumir</button></li></ul>
      </aside>
     </div>
     <p v-for="warning in warnings" :key="warning.player+warning.action+warning.kind" class="input-warning">Jogador {{ warning.player+1 }} · {{ names[warning.action] }}: {{ warning.kind==='unsupported' ? 'usa botões indisponíveis neste controle.' : 'sem botão atribuído.' }}</p>
     <p v-if="conflict" role="alert">O header gerado foi modificado. O arquivo será preservado; revise-o antes de exportar novamente.</p>
     <footer><small role="status">{{ dirty ? 'Alterações ainda não salvas.' : saved ? 'Controles salvos e header C exportado.' : 'Configuração carregada.' }} O game precisa consumir o mapeamento.</small><button type="button" :disabled="busy || conflict" @click="save">{{ busy ? 'Salvando…' : 'Salvar e exportar controles' }}</button></footer>
    </template>
   </section>
  </dialog>
 </Teleport>
</template>
<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {INPUT_ACTIONS,INPUT_BUTTONS,inputPadMask,createInputConfiguration,inputWarnings,createInputPreviewState,updateInputPreview,consumeInputPreview} from '../../utils/retro/inputMapping.js'
const props=defineProps({projectPath:{type:String,required:true}})
const emit=defineEmits(['close'])
const dialogElement=ref(null)
function cancel(){if(!busy.value&&!dirty.value)emit('close')}
function onDialogKeydown(event){
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
  event.preventDefault()
  if(config.value&&!loading.value&&!busy.value&&!conflict.value)void save()
 }
}
onMounted(()=>dialogElement.value?.showModal())
const config=ref(null),revision=ref(''),conflict=ref(false),loading=ref(false),busy=ref(false),error=ref(''),dirty=ref(false),saved=ref(false)
const playerIndex=ref(0),action=ref('jump'),physical=ref(0),preview=ref(createInputPreviewState())
const names={left:'Mover à esquerda',right:'Mover à direita',up:'Mover para cima',down:'Mover para baixo',jump:'Pular',attack:'Atacar',dash:'Dash',transform:'Transformar',interact:'Interagir',menu:'Menu'}
const kinds=[{id:'primary',label:'Combinação principal'},{id:'alternate',label:'Alternativa'},{id:'exclude',label:'Bloquear com'}]
const player=computed(()=>config.value?.players[playerIndex.value])
const binding=computed(()=>player.value?.bindings.find(item=>item.id===action.value))
const warnings=computed(()=>{try{return config.value?inputWarnings(config.value):[]}catch{return []}})
let request=0
function maskLabel(mask){return Object.entries(INPUT_BUTTONS).filter(([,bit])=>mask&bit).map(([label])=>label).join(' + ')||'Nenhum'}
function resetPreview(){physical.value=0;preview.value=createInputPreviewState()}
function edited(){dirty.value=true;saved.value=false;resetPreview()}
function toggle(kind,mask){binding.value[kind]^=mask;edited()}
function preset(){const enabled=player.value.enabled;config.value.players[playerIndex.value]=createInputConfiguration(player.value.pad).players[0];player.value.enabled=enabled;edited()}
function step(){if(player.value)updateInputPreview(preview.value,player.value,physical.value)}
function previewLabel(index){const bit=1<<index;return [preview.value.pressed&bit?'pressionado':'',preview.value.held&bit?'mantido':'',preview.value.released&bit?'solto':'',preview.value.buffered[index]?'buffer '+preview.value.buffered[index]:''].filter(Boolean).join(' · ')||'—'}
async function load(){
 const id=++request,projectPath=props.projectPath
 loading.value=true;error.value='';config.value=null;dirty.value=false;saved.value=false;resetPreview()
 try{const result=await window.retroStudio.retro.inputConfiguration({projectPath});if(id!==request)return;config.value=result.config;revision.value=result.revision;conflict.value=result.headerConflict}
 catch(e){if(id===request)error.value=e.message}
 finally{if(id===request)loading.value=false}
}
async function save(){
 if(busy.value)return
 const projectPath=props.projectPath,id=request
 busy.value=true;error.value=''
 try{
  const result=await window.retroStudio.retro.saveInputConfiguration({projectPath,revision:revision.value,config:JSON.parse(JSON.stringify(config.value))})
  if(id!==request)return
  config.value=result.config;revision.value=result.revision;conflict.value=result.headerConflict;dirty.value=false;saved.value=true
 }catch(e){if(id===request)error.value=e.message}
 finally{busy.value=false}
}
watch(()=>props.projectPath,()=>void load(),{immediate:true})
onBeforeUnmount(()=>{request++;dialogElement.value?.close()})
</script>
<style scoped>
.input-overlay{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0;display:none;place-items:center;background:transparent;padding:18px;box-sizing:border-box}.input-overlay[open]{display:grid}.input-overlay::backdrop{background:#0009}
.input-editor{width:min(1080px,100%);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:18px;font-size:12px}
header,footer,.input-settings{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}header{border-bottom:1px solid var(--border);padding-bottom:12px}h2{font-size:20px;margin:4px 0}h3{font-size:14px;margin-top:0}
small,.input-editor p{color:var(--muted);line-height:1.5}
button,select,input[type=number]{color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:6px 8px;font:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.selected{border-color:var(--accent);background:var(--hover);color:var(--accent)}.unsupported{text-decoration:line-through}
.input-settings{justify-content:flex-start;margin-top:14px}.input-columns{display:grid;grid-template-columns:190px minmax(240px,1fr) minmax(230px,1fr);gap:16px}
.input-actions{display:flex;flex-direction:column;gap:4px}.input-actions button{text-align:left;display:flex;flex-direction:column;gap:4px}.input-binding,.input-preview{padding:12px;border:1px solid var(--border);border-radius:4px}
fieldset{border:1px solid var(--border);margin:0 0 12px;padding:10px}legend{padding:0 4px}.button-grid{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}input[type=number]{width:64px}
ul{list-style:none;padding:0}li{margin:8px 0;display:flex;flex-wrap:wrap;align-items:center;gap:6px}li span{color:var(--muted)}.input-warning{color:var(--text)!important}
footer{margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
@media(max-width:850px){.input-columns{grid-template-columns:150px minmax(220px,1fr)}.input-preview{grid-column:1/-1}}
@media(max-width:500px){.input-columns{grid-template-columns:1fr}.input-preview{grid-column:auto}.input-overlay{padding:6px}.input-editor{padding:10px}}
</style>
