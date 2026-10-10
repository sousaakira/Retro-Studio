<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {CAMERA_FIELDS,CAMERA_VIEW,createCameraConfiguration,validateCameraConfiguration,compileCameraHeader,cameraRegionRows} from '../../../shared/retro/cameraConfiguration.js'
import {createCameraController,CAMERA_FLAGS} from '../../../shared/retro/cameraController.js'
import {worldNumericId} from '../../../shared/retro/worldConfiguration.js'
import {cameraDrafts} from '../../utils/retro/cameraDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),stage=ref(null),config=ref(null),baseline=ref(''),revision=ref(''),rooms=ref([])
const loading=ref(false),saving=ref(false),error=ref(''),worldError=ref(''),headerConflict=ref(false),revisionConflict=ref(false),saved=ref(false)
const region=ref('ntsc'),roomId=ref(''),selected=ref(''),showData=ref(false)
const target=ref({x:100,y:160}),direction=ref(1),auto=ref(true),playing=ref(false),reducedMotion=ref(false),scriptX=ref(0)
const frameState=ref(null),previewError=ref(''),ticks=ref(0)
let request=0,activeProject='',disposed=false,closing=false,controller=null,frame=0,walk=1,motion=null
const clone=value=>JSON.parse(JSON.stringify(value))
// Preview room when the project has no world graph yet: profiles are still tunable.
const lab={id:'',name:'Sala de exemplo',width:640,height:448,entries:[]}
const names={maxSpeedX:'Velocidade máx. X',maxSpeedY:'Velocidade máx. Y',lookAheadSpeed:'Velocidade do olhar à frente',scriptReturnSpeed:'Retorno após cena',
 deadZoneWidth:'Zona de tolerância · largura',deadZoneHeight:'Zona de tolerância · altura',focusX:'Enquadramento X',focusY:'Enquadramento Y',
 lookAheadX:'Olhar à frente',smoothingX:'Suavização X',smoothingY:'Suavização Y'}
const groups=[{title:'Acompanhamento',keys:['maxSpeedX','maxSpeedY','smoothingX','smoothingY']},
 {title:'Zona de tolerância e enquadramento',keys:['deadZoneWidth','deadZoneHeight','focusX','focusY']},
 {title:'Olhar à frente e cenas',keys:['lookAheadX','lookAheadSpeed','scriptReturnSpeed']}]
const ranges=Object.fromEntries(CAMERA_FIELDS.map(([key,min,max,scale])=>[key,{min,max,step:scale===256?1/256:1,unit:scale===256?'px/tick':key.startsWith('smoothing')?'divisor 2ⁿ':'px'}]))
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
const profile=computed(()=>config.value?.profiles[region.value])
const room=computed(()=>rooms.value.find(r=>r.id===roomId.value)||lab)
const sizes=computed(()=>rooms.value.length?Object.fromEntries(rooms.value.map(r=>[r.id,{width:r.width,height:r.height}])):undefined)
const cameraRoom=computed(()=>config.value?.rooms.find(r=>r.id===roomId.value))
const regions=computed(()=>cameraRoom.value?.regions||[])
const current=computed(()=>regions.value.find(item=>item.id===selected.value))
// Camera rooms whose world room was removed or renamed: fixable here, never silently dropped.
const orphans=computed(()=>(config.value?.rooms||[]).filter(r=>!rooms.value.some(known=>known.id===r.id)))
function removeOrphans(){if(blocked.value||!config.value)return;const gone=new Set(orphans.value.map(r=>r.id));config.value.rooms=config.value.rooms.filter(r=>!gone.has(r.id))}
const validation=computed(()=>{try{if(config.value)validateCameraConfiguration(config.value,sizes.value?{rooms:sizes.value}:{rooms:{}});return ''}catch(e){return e.message}})
const blocked=computed(()=>loading.value||saving.value)
const exported=computed(()=>{try{return config.value&&!validation.value?compileCameraHeader(config.value,{rooms:sizes.value||{}}):''}catch{return ''}})
const view=computed(()=>({width:Math.min(CAMERA_VIEW.width,320),height:CAMERA_VIEW.height}))
const deadZone=computed(()=>{
 const p=profile.value,f=frameState.value;if(!p||!f)return null
 return {x:f.x+view.value.width/2+p.focusX-p.deadZoneWidth/2,y:f.y+view.value.height/2+p.focusY-p.deadZoneHeight/2,width:p.deadZoneWidth,height:p.deadZoneHeight}
})
const flagLabels=computed(()=>{
 const f=frameState.value?.flags||0
 return [f&CAMERA_FLAGS.transition&&'transição',f&CAMERA_FLAGS.locked&&'arena travada',f&CAMERA_FLAGS.script&&'cena no controle'].filter(Boolean).join(' · ')||'seguindo o alvo'
})
const activeRegion=computed(()=>regions.value.find(item=>worldNumericId(item.id)===frameState.value?.region))
function cache(){if(activeProject&&config.value){if(dirty.value||saving.value)cameraDrafts.set(activeProject,{config:clone(config.value),baseline:baseline.value,revision:revision.value,roomId:roomId.value},draftOwner);else cameraDrafts.deleteIfOwner(activeProject,draftOwner)}}
// #52: undo/redo of this document, and a draft written while editing (not only on close).
// The same editor can be open twice (dialog and bottom dock): each instance only clears its own draft.
const draftOwner=Symbol('CameraEditor')
const recoveredAt=ref(''),history=useDocumentUndo(config,{blocked:()=>blocked.value})
const draftSaver=draftTimer(()=>{if(!disposed&&config.value&&!loading.value)cache()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
function stop(){playing.value=false;if(frame){cancelAnimationFrame(frame);frame=0}}
async function load(discard=false){
 if(saving.value)return
 stop()
 if(!discard)cache();else cameraDrafts.delete(props.projectPath)
 const projectPath=props.projectPath,id=++request
 activeProject=projectPath;loading.value=true;error.value='';config.value=null;saved.value=false;revisionConflict.value=false;frameState.value=null
 try{
  const result=await window.retroStudio?.retro?.cameraConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error(result?.error||'Configuração da câmera indisponível.')
  // #52: a draft left by an interrupted session comes back as unsaved changes.
  if(cameraDrafts.needsHydration(projectPath)){await cameraDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  const draft=cameraDrafts.get(projectPath)
  if(draft)cameraDrafts.claim(projectPath,draftOwner)
  recoveredAt.value=draft?cameraDrafts.recoveredAt(projectPath):''
  config.value=clone(draft?.config||result.config);baseline.value=draft?.baseline||JSON.stringify(result.config)
  revision.value=draft?.revision||result.revision;revisionConflict.value=!!draft&&draft.revision!==result.revision
  headerConflict.value=!!result.headerConflict;rooms.value=result.rooms||[];worldError.value=result.worldError||''
  roomId.value=rooms.value.some(r=>r.id===draft?.roomId)?draft.roomId:rooms.value[0]?.id||''
  selected.value=regions.value[0]?.id||''
  startAtEntry()
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||headerConflict.value||revisionConflict.value||!config.value||validation.value)return
 const projectPath=props.projectPath,id=request,submitted=clone(config.value),submittedRevision=revision.value
 submitted.rooms=submitted.rooms.filter(r=>r.regions.length)
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveCameraConfiguration?.({projectPath,config:submitted,revision:submittedRevision})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar a câmera.')
  const cached=cameraDrafts.get(projectPath)
  if(cached?.revision===submittedRevision)cameraDrafts.delete(projectPath)
  if(disposed||projectPath!==props.projectPath)return
  // Late reply after leaving and returning: the saved draft must not be cached again.
  if(id!==request){config.value=null;void load();return}
  config.value=clone(result.config);baseline.value=JSON.stringify(result.config);revision.value=result.revision
  rooms.value=result.rooms||rooms.value;worldError.value=result.worldError||'';saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)saving.value=false}
}
function preset(){if(!blocked.value&&config.value)config.value.profiles[region.value]=createCameraConfiguration().profiles.ntsc}
function addRegion(){
 if(blocked.value||!config.value||!roomId.value)return
 let entry=cameraRoom.value
 if(!entry){entry={id:roomId.value,regions:[]};config.value.rooms.push(entry);entry=config.value.rooms[config.value.rooms.length-1]}
 if(entry.regions.length>=32)return
 const used=new Set(entry.regions.map(item=>worldNumericId(item.id)));let id=''
 for(let i=1;i<65535&&!id;i++)if(!used.has(worldNumericId('region_'+i)))id='region_'+i
 const r=room.value,width=Math.min(CAMERA_VIEW.width,r.width),height=Math.min(CAMERA_VIEW.height,r.height)
 const x=Math.max(0,Math.min(r.width-width,Math.round(target.value.x-width/2))),y=Math.max(0,Math.min(r.height-height,Math.round(target.value.y-height/2)))
 // New regions take the next free priority so overlaps always resolve explicitly.
 const priority=Math.min(255,entry.regions.reduce((max,item)=>Math.max(max,item.priority+1),0))
 entry.regions.push({id,name:'Região '+(entry.regions.length+1),area:{x,y,width,height},limits:{x,y,width,height},priority,lock:false,transitionSpeed:4})
 selected.value=id
}
function removeRegion(){
 const entry=cameraRoom.value;if(blocked.value||!entry||!current.value)return
 entry.regions=entry.regions.filter(item=>item.id!==selected.value)
 if(!entry.regions.length)config.value.rooms=config.value.rooms.filter(r=>r.id!==entry.id)
 selected.value=regions.value[0]?.id||''
}
// Preview: the same controller arithmetic and the exported rows the header carries.
function restart(){
 previewError.value='';controller=null;ticks.value=0
 if(!profile.value)return
 try{
  if(validation.value)throw Error('Corrija a configuração para ver a prévia.')
  controller=createCameraController(profile.value,view.value)
  const rows=cameraRoom.value?cameraRegionRows(cameraRoom.value):[]
  if(!controller.enterRoom(room.value.width,room.value.height,rows,Math.round(target.value.x*256),Math.round(target.value.y*256),direction.value))throw Error('A sala ou as regiões foram recusadas pelo controlador.')
  frameState.value={...controller.tick(Math.round(target.value.x*256),Math.round(target.value.y*256),0),look:controller.state().look/256,bounds:controller.bounds()}
  scriptX.value=frameState.value.x
 }catch(e){controller=null;frameState.value=null;previewError.value=e.message}
}
function startAtEntry(){
 const entry=room.value.entries?.[0]
 target.value={x:entry?entry.x:Math.min(100,room.value.width-1),y:entry?entry.y:Math.min(160,room.value.height-1)}
 direction.value=entry?.facing?-1:1;walk=direction.value;restart()
}
function tick(){
 if(!controller)return
 const result=controller.tick(Math.round(target.value.x*256),Math.round(target.value.y*256),direction.value)
 if(result.invalid){previewError.value='Passo recusado pelo controlador.';stop();return}
 ticks.value++;frameState.value={...result,look:controller.state().look/256,bounds:controller.bounds()}
 if(!(result.flags&CAMERA_FLAGS.script))scriptX.value=result.x
}
function moveTarget(x,y){
 const r=room.value,next={x:Math.max(0,Math.min(r.width-1,Math.round(x))),y:Math.max(0,Math.min(r.height-1,Math.round(y)))}
 if(next.x!==target.value.x)direction.value=next.x>target.value.x?1:-1
 target.value=next
}
function step(){
 if(auto.value){
  if(target.value.x>=room.value.width-9)walk=-1
  if(target.value.x<=8)walk=1
  moveTarget(target.value.x+walk*2,target.value.y)
 }
 tick()
}
function loop(){frame=requestAnimationFrame(()=>{frame=0;if(!playing.value)return;step();if(playing.value)loop()})}
function togglePlaying(){
 if(playing.value){stop();return}
 if(!controller||reducedMotion.value||blocked.value)return
 playing.value=true;loop()
}
function unlock(){if(controller?.unlock())tick()}
function scriptPan(){if(controller?.scriptSet(1,Math.round(scriptX.value),0))tick()}
function scriptRelease(){if(controller){controller.scriptRelease();tick()}}
function stagePoint(event){
 // The SVG may be letterboxed inside its box; its own matrix maps to room pixels.
 const matrix=stage.value?.getScreenCTM?.();if(!matrix)return null
 const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse())
 return {x:point.x,y:point.y}
}
function onPointer(event){
 if(event.type==='pointermove'&&!(event.buttons&1))return
 const point=stagePoint(event);if(!point||!controller)return
 moveTarget(point.x,point.y);tick()
}
function onStageKey(event){
 const moves={ArrowLeft:[-4,0],ArrowRight:[4,0],ArrowUp:[0,-4],ArrowDown:[0,4]},move=moves[event.key]
 if(!move||!controller)return
 event.preventDefault();moveTarget(target.value.x+move[0],target.value.y+move[1]);tick()
}
function close(discard=false){
 if(saving.value)return
 if(dirty.value&&!discard){error.value='Salve a câmera ou use “Descartar e fechar”.';return}
 closing=true;stop();if(config.value||discard)cameraDrafts.delete(activeProject);emit('close')
}
function keydown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save()}}
function canClose(){return !dirty.value&&!saving.value}
function onHidden(){if(typeof document!=='undefined'&&document.hidden)stop()}
function onMotion(){reducedMotion.value=!!motion?.matches;if(reducedMotion.value)stop()}
defineExpose({canClose})
watch(()=>props.projectPath,()=>{cache();saving.value=false;void load()},{immediate:true})
watch([()=>JSON.stringify(profile.value),()=>JSON.stringify(regions.value),region],()=>{if(config.value&&!loading.value)restart()})
watch(roomId,()=>{if(config.value&&!loading.value){selected.value=regions.value[0]?.id||'';startAtEntry()}})
onMounted(()=>{
 dialogElement.value?.showModal()
 motion=window.matchMedia?.('(prefers-reduced-motion: reduce)')||null
 motion?.addEventListener?.('change',onMotion);onMotion()
 window.addEventListener?.('blur',stop);document.addEventListener?.('visibilitychange',onHidden)
})
onBeforeUnmount(()=>{
 if(!closing)cache()
 disposed=true;request++;stop()
 motion?.removeEventListener?.('change',onMotion);window.removeEventListener?.('blur',stop);document.removeEventListener?.('visibilitychange',onHidden)
 dialogElement.value?.close()
})
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="camera-dialog" aria-labelledby="camera-title" @cancel.prevent="close()" @keydown.stop="history.onKeydown($event) || keydown($event)">
   <header><div><small>MEGA DRIVE · MUNDO</small><h2 id="camera-title">Câmera</h2></div><button type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <p v-if="loading" role="status" class="notice">Carregando câmera e salas…</p>
   <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
   <div v-if="config && !loading" class="camera-content">
    <main class="camera-main">
     <div class="camera-tools">
      <label>Sala <select v-model="roomId" :disabled="blocked || !rooms.length"><option v-if="!rooms.length" value="">Sala de exemplo (sem grafo de salas)</option><option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }} · {{ r.width }} × {{ r.height }}</option></select></label>
      <button type="button" :aria-pressed="playing" :disabled="blocked || !frameState || (reducedMotion && !playing)" @click="togglePlaying">{{ playing ? 'Pausar' : 'Reproduzir' }}</button>
      <button type="button" :disabled="blocked || !frameState || playing" @click="step">Avançar tick</button>
      <button type="button" :disabled="blocked" @click="startAtEntry">Reiniciar na entrada</button>
      <label class="check"><input v-model="auto" type="checkbox" :disabled="blocked" />Percorrer a sala</label>
     </div>
     <p v-if="previewError" role="alert" class="notice problem">{{ previewError }}</p>
     <p v-if="reducedMotion" class="notice">Movimento reduzido ativo. Use “Avançar tick”, as setas ou arraste o alvo.</p>
     <div class="camera-stage" tabindex="0" role="group" aria-label="Prévia da câmera. Setas movem o alvo em 4 pixels; cada movimento avança um tick." @keydown="onStageKey">
      <svg ref="stage" :viewBox="`0 0 ${room.width} ${room.height}`" role="img" aria-label="Sala, regiões, limites, quadro da câmera, zona de tolerância e alvo" @pointerdown="onPointer" @pointermove="onPointer">
       <defs><pattern id="camera-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" class="grid-line" /></pattern></defs>
       <rect :width="room.width" :height="room.height" fill="url(#camera-grid)" class="room" />
       <g v-for="item in regions" :key="item.id" :class="{current:item.id===selected,active:activeRegion===item}">
        <rect :x="item.area.x" :y="item.area.y" :width="item.area.width" :height="item.area.height" class="region-area" />
        <rect :x="item.limits.x" :y="item.limits.y" :width="item.limits.width" :height="item.limits.height" class="region-limits" />
        <text :x="item.area.x+6" :y="item.area.y+18" class="region-label">{{ item.lock ? '🔒 ' : '' }}{{ item.name }} · P{{ item.priority }}</text>
       </g>
       <template v-if="frameState">
        <rect :x="frameState.x" :y="frameState.y" :width="view.width" :height="view.height" class="view" />
        <rect v-if="deadZone" :x="deadZone.x" :y="deadZone.y" :width="Math.max(deadZone.width,1)" :height="Math.max(deadZone.height,1)" class="dead-zone" />
        <path :d="`M${target.x+frameState.look-5} ${target.y}h10M${target.x+frameState.look} ${target.y-5}v10`" class="focus" />
       </template>
       <circle :cx="target.x" :cy="target.y" r="5" class="target" />
      </svg>
     </div>
     <dl class="camera-metrics">
      <div><dt>Câmera</dt><dd>{{ frameState ? frameState.x+', '+frameState.y : '—' }}</dd></div>
      <div><dt>Alvo</dt><dd>{{ target.x }}, {{ target.y }} · {{ direction<0?'esquerda':'direita' }}</dd></div>
      <div><dt>Região ativa</dt><dd>{{ activeRegion ? activeRegion.name : 'sala inteira' }}</dd></div>
      <div><dt>Estado</dt><dd>{{ flagLabels }}</dd></div>
      <div><dt>Tick</dt><dd>{{ ticks }} · {{ region==='pal'?'50':'60' }} Hz</dd></div>
     </dl>
     <div class="camera-tools">
      <button type="button" :disabled="blocked || !(frameState?.flags & 4)" @click="unlock">Destravar arena</button>
      <label>Cena: câmera em X <input v-model.number="scriptX" type="number" min="0" :max="room.width" :disabled="blocked || !frameState" /></label>
      <button type="button" :disabled="blocked || !frameState" @click="scriptPan">Assumir pela cena</button>
      <button type="button" :disabled="blocked || !(frameState?.flags & 8)" @click="scriptRelease">Devolver ao jogador</button>
     </div>
     <p class="help">Arraste o alvo ou use as setas. O quadro branco é a tela ({{ view.width }} × {{ view.height }}); o retângulo tracejado é a zona de tolerância; a cruz é o ponto de foco com o olhar à frente. A prévia usa os mesmos inteiros Q8 e ticks de vídeo do controlador C, sobre as regiões na ordem exportada.</p>
     <details :open="showData" @toggle="showData=$event.target.open"><summary>Dados exportados (camera_config.h)</summary><pre v-if="exported">{{ exported }}</pre><p v-else>Corrija a configuração para ver o header.</p></details>
    </main>
    <aside class="camera-inspector" aria-label="Parâmetros da câmera">
     <div class="pair"><label>Perfil <select v-model="region" :disabled="blocked"><option value="ntsc">NTSC · 60 Hz</option><option value="pal">PAL · 50 Hz</option></select></label><button type="button" :disabled="blocked" @click="preset">Restaurar preset</button></div>
     <p class="help">Valores por tick de vídeo. PAL e NTSC são independentes; nada é escalado automaticamente.</p>
     <fieldset v-for="group in groups" :key="group.title" :disabled="blocked"><legend>{{ group.title }}</legend>
      <label v-for="key in group.keys" :key="key" class="field"><span>{{ names[key] }} <small>{{ ranges[key].unit }}</small></span><input v-model.number="profile[key]" type="number" :min="ranges[key].min" :max="ranges[key].max" :step="ranges[key].step" /></label>
      <template v-if="group.title==='Acompanhamento'"><label class="check"><input v-model="profile.followX" type="checkbox" />Acompanhar em X</label><label class="check"><input v-model="profile.followY" type="checkbox" />Acompanhar em Y</label></template>
     </fieldset>
     <h3>Regiões de {{ room.name }}</h3>
     <p v-if="!rooms.length" class="help">Regiões pertencem às salas do mundo. Cadastre as salas em “Salas e conexões” para criar regiões e arenas.</p>
     <template v-else>
      <div class="pair"><select v-model="selected" :disabled="blocked || !regions.length" aria-label="Região selecionada"><option v-if="!regions.length" value="">Nenhuma região</option><option v-for="item in regions" :key="item.id" :value="item.id">{{ item.name }} · P{{ item.priority }}</option></select><button type="button" :disabled="blocked || regions.length>=32" @click="addRegion">＋ Região</button></div>
      <fieldset v-if="current" :disabled="blocked"><legend>{{ current.id }}</legend>
       <label class="field"><span>Nome</span><input v-model="current.name" maxlength="128" /></label>
       <label class="field"><span>Prioridade <small>maior vence</small></span><input v-model.number="current.priority" type="number" min="0" max="255" step="1" /></label>
       <label class="field"><span>Transição <small>px/tick · 0 corta</small></span><input v-model.number="current.transitionSpeed" type="number" min="0" max="32" :step="1/256" /></label>
       <label class="check"><input v-model="current.lock" type="checkbox" />Arena travada até o jogo liberar</label>
       <small>Área de ativação (alvo)</small><div class="quad"><label v-for="(label,key) in {x:'X',y:'Y',width:'Largura',height:'Altura'}" :key="'a'+key">{{ label }} <input v-model.number="current.area[key]" type="number" :min="key==='width'||key==='height'?1:0" max="32767" /></label></div>
       <small>Limites da câmera</small><div class="quad"><label v-for="(label,key) in {x:'X',y:'Y',width:'Largura',height:'Altura'}" :key="'l'+key">{{ label }} <input v-model.number="current.limits[key]" type="number" :min="key==='width'||key==='height'?1:0" max="32767" /></label></div>
       <button type="button" @click="removeRegion">Remover {{ current.name }}</button>
      </fieldset>
     </template>
     <p v-if="orphans.length" role="alert" class="notice problem">Há regiões de salas que não existem mais no mundo: {{ orphans.map(r=>r.id).join(', ') }}. <button type="button" :disabled="blocked" @click="removeOrphans">Remover regiões órfãs</button></p>
     <p v-if="validation" role="alert" class="notice problem">{{ validation }}</p>
     <p v-if="worldError && !validation" role="alert" class="notice problem">{{ worldError }}</p>
     <p v-if="headerConflict || revisionConflict" role="alert" class="notice problem">{{ headerConflict ? 'O header foi personalizado e será preservado.' : 'A câmera mudou no disco. Seu rascunho está preservado.' }}</p>
    </aside>
   </div>
   <footer><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="blocked || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="blocked || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><div><small role="status">{{ saving ? 'Exportando…' : dirty ? (recoveredAt ? 'Alterações não salvas, recuperadas de ' + recoveredAt + '.' : 'Alterações não salvas.') : saved ? 'Câmera salva e header C exportado.' : 'camera/camera.json · src/generated/camera_config.h' }}</small><small>O game precisa instalar o módulo camera e chamar o controlador a cada tick.</small></div><button v-if="dirty || revisionConflict" type="button" :disabled="saving" @click="load(true)">Descartar e recarregar</button><button v-if="dirty" type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button><button type="button" class="primary" :disabled="blocked || headerConflict || revisionConflict || !config || !!validation" @click="save">Salvar e exportar câmera</button></footer>
  </dialog>
 </Teleport>
</template>
<style scoped>
.camera-dialog{box-sizing:border-box;width:min(1240px,96vw);height:min(860px,94vh);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.camera-dialog[open]{display:flex;flex-direction:column}.camera-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d)}footer>div{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
h2{margin:3px 0;font-size:19px}h3{margin:14px 0 6px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:8px 0;line-height:1.5}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;min-width:0}
button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true],.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,input,select,summary,.camera-stage):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.notice{margin:8px 12px;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}.problem{border-color:#e38269;color:#f0b3a3}.camera-main .notice,.camera-inspector .notice{margin-inline:0}
.camera-content{display:grid;grid-template-columns:minmax(0,1fr) 340px;flex:1;min-height:0;overflow:hidden}.camera-main,.camera-inspector{overflow:auto;padding:14px;min-width:0}.camera-inspector{border-left:1px solid var(--border,#41464d)}
.camera-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}.camera-tools label{display:flex;align-items:center;gap:6px}.camera-tools select{max-width:260px}.camera-tools input[type=number]{width:84px}
.check{display:flex;align-items:center;gap:6px;margin:6px 0}
.camera-stage{background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;touch-action:none}svg{display:block;width:100%;max-height:52vh;cursor:crosshair}
.grid-line{fill:none;stroke:#ffffff14;stroke-width:1}.room{stroke:var(--border,#41464d);stroke-width:2}
.region-area{fill:#5bbda51a;stroke:#5bbda5;stroke-width:1.5;stroke-dasharray:6 4}.region-limits{fill:none;stroke:#d9b45b;stroke-width:1.5}.region-label{fill:var(--text,#ddd);font-size:13px}
.current .region-area{fill:#5bbda533;stroke-width:3}.current .region-limits{stroke-width:3}.active .region-label{fill:var(--accent,#5bbda5);font-weight:600}
.view{fill:#ffffff10;stroke:#fff;stroke-width:2}.dead-zone{fill:none;stroke:#fff;stroke-width:1.5;stroke-dasharray:4 4}.focus{stroke:#f2d16b;stroke-width:2}.target{fill:#f2d16b;stroke:#171c21;stroke-width:2}
.camera-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0}.camera-metrics div{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}dt{color:var(--muted,#a7b2b9)}dd{margin:3px 0 0;font-variant-numeric:tabular-nums}
details{margin-top:10px}summary{cursor:pointer;padding:4px 0}pre{margin:8px 0 0;padding:10px;max-height:220px;overflow:auto;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:10px 0}.field{display:grid;grid-template-columns:minmax(0,1fr) 96px;align-items:center;gap:8px;margin:6px 0}.field input{width:100%}
.pair{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}.pair label{display:flex;flex-direction:column;gap:4px}.quad{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:4px 0 8px}.quad label{display:flex;flex-direction:column;gap:3px}.quad input{width:100%}
@media(max-width:820px){.camera-content{grid-template-columns:minmax(0,1fr) 280px}}@media(max-width:620px){.camera-content{display:block;overflow:auto}.camera-main,.camera-inspector{overflow:visible}.camera-inspector{border-left:0;border-top:1px solid var(--border,#41464d)}}
.history-buttons{display:inline-flex;gap:4px}
</style>
