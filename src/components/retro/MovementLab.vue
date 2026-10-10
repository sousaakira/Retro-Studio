<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {MOVEMENT_FIELDS,createMovementConfiguration,validateMovementConfiguration} from '../../../shared/retro/movementConfiguration.js'
import room from '../../../shared/retro/movementRoom.json'
import {createMovementLab} from '../../utils/retro/movementLab.js'
import {movementDrafts} from '../../utils/retro/movementDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true}})
const emit=defineEmits(['close'])
const dialogElement=ref(null),viewport=ref(null),config=ref(null),baseline=ref(''),revision=ref('')
const loading=ref(false),saving=ref(false),error=ref(''),labError=ref(''),saved=ref(false),headerConflict=ref(false),revisionConflict=ref(false)
const diagnosticBusy=ref(false),diagnostic=ref(null),diagnosticMessage=ref('')
const region=ref('ntsc'),playing=ref(false),reducedMotion=ref(false),axis=ref(0),holdJump=ref(false),drop=ref(false)
const snapshot=ref(null),trail=ref([])
const profile=computed(()=>config.value?.profiles[region.value])
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
const validation=computed(()=>{try{if(config.value)validateMovementConfiguration(config.value);return ''}catch(e){return e.message}})
const blocked=computed(()=>loading.value||saving.value||diagnosticBusy.value||!!validation.value||!config.value)
const groups=[
 {title:'Deslocamento',keys:['walkSpeed','acceleration','deceleration','airAcceleration']},
 {title:'Pulo e queda',keys:['gravity','jumpSpeed','maxFallSpeed','jumpCutSpeed']},
 {title:'Dash',keys:['dashSpeed','dashTicks','dashCooldownTicks']},
 {title:'Parede',keys:['wallSlideSpeed','wallJumpX','wallJumpY','wallLockTicks']},
 {title:'Tolerâncias',keys:['coyoteTicks','jumpBufferTicks','slopeSnap']}
]
const names={walkSpeed:'Velocidade',acceleration:'Aceleração',deceleration:'Desaceleração',airAcceleration:'Aceleração no ar',gravity:'Gravidade',jumpSpeed:'Força inicial',maxFallSpeed:'Queda máxima',jumpCutSpeed:'Subida ao soltar',dashSpeed:'Velocidade de dash',dashTicks:'Duração',dashCooldownTicks:'Espera após dash',wallSlideSpeed:'Escorregada',wallJumpX:'Pulo horizontal',wallJumpY:'Pulo vertical',wallLockTicks:'Manter impulso',coyoteTicks:'Pulo após sair do chão',jumpBufferTicks:'Memória de pulo',slopeSnap:'Apoio na rampa'}
const ranges=Object.fromEntries(MOVEMENT_FIELDS.map(([key,min,max],i)=>[key,{min,max,step:i<12?1/256:1}]))
const unit=key=>['acceleration','deceleration','airAcceleration','gravity'].includes(key)?'px/tick²':MOVEMENT_FIELDS.findIndex(([name])=>name===key)<12?'px/tick':key==='slopeSnap'?'px':'ticks'
const points=computed(()=>trail.value.map(p=>p.x+','+p.y).join(' '))
const body=computed(()=>snapshot.value?{x:snapshot.value.x+room.body.x,y:snapshot.value.y+room.body.y}:null)
const stateLabel=computed(()=>!snapshot.value?'—':!snapshot.value.ticks?'Pronto':snapshot.value.sliding?'Escorregando':snapshot.value.dashRemaining?'Dash':snapshot.value.grounded?'No chão':snapshot.value.velocityY<0?'Subindo':'Caindo')
const clone=value=>JSON.parse(JSON.stringify(value))
const number=value=>Number(value??0).toFixed(3).replace(/\.?0+$/,'')||'0'
let activeProject='',request=0,lab=null,disposed=false,closing=false,media=null,frame=0,epoch=0,previousJump=false,previousDash=false,jumpPending=false,dashPending=false
const keys=new Map()
const held=action=>[...keys.values()].includes(action)
function stash(){
 if(!activeProject||!config.value)return
 if(dirty.value||saving.value)movementDrafts.set(activeProject,{config:clone(config.value),baseline:baseline.value,revision:revision.value},draftOwner)
 else movementDrafts.deleteIfOwner(activeProject,draftOwner)
}
// #52: undo/redo of this document, and a draft written while editing (not only on close).
// The same editor can be open twice (dialog and bottom dock): each instance only clears its own draft.
const draftOwner=Symbol('MovementLab')
const recoveredAt=ref(''),history=useDocumentUndo(config,{blocked:()=>loading.value||saving.value})
const draftSaver=draftTimer(()=>{if(!disposed&&config.value&&!loading.value)stash()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
function stop(){playing.value=false;epoch++;if(frame)cancelAnimationFrame(frame);frame=0;keys.clear();previousJump=false;previousDash=false;jumpPending=false;dashPending=false}
function resetLab(){
 stop();labError.value='';trail.value=[];snapshot.value=null
 if(!lab||!profile.value||validation.value)return
 try{snapshot.value=lab.reset(clone(profile.value));trail.value=[{x:snapshot.value.x,y:snapshot.value.y}]}
 catch(e){labError.value=e.message}
}
function step(){
 if(!lab||blocked.value||labError.value)return false
 const jump=holdJump.value||held('jump')||jumpPending,dash=held('dash')||dashPending
 const direction=held('left')&&held('right')?0:held('left')?-1:held('right')?1:axis.value
 const buttons=(jump?1:0)|((jump&&!previousJump)||jumpPending?2:0)|((dash&&!previousDash)||dashPending?4:0)|((drop.value||held('drop'))?8:0)
 previousJump=jump;previousDash=dash;jumpPending=false;dashPending=false
 try{
  snapshot.value=lab.step(direction,buttons)
  trail.value=[...trail.value.slice(-511),{x:snapshot.value.x,y:snapshot.value.y}];return true
 }catch(e){labError.value=e.message;stop();return false}
}
function pulse(kind){if(kind==='jump')jumpPending=true;else dashPending=true;if(!playing.value)step()}
function traceJump(){
 resetLab();if(!lab||blocked.value||!snapshot.value)return
 try{
  const points=[{x:snapshot.value.x,y:snapshot.value.y}]
  for(let i=0;i<240;i++){
   snapshot.value=lab.step(axis.value,1|(i===0?2:0));points.push({x:snapshot.value.x,y:snapshot.value.y})
   if(snapshot.value.grounded&&i>0)break
  }
  trail.value=points
 }catch(e){labError.value=e.message}
}
function togglePlaying(){
 if(playing.value){stop();return}
 if(blocked.value||!lab||labError.value||reducedMotion.value)return
 playing.value=true;const id=++epoch;let last=null,accumulator=0
 const tick=time=>{
  if(disposed||!playing.value||id!==epoch)return
  const duration=1000/(region.value==='pal'?50:60)
  if(last!==null)accumulator=Math.min(duration*4,accumulator+Math.max(0,time-last))
  last=time
  while(accumulator>=duration){if(!step())return;accumulator-=duration}
  frame=requestAnimationFrame(tick)
 }
 frame=requestAnimationFrame(tick);viewport.value?.focus()
}
function onViewportKey(event,down){
 if(event.ctrlKey||event.metaKey||event.altKey)return
 const key={ArrowLeft:'left',ArrowRight:'right',ArrowDown:'drop',Space:'jump',KeyZ:'jump',KeyB:'jump',KeyX:'dash',KeyC:'dash'}[event.code]
 if(!key)return
 event.preventDefault();if(down)keys.set(event.code,key);else keys.delete(event.code)
}
function onViewportBlur(event){
 keys.clear();previousJump=false;previousDash=false
 if(!dialogElement.value?.contains(event.relatedTarget))stop()
}
function onDialogKeydown(event){
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save()}
}
function close(discard=false){
 if(saving.value||diagnosticBusy.value)return
 if(dirty.value&&!discard){error.value='Salve os ajustes ou use “Descartar e fechar”.';return}
 closing=true;movementDrafts.delete(activeProject);stop();emit('close')
}
function preset(){if(loading.value||saving.value||!config.value)return;config.value.profiles[region.value]=createMovementConfiguration().profiles[region.value];saved.value=false}
async function load(discard=false){
 if(discard)movementDrafts.delete(props.projectPath)
 else stash()
 stop();const id=++request,projectPath=props.projectPath;activeProject=projectPath
 diagnostic.value=null;diagnosticMessage.value=''
 config.value=null;baseline.value='';revision.value='';loading.value=true;saved.value=false;error.value='';headerConflict.value=false;revisionConflict.value=false
 try{
  const result=await window.retroStudio.retro.movementConfiguration({projectPath})
  if(disposed||id!==request)return
  validateMovementConfiguration(result.config)
  // #52: a draft left by an interrupted session comes back as unsaved changes.
  if(movementDrafts.needsHydration(projectPath)){await movementDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  const draft=movementDrafts.get(projectPath)
  if(draft)movementDrafts.claim(projectPath,draftOwner)
  recoveredAt.value=draft?movementDrafts.recoveredAt(projectPath):''
  const cached=draft&&JSON.stringify(draft.config)!==draft.baseline?draft:null
  config.value=clone(cached?.config||result.config);baseline.value=cached?.baseline||JSON.stringify(result.config)
  revision.value=cached?.revision||result.revision;headerConflict.value=!!result.headerConflict
  revisionConflict.value=!!cached&&cached.revision!==result.revision
 }catch(e){if(id===request&&!disposed)error.value=e.message}
 finally{if(id===request&&!disposed){loading.value=false;resetLab()}}
}
async function save(){
 if(blocked.value||headerConflict.value||revisionConflict.value)return
 stop();const projectPath=activeProject,id=request,submitted=clone(config.value),submittedText=JSON.stringify(submitted)
 saving.value=true;error.value='';saved.value=false
 try{
  const result=await window.retroStudio.retro.saveMovementConfiguration({projectPath,config:submitted,revision:revision.value})
  if(!result?.success)throw Error('Não foi possível salvar os ajustes.')
  validateMovementConfiguration(result.config)
  const text=JSON.stringify(result.config)
  if(disposed||id!==request){
   const cached=movementDrafts.get(projectPath)
   if(cached&&JSON.stringify(cached.config)===submittedText)movementDrafts.set(projectPath,{config:clone(result.config),baseline:text,revision:result.revision})
   return
  }
  if(JSON.stringify(config.value)===submittedText)config.value=clone(result.config)
  revision.value=result.revision;baseline.value=text;headerConflict.value=!!result.headerConflict;saved.value=true
  stash()
 }catch(e){if(id===request&&!disposed)error.value=e.message}
 finally{saving.value=false}
}
async function buildDiagnostic(){
 if(blocked.value||dirty.value||headerConflict.value||revisionConflict.value)return
 stop();const id=request,projectPath=activeProject,submittedRevision=revision.value
 diagnosticBusy.value=true;diagnostic.value=null;diagnosticMessage.value='';error.value=''
 try{
  const result=await window.retroStudio.retro.buildMovementDiagnostic({projectPath,revision:submittedRevision})
  if(disposed||id!==request)return
  if(!result?.success||result.revision!==submittedRevision||typeof result.token!=='string')throw Error('Não foi possível gerar a sala SGDK.')
  diagnostic.value=result;diagnosticMessage.value='ROM da sala gerada com os ajustes salvos. Abra no emulador para comparar.'
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{diagnosticBusy.value=false}
}
async function openDiagnostic(){
 if(blocked.value||dirty.value||!diagnostic.value)return
 stop();const id=request,projectPath=activeProject;diagnosticBusy.value=true;error.value=''
 try{
  const result=await window.retroStudio.retro.openMovementDiagnostic({projectPath,revision:revision.value,token:diagnostic.value.token})
  if(disposed||id!==request)return
  if(!result?.success)throw Error(result?.message||'Não foi possível abrir o emulador.')
  diagnosticMessage.value=result.message||'Sala aberta no emulador configurado.'
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{diagnosticBusy.value=false}
}
function onBlur(){stop()}
function onVisibility(){if(document.hidden)stop()}
function onPreference(){reducedMotion.value=!!media?.matches;if(reducedMotion.value)stop()}
watch(()=>props.projectPath,()=>void load(),{immediate:true,flush:'sync'})
watch(()=>JSON.stringify(profile.value),()=>{saved.value=false;resetLab()},{flush:'sync'})
onMounted(async()=>{
 dialogElement.value?.showModal();media=window.matchMedia?.('(prefers-reduced-motion: reduce)');onPreference()
 media?.addEventListener?.('change',onPreference);window.addEventListener?.('blur',onBlur);document.addEventListener?.('visibilitychange',onVisibility)
 try{const instance=await createMovementLab();if(disposed)return;lab=instance;resetLab()}
 catch(e){if(!disposed)labError.value=e.message}
})
onBeforeUnmount(()=>{
 if(!closing)stash();disposed=true;request++;stop();dialogElement.value?.close()
 media?.removeEventListener?.('change',onPreference);window.removeEventListener?.('blur',onBlur);document.removeEventListener?.('visibilitychange',onVisibility)
})
defineExpose({hasUnsavedChanges:dirty,save,canClose:()=>!saving.value&&!diagnosticBusy.value&&!dirty.value})
</script>

<template>
 <Teleport to="body">
  <dialog ref="dialogElement" class="movement-dialog" aria-labelledby="movement-title" @cancel.prevent="close()" @keydown.stop="history.onKeydown($event) || onDialogKeydown($event)">
   <section class="movement-window" :aria-busy="loading || saving || diagnosticBusy">
    <header class="lab-header"><div><small>RETRO STUDIO · PERSONAGENS</small><h2 id="movement-title">Física e sala de testes</h2></div><button type="button" :disabled="saving || diagnosticBusy" @click="close(dirty)">{{ dirty ? 'Descartar e fechar' : 'Fechar' }}</button></header>
    <p v-if="loading" role="status" class="lab-message">Carregando ajustes do projeto…</p>
    <p v-if="error" role="alert" class="lab-error">{{ error }}</p>
    <div v-if="config" class="lab-workspace">
     <main class="lab-main">
      <div class="lab-tools">
       <button type="button" :disabled="blocked || !snapshot || !!labError || (reducedMotion && !playing)" @click="togglePlaying" :aria-pressed="playing"><svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor"><path v-if="playing" d="M5 4h3v12H5zM12 4h3v12h-3z"/><path v-else d="m5 3 12 7-12 7z"/></svg>{{ playing ? 'Pausar' : 'Reproduzir' }}</button>
       <button type="button" :disabled="blocked || !snapshot || playing || !!labError" @click="step">Avançar quadro</button>
       <button type="button" :disabled="blocked || !snapshot" @click="traceJump">Traçar pulo</button>
       <button type="button" :disabled="blocked" @click="resetLab">Reiniciar</button>
       <button type="button" :disabled="blocked || dirty || headerConflict || revisionConflict" @click="buildDiagnostic">{{ diagnosticBusy ? 'Preparando sala…' : 'Gerar ROM da sala' }}</button>
       <button v-if="diagnostic" type="button" :disabled="blocked || dirty || diagnostic.revision !== revision" @click="openDiagnostic">Abrir no emulador</button>
       <span class="controller-label">Controlador C compartilhado · {{ region === 'pal' ? '50' : '60' }} Hz</span>
      </div>
      <p v-if="diagnosticMessage" role="status" class="lab-message">{{ diagnosticMessage }}</p>
      <p v-if="labError" role="alert" class="lab-error">{{ labError }}</p>
      <p v-if="reducedMotion" class="lab-message">Movimento reduzido ativo. Use avanço por quadro ou trace o pulo.</p>
      <div ref="viewport" class="lab-viewport" tabindex="0" role="group" aria-label="Sala de testes. Setas movem; Z ou espaço pula; X faz dash; baixo atravessa plataformas." @keydown="onViewportKey($event,true)" @keyup="onViewportKey($event,false)" @blur="onViewportBlur">
       <svg :viewBox="'0 0 '+room.width+' '+room.height" role="img" aria-label="Corpo do personagem, trajetória, piso, paredes, plataforma e rampa">
        <defs><pattern id="movement-grid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" class="grid-line"/></pattern><clipPath id="movement-room-clip"><rect :width="room.width" :height="room.height"/></clipPath></defs>
        <g clip-path="url(#movement-room-clip)">
         <rect :width="room.width" :height="room.height" fill="url(#movement-grid)"/>
         <rect v-for="(item,index) in room.colliders" :key="index" :x="item.x" :y="item.y" :width="item.width" :height="item.height" :class="item.kind === 2 ? 'platform' : 'terrain'"/>
         <polygon v-for="(item,index) in room.slopes" :key="'s'+index" :points="`${item.x},${item.y+item.leftHeight} ${item.x+item.width},${item.y+item.rightHeight} ${item.x+item.width},${item.y+item.height}`" class="slope"/>
         <polyline :points="points" class="trajectory"/>
         <g v-if="body"><rect :x="body.x" :y="body.y" :width="room.body.width" :height="room.body.height" class="player-body"/><path :d="`M${snapshot.x} ${snapshot.y-22}h${snapshot.facing ? -6 : 6}`" class="facing-mark"/><path :d="`M${snapshot.x-3} ${snapshot.y}h6M${snapshot.x} ${snapshot.y-3}v6`" class="feet-mark"/></g>
        </g>
       </svg>
      </div>
      <div class="lab-inputs">
       <label>Direção<select v-model.number="axis" :disabled="blocked"><option :value="-1">Esquerda</option><option :value="0">Parado</option><option :value="1">Direita</option></select></label>
       <button type="button" :disabled="blocked || !snapshot" @click="pulse('jump')">Pular</button><button type="button" :disabled="blocked || !snapshot" @click="pulse('dash')">Dash</button>
       <label><input type="checkbox" v-model="holdJump" :disabled="blocked"/>Manter pulo</label><label><input type="checkbox" v-model="drop" :disabled="blocked"/>Atravessar plataforma</label>
      </div>
      <dl class="lab-metrics"><div><dt>Estado</dt><dd>{{ stateLabel }}</dd></div><div><dt>Altura do pulo</dt><dd>{{ number(snapshot?.height) }} px</dd></div><div><dt>Distância do pulo</dt><dd>{{ number(snapshot?.distance) }} px</dd></div><div><dt>Velocidade X / Y</dt><dd>{{ number(snapshot?.velocityX) }} / {{ number(snapshot?.velocityY) }}</dd></div><div><dt>Duração do voo</dt><dd>{{ snapshot?.flightTicks || 0 }} ticks</dd></div><div><dt>Quadro</dt><dd>{{ snapshot?.ticks || 0 }}</dd></div></dl>
      <p class="lab-help">Clique na sala para usar setas, Z/espaço e X. O corpo verde usa a caixa de colisão; a linha mostra os pés. A sala usa a mesma física C exportada, com piso, paredes, teto, plataforma e rampa. Para comparar no emulador, salve os ajustes e gere a ROM da sala; o sistema do emulador escolhe PAL/NTSC.</p>
     </main>
     <aside class="lab-inspector" aria-label="Parâmetros de física">
      <div class="lab-profile"><label>Perfil<select v-model="region" :disabled="loading || saving || diagnosticBusy"><option value="ntsc">NTSC · 60 Hz</option><option value="pal">PAL · 50 Hz</option></select></label><button type="button" :disabled="loading || saving || diagnosticBusy" @click="preset">Restaurar preset deste perfil</button></div>
      <p class="lab-help">Valores por tick de vídeo. PAL e NTSC têm ajustes independentes; a troca de perfil não escala os valores.</p>
      <fieldset v-for="group in groups" :key="group.title" :disabled="loading || saving || diagnosticBusy"><legend>{{ group.title }}</legend><label v-for="key in group.keys" :key="key" class="lab-field"><span>{{ names[key] }}<small>{{ unit(key) }}</small></span><input v-model.number="profile[key]" type="number" :min="ranges[key].min" :max="ranges[key].max" :step="ranges[key].step"/></label></fieldset>
      <label class="lab-toggle"><input type="checkbox" v-model="profile.airDash" :disabled="loading || saving || diagnosticBusy"/>Permitir dash no ar</label>
      <p v-if="validation" role="alert" class="lab-error">{{ validation }} Precisão mínima: 1/256 de pixel.</p>
      <p v-if="headerConflict" role="alert" class="lab-error">O header foi personalizado ou não é gerenciado. Revise o arquivo antes de exportar; ele será preservado.</p>
      <p v-if="revisionConflict" role="alert" class="lab-error">Há mudanças externas. O rascunho foi preservado; recarregue antes de exportar.</p>
      <button type="button" :disabled="loading || saving || diagnosticBusy" @click="load(true)">{{ dirty ? 'Descartar rascunho e recarregar' : 'Recarregar ajustes' }}</button>
     </aside>
    </div>
    <footer class="lab-footer"><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="loading || saving || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="loading || saving || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><small role="status">{{ dirty ? (recoveredAt ? 'Ajustes ainda não salvos, recuperados de ' + recoveredAt + '.' : 'Ajustes ainda não salvos.') : saved ? 'Ajustes salvos e header C exportado.' : 'Ajustes do projeto.' }} O game precisa consumir o controlador e o perfil exportados.</small><button type="button" class="lab-save" :disabled="blocked || headerConflict || revisionConflict" @click="save">{{ saving ? 'Salvando…' : 'Salvar e exportar física' }}</button></footer>
   </section>
  </dialog>
 </Teleport>
</template>

<style scoped>
.movement-dialog{position:fixed;inset:0;margin:auto;width:min(1320px,96vw);height:min(860px,94vh);max-width:none;max-height:none;padding:0;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text)}.movement-dialog::backdrop{background:#0009}
.movement-window{height:100%;display:flex;flex-direction:column;min-height:0;font-size:12px}.lab-header,.lab-footer{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;flex:0 0 auto}.lab-header{border-bottom:1px solid var(--border)}.lab-header small,.lab-footer small,.lab-help,.controller-label{color:var(--muted);line-height:1.5}.lab-header small{font:10px monospace;letter-spacing:.1em}h2{margin:4px 0 0;font-size:19px}
button,select,input{font:inherit;color:var(--text);background:var(--input-bg,var(--bg));border:1px solid var(--border);border-radius:3px}button{padding:6px 9px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px}button svg{width:13px;height:13px}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible,.lab-viewport:focus-visible{outline:2px solid var(--accent);outline-offset:2px}select,input[type=number]{padding:6px;min-width:0}select option{background:var(--input-bg);color:var(--text)}input[type=checkbox]{accent-color:var(--accent)}
.lab-workspace{display:grid;grid-template-columns:minmax(0,1fr) 310px;flex:1;min-height:0}.lab-main{display:flex;flex-direction:column;gap:10px;padding:12px;min-height:0;overflow:auto}.lab-tools,.lab-inputs{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.controller-label{margin-left:auto;font:11px monospace}.lab-viewport{background:var(--bg);border:1px solid var(--border);min-height:180px;flex:1;display:grid;place-items:center;overflow:hidden}.lab-viewport svg{width:100%;height:100%;min-height:180px;max-height:450px}.grid-line{fill:none;stroke:var(--border);stroke-width:.25}.terrain{fill:var(--muted)}.platform{fill:#529bce}.slope{fill:#ba9d42}.trajectory{fill:none;stroke:var(--accent);stroke-width:1;stroke-dasharray:2 2}.player-body{fill:#6bb99833;stroke:#6bb998;stroke-width:1}.feet-mark,.facing-mark{stroke:var(--text);stroke-width:1;fill:none}.lab-inputs label,.lab-toggle{display:flex;align-items:center;gap:6px}.lab-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0;padding:12px 0;border-block:1px solid var(--border)}.lab-metrics dt{color:var(--muted);margin-bottom:4px}.lab-metrics dd{margin:0;font:13px monospace}.lab-help{margin:0}.lab-inspector{overflow:auto;min-height:0;border-left:1px solid var(--border);padding:12px;display:flex;flex-direction:column;gap:12px}.lab-profile{display:flex;flex-direction:column;gap:8px}.lab-profile label{display:flex;align-items:center;justify-content:space-between;gap:8px}fieldset{border:0;border-top:1px solid var(--border);margin:0;padding:10px 0 0;min-width:0}legend{font-weight:600;padding:0 8px 0 0}.lab-field{display:grid;grid-template-columns:minmax(0,1fr) 85px;align-items:center;gap:8px;margin-bottom:8px}.lab-field span{display:flex;flex-direction:column;gap:3px}.lab-field small{color:var(--muted);font-size:10px}.lab-error{color:var(--danger);line-height:1.5;margin:8px 12px}.lab-message{color:var(--muted);margin:8px 12px}.lab-footer{border-top:1px solid var(--border)}.lab-save{background:var(--accent);color:#fff;border-color:var(--accent)}
@media(max-width:760px){.lab-workspace{grid-template-columns:minmax(0,1fr) 260px}.lab-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.controller-label{margin-left:0;width:100%}}
@media(max-width:550px){.movement-dialog{height:96vh}.lab-workspace{display:flex;flex-direction:column;overflow:auto}.lab-main,.lab-inspector{overflow:visible;flex:0 0 auto}.lab-inspector{border-left:0;border-top:1px solid var(--border)}.lab-viewport{height:224px;flex:none}.lab-footer{flex-wrap:wrap}}
.history-buttons{display:inline-flex;gap:4px}
</style>
