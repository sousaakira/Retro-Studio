<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {AUDIO_DRIVERS,AUDIO_PREVIEW_FORMATS,AUDIO_LIMITS,validateAudioConfiguration,compileAudioHeader,compileAudioResources,audioMusicRows,audioEffectRows} from '../../../shared/retro/audioConfiguration.js'
import {createAudioMixer,AUDIO_NONE} from '../../../shared/retro/audioMixer.js'
import {audioDrafts} from '../../utils/retro/audioDrafts.js'
import {draftTimer} from '../../utils/retro/durableDrafts.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
import VgmPlayer from './VgmPlayer.vue'
import {vgmPlayer,playVgm,pauseVgm,resumeVgm,stopVgmIf,projectVgm} from '../../audio/vgmPlayer.js'
const props=defineProps({projectPath:{type:String,required:true},embedded:Boolean,active:{type:Boolean,default:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),config=ref(null),baseline=ref(''),revision=ref(''),rooms=ref([]),candidates=ref([]),report=ref(null),reported=ref('')
const loading=ref(false),saving=ref(false),refreshing=ref(false),error=ref(''),worldError=ref(''),worldUnreadable=ref(false),outputConflicts=ref([]),revisionConflict=ref(false),saved=ref(false)
const tab=ref('music'),mixState=ref(null),log=ref([]),previewError=ref(''),showData=ref(false)
let request=0,activeProject='',disposed=false,closing=false,mixer=null,musicPlayer=null,musicToken=0
const players=[],urls=new Map()
const clone=value=>JSON.parse(JSON.stringify(value))
const extension=file=>{const index=file.lastIndexOf('.');return index<0?'':file.slice(index).toLowerCase()}
const isVgm=file=>['.vgm','.vgz'].includes(extension(file||''))
const driver=computed(()=>AUDIO_DRIVERS[config.value?.driver]||AUDIO_DRIVERS.xgm)
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
// The report describes one exact catalog text; any later edit makes it stale.
const reportStale=computed(()=>!!config.value&&!!report.value&&JSON.stringify(config.value)!==reported.value)
const blocked=computed(()=>loading.value||saving.value)
const roomIds=computed(()=>rooms.value.map(room=>room.id))
// An unreadable world is the world's problem: room links are kept and not judged here.
const validation=computed(()=>{try{if(config.value)validateAudioConfiguration(config.value,worldUnreadable.value?{}:{rooms:roomIds.value});return ''}catch(e){return e.message}})
const files=formats=>candidates.value.filter(file=>formats.includes(extension(file)))
const musicFiles=computed(()=>files(driver.value.music)),effectFiles=computed(()=>files(driver.value.effects)),previewFiles=computed(()=>files(AUDIO_PREVIEW_FORMATS))
const musicRows=computed(()=>{try{return validation.value?[]:audioMusicRows(config.value)}catch{return []}})
const effectRows=computed(()=>{try{return validation.value?[]:audioEffectRows(config.value)}catch{return []}})
const exported=computed(()=>{try{return config.value&&!validation.value?compileAudioResources(config.value)+'\n'+compileAudioHeader(config.value):''}catch{return ''}})
// Rooms of the world graph, each with its music ('' = no music set).
const roomMusic=computed(()=>rooms.value.map(room=>({room,entry:config.value?.rooms.find(item=>item.room===room.id)})))
const orphans=computed(()=>worldUnreadable.value?[]:(config.value?.rooms||[]).filter(item=>!roomIds.value.includes(item.room)))
const issueGroups=computed(()=>['error','warning','info'].map(severity=>({severity,items:(report.value?.issues||[]).filter(item=>item.severity===severity)})).filter(group=>group.items.length))
const labels={error:'Erros',warning:'Avisos',info:'Informações'}
const kib=bytes=>bytes>=1024?(bytes/1024).toFixed(1)+' KiB':bytes+' B'
function cache(){if(activeProject&&config.value){if(dirty.value||saving.value)audioDrafts.set(activeProject,{config:clone(config.value),baseline:baseline.value,revision:revision.value},draftOwner);else audioDrafts.deleteIfOwner(activeProject,draftOwner)}}
// #52: undo/redo of this document, and a draft written while editing (not only on close).
// The same editor can be open twice (dialog and bottom dock): each instance only clears its own draft.
const draftOwner=Symbol('AudioEditor')
const recoveredAt=ref(''),history=useDocumentUndo(config,{blocked:()=>blocked.value})
const draftSaver=draftTimer(()=>{if(!disposed&&config.value&&!loading.value)cache()})
watch(()=>config.value?JSON.stringify(config.value):null,(now,before)=>{if(now&&before)draftSaver.touch()})
function apply(result){rooms.value=result.rooms||[];candidates.value=result.candidates||[];report.value=result.report||null;worldError.value=result.worldError||'';worldUnreadable.value=!!result.worldUnreadable;outputConflicts.value=result.outputConflicts||[];reported.value=JSON.stringify(result.config)}
async function load(discard=false){
 if(saving.value)return
 silence()
 if(!discard)cache();else audioDrafts.delete(props.projectPath)
 const projectPath=props.projectPath,id=++request
 activeProject=projectPath;loading.value=true;error.value='';config.value=null;saved.value=false;revisionConflict.value=false;urls.clear();log.value=[]
 try{
  const result=await window.retroStudio?.retro?.audioConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error(result?.error||'Catálogo de áudio indisponível.')
  // #52: a draft left by an interrupted session comes back as unsaved changes.
  if(audioDrafts.needsHydration(projectPath)){await audioDrafts.hydrate(projectPath);if(disposed||id!==request)return}
  const draft=audioDrafts.get(projectPath)
  if(draft)audioDrafts.claim(projectPath,draftOwner)
  recoveredAt.value=draft?audioDrafts.recoveredAt(projectPath):''
  config.value=clone(draft?.config||result.config);baseline.value=draft?.baseline||JSON.stringify(result.config)
  revision.value=draft?.revision||result.revision;revisionConflict.value=!!draft&&draft.revision!==result.revision
  apply(result);rebuild()
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||outputConflicts.value.length||revisionConflict.value||!config.value||validation.value)return
 const projectPath=props.projectPath,id=request,submitted=clone(config.value),submittedRevision=revision.value
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveAudioConfiguration?.({projectPath,config:submitted,revision:submittedRevision})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar o áudio.')
  const cached=audioDrafts.get(projectPath)
  if(cached?.revision===submittedRevision)audioDrafts.delete(projectPath)
  if(disposed||projectPath!==props.projectPath)return
  // Late reply after leaving and returning: the saved draft must not be cached again.
  if(id!==request){config.value=null;void load();return}
  config.value=clone(result.config);baseline.value=JSON.stringify(result.config);revision.value=result.revision;apply(result);saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)saving.value=false}
}
/** Report for the unsaved catalog; nothing is written. */
async function refreshReport(){
 if(blocked.value||refreshing.value||!config.value||validation.value)return
 const projectPath=props.projectPath,id=request,draft=clone(config.value),text=JSON.stringify(draft)
 refreshing.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.audioConfiguration?.({projectPath,draft})
  if(disposed||id!==request||projectPath!==props.projectPath)return
  if(!result?.report)throw Error(result?.error||'Relatório indisponível.')
  report.value=result.report;candidates.value=result.candidates||candidates.value;reported.value=text
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed)refreshing.value=false}
}
function freeId(list,prefix){const used=new Set(list.map(item=>item.id));let number=1;while(used.has(prefix+number))number++;return prefix+number}
function addMusic(){
 const now=config.value;if(blocked.value||!now||now.music.length>=AUDIO_LIMITS.music)return
 const used=new Set(now.music.map(item=>item.source)),id=freeId(now.music,'music_')
 now.music.push({id,name:'Música '+(now.music.length+1),source:musicFiles.value.find(file=>!used.has(file))||'',preview:'',timing:'auto'})
}
function addEffect(){
 const now=config.value;if(blocked.value||!now||now.effects.length>=driver.value.maxEffects)return
 const used=new Set(now.effects.map(item=>item.source)),id=freeId(now.effects,'sfx_')
 now.effects.push({id,name:'Efeito '+(now.effects.length+1),source:effectFiles.value.find(file=>!used.has(file))||'',priority:4,channel:0})
}
function removeMusic(index){
 const now=config.value;if(blocked.value||!now)return
 const [gone]=now.music.splice(index,1);now.rooms=now.rooms.filter(item=>item.music!==gone.id)
}
function setRoomMusic(room,music){
 const now=config.value;if(blocked.value||!now)return
 now.rooms=now.rooms.filter(item=>item.room!==room)
 if(music)now.rooms.push({room,music})
}
function removeOrphans(){if(!blocked.value&&config.value)config.value.rooms=config.value.rooms.filter(item=>roomIds.value.includes(item.room))}
// Preview: the exported rows drive the same channel policy as the C module.
// Music plays its rendered preview file or, without one, the VGM on the emulated chips (#103);
// effects play their original WAV.
function stopPlayer(player){if(player){try{player.pause()}catch{/* already stopped */}}}
// Leaving the preview (track change, close, hidden dock) ends a VGM instead of pausing it.
function endPlayer(player){if(player?.stop)player.stop();else stopPlayer(player)}
function silence(){musicToken++;endPlayer(musicPlayer);musicPlayer=null;for(let i=0;i<players.length;i++){stopPlayer(players[i]);players[i]=null}}
function rebuild(){
 silence();mixer=null;mixState.value=null;previewError.value=''
 if(!config.value||validation.value)return
 try{
  mixer=createAudioMixer({musicCount:musicRows.value.length,channels:config.value.effectChannels,effects:effectRows.value.map(row=>({priority:row.priority,channel:row.channel})),driver:{
   music:track=>{void startMusic(track)},effect:(effect,channel)=>{void startEffect(effect,channel)},
   // As in the game, pausing affects the music; effects already playing finish.
   pause:paused=>{if(musicPlayer){if(paused)stopPlayer(musicPlayer);else void musicPlayer.play()?.catch?.(()=>{})}},
   busy:channel=>{const player=players[channel-1];return !!player&&!player.ended&&!player.failed}}})
  mixState.value=mixer.state()
 }catch(e){previewError.value=e.message}
}
async function url(file){
 if(!file)return ''
 if(urls.has(file))return urls.get(file)
 const projectPath=props.projectPath,result=await window.retroStudio?.retro?.getAssetPreview?.(projectPath,file)
 if(projectPath!==props.projectPath)return ''
 if(!result?.success)throw Error(result?.error||'Prévia indisponível.')
 urls.set(file,result.preview);return result.preview
}
async function startMusic(track){
 const token=++musicToken
 endPlayer(musicPlayer);musicPlayer=null
 if(track===AUDIO_NONE)return
 const row=musicRows.value[track],item=config.value?.music.find(entry=>entry.id===row?.id),owner=mixer
 if(!item?.preview&&isVgm(item?.source)){
  // Same key as the row player, so the row shows this track playing.
  const key=props.projectPath+'::'+item.source,projectPath=props.projectPath
  const start=()=>playVgm({key,name:item.name,load:()=>projectVgm(projectPath,item.source)})
  // Chosen while paused: nothing is loaded yet, so resuming starts it.
  musicPlayer={pause(){if(vgmPlayer.key===key)void pauseVgm()},play(){return vgmPlayer.key!==key?start():vgmPlayer.status==='paused'?resumeVgm():undefined},stop(){stopVgmIf(key)}}
  if(!mixer.state().paused)void start()
  return
 }
 if(!item?.preview){previewError.value='“'+(item?.name||'?')+'” não tem prévia; a troca aparece no estado, mas sem som.';return}
 try{
  // Only the latest request may create a player: earlier ones would loop forever unseen.
  const source=await url(item.preview);if(disposed||token!==musicToken||mixer!==owner||!source)return
  const player=new Audio(source);player.loop=true;endPlayer(musicPlayer);musicPlayer=player
  if(!mixer.state().paused)await player.play()
 }catch(e){if(e?.name!=='AbortError')previewError.value='Música “'+item.name+'”: '+e.message}
}
async function startEffect(effect,channel){
 const row=effectRows.value[effect],owner=mixer,slot={ended:false,failed:false,pause(){this.ended=true}}
 // The slot holds the channel while the file loads, so the policy sees it as busy.
 stopPlayer(players[channel-1]);players[channel-1]=slot
 try{
  const source=await url(row.source);if(disposed||mixer!==owner||players[channel-1]!==slot||!source){slot.failed=true;return}
  const player=new Audio(source);players[channel-1]=player
  player.addEventListener?.('ended',()=>{if(mixer===owner)mixState.value=mixer.state()})
  await player.play()
 }catch(e){slot.failed=true;if(players[channel-1]&&players[channel-1]!==slot)players[channel-1].failed=true;if(e?.name!=='AbortError')previewError.value='Efeito “'+row.id+'”: '+e.message}
}
function act(run){if(!mixer)return;previewError.value='';mixer.tick();mixer.tick();run();mixState.value=mixer.state()}
function note(text){log.value=[text,...log.value].slice(0,8)}
function playRoom(id){const row=musicRows.value.find(item=>item.id===id);act(()=>{mixer.roomMusic(row?row.index:AUDIO_NONE);note(row?'Sala: música “'+id+'”.':'Sala: silêncio.')})}
function playScript(id){const row=musicRows.value.find(item=>item.id===id);if(row)act(()=>{mixer.scriptMusic(row.index);note('Cena: música “'+id+'” (a da sala fica guardada).')})}
function restore(){act(()=>{mixer.restoreMusic();note('Cena terminou: volta a música da sala.')})}
function togglePause(){act(()=>{const paused=!mixer.state().paused;mixer.pause(paused);note(paused?'Pausado.':'Retomado.')})}
function describe(id,result){
 if(!result.channel)return 'Efeito “'+id+'” descartado: todos os canais possíveis tocam algo de prioridade maior.'
 const cut=result.interrupted!==AUDIO_NONE?effectRows.value[result.interrupted]?.id:''
 return 'Efeito “'+id+'” no canal '+result.channel+(cut?', interrompendo “'+cut+'”.':'.')
}
function playEffect(id,times=1){
 const row=effectRows.value.find(item=>item.id===id);if(!row)return
 // Several plays inside one action behave like the same video frame in the game.
 act(()=>{for(let i=0;i<times;i++)note(describe(id,mixer.playEffect(row.index)))})
}
function voiceLabel(voice,index){
 const row=effectRows.value[voice.effect],player=players[index],busy=!!player&&!player.ended&&!player.failed
 return row?(busy?'tocando':'terminou')+' “'+row.id+'” · prioridade '+voice.priority:'livre'
}
function close(discard=false){
 if(saving.value)return
 if(dirty.value&&!discard){error.value='Salve o áudio ou use “Descartar e fechar”.';return}
 closing=true;silence();if(config.value||discard)audioDrafts.delete(activeProject);emit('close')
}
function keydown(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save()}}
function canClose(){return !dirty.value&&!saving.value}
// A modal dialog keeps its keys to itself; in the dock the IDE shortcuts must keep working.
function onRootKeydown(event){if(!props.embedded)event.stopPropagation();if(!history.onKeydown(event))keydown(event)}
// #45: hosted in the bottom dock. Hidden: nothing keeps playing. Shown again while clean: the
// file may have been changed by the same editor opened elsewhere, so it is read again.
watch(()=>props.active,active=>{if(!props.embedded)return;if(!active)silence();else if(!dirty.value&&!loading.value&&!saving.value&&config.value)void load()})
function onHidden(){if(typeof document!=='undefined'&&document.hidden&&mixer&&!mixer.state().paused)togglePause()}
defineExpose({canClose})
watch(()=>props.projectPath,()=>{cache();saving.value=false;void load()},{immediate:true})
watch(()=>JSON.stringify(config.value),(now,before)=>{if(config.value&&!loading.value&&before!==undefined&&now!==before)rebuild()})
onMounted(()=>{dialogElement.value?.showModal?.();document.addEventListener?.('visibilitychange',onHidden)})
onBeforeUnmount(()=>{if(!closing)cache();disposed=true;request++;silence();document.removeEventListener?.('visibilitychange',onHidden);dialogElement.value?.close?.()})
</script>
<template>
 <Teleport to="body" :disabled="embedded">
  <component :is="embedded ? 'section' : 'dialog'" ref="dialogElement" class="audio-dialog" :class="{embedded}" aria-labelledby="audio-title" @cancel.prevent="close()" @keydown="onRootKeydown">
   <header><div><small>MEGA DRIVE · ÁUDIO</small><h2 id="audio-title">Músicas e efeitos</h2></div><button v-if="!embedded" type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <p v-if="loading" role="status" class="notice">Carregando catálogo de áudio…</p>
   <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
   <div v-if="config" class="audio-content">
    <main class="audio-main" aria-label="Catálogo de áudio">
     <div class="tabs" role="tablist" aria-label="Seções do catálogo">
      <button v-for="item in [['music','Músicas · '+config.music.length],['effects','Efeitos · '+config.effects.length],['rooms','Música por sala'],['report','Relatório'+(report?.errors?' · '+report.errors+' erro(s)':'')]]" :key="item[0]" type="button" role="tab" :aria-selected="tab===item[0]" @click="tab=item[0]">{{ item[1] }}</button>
     </div>
     <section v-if="tab==='music'">
      <div class="title"><p class="help">Originais em {{ driver.music.join(' ou ') }}. O ▶ toca o VGM nos chips emulados da IDE: parecido com o console, bom para reconhecer a música. Uma prévia renderizada ({{ AUDIO_PREVIEW_FORMATS.join(', ') }}), se indicada, tem preferência ao tocar como sala ou cena. A prévia nunca entra na ROM.</p><button type="button" :disabled="blocked || config.music.length>=AUDIO_LIMITS.music" @click="addMusic">＋ Música</button></div>
      <p v-if="!musicFiles.length" class="notice">Nenhum arquivo {{ driver.music.join('/') }} em <code>audio/</code> ou <code>res/</code>. Copie as músicas para o projeto e recarregue.</p>
      <article v-for="(item,index) in config.music" :key="index" class="entry">
       <label>ID no código <input v-model="item.id" maxlength="32" :disabled="blocked" /></label>
       <label>Nome <input v-model="item.name" maxlength="128" :disabled="blocked" /></label>
       <label class="wide">Original <select v-model="item.source" :disabled="blocked"><option v-if="!musicFiles.includes(item.source)" :value="item.source">{{ item.source || 'Escolha um arquivo' }}</option><option v-for="file in musicFiles" :key="file" :value="file">{{ file }}</option></select></label>
       <label class="wide">Prévia <select v-model="item.preview" :disabled="blocked"><option value="">Sem prévia</option><option v-if="item.preview && !previewFiles.includes(item.preview)" :value="item.preview">{{ item.preview }}</option><option v-for="file in previewFiles" :key="file" :value="file">{{ file }}</option></select></label>
       <VgmPlayer v-if="isVgm(item.source)" class="wide" :project-path="projectPath" :file="item.source" :name="item.name" />
       <label>Andamento <select v-model="item.timing" :disabled="blocked"><option value="auto">Automático</option><option value="ntsc">NTSC · 60 Hz</option><option value="pal">PAL · 50 Hz</option></select></label>
       <div class="actions"><button type="button" :disabled="!mixer" @click="playRoom(item.id)">Tocar como sala</button><button type="button" :disabled="!mixer" @click="playScript(item.id)">Tocar como cena</button><button type="button" :disabled="blocked" @click="removeMusic(index)">Remover</button></div>
      </article>
      <p v-if="!config.music.length" class="help">Nenhuma música cadastrada.</p>
     </section>
     <section v-if="tab==='effects'">
      <div class="title"><p class="help">Originais em WAV PCM; o build converte para {{ driver.sampleRate }} Hz mono 8 bits. Prioridade de 0 a 15: com todos os canais ocupados, um efeito só interrompe outro de prioridade igual ou menor.</p><button type="button" :disabled="blocked || config.effects.length>=driver.maxEffects" @click="addEffect">＋ Efeito</button></div>
      <p v-if="!effectFiles.length" class="notice">Nenhum arquivo .wav em <code>audio/</code> ou <code>res/</code>. Copie os efeitos para o projeto e recarregue.</p>
      <article v-for="(item,index) in config.effects" :key="index" class="entry">
       <label>ID no código <input v-model="item.id" maxlength="32" :disabled="blocked" /></label>
       <label>Nome <input v-model="item.name" maxlength="128" :disabled="blocked" /></label>
       <label class="wide">Original <select v-model="item.source" :disabled="blocked"><option v-if="!effectFiles.includes(item.source)" :value="item.source">{{ item.source || 'Escolha um arquivo' }}</option><option v-for="file in effectFiles" :key="file" :value="file">{{ file }}</option></select></label>
       <label>Prioridade <input v-model.number="item.priority" type="number" min="0" max="15" step="1" :disabled="blocked" /></label>
       <label>Canal <select v-model.number="item.channel" :disabled="blocked"><option :value="0">Automático</option><option v-for="n in config.effectChannels" :key="n" :value="n">Sempre o {{ n }}</option></select></label>
       <div class="actions"><button type="button" :disabled="!mixer" @click="playEffect(item.id)">Tocar</button><button type="button" :disabled="!mixer" @click="playEffect(item.id,4)">Tocar 4× no mesmo quadro</button><button type="button" :disabled="blocked" @click="config.effects.splice(index,1)">Remover</button></div>
      </article>
      <p v-if="!config.effects.length" class="help">Nenhum efeito cadastrado.</p>
     </section>
     <section v-if="tab==='rooms'">
      <p class="help">A música da sala começa quando o jogo entra nela. Salas vizinhas com a mesma música não reiniciam a faixa.</p>
      <p v-if="worldUnreadable" role="alert" class="notice problem">O grafo de salas não pôde ser lido ({{ worldError }}). As ligações de música por sala estão preservadas; corrija o mundo para editá-las.</p>
      <p v-else-if="!rooms.length" class="notice">Cadastre as salas em “Salas e conexões” para escolher a música de cada uma.</p>
      <label v-for="item in roomMusic" :key="item.room.id" class="field"><span>{{ item.room.name }} <small>{{ item.room.id }}</small></span><select :value="item.entry?.music || ''" :disabled="blocked" @change="setRoomMusic(item.room.id,$event.target.value)"><option value="">Sem música definida</option><option v-for="track in config.music" :key="track.id" :value="track.id">{{ track.name }}</option></select></label>
      <p v-if="orphans.length" role="alert" class="notice problem">Há músicas ligadas a salas que não existem mais no mundo: {{ orphans.map(item=>item.room).join(', ') }}. <button type="button" :disabled="blocked" @click="removeOrphans">Remover ligações órfãs</button></p>
     </section>
     <section v-if="tab==='report'">
      <div class="title"><p class="help">{{ reportStale ? 'O catálogo mudou depois deste relatório.' : 'Relatório do catálogo atual.' }}</p><button type="button" :disabled="blocked || refreshing || !!validation" @click="refreshReport">{{ refreshing ? 'Atualizando…' : 'Atualizar relatório' }}</button></div>
      <template v-if="report">
       <dl class="metrics">
        <div><dt>Driver</dt><dd>{{ report.driver.name }}{{ report.driver.toolkit ? (report.driver.toolkit[report.driver.id] ? ' · disponível no toolkit' : ' · ausente no toolkit') : '' }}</dd></div>
        <div><dt>Formatos na ROM</dt><dd>música {{ report.driver.musicFormats.join(', ') }} · efeitos {{ report.driver.effectFormats.join(', ') }}</dd></div>
        <div><dt>Canais PCM</dt><dd>{{ report.driver.effectChannels }} para efeitos de {{ report.driver.pcmChannels }} · {{ report.driver.sampleRate }} Hz</dd></div>
        <div><dt>Tamanho estimado</dt><dd>{{ kib(report.romBytes) }} · {{ report.entries.filter(e=>e.kind==='effect').length }} de {{ report.driver.maxEffects }} efeitos</dd></div>
       </dl>
       <table v-if="report.entries.length"><thead><tr><th scope="col">Tipo</th><th scope="col">ID</th><th scope="col">Nº</th><th scope="col">Original</th><th scope="col">Arquivo</th><th scope="col">ROM (estim.)</th></tr></thead>
        <tbody><tr v-for="entry in report.entries" :key="entry.kind+entry.id"><td>{{ entry.kind==='music'?'Música':'Efeito' }}</td><td>{{ entry.id }}</td><td>{{ entry.index }}</td><td>{{ entry.source }}<small v-if="entry.rate"> · {{ entry.rate }} Hz, {{ entry.channels }} canal(is), {{ entry.bits }} bits, {{ entry.seconds.toFixed(2) }} s</small></td><td>{{ entry.exists ? kib(entry.bytes) : 'ausente' }}</td><td>{{ entry.exists ? kib(entry.romBytes) : '—' }}</td></tr></tbody></table>
       <div v-for="group in issueGroups" :key="group.severity" :class="['issues',group.severity]"><h3>{{ labels[group.severity] }} · {{ group.items.length }}</h3><ul><li v-for="(item,index) in group.items" :key="index">{{ item.message }}</li></ul></div>
       <p v-if="!report.issues.length" class="help">Nenhum conflito encontrado.</p>
       <p class="help">O tamanho das músicas é o do arquivo original (limite superior). Players de MP3/OGG não entram na ROM: esses formatos servem só de prévia.</p>
      </template>
     </section>
     <details :open="showData" @toggle="showData=$event.target.open"><summary>Dados exportados (audio_resources.res e audio_config.h)</summary><pre v-if="exported">{{ exported }}</pre><p v-else>Corrija o catálogo para ver os arquivos.</p></details>
    </main>
    <aside class="audio-inspector" aria-label="Prévia e canais">
     <fieldset :disabled="blocked"><legend>Driver e canais</legend>
      <label class="field"><span>Driver</span><select v-model="config.driver"><option v-for="(item,id) in AUDIO_DRIVERS" :key="id" :value="id">{{ item.name }}</option></select></label>
      <label class="field"><span>Canais para efeitos</span><select v-model.number="config.effectChannels"><option :value="driver.pcmChannels-1">{{ driver.pcmChannels-1 }} · canal 1 fica com a música</option><option :value="driver.pcmChannels">{{ driver.pcmChannels }} · músicas sem samples</option></select></label>
     </fieldset>
     <h3>Prévia</h3>
     <p class="help">Os efeitos passam pela mesma política de canais do jogo. O som vem dos arquivos de prévia, dos WAV originais e, nas músicas sem prévia, do VGM tocado nos chips emulados.</p>
     <div class="actions"><button type="button" :disabled="!mixer" @click="togglePause">{{ mixState?.paused ? 'Retomar' : 'Pausar' }}</button><button type="button" :disabled="!mixer || !mixState?.overridden" @click="restore">Fim da cena</button><button type="button" :disabled="!mixer" @click="playRoom('')">Sala sem música</button></div>
     <dl v-if="mixState" class="metrics single">
      <div><dt>Música tocando</dt><dd>{{ musicRows[mixState.playing]?.id || 'silêncio' }}{{ mixState.overridden ? ' · cena no controle' : '' }}{{ mixState.paused ? ' · pausado' : '' }}</dd></div>
      <div><dt>Música da sala</dt><dd>{{ musicRows[mixState.room]?.id || 'nenhuma' }}</dd></div>
      <div v-for="(voice,index) in mixState.voices" :key="index"><dt>Canal {{ index+1 }}</dt><dd>{{ voiceLabel(voice,index) }}</dd></div>
     </dl>
     <p v-if="previewError" role="status" class="notice">{{ previewError }}</p>
     <ol v-if="log.length" class="log" aria-label="Últimas decisões"><li v-for="(line,index) in log" :key="index">{{ line }}</li></ol>
     <p v-if="validation" role="alert" class="notice problem">{{ validation }}</p>
     <p v-if="worldError && !validation" role="alert" class="notice problem">{{ worldError }}</p>
     <p v-if="outputConflicts.length || revisionConflict" role="alert" class="notice problem">{{ outputConflicts.length ? 'Arquivo gerado foi personalizado e será preservado: '+outputConflicts.join(', ') : 'O catálogo mudou no disco. Seu rascunho está preservado.' }}</p>
    </aside>
   </div>
   <footer><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="blocked || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="blocked || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><div><small role="status">{{ saving ? 'Exportando…' : dirty ? (recoveredAt ? 'Alterações não salvas, recuperadas de ' + recoveredAt + '.' : 'Alterações não salvas.') : saved ? 'Áudio salvo; recursos e headers exportados.' : 'audio/audio.json · res/audio_resources.res · src/generated/audio_config.h' }}</small><small>O game precisa instalar o módulo audio e chamar suas funções; os números vêm de audio_config.h.</small></div><button v-if="dirty || revisionConflict" type="button" :disabled="saving" @click="load(true)">Descartar e recarregar</button><button v-if="dirty && !embedded" type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button><button type="button" class="primary" :disabled="blocked || !!outputConflicts.length || revisionConflict || !config || !!validation" @click="save">Salvar e exportar áudio</button></footer>
  </component>
 </Teleport>
</template>
<style scoped>
.audio-dialog{box-sizing:border-box;width:min(1240px,96vw);height:min(860px,94vh);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.audio-dialog[open],.audio-dialog.embedded{display:flex;flex-direction:column}.audio-dialog.embedded{width:100%;max-width:none;height:100%;max-height:none;border:0;border-radius:0}.audio-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer>div{display:flex;flex-direction:column;gap:2px;flex:1;min-width:180px}
h2{margin:3px 0;font-size:19px}h3{margin:12px 0 6px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}code{font-size:11px}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;min-width:0}
button{cursor:pointer}button:disabled,input:disabled,select:disabled{opacity:.5;cursor:default}.primary,[role=tab][aria-selected=true]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,input,select,summary):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.notice{margin:8px 12px;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4}.problem{border-color:#e38269;color:#f0b3a3}.audio-main .notice,.audio-inspector .notice{margin-inline:0}
.audio-content{display:grid;grid-template-columns:minmax(0,1fr) 340px;flex:1;min-height:0;overflow:hidden}.audio-main,.audio-inspector{overflow:auto;padding:14px;min-width:0}.audio-inspector{border-left:1px solid var(--border,#41464d)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;background:transparent}.title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.title .help{margin-top:0}.title button{white-space:nowrap;flex-shrink:0}
.entry{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px;margin:8px 0;border:1px solid var(--border,#41464d);border-radius:3px}.entry label{display:flex;flex-direction:column;gap:3px;min-width:0}.entry .wide{grid-column:span 2}.entry input,.entry select{width:100%}
.actions{display:flex;flex-wrap:wrap;gap:6px;align-items:end}.entry .actions{grid-column:1/-1}
.field{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:8px;margin:6px 0}.field select{width:100%}fieldset .field{grid-template-columns:minmax(0,1fr);gap:3px}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:0 0 10px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin:10px 0}.metrics.single{grid-template-columns:1fr}.metrics div{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}dt{color:var(--muted,#a7b2b9)}dd{margin:3px 0 0;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;margin:8px 0}th{text-align:left;font-weight:400;color:var(--muted,#a7b2b9)}th,td{padding:4px 6px;border-bottom:1px solid var(--border,#41464d);vertical-align:top;overflow-wrap:anywhere}
.issues ul,.log{margin:4px 0;padding-left:18px;line-height:1.5}.issues.error h3{color:#f0b3a3}.issues.warning h3{color:#f2d16b}.log{color:var(--muted,#a7b2b9)}.log li:first-child{color:var(--text,#ddd)}
details{margin-top:12px}summary{cursor:pointer;padding:4px 0}pre{margin:8px 0 0;padding:10px;max-height:220px;overflow:auto;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:900px){.entry{grid-template-columns:repeat(2,minmax(0,1fr))}.audio-content{grid-template-columns:minmax(0,1fr) 280px}table,thead,tbody,tr,td{display:block}thead{display:none}td{border:0;padding:1px 0}tr{padding:6px 0;border-bottom:1px solid var(--border,#41464d)}td:nth-child(1),td:nth-child(2),td:nth-child(3){display:inline;margin-right:6px}td:nth-child(3)::before{content:'nº '}td:nth-child(5)::before{content:'arquivo: '}td:nth-child(6)::before{content:'ROM: '}}
@media(max-width:620px){.audio-content{display:block;overflow:auto}.audio-main,.audio-inspector{overflow:visible}.audio-inspector{border-left:0;border-top:1px solid var(--border,#41464d)}.title{flex-direction:column}}
.history-buttons{display:inline-flex;gap:4px}
</style>
