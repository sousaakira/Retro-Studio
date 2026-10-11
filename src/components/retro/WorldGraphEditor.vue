<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {validateWorldConfiguration,worldNumericId} from '../../../shared/retro/worldConfiguration.js'
import {worldDrafts} from '../../utils/retro/worldDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),config=ref(null),baseline=ref(''),revision=ref(''),selection=ref('')
const loading=ref(false),saving=ref(false),error=ref(''),headerConflict=ref(false),revisionConflict=ref(false),saved=ref(false)
const catalog=ref({maps:[],errors:[],truncated:false}),newMap=ref(''),tab=ref('entries')
let request=0,activeProject='',disposed=false,closing=false
const clone=value=>JSON.parse(JSON.stringify(value))
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
const room=computed(()=>config.value?.rooms.find(r=>r.id===selection.value))
// Ponto "Spawn" desenhado no mapa desta sala (se houver): pode virar a posição de uma entrada com um clique.
const mapSpawn=computed(()=>catalog.value.maps.find(map=>map.path===room.value?.map)?.spawn||null)
const validation=computed(()=>{try{if(config.value)validateWorldConfiguration(config.value);return ''}catch(e){return e.message}})
const blocked=computed(()=>loading.value||saving.value||headerConflict.value||revisionConflict.value)
const nodes=computed(()=>config.value?.rooms.map((r,i)=>({room:r,x:24+(i%3)*210,y:24+Math.floor(i/3)*100}))||[])
const graphHeight=computed(()=>Math.max(180,Math.ceil(nodes.value.length/3)*100+20))
const links=computed(()=>nodes.value.flatMap(node=>node.room.exits.map(exit=>({from:node,to:nodes.value.find(n=>n.room.id===exit.targetRoom),exit}))))
const initialRoom=computed(()=>config.value?.rooms.find(r=>r.id===config.value.initial?.room))
function cache(){if(activeProject&&config.value){if(dirty.value||saving.value)worldDrafts.set(activeProject,{config:clone(config.value),baseline:baseline.value,revision:revision.value,selection:selection.value},draftOwner);else worldDrafts.deleteIfOwner(activeProject,draftOwner)}}
// #52: undo/redo of this document, and a draft written while editing (not only on close).
// The same editor can be open twice (dialog and bottom dock): each instance only clears its own draft.
const draftOwner=Symbol('WorldGraphEditor')
const recoveredAt=ref(''),history=useDocumentUndo(config,{blocked:()=>loading.value||saving.value})
const draftSaver=draftTimer(()=>{if(!disposed&&config.value&&!loading.value)cache()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
async function load(discard=false){
 if(saving.value)return
 if(!discard)cache();else worldDrafts.delete(props.projectPath)
 const projectPath=props.projectPath,id=++request
 activeProject=projectPath;loading.value=true;error.value='';config.value=null;saved.value=false;revisionConflict.value=false
 try{
  const result=await window.retroStudio?.retro?.worldConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error('Configuração do mundo indisponível.')
  // #52: a draft left by an interrupted session comes back as unsaved changes.
  if(worldDrafts.needsHydration(projectPath)){await worldDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  const draft=worldDrafts.get(projectPath)
  if(draft)worldDrafts.claim(projectPath,draftOwner)
  recoveredAt.value=draft?worldDrafts.recoveredAt(projectPath):''
  config.value=clone(draft?.config||result.config);baseline.value=draft?.baseline||JSON.stringify(result.config)
  revision.value=draft?.revision||result.revision;revisionConflict.value=!!draft&&draft.revision!==result.revision
  headerConflict.value=!!result.headerConflict;catalog.value=result.catalog||{maps:[],errors:[],truncated:false}
  selection.value=draft?.selection||config.value.rooms[0]?.id||'';newMap.value=catalog.value.maps[0]?.path||''
  if(result.mapError||result.assetsError)error.value=result.mapError||result.assetsError
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||!config.value||validation.value)return
 const projectPath=props.projectPath,id=request,submitted=clone(config.value),submittedRevision=revision.value
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveWorldConfiguration?.({projectPath,config:submitted,revision:revision.value})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar o mundo.')
  const cached=worldDrafts.get(projectPath)
  if(cached?.revision===submittedRevision&&JSON.stringify(cached.config)===JSON.stringify(submitted))worldDrafts.delete(projectPath)
  if(disposed||id!==request||projectPath!==props.projectPath)return
  worldDrafts.delete(projectPath)
  config.value=clone(result.config);baseline.value=JSON.stringify(result.config);revision.value=result.revision
  catalog.value=result.catalog||catalog.value;saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)saving.value=false}
}
function uniqueId(prefix,items){
 const used=new Set(items.map(item=>worldNumericId(item.id)))
 for(let i=1;i<65535;i++){const value=prefix+'_'+i;if(!used.has(worldNumericId(value)))return value}
 throw Error('Não há IDs disponíveis.')
}
function addRoom(){
 if(blocked.value||!config.value||config.value.rooms.length>=64)return
 const map=catalog.value.maps.find(m=>m.path===newMap.value);if(!map)return
 const id=uniqueId('room',config.value.rooms)
 config.value.rooms.push({id,name:map.path.split('/').pop().replace(/\.tmx$/,''),map:map.path,width:map.width,height:map.height,entries:[{id:'spawn',x:map.spawn?map.spawn.x:Math.min(24,map.width-1),y:map.spawn?map.spawn.y:Math.min(160,map.height),facing:false}],exits:[],checkpoints:[]})
 if(!config.value.initial)config.value.initial={room:id,entry:'spawn'}
 selection.value=id
}
function changeMap(){
 const map=catalog.value.maps.find(m=>m.path===room.value?.map)
 if(map){room.value.width=map.width;room.value.height=map.height}
}
function setInitial(){const target=config.value.rooms.find(r=>r.id===config.value.initial.room);config.value.initial.entry=target?.entries[0]?.id||''}
function addItem(kind){
 if(blocked.value||!room.value||room.value[kind].length>=128)return
 const r=room.value,id=uniqueId(kind==='entries'?'entry':kind==='exits'?'exit':'checkpoint',r[kind])
 const spawn={id,x:Math.min(24,r.width-1),y:Math.min(160,r.height),facing:false}
 const area={x:0,y:0,width:Math.min(24,r.width),height:Math.min(48,r.height)}
 r[kind].push(kind==='entries'?spawn:kind==='checkpoints'?{...spawn,area}:{id,area,targetRoom:r.id,targetEntry:r.entries[0]?.id||'',requires:[]})
}
function removeRoom(){
 const r=room.value;if(!r||blocked.value)return
 if(config.value.rooms.length===1){error.value='O mundo precisa de pelo menos uma sala.';return}
 if(config.value.initial?.room===r.id||config.value.rooms.some(source=>source.exits.some(exit=>exit.targetRoom===r.id))){error.value='Mude a fase inicial e as saídas que apontam para esta sala antes de removê-la.';return}
 config.value.rooms=config.value.rooms.filter(item=>item!==r);selection.value=config.value.rooms[0]?.id||'';error.value=''
}
function removeItem(kind,item){
 if(blocked.value||!room.value)return
 const r=room.value
 if(kind==='entries'&&(r.entries.length===1||(config.value.initial?.room===r.id&&config.value.initial.entry===item.id)||config.value.rooms.some(source=>source.exits.some(exit=>exit.targetRoom===r.id&&exit.targetEntry===item.id)))){error.value='Esta entrada é a única da sala ou está sendo usada. Ajuste as conexões antes de removê-la.';return}
 r[kind]=r[kind].filter(candidate=>candidate!==item);error.value=''
}
function targetChanged(exit){exit.targetEntry=config.value.rooms.find(r=>r.id===exit.targetRoom)?.entries[0]?.id||''}
function addCondition(){if(!blocked.value&&config.value.conditions.length<64)config.value.conditions.push({id:uniqueId('condition',config.value.conditions),name:'Nova condição'})}
function removeCondition(condition){
 if(blocked.value)return
 if(config.value.rooms.some(r=>r.exits.some(exit=>exit.requires.includes(condition.id)))){error.value='A condição está sendo usada por uma saída.';return}
 config.value.conditions=config.value.conditions.filter(c=>c!==condition);error.value=''
}
function close(discard=false){if(saving.value)return;if(dirty.value&&!discard){error.value='Salve o mundo ou use “Descartar e fechar”.';return}closing=true;worldDrafts.delete(activeProject);emit('close')}
function keydown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save()}}
function canClose(){return !dirty.value&&!saving.value}
defineExpose({canClose})
watch(()=>props.projectPath,()=>{cache();saving.value=false;void load()},{immediate:true})
onMounted(()=>dialogElement.value?.showModal())
onBeforeUnmount(()=>{if(!closing)cache();disposed=true;request++;dialogElement.value?.close()})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="world-dialog" aria-labelledby="world-title" @cancel.prevent="close()" @keydown.stop="history.onKeydown($event) || keydown($event)">
   <header><div><small>MEGA DRIVE · MUNDO</small><h2 id="world-title">Salas e conexões</h2></div><button type="button" :disabled="saving" @click="close()" autofocus>Fechar</button></header>
   <p v-if="loading" role="status">Carregando mundo e mapas…</p>
   <p v-if="error" role="alert" class="notice">{{ error }}</p>
   <template v-if="config && !loading">
    <div class="world-toolbar">
     <label>Mapa <select v-model="newMap" :disabled="blocked"><option value="" disabled>Selecione um TMX</option><option v-for="map in catalog.maps" :key="map.path" :value="map.path">{{map.path}} · {{map.width}} × {{map.height}}</option></select></label>
     <button type="button" :disabled="blocked || !newMap || config.rooms.length>=64" @click="addRoom">＋ Sala</button>
     <label>Fase inicial <select v-if="config.initial" v-model="config.initial.room" :disabled="blocked" @change="setInitial"><option v-for="r in config.rooms" :key="r.id" :value="r.id">{{r.name}}</option></select><span v-else>Adicione uma sala</span></label>
     <label v-if="initialRoom">Entrada <select v-model="config.initial.entry" :disabled="blocked"><option v-for="entry in initialRoom.entries" :key="entry.id" :value="entry.id">{{entry.id}}</option></select></label>
    </div>
    <div class="world-content">
     <section class="world-graph" aria-label="Grafo de salas">
      <p v-if="!nodes.length">Crie um mapa no editor e adicione-o aqui para começar seu mundo.</p>
      <svg v-else :viewBox="`0 0 655 ${graphHeight}`" role="img" aria-label="Salas e saídas; selecione uma sala na lista abaixo">
       <defs><marker id="world-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
       <path v-for="link in links" :key="link.from.room.id+':'+link.exit.id" :d="link.to ? (link.to===link.from ? `M ${link.from.x+130} ${link.from.y} c 0 -24 -90 -24 -90 0` : `M ${link.from.x+90} ${link.from.y+60} L ${link.to.x+90} ${link.to.y}`) : `M ${link.from.x+90} ${link.from.y+60} v 30`" :class="{broken:!link.to}" class="connection" marker-end="url(#world-arrow)"><title>{{link.exit.id}} → {{link.exit.targetRoom}} / {{link.exit.targetEntry}}</title></path>
       <g v-for="node in nodes" :key="node.room.id" :transform="`translate(${node.x},${node.y})`" @click="selection=node.room.id" class="graph-node" :class="{selected:selection===node.room.id}"><rect width="180" height="60" rx="4"/><text x="10" y="24">{{ node.room.name.slice(0,22) }}</text><text x="10" y="44" class="node-detail">{{config.initial?.room===node.room.id?'▶ ':''}}{{node.room.width}} × {{node.room.height}} · {{node.room.exits.length}} saídas</text></g>
      </svg>
      <nav aria-label="Selecionar sala"><button v-for="r in config.rooms" :key="r.id" type="button" :aria-pressed="selection===r.id" @click="selection=r.id">{{r.name}}</button></nav>
      <details><summary>Condições de passagem ({{config.conditions.length}})</summary><p>O código do jogo decide quando cada condição está satisfeita.</p><div v-for="condition in config.conditions" :key="condition.id" class="condition"><code>{{condition.id}}</code><input v-model="condition.name" :disabled="blocked" :aria-label="'Nome de '+condition.id" maxlength="128"/><button type="button" :disabled="blocked" :aria-label="'Remover '+condition.id" @click="removeCondition(condition)">×</button></div><button type="button" :disabled="blocked || config.conditions.length>=64" @click="addCondition">＋ Condição</button></details>
      <details v-if="catalog.errors.length || catalog.truncated"><summary>Avisos do catálogo</summary><p v-if="catalog.truncated">Catálogo limitado a 256 mapas e 4096 arquivos. Mapas já usados continuam preservados.</p><p v-for="issue in catalog.errors" :key="issue.path">{{issue.path}}: {{issue.error}}</p></details>
     </section>
     <aside class="world-inspector" aria-label="Propriedades da sala">
      <template v-if="room">
       <h3>{{room.name}}</h3><code>{{room.id}}</code>
       <fieldset :disabled="blocked"><label>Nome <input v-model="room.name" maxlength="128" /></label><label>Mapa <select v-model="room.map" @change="changeMap"><option v-if="!catalog.maps.some(m=>m.path===room.map)" :value="room.map">{{room.map}} (fora do catálogo)</option><option v-for="map in catalog.maps" :key="map.path" :value="map.path">{{map.path}}</option></select></label></fieldset>
       <p>{{room.width}} × {{room.height}} px · Coordenadas dos pés em pixels.</p>
       <div class="item-tabs" role="group" aria-label="Itens da sala"><button v-for="(label,key) in {entries:'Entradas',exits:'Saídas',checkpoints:'Checkpoints'}" :key="key" type="button" :aria-pressed="tab===key" @click="tab=key">{{label}} {{room[key].length}}</button></div>
       <button type="button" :disabled="blocked || room[tab].length>=128" @click="addItem(tab)">＋ {{tab==='entries'?'Entrada':tab==='exits'?'Saída':'Checkpoint'}}</button>
       <fieldset v-for="item in room[tab]" :key="room.id+':'+tab+':'+item.id" :disabled="blocked" class="world-item"><legend>{{item.id}}</legend>
        <template v-if="tab!=='exits'"><div class="pair"><label>Pés X <input v-model.number="item.x" type="number" min="0" :max="room.width-1"/></label><label>Pés Y <input v-model.number="item.y" type="number" min="0" :max="room.height"/></label></div><label>Orientação <select v-model="item.facing"><option :value="false">Direita</option><option :value="true">Esquerda</option></select></label><button v-if="tab==='entries'&&mapSpawn&&(item.x!==mapSpawn.x||item.y!==mapSpawn.y)" type="button" class="use-spawn" @click="item.x=mapSpawn.x;item.y=mapSpawn.y">Usar o Spawn do mapa (x {{mapSpawn.x}}, y {{mapSpawn.y}})</button></template>
        <template v-if="item.area"><small>Área do gatilho</small><div class="pair"><label v-for="(label,key) in {x:'X',y:'Y',width:'Largura',height:'Altura'}" :key="key">{{label}} <input v-model.number="item.area[key]" type="number" :min="key==='width'||key==='height'?1:0" :max="32767"/></label></div></template>
        <template v-if="tab==='exits'"><label>Sala de destino <select v-model="item.targetRoom" @change="targetChanged(item)"><option v-for="r in config.rooms" :key="r.id" :value="r.id">{{r.name}}</option></select></label><label>Entrada de destino <select v-model="item.targetEntry"><option v-for="entry in config.rooms.find(r=>r.id===item.targetRoom)?.entries||[]" :key="entry.id" :value="entry.id">{{entry.id}}</option></select></label><details v-if="config.conditions.length"><summary>Exigir condições ({{item.requires.length}})</summary><label v-for="condition in config.conditions" :key="condition.id"><input v-model="item.requires" type="checkbox" :value="condition.id" />{{condition.name}}</label></details></template>
        <button type="button" @click="removeItem(tab,item)">Remover {{item.id}}</button>
       </fieldset>
       <button type="button" :disabled="blocked" @click="removeRoom">Remover sala do mundo</button>
      </template><p v-else>Selecione uma sala para editar suas entradas e conexões.</p>
     </aside>
    </div>
    <p v-if="validation" role="alert" class="notice">{{validation}}</p>
    <p v-if="headerConflict || revisionConflict" role="alert" class="notice">{{headerConflict?'O header foi personalizado e será preservado.':'O mundo mudou no disco. Seu rascunho está preservado.'}}</p>
   </template>
   <footer><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="loading || saving || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="loading || saving || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><div><small role="status">{{saving?'Exportando…':dirty?(recoveredAt?'Alterações não salvas, recuperadas de '+recoveredAt+'.':'Alterações não salvas.'):saved?'Mundo e recursos das salas exportados.':'world/world.json · src/generated/world_config.h'}}</small><small>O game precisa consumir o runtime e carregar os recursos das salas.</small></div><button v-if="dirty || revisionConflict" type="button" :disabled="saving" @click="load(true)">Descartar e recarregar</button><button v-else type="button" :disabled="saving || loading" @click="load()">Atualizar mapas</button><button v-if="dirty" type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button><button type="button" class="primary" :disabled="blocked || !config || !!validation" @click="save">Salvar e exportar mundo</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.world-dialog{box-sizing:border-box;width:min(1180px,96vw);height:min(820px,94vh);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.world-dialog[open]{display:flex;flex-direction:column}.world-dialog::backdrop{background:#0009}
header,footer,.world-toolbar{display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--border,#41464d);flex-shrink:0}header{justify-content:space-between}h2{margin:3px 0;font-size:19px}h3{margin:0 0 8px}small,code{color:var(--muted,#a7b2b9)}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;min-width:0}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true],.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}:is(button,input,select):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.world-toolbar{flex-wrap:wrap}.world-toolbar label{display:flex;align-items:center;gap:6px}.world-toolbar select{max-width:250px}.world-content{display:grid;grid-template-columns:minmax(0,1fr) 340px;flex:1;min-height:0;overflow:hidden}.world-graph,.world-inspector{overflow:auto;padding:14px;min-width:0}.world-inspector{border-left:1px solid var(--border,#41464d)}svg{width:100%;display:block;background:var(--bg,#171c21);color:var(--accent,#5bbda5)}.connection{fill:none;stroke:currentColor;stroke-width:2}.connection.broken{stroke:#e38269}.graph-node{cursor:pointer}.graph-node rect{fill:var(--panel,#20252a);stroke:var(--border,#41464d)}.graph-node.selected rect{stroke:var(--accent,#5bbda5);stroke-width:2}.graph-node text{fill:var(--text,#ddd);font-size:12px}.graph-node .node-detail{fill:var(--muted,#a7b2b9);font-size:10px}nav,.item-tabs{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0}label{display:flex;gap:5px;align-items:center;margin:6px 0}label input:not([type=checkbox]),label select{flex:1;width:100%}fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);margin:10px 0}fieldset label{flex-direction:column;align-items:stretch}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.world-item details label{flex-direction:row}.condition{display:flex;align-items:center;gap:6px;margin:8px 0}.condition input{width:100%;flex:1}details{margin:12px 0}summary{cursor:pointer}.notice{margin:0;padding:8px 12px;color:#e8ac8e;overflow-wrap:anywhere;flex-shrink:0}footer{border-bottom:0;border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer div{display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px}
@media(max-width:760px){.world-content{grid-template-columns:minmax(0,1fr) 280px}.world-toolbar select{max-width:170px}}@media(max-width:580px){.world-content{display:block;overflow:auto}.world-graph,.world-inspector{overflow:visible}.world-inspector{border-left:0;border-top:1px solid var(--border,#41464d)}}
.history-buttons{display:inline-flex;gap:4px}
</style>
