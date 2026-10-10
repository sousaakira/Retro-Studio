<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {PROGRESS_LIMITS,PROGRESS_SRAM_SIZES,validateProgressConfiguration,compileProgressHeader,progressCompatibility,progressMemory} from '../../../shared/retro/progressConfiguration.js'
import {progressDrafts} from '../../utils/retro/progressDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),config=ref(null),baseline=ref(''),revision=ref(''),exported=ref(false),romHeader=ref(null)
const loading=ref(false),saving=ref(false),error=ref(''),headerConflict=ref(false),revisionConflict=ref(false),saved=ref(false),dropSchemas=ref(false),moveSlots=ref(false)
let request=0,activeProject='',disposed=false,closing=false
const clone=value=>JSON.parse(JSON.stringify(value))
const capacities=Array.from({length:PROGRESS_LIMITS.flags/8+1},(_,i)=>i*8)
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
const blocked=computed(()=>loading.value||saving.value)
// Stored meaning is compared with what was last exported, not with the draft.
const previous=computed(()=>exported.value&&baseline.value?JSON.parse(baseline.value):null)
const sameSchema=computed(()=>!!previous.value&&config.value?.schema===previous.value.schema)
const validation=computed(()=>{
 try{if(config.value){validateProgressConfiguration(config.value);progressCompatibility(previous.value,config.value,{allowDroppedSchemas:dropSchemas.value,allowMovedSlots:moveSlots.value})}return ''}
 catch(e){return e.message}
})
const header=computed(()=>{try{return config.value&&!validation.value?compileProgressHeader(config.value):''}catch{return ''}})
const memory=computed(()=>{try{return config.value?progressMemory(config.value):null}catch{return null}})
const dropped=computed(()=>{
 const now=config.value,old=previous.value;if(!now||!old)return []
 const kept=item=>now.history.some(entry=>entry.schema===item.schema&&entry.flagCapacity===item.flagCapacity&&entry.dataSize===item.dataSize)
 return [...old.history,...(now.schema!==old.schema?[old]:[])].filter(item=>!kept(item)).map(item=>item.schema)
})
// One cell per reserved bit/byte, so free space and overlaps are visible before exporting.
const cells=(value,limit)=>Number.isInteger(value)?Math.max(0,Math.min(value,limit)):0
const slotsMoved=computed(()=>{const old=previous.value?.sram,now=config.value?.sram;return !!old&&!!now&&old.enabled&&now.enabled&&(now.offset!==old.offset||now.slots<old.slots)})
const canVersion=computed(()=>sameSchema.value&&previous.value.schema<65535&&(config.value.history.length<PROGRESS_LIMITS.history||config.value.history.some(item=>item.schema===previous.value.schema)))
const bitCells=computed(()=>Array.from({length:cells(config.value?.flagCapacity,PROGRESS_LIMITS.flags)},(_,bit)=>({bit,owners:config.value.flags.filter(flag=>flag.bit===bit)})))
const byteCells=computed(()=>Array.from({length:cells(config.value?.dataSize,PROGRESS_LIMITS.data)},(_,offset)=>({offset,
 owners:config.value.fields.filter(field=>Number.isInteger(field.offset)&&offset>=field.offset&&offset<field.offset+field.bytes)})))
function cache(){if(activeProject&&config.value){if(dirty.value||saving.value)progressDrafts.set(activeProject,{config:clone(config.value),baseline:baseline.value,revision:revision.value,exported:exported.value,dropSchemas:dropSchemas.value,moveSlots:moveSlots.value},draftOwner);else progressDrafts.deleteIfOwner(activeProject,draftOwner)}}
// #52: undo/redo of this document, and a draft written while editing (not only on close).
// The same editor can be open twice (dialog and bottom dock): each instance only clears its own draft.
const draftOwner=Symbol('ProgressEditor')
const recoveredAt=ref(''),history=useDocumentUndo(config,{blocked:()=>blocked.value})
const draftSaver=draftTimer(()=>{if(!disposed&&config.value&&!loading.value)cache()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
function apply(result){exported.value=!!result.exported;romHeader.value=result.romHeaderDeclaresSram??null;headerConflict.value=!!result.headerConflict}
async function load(discard=false){
 if(saving.value)return
 if(!discard)cache();else progressDrafts.delete(props.projectPath)
 const projectPath=props.projectPath,id=++request
 activeProject=projectPath;loading.value=true;error.value='';config.value=null;saved.value=false;revisionConflict.value=false;dropSchemas.value=false;moveSlots.value=false
 try{
  const result=await window.retroStudio?.retro?.progressConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error(result?.error||'Configuração de progresso indisponível.')
  // #52: a draft left by an interrupted session comes back as unsaved changes.
  if(progressDrafts.needsHydration(projectPath)){await progressDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  const draft=progressDrafts.get(projectPath),conflict=!!draft&&draft.revision!==result.revision
  if(draft)progressDrafts.claim(projectPath,draftOwner)
  recoveredAt.value=draft?progressDrafts.recoveredAt(projectPath):''
  apply(result)
  // A conflicting draft keeps the baseline it was written against until it is discarded.
  if(conflict)exported.value=draft.exported
  config.value=clone(draft?.config||result.config);baseline.value=draft?.baseline||JSON.stringify(result.config)
  revision.value=draft?.revision||result.revision;revisionConflict.value=conflict;dropSchemas.value=!!draft?.dropSchemas;moveSlots.value=!!draft?.moveSlots
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||headerConflict.value||revisionConflict.value||!config.value||validation.value)return
 const projectPath=props.projectPath,id=request,submitted=clone(config.value),submittedRevision=revision.value
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveProgressConfiguration?.({projectPath,config:submitted,revision:submittedRevision,allowDroppedSchemas:dropSchemas.value,allowMovedSlots:moveSlots.value})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar o progresso.')
  const cached=progressDrafts.get(projectPath)
  if(cached?.revision===submittedRevision)progressDrafts.delete(projectPath)
  if(disposed||projectPath!==props.projectPath)return
  // Late reply after leaving and returning: the saved draft must not be cached again.
  if(id!==request){config.value=null;void load();return}
  config.value=clone(result.config);baseline.value=JSON.stringify(result.config);revision.value=result.revision
  apply(result);dropSchemas.value=false;moveSlots.value=false;saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)saving.value=false}
}
/** Next schema: the exported layout goes to the history so old saves keep loading. */
function newSchema(){
 const old=previous.value,now=config.value
 if(blocked.value||!old||!now||!canVersion.value)return
 if(!now.history.some(item=>item.schema===old.schema))now.history.push({schema:old.schema,flagCapacity:old.flagCapacity,dataSize:old.dataSize})
 now.schema=old.schema+1
}
function addFlag(){
 const now=config.value;if(blocked.value||!now)return
 const bits=new Set(now.flags.map(flag=>flag.bit)),ids=new Set(now.flags.map(flag=>flag.id));let bit=0,number=1
 while(bits.has(bit))bit++
 if(bit>=now.flagCapacity)return
 while(ids.has('flag_'+number))number++
 now.flags.push({id:'flag_'+number,name:'Flag '+number,bit})
}
function addField(){
 const now=config.value;if(blocked.value||!now)return
 const used=new Set(byteCells.value.filter(cell=>cell.owners.length).map(cell=>cell.offset)),ids=new Set(now.fields.map(field=>field.id));let offset=0,number=1
 while(used.has(offset))offset++
 if(offset>=now.dataSize)return
 while(ids.has('field_'+number))number++
 now.fields.push({id:'field_'+number,name:'Campo '+number,offset,bytes:1})
}
function removeHistory(schema){if(!blocked.value&&config.value)config.value.history=config.value.history.filter(item=>item.schema!==schema)}
function close(discard=false){
 if(saving.value)return
 if(dirty.value&&!discard){error.value='Salve o progresso ou use “Descartar e fechar”.';return}
 closing=true;if(config.value||discard)progressDrafts.delete(activeProject);emit('close')
}
function keydown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save()}}
function canClose(){return !dirty.value&&!saving.value}
defineExpose({canClose})
watch(()=>props.projectPath,()=>{cache();saving.value=false;void load()},{immediate:true})
onMounted(()=>dialogElement.value?.showModal())
onBeforeUnmount(()=>{if(!closing)cache();disposed=true;request++;dialogElement.value?.close()})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="progress-dialog" aria-labelledby="progress-title" @cancel.prevent="close()" @keydown.stop="history.onKeydown($event) || keydown($event)">
   <header><div><small>MEGA DRIVE · PRODUÇÃO</small><h2 id="progress-title">Progresso e save</h2></div><button type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <p v-if="loading" role="status" class="notice">Carregando progresso…</p>
   <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
   <div v-if="config" class="progress-content">
    <main class="progress-main" aria-label="Formato do progresso">
     <section>
      <h3>Formato salvo · versão {{ config.schema }}</h3>
      <p class="help">O checkpoint (sala e ponto) sempre faz parte do save. Flags e campos ocupam o espaço reservado abaixo. Mudar o espaço reservado, o bit de uma flag ou a posição de um campo muda o significado dos saves antigos e exige uma nova versão.</p>
      <div class="row">
       <label>Flags reservadas <select v-model.number="config.flagCapacity" :disabled="blocked || sameSchema"><option v-for="n in capacities" :key="n" :value="n">{{ n }}</option></select></label>
       <label>Dados do jogo <small>bytes</small> <input v-model.number="config.dataSize" type="number" min="0" :max="PROGRESS_LIMITS.data" step="1" :disabled="blocked || sameSchema" /></label>
       <button v-if="exported" type="button" :disabled="blocked || !canVersion" @click="newSchema">Nova versão do formato</button>
      </div>
      <p v-if="sameSchema && !canVersion" class="help">O histórico está cheio ({{ PROGRESS_LIMITS.history }} versões). Remova uma versão antiga para criar outra.</p>
      <p v-if="sameSchema" class="help">Para mudar o espaço reservado, crie uma nova versão; a atual entra no histórico e os saves antigos continuam carregando.</p>
     </section>
     <section>
      <div class="title"><h3>Flags <small>{{ config.flags.length }} de {{ config.flagCapacity }}</small></h3><button type="button" :disabled="blocked || config.flags.length>=config.flagCapacity" @click="addFlag">＋ Flag</button></div>
      <div class="cells" aria-hidden="true"><span v-for="cell in bitCells" :key="cell.bit" :class="{used:cell.owners.length===1,clash:cell.owners.length>1}" :title="'bit '+cell.bit+(cell.owners.length?' · '+cell.owners.map(o=>o.id).join(', '):' · livre')"></span></div>
      <table v-if="config.flags.length"><thead><tr><th scope="col">ID no código</th><th scope="col">Nome</th><th scope="col">Bit</th><th></th></tr></thead>
       <tbody><tr v-for="(flag,index) in config.flags" :key="index">
        <td data-label="ID no código"><input v-model="flag.id" maxlength="32" :disabled="blocked" :aria-label="'ID da flag '+(index+1)" /></td>
        <td data-label="Nome"><input v-model="flag.name" maxlength="128" :disabled="blocked" :aria-label="'Nome da flag '+(index+1)" /></td>
        <td data-label="Bit"><input v-model.number="flag.bit" type="number" min="0" :max="config.flagCapacity-1" :disabled="blocked" :aria-label="'Bit da flag '+(index+1)" /></td>
        <td><button type="button" :disabled="blocked" :aria-label="'Remover flag '+flag.id" @click="config.flags.splice(index,1)">Remover</button></td>
       </tr></tbody></table>
      <p v-else class="help">Nenhuma flag. Use flags para portas abertas, chefes derrotados e itens únicos.</p>
     </section>
     <section>
      <div class="title"><h3>Campos do jogo <small>{{ byteCells.filter(c=>c.owners.length).length }} de {{ config.dataSize }} bytes</small></h3><button type="button" :disabled="blocked || byteCells.every(c=>c.owners.length)" @click="addField">＋ Campo</button></div>
      <div class="cells bytes" aria-hidden="true"><span v-for="cell in byteCells" :key="cell.offset" :class="{used:cell.owners.length===1,clash:cell.owners.length>1}" :title="'byte '+cell.offset+(cell.owners.length?' · '+cell.owners.map(o=>o.id).join(', '):' · livre')"></span></div>
      <table v-if="config.fields.length"><thead><tr><th scope="col">ID no código</th><th scope="col">Nome</th><th scope="col">Byte inicial</th><th scope="col">Tamanho</th><th></th></tr></thead>
       <tbody><tr v-for="(field,index) in config.fields" :key="index">
        <td data-label="ID no código"><input v-model="field.id" maxlength="32" :disabled="blocked" :aria-label="'ID do campo '+(index+1)" /></td>
        <td data-label="Nome"><input v-model="field.name" maxlength="128" :disabled="blocked" :aria-label="'Nome do campo '+(index+1)" /></td>
        <td data-label="Byte inicial"><input v-model.number="field.offset" type="number" min="0" :max="config.dataSize-1" :disabled="blocked" :aria-label="'Byte inicial do campo '+(index+1)" /></td>
        <td data-label="Tamanho"><select v-model.number="field.bytes" :disabled="blocked" :aria-label="'Tamanho do campo '+(index+1)"><option :value="1">1 byte · até 255</option><option :value="2">2 bytes · até 65535</option><option :value="4">4 bytes</option></select></td>
        <td><button type="button" :disabled="blocked" :aria-label="'Remover campo '+field.id" @click="config.fields.splice(index,1)">Remover</button></td>
       </tr></tbody></table>
      <p v-else class="help">Nenhum campo. Use campos para vidas, moedas, pontuação e tempo de jogo.</p>
     </section>
     <details><summary>Dados exportados (progress_config.h)</summary><pre v-if="header">{{ header }}</pre><p v-else>Corrija a configuração para ver o header.</p></details>
    </main>
    <aside class="progress-inspector" aria-label="Cartucho e memória">
     <fieldset :disabled="blocked"><legend>Save no cartucho (SRAM)</legend>
      <label class="check"><input v-model="config.sram.enabled" type="checkbox" />Salvar o progresso na SRAM</label>
      <p v-if="!config.sram.enabled" class="help">Desativado: o progresso vive só na RAM e o jogo recomeça ao desligar. O mesmo código do jogo funciona nos dois casos.</p>
      <template v-else>
       <label class="field"><span>Slots de save</span><input v-model.number="config.sram.slots" type="number" min="1" :max="PROGRESS_LIMITS.slots" step="1" /></label>
       <label class="field"><span>Tamanho da SRAM</span><select v-model.number="config.sram.size"><option v-for="size in PROGRESS_SRAM_SIZES" :key="size" :value="size">{{ size }} B · {{ size*8/1024 }} kbit</option></select></label>
       <label class="field"><span>Primeiro byte usado</span><input v-model.number="config.sram.offset" type="number" min="0" :max="config.sram.size" step="1" /></label>
       <label v-if="slotsMoved" class="check"><input v-model="moveSlots" type="checkbox" />Mudar a posição ou reduzir os slots mesmo assim (os saves existentes serão lidos errado ou perdidos)</label>
       <p class="help">SRAM de 8 bits nos endereços ímpares a partir de 0x200001, como o SGDK usa. O cabeçalho da ROM precisa declarar “RA”.</p>
       <p v-if="romHeader===false" role="alert" class="notice problem">src/boot/rom_head.c não declara “RA”. O build será recusado até a SRAM ser declarada ou desativada aqui.</p>
       <p v-else-if="romHeader===null" class="help">O projeto não tem src/boot/rom_head.c; o cabeçalho padrão do SGDK já declara a SRAM.</p>
      </template>
     </fieldset>
     <dl v-if="memory" class="metrics">
      <div><dt>Registro salvo</dt><dd>{{ memory.record }} de {{ PROGRESS_LIMITS.copyBytes }} bytes</dd></div>
      <div><dt>SRAM usada</dt><dd>{{ memory.sram ? memory.sram+' bytes · '+memory.firstByte+' a '+memory.lastByte : 'nenhuma' }}</dd></div>
      <div><dt>RAM do progresso</dt><dd>{{ memory.ram }} bytes</dd></div>
      <div><dt>Pilha ao salvar ou carregar</dt><dd>{{ memory.stack }} bytes</dd></div>
     </dl>
     <p class="help">Cada slot guarda duas cópias com verificação. Se uma estragar (por exemplo, o console desligou durante o save), o jogo carrega a outra.</p>
     <h3>Versões antigas que o jogo ainda lê</h3>
     <ul v-if="config.history.length" class="history"><li v-for="item in config.history" :key="item.schema"><span>Versão {{ item.schema }} · {{ item.flagCapacity }} flags · {{ item.dataSize }} bytes</span><button type="button" :disabled="blocked" @click="removeHistory(item.schema)">Remover</button></li></ul>
     <p v-else class="help">Nenhuma. Ao criar uma nova versão, a anterior aparece aqui.</p>
     <label v-if="dropped.length" class="check"><input v-model="dropSchemas" type="checkbox" :disabled="blocked" />Abandonar os saves da versão {{ dropped.join(', ') }} (o jogo passará a recusá-los)</label>
     <p v-if="validation" role="alert" class="notice problem">{{ validation }}</p>
     <p v-if="headerConflict || revisionConflict" role="alert" class="notice problem">{{ headerConflict ? 'O header foi personalizado e será preservado.' : 'O progresso mudou no disco. Seu rascunho está preservado.' }}</p>
    </aside>
   </div>
   <footer><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="blocked || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="blocked || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><div><small role="status">{{ saving ? 'Exportando…' : dirty ? (recoveredAt ? 'Alterações não salvas, recuperadas de ' + recoveredAt + '.' : 'Alterações não salvas.') : saved ? 'Progresso salvo e header C exportado.' : 'progress/progress.json · src/generated/progress_config.h' }}</small><small>O game precisa instalar o módulo progress e chamar novo jogo, continuar, salvar e apagar.</small></div><button v-if="dirty || revisionConflict" type="button" :disabled="saving" @click="load(true)">Descartar e recarregar</button><button v-if="dirty" type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button><button type="button" class="primary" :disabled="blocked || headerConflict || revisionConflict || !config || !!validation" @click="save">Salvar e exportar progresso</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.progress-dialog{box-sizing:border-box;width:min(1180px,96vw);height:min(820px,94vh);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.progress-dialog[open]{display:flex;flex-direction:column}.progress-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer>div{display:flex;flex-direction:column;gap:2px;flex:1;min-width:180px}
h2{margin:3px 0;font-size:19px}h3{margin:0;font-size:13px}h3 small{font-weight:400;margin-left:6px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:8px 0;line-height:1.5}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;min-width:0}
button{cursor:pointer}button:disabled,input:disabled,select:disabled{opacity:.5;cursor:default}.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,input,select,summary):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.notice{margin:8px 12px;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}.problem{border-color:#e38269;color:#f0b3a3}.progress-inspector .notice{margin-inline:0}
.progress-content{display:grid;grid-template-columns:minmax(0,1fr) 340px;flex:1;min-height:0;overflow:hidden}.progress-main,.progress-inspector{overflow:auto;padding:14px;min-width:0}.progress-inspector{border-left:1px solid var(--border,#41464d)}
section{margin-bottom:18px}.title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.row{display:flex;flex-wrap:wrap;align-items:end;gap:10px}.row label{display:flex;flex-direction:column;gap:4px}.row input{width:96px}
.cells{display:flex;flex-wrap:wrap;gap:2px;margin:6px 0 10px}.cells span{width:10px;height:10px;border:1px solid var(--border,#41464d);border-radius:2px}.cells.bytes span{width:16px}
.cells .used{background:var(--accent,#5bbda5);border-color:var(--accent,#5bbda5)}.cells .clash{background:#e38269;border-color:#e38269}
table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:400;color:var(--muted,#a7b2b9);padding:2px 4px}td{padding:2px 4px;min-width:0}td input,td select{width:100%}td:last-child,th:last-child{width:1%;white-space:nowrap}
.check{display:flex;align-items:flex-start;gap:6px;margin:6px 0;line-height:1.4}.field{display:grid;grid-template-columns:minmax(0,1fr) 150px;align-items:center;gap:8px;margin:6px 0}.field input,.field select{width:100%}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:0 0 10px}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.metrics div{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}dt{color:var(--muted,#a7b2b9)}dd{margin:3px 0 0;font-variant-numeric:tabular-nums}
.history{list-style:none;margin:6px 0;padding:0}.history li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0}
details{margin-top:10px}summary{cursor:pointer;padding:4px 0}pre{margin:8px 0 0;padding:10px;max-height:240px;overflow:auto;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:820px){.progress-content{grid-template-columns:minmax(0,1fr) 280px}}@media(max-width:620px){.progress-content{display:block;overflow:auto}.progress-main,.progress-inspector{overflow:visible}.progress-inspector{border-left:0;border-top:1px solid var(--border,#41464d)}table,thead,tbody,tr,td{display:block}thead{display:none}tr{padding:6px 0;border-bottom:1px solid var(--border,#41464d)}td[data-label]::before{content:attr(data-label);display:block;color:var(--muted,#a7b2b9);margin-bottom:2px}td:last-child{width:auto}}
.history-buttons{display:inline-flex;gap:4px}
</style>
