<script setup>
// #89: modo Música — compositor para Mega Drive. Faixas com instrumento FM/PSG, piano roll, gravação
// pelo teclado MIDI (M-Vave SMK-25 por Bluetooth, ou USB), loop e metrônomo; "Exportar para o jogo"
// gera res/music/<id>.vgm e cadastra a música no catálogo de áudio.
import {ref,reactive,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import MidiKeyboard from './MidiKeyboard.vue'
import MidiDevicePanel from './MidiDevicePanel.vue'
import PianoRoll from './PianoRoll.vue'
import InstrumentEditor from './InstrumentEditor.vue'
import InstrumentBrowser from './InstrumentBrowser.vue'
import PadPanel from './PadPanel.vue'
import {setPadActions} from '../../composables/useDrumPads.js'
import {importInstrumentFile,songInstrument,INSTRUMENT_IMPORT_FORMATS} from '../../../shared/retro/instrumentFormats.js'
import {useMidiInput} from '../../composables/useMidiInput.js'
import {useChipSynth} from '../../composables/useChipSynth.js'
import {useSongEditor} from '../../composables/useSongEditor.js'
import {INSTRUMENT_CATEGORIES} from '../../../shared/retro/chipInstruments.js'
import {SONG_GRIDS,SONG_PPQ,SONG_LIMITS,normalizeSong,songLength} from '../../../shared/retro/song.js'
import {midiNoteName} from '../../../shared/retro/midi.js'
const props=defineProps({projectPath:{type:String,default:''},active:Boolean})
const {midi,connectBluetooth}=useMidiInput()
const {synth,instruments,startSynth,stopSynth,noteOn,noteOff,allNotesOff,setOctave,setVolume,previewInstrument}=useChipSynth()
const editor=useSongEditor(()=>props.projectPath)
const {song,songs,selected,track,grid,quantize,metronome,playing,recording,playhead,cursor,busy,error,message,dirty,savedId,history,recoveredAt}=editor
const heading=ref(null),filter=ref(''),showInstruments=ref(true),pendingOpen=ref(null)
const TRACK_COLORS=['#5bbda5','#5b8fbd','#bd9a5b','#bd5b7a','#8f5bbd','#7abd5b','#bd765b','#5bb3bd']
const kindLabel={fm:'FM',psg:'PSG',noise:'Ruído'}
const connected=computed(()=>midi.sources.filter(source=>source.status==='connected'))
// Um teclado USB com várias portas (SINCO SMK25-Master, -Private…) aparece uma vez, pelo nome do aparelho.
const keyboardStatus=computed(()=>connected.value.length?[...new Set(connected.value.map(source=>source.kind==='midi'?source.name.replace(/\s+\S*$/,'').trim()||source.name:source.name))].join(', ')+(connected.value.some(source=>source.kind==='midi')?' (USB)':''):midi.sources.length?'reconectando…':'nenhum')
const songInstruments=computed(()=>song.value?.instruments||[])
const instrumentName=id=>songInstruments.value.find(item=>item.id===id)?.name||instruments.find(item=>item.id===id)?.name||id
// Editor de instrumento e importação (#89 fase 2).
const editingId=ref(''),fileInput=ref(null),importChoices=ref(null),importError=ref(''),showBrowser=ref(false)
const editing=computed(()=>songInstruments.value.find(item=>item.id===editingId.value)||null)
const usage=id=>song.value?.tracks.filter(item=>item.instrument===id).length||0
function ensureList(){if(!song.value.instruments)song.value.instruments=[];return song.value.instruments}
function addInstruments(list,assign){
 const target=ensureList(),room=SONG_LIMITS.instruments-target.length
 if(room<=0){importError.value='A música já tem '+SONG_LIMITS.instruments+' instrumentos próprios.';return []}
 const added=list.slice(0,room).map(item=>{const copy=songInstrument(item,target.map(entry=>entry.id));target.push(copy);return copy})
 if(list.length>room)importError.value='Só '+room+' couberam (limite de '+SONG_LIMITS.instruments+' por música).'
 if(assign&&added[0]&&track.value){track.value.instrument=added[0].id;previewInstrument(added[0].id)}
 return added
}
function editCopy(){
 const id=track.value?.instrument
 if(songInstruments.value.some(item=>item.id===id)){editingId.value=id;return}
 const source=instruments.find(item=>item.id===id);if(!source)return
 const [copy]=addInstruments([{...source,name:source.name+' (meu)'}],true)
 if(copy)editingId.value=copy.id
}
async function importFiles(files){
 importError.value='';const found=[],warnings=new Set()
 for(const file of files){
  try{const result=importInstrumentFile(file.name,new Uint8Array(await file.arrayBuffer()));found.push(...result.instruments);result.warnings.forEach(item=>warnings.add(item))}
  catch(problem){importError.value=file.name+': '+problem.message}
 }
 if(fileInput.value)fileInput.value.value=''
 if(found.length>1)importChoices.value={items:found.map((item,index)=>({item,index,on:index<8})),warnings:[...warnings]}
 else if(found.length===1){addInstruments(found,true);if(warnings.size)importError.value=[...warnings].join(' ')}
}
// Da internet: a seleção na biblioteca já é a escolha; um banco baixado de link abre o seletor.
function onBrowserImport({instruments:list,choose,warnings=[]}){
 importError.value=''
 if(choose&&list.length>1){importChoices.value={items:list.map((item,index)=>({item,index,on:index<8})),warnings};showBrowser.value=false}
 else addInstruments(list,true)
}
function confirmImport(){const chosen=importChoices.value.items.filter(entry=>entry.on).map(entry=>entry.item);importChoices.value=null;addInstruments(chosen,true)}
function removeInstrument(id){const list=ensureList(),index=list.findIndex(item=>item.id===id);if(index>=0&&!usage(id))list.splice(index,1);editingId.value=''}
const groups=computed(()=>INSTRUMENT_CATEGORIES.map(category=>({category,items:instruments.filter(item=>item.category===category&&(!filter.value||item.kind===filter.value))})).filter(group=>group.items.length))
const bar=computed(()=>SONG_PPQ*(song.value?.beatsPerBar||4))
const position=computed(()=>{const tick=playing.value?playhead.value:cursor.value,b=bar.value;return (Math.floor(tick/b)+1)+'.'+(Math.floor(tick%b/SONG_PPQ)+1)})
const noteCount=computed(()=>song.value?.tracks.reduce((sum,item)=>sum+item.notes.length,0)||0)
// Canais do chip: os da música quando ela toca, os do teclado ao vivo quando não.
const channels=computed(()=>{
 const busy=playing.value?synth.songActive:synth.active,voices=synth.voices,fmCount=song.value?.fmChannels||6
 const fm=busy.map((on,index)=>({label:'FM'+(index+1),on:index<fmCount&&(on||(!playing.value&&!!voices?.fm[index]?.held)),off:index>=fmCount}))
 return [...fm,...(voices?.psg||[{},{},{}]).map((voice,index)=>({label:'PSG'+(index+1),on:!playing.value&&!!voice.held})),{label:'Ruído',on:!playing.value&&!!voices?.noise?.held}]
})
// Compassos/loop em números da interface (1 = primeiro compasso).
const loopBars=computed({
 get:()=>song.value?.loop?[song.value.loop.start/bar.value+1,song.value.loop.end/bar.value]:[1,song.value?.bars||1],
 set:([start,end])=>{const s=Math.max(1,Math.min(song.value.bars,Math.round(start))),e=Math.max(s,Math.min(song.value.bars,Math.round(end)));song.value.loop={start:(s-1)*bar.value,end:e*bar.value}}
})
function setLoop(on){song.value.loop=on?{start:0,end:songLength(song.value)}:null}
function setBars(value){const bars=Math.max(1,Math.min(SONG_LIMITS.bars,Math.round(value)||1));const wasFull=song.value.loop?.end===songLength(song.value);song.value.bars=bars;Object.assign(song.value,normalizeSong(song.value));if(wasFull&&song.value.loop)song.value.loop.end=songLength(song.value);cursor.value=Math.min(cursor.value,songLength(song.value)-1)}
function setBeats(value){song.value.beatsPerBar=Math.max(1,Math.min(12,Math.round(value)||4));setBars(song.value.bars)}
function chooseInstrument(id){if(!track.value)return;track.value.instrument=id;previewInstrument(id)}
// Prévia de notas pelo piano roll (teclas, criar/mover nota).
// A nota do piano roll já é a que soa: desconta a oitava do teclado.
let previewing=null
function preview(pitch,velocity=100){previewEnd();previewing=pitch-synth.octave*12;noteOn(previewing,velocity)}
function previewEnd(){if(previewing!==null){noteOff(previewing);previewing=null}}
// Teclas tocadas pelo mouse ou pelo teclado do computador, somadas às do teclado MIDI.
const local=reactive({})
const shown=computed(()=>({...midi.notes,...local}))
function press(note,velocity=100){local[note]=velocity;noteOn(note,velocity)}
function release(note){delete local[note];noteOff(note)}
// Teclado do computador como nos trackers: Z…M a partir de C3, Q…I a partir de C4. Espaço toca/para.
const KEYS={KeyZ:0,KeyS:1,KeyX:2,KeyD:3,KeyC:4,KeyV:5,KeyG:6,KeyB:7,KeyH:8,KeyN:9,KeyJ:10,KeyM:11,Comma:12,
 KeyQ:12,Digit2:13,KeyW:14,Digit3:15,KeyE:16,KeyR:17,Digit5:18,KeyT:19,Digit6:20,KeyY:21,Digit7:22,KeyU:23,KeyI:24}
const typing=target=>target?.closest?.('input,select,textarea,[contenteditable="true"],.xterm')
function onKeydown(event){
 if(!props.active||document.querySelector('dialog[open]')||typing(event.target))return
 if(history.onKeydown(event))return
 if(event.ctrlKey||event.altKey||event.metaKey)return
 if(event.code==='Space'&&!event.repeat){event.preventDefault();editor.toggle();return}
 if(event.repeat||!(event.code in KEYS))return
 event.preventDefault();press(48+KEYS[event.code])
}
function onKeyup(event){if(event.code in KEYS&&local[48+KEYS[event.code]]!==undefined)release(48+KEYS[event.code])}
function onBlur(){for(const note of Object.keys(local))release(+note)}
async function requestOpen(value){
 if(value===(savedId.value||''))return
 if(dirty.value){pendingOpen.value=value;return}
 await openChoice(value)
}
async function openChoice(value){pendingOpen.value=null;if(value==='__new__')editor.newSong();else await editor.open(value)}
// Fora do modo Música o teclado não toca: o som e a música param e voltam ao entrar.
// Pads no modo Controles: atalhos do compositor, só enquanto o modo Música está aberto.
const padActions={
 play:()=>editor.toggle(),record:()=>editor.record(),metronome:()=>{metronome.value=!metronome.value},loop:()=>song.value&&setLoop(!song.value.loop),
 undo:()=>history.undo(),redo:()=>history.redo(),
 'track-prev':()=>{if(song.value)selected.value=Math.max(0,selected.value-1)},'track-next':()=>{if(song.value)selected.value=Math.min(song.value.tracks.length-1,selected.value+1)}
}
watch(()=>props.active,active=>{setPadActions(active?padActions:null);if(active)void startSynth();else{onBlur();editor.stop();stopSynth()}},{immediate:true})
// A IA (comandos music_open/music_write) espera a primeira música abrir antes de trocar.
let markReady
const ready=new Promise(resolve=>{markReady=resolve})
onMounted(async()=>{
 if(props.active)void startSynth()
 window.addEventListener('keydown',onKeydown);window.addEventListener('keyup',onKeyup);window.addEventListener('blur',onBlur)
 try{
  await editor.refreshList()
  // Rascunho não salvo (recarga, travamento) tem prioridade sobre abrir a primeira música.
  if(await editor.restoreDraft())return
  if(songs.value.find(item=>!item.error))await editor.open(songs.value.find(item=>!item.error).id);else editor.newSong()
 }finally{markReady()}
})
/** music_open: abre (e toca) uma música, sem passar por cima de alterações não salvas de outra. */
async function openSong(id,play=false){
 await ready
 if(dirty.value&&savedId.value!==id)return {ok:false,reason:'A música aberta ("'+(song.value?.name||'')+'") tem alterações não salvas; peça ao usuário para salvar ou descartar.'}
 if(savedId.value!==id||!dirty.value){await editor.refreshList();await editor.open(id)}
 if(savedId.value!==id)return {ok:false,reason:error.value||'Música não encontrada: '+id}
 if(play)await editor.play(0)
 return {ok:true,id,name:song.value.name,playing:playing.value}
}
/** music_write: a música mudou no disco; recarrega se estiver aberta e sem alterações. */
async function songChanged(id){
 await ready
 await editor.refreshList()
 if(savedId.value!==id)return {open:false}
 if(dirty.value)return {open:true,reloaded:false,reason:'o usuário tem alterações não salvas nesta música'}
 await editor.open(id)
 return {open:true,reloaded:true}
}
onBeforeUnmount(()=>{setPadActions(null);window.removeEventListener('keydown',onKeydown);window.removeEventListener('keyup',onKeyup);window.removeEventListener('blur',onBlur);stopSynth()})
function focus(){heading.value?.focus()}
defineExpose({focus,dirty,openSong,songChanged})
</script>
<template>
 <section class="music-workspace" aria-labelledby="music-title">
  <header>
   <div class="brand"><small>MEGA DRIVE · YM2612 + PSG</small><h2 id="music-title" ref="heading" tabindex="-1">Compositor</h2></div>
   <div v-if="song" class="song-bar">
    <label>Música <select :value="savedId||''" :disabled="busy" @change="requestOpen($event.target.value);$event.target.value=savedId||''">
     <option v-if="!savedId" value="">{{ song.name }} (não salva)</option>
     <option v-for="item in songs" :key="item.id" :value="item.id" :disabled="!!item.error">{{ item.name }}{{ item.error ? ' (com erro)' : item.exported ? '' : ' · não exportada' }}</option>
     <option value="__new__">＋ Nova música</option></select></label>
    <label>Nome <input v-model="song.name" maxlength="128" :disabled="busy" /></label>
    <label :title="savedId ? 'O ID não muda depois de salvar (é o nome dos arquivos e da constante no código).' : 'Nome dos arquivos e da constante no código: letras minúsculas, números e _'">ID <input :value="song.id" maxlength="32" :disabled="busy || !!savedId" @input="song.id=$event.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_')" /></label>
    <button type="button" :disabled="busy || !dirty && !!savedId" @click="editor.save(false)">{{ busy ? 'Salvando…' : 'Salvar' }}</button>
    <button type="button" class="primary" :disabled="busy" title="Salva, gera res/music/<id>.vgm e cadastra no catálogo de áudio" @click="editor.save(true)">Exportar para o jogo</button>
   </div>
   <div class="header-tools">
    <div class="pill" :class="{on:synth.status==='on'}" role="status"><span class="dot" aria-hidden="true"></span>Som: <b>{{ {on:'ligado',starting:'ligando…',off:'desligado',error:'com erro'}[synth.status] }}</b>
     <button v-if="synth.status!=='on' && synth.status!=='starting'" type="button" class="primary" @click="startSynth">Ligar</button></div>
    <div class="pill" :class="{on:connected.length}" role="status"><span class="dot" aria-hidden="true"></span>Teclado: <b>{{ keyboardStatus }}</b>
     <button v-if="!connected.length" type="button" class="primary" :disabled="midi.choosing" @click="connectBluetooth">{{ midi.choosing ? 'Procurando…' : 'Conectar SMK-25' }}</button></div>
   </div>
  </header>
  <p v-if="pendingOpen" role="alert" class="notice">Há alterações não salvas nesta música. <button type="button" @click="editor.save(false).then(ok=>ok&&openChoice(pendingOpen))">Salvar e abrir</button> <button type="button" @click="openChoice(pendingOpen)">Descartar e abrir</button> <button type="button" @click="pendingOpen=null">Continuar editando</button></p>
  <p v-if="recoveredAt && dirty" role="status" class="notice">Alterações não salvas recuperadas ({{ recoveredAt }}). <button type="button" @click="editor.discardDraft();savedId ? editor.open(savedId) : editor.newSong()">Descartar rascunho</button></p>
  <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
  <p v-else-if="message" role="status" class="notice ok">{{ message }}</p>
  <p v-if="synth.error" role="alert" class="notice problem">{{ synth.error }}</p>
  <template v-if="song">
   <div class="transport" role="toolbar" aria-label="Transporte">
    <button type="button" title="Voltar ao início" aria-label="Voltar ao início" @click="cursor=0;playing&&editor.play(0)">⏮</button>
    <button type="button" class="play" :aria-pressed="playing && !recording" :title="playing ? 'Parar (Espaço)' : 'Tocar a partir do marcador (Espaço)'" @click="editor.toggle()">{{ playing ? '■ Parar' : '▶ Tocar' }}</button>
    <button type="button" class="rec" :aria-pressed="recording" title="Gravar o teclado na faixa selecionada" @click="editor.record()">● {{ recording ? 'Gravando' : 'Gravar' }}</button>
    <output class="position" title="Compasso.tempo">{{ position }}</output>
    <span class="sep"></span>
    <label>Tempo <input type="number" :min="SONG_LIMITS.tempoMin" :max="SONG_LIMITS.tempoMax" :value="song.tempo" @change="song.tempo=Math.max(SONG_LIMITS.tempoMin,Math.min(SONG_LIMITS.tempoMax,Math.round(+$event.target.value)||120))" /> BPM</label>
    <label>Compasso <input type="number" min="1" max="12" :value="song.beatsPerBar" @change="setBeats(+$event.target.value)" />/4</label>
    <label>Duração <input type="number" min="1" :max="SONG_LIMITS.bars" :value="song.bars" @change="setBars(+$event.target.value)" /> compassos</label>
    <span class="sep"></span>
    <label>Grade <select v-model.number="grid"><option v-for="[value,label] in SONG_GRIDS" :key="value" :value="value">{{ label }}</option></select></label>
    <label class="check"><input v-model="quantize" type="checkbox" /> Quantizar gravação</label>
    <label class="check"><input v-model="metronome" type="checkbox" /> Metrônomo</label>
    <label class="check"><input type="checkbox" :checked="!!song.loop" @change="setLoop($event.target.checked)" /> Loop</label>
    <template v-if="song.loop"><label>do <input type="number" min="1" :max="song.bars" :value="loopBars[0]" @change="loopBars=[+$event.target.value,loopBars[1]]" /></label><label>ao <input type="number" min="1" :max="song.bars" :value="loopBars[1]" @change="loopBars=[loopBars[0],+$event.target.value]" /></label></template>
    <label class="check" title="O XGM usa o DAC do FM 6 para os efeitos PCM: reserve-o se o jogo tocar efeitos durante esta música."><input type="checkbox" :checked="song.fmChannels===5" @change="song.fmChannels=$event.target.checked?5:6" /> FM 6 livre p/ efeitos</label>
    <span class="sep"></span>
    <button type="button" :disabled="!history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button>
    <button type="button" :disabled="!history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button>
    <ol class="channels" aria-label="Canais do chip"><li v-for="channel in channels" :key="channel.label" :class="{on:channel.on,off:channel.off}">{{ channel.label }}</li></ol>
   </div>
   <div class="editor" :class="{'no-instruments':!showInstruments}">
    <aside class="tracks" aria-label="Faixas">
     <div class="tracks-head"><h3>Faixas</h3><button type="button" :disabled="song.tracks.length>=SONG_LIMITS.tracks" @click="editor.addTrack()">＋ Faixa</button></div>
     <ol>
      <li v-for="(item,index) in song.tracks" :key="item.id" :class="{selected:index===selected}" @click="selected=index">
       <span class="swatch" :style="{background:TRACK_COLORS[index%TRACK_COLORS.length]}" aria-hidden="true"></span>
       <span class="track-main"><input v-model="item.name" maxlength="64" :aria-label="'Nome da faixa '+(index+1)" @focus="selected=index" /><small>{{ instrumentName(item.instrument) }} · {{ item.notes.length }} notas</small></span>
       <span class="track-tools"><button type="button" :aria-pressed="item.mute" title="Mudo (só no editor)" @click.stop="item.mute=!item.mute">M</button><button type="button" :aria-pressed="item.solo" title="Solo (só no editor)" @click.stop="item.solo=!item.solo">S</button><button type="button" :disabled="song.tracks.length<=1" :title="'Remover '+item.name" @click.stop="editor.removeTrack(index)">×</button></span>
      </li>
     </ol>
     <p class="help">{{ noteCount }} notas. Mudo e solo valem só para ouvir no editor; a exportação leva todas as faixas.</p>
    </aside>
    <main class="roll">
     <PianoRoll :song="song" :track="selected" :grid="grid" :playhead="playhead" :cursor="cursor" :playing="playing" :colors="TRACK_COLORS" @cursor="cursor=$event" @preview="preview" @preview-end="previewEnd" @gesture="editor.gesturing.value=$event" />
    </main>
    <aside v-if="showInstruments && editing" class="instruments editing" aria-label="Editor de instrumento">
     <InstrumentEditor :instrument="editing" :used="usage(editing.id)" @close="editingId=''" @preview="previewInstrument(editing.id)" @remove="removeInstrument(editing.id)" />
    </aside>
    <aside v-else-if="showInstruments && showBrowser" class="instruments editing" aria-label="Instrumentos da internet">
     <InstrumentBrowser @import="onBrowserImport" @close="showBrowser=false" />
    </aside>
    <aside v-else-if="showInstruments" class="instruments" aria-labelledby="instruments-title">
     <div class="tracks-head"><h3 id="instruments-title">Instrumento da faixa</h3><button type="button" title="Esconder" aria-label="Esconder instrumentos" @click="showInstruments=false">⟩</button></div>
     <p class="current"><b>{{ instrumentName(track?.instrument) }}</b> · {{ track?.name }}</p>
     <div class="library-tools">
      <button type="button" :title="'Abrir '+INSTRUMENT_IMPORT_FORMATS.join(', ')" @click="fileInput.click()">Importar…</button>
      <button type="button" title="Biblioteca de instrumentos do Furnace ou link https" @click="showBrowser=true">Da internet…</button>
      <button type="button" title="Cria uma cópia editável do instrumento da faixa (ou edita, se já for da música)" @click="editCopy">Editar cópia</button>
      <input ref="fileInput" type="file" multiple :accept="INSTRUMENT_IMPORT_FORMATS.join(',')" hidden @change="importFiles([...$event.target.files])" />
     </div>
     <p v-if="importError" role="alert" class="import-error">{{ importError }}</p>
     <div v-if="importChoices" class="import-choices" role="group" aria-label="Escolher instrumentos do arquivo">
      <p class="help">{{ importChoices.items.length }} instrumentos no arquivo. Marque os que entram na música.</p>
      <div class="choice-tools"><button type="button" @click="importChoices.items.forEach(entry=>entry.on=true)">Todos</button><button type="button" @click="importChoices.items.forEach(entry=>entry.on=false)">Nenhum</button></div>
      <ul><li v-for="entry in importChoices.items" :key="entry.index"><label><input v-model="entry.on" type="checkbox" /> {{ entry.item.name }} <small>{{ kindLabel[entry.item.kind] }}</small></label></li></ul>
      <p v-for="warning in importChoices.warnings" :key="warning" class="help">{{ warning }}</p>
      <div class="choice-tools"><button type="button" class="primary" :disabled="!importChoices.items.some(entry=>entry.on)" @click="confirmImport">Importar {{ importChoices.items.filter(entry=>entry.on).length }}</button><button type="button" @click="importChoices=null">Cancelar</button></div>
     </div>
     <section v-if="songInstruments.length"><h4>Da música</h4>
      <div class="grid" role="radiogroup" aria-label="Instrumentos da música">
       <span v-for="item in songInstruments" :key="item.id" class="own"><button type="button" role="radio" class="instrument" :class="item.kind" :aria-checked="track?.instrument===item.id" @click="chooseInstrument(item.id)">{{ item.name }}</button><button type="button" class="edit" :aria-label="'Editar '+item.name" title="Editar" @click="editingId=item.id">✎</button></span>
      </div>
     </section>
     <div class="filters" role="radiogroup" aria-label="Tipo de som"><button v-for="[value,label] in [['','Todos'],['fm','FM'],['psg','PSG'],['noise','Ruído']]" :key="value" type="button" role="radio" :aria-checked="filter===value" @click="filter=value">{{ label }}</button></div>
     <section v-for="group in groups" :key="group.category"><h4>{{ group.category }}</h4>
      <div class="grid" role="radiogroup" :aria-label="group.category">
       <button v-for="item in group.items" :key="item.id" type="button" role="radio" class="instrument" :class="item.kind" :aria-checked="track?.instrument===item.id" :title="kindLabel[item.kind]+(item.kind==='fm'?' · algoritmo '+item.alg:'')" @click="chooseInstrument(item.id)">{{ item.name }}</button>
      </div>
     </section>
    </aside>
    <button v-else type="button" class="show-instruments" @click="showInstruments=true">⟨ Instrumentos</button>
   </div>
   <footer class="keys-bar">
    <div class="keys"><MidiKeyboard :notes="shown" playable @press="press" @release="release" /></div>
    <PadPanel :instruments="[...songInstruments,...instruments]" />
    <div class="key-controls">
     <div class="octave" role="group" aria-label="Oitava"><span>Oitava</span><button type="button" aria-label="Oitava abaixo" :disabled="synth.octave<=-3" @click="setOctave(synth.octave-1)">−</button><output>{{ synth.octave>0 ? '+'+synth.octave : synth.octave }}</output><button type="button" aria-label="Oitava acima" :disabled="synth.octave>=3" @click="setOctave(synth.octave+1)">+</button></div>
     <label class="volume">Volume <input type="range" min="0" max="1" step="0.01" :value="synth.volume" @input="setVolume(+$event.target.value)" /></label>
     <button type="button" title="Solta todas as notas presas" @click="allNotesOff">Parar notas</button>
     <details><summary>Teclado MIDI</summary><div class="midi-popover"><p class="help">Sem teclado MIDI? Use o mouse ou <kbd>Z</kbd>…<kbd>M</kbd> (C3) e <kbd>Q</kbd>…<kbd>I</kbd> (C4).</p><MidiDevicePanel /></div></details>
    </div>
   </footer>
  </template>
 </section>
</template>
<style scoped>
.music-workspace{box-sizing:border-box;display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
header{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border,#41464d);flex-wrap:wrap}
.brand small{color:var(--muted,#a7b2b9);letter-spacing:.06em;font-size:10px}h2{margin:1px 0;font-size:17px}h2:focus{outline:none}h2:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
h3{margin:0;font-size:12px}h4{margin:10px 0 4px;font-size:11px;color:var(--muted,#a7b2b9);font-weight:500}
small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}
.song-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1}.song-bar label{display:flex;align-items:center;gap:5px;color:var(--muted,#a7b2b9)}
.song-bar select{max-width:220px}.song-bar input{width:150px}
.header-tools{display:flex;gap:6px;flex-wrap:wrap}
.pill{display:flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--border,#41464d);border-radius:999px;white-space:nowrap}
.pill.on{border-color:var(--accent,#5bbda5)}.dot{width:8px;height:8px;border-radius:50%;background:#7c858c}.pill.on .dot{background:var(--accent,#5bbda5)}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:4px 7px;min-width:0}
button{cursor:pointer}button:disabled,input:disabled,select:disabled{opacity:.5;cursor:default}
.primary,[aria-pressed=true],[aria-checked=true]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,input,select,summary):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
input[type=number]{width:56px}input[type=checkbox]{padding:0;accent-color:var(--accent,#5bbda5)}
.notice{margin:8px 14px 0;padding:7px 9px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4}.problem{border-color:#e38269;color:#f0b3a3}.ok{border-color:var(--accent,#5bbda5)}
.transport{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border,#41464d)}
.transport label{display:flex;align-items:center;gap:4px;color:var(--muted,#a7b2b9)}.transport .check{gap:5px}
.play{min-width:80px;font-weight:600}.rec[aria-pressed=true]{border-color:#e35d5d;color:#ff8a8a;background:color-mix(in srgb,#e35d5d 16%,var(--bg,#171c21))}
.position{min-width:48px;padding:4px 8px;border:1px solid var(--border,#41464d);border-radius:3px;font-variant-numeric:tabular-nums;text-align:center;color:#f2d16b}
.sep{width:1px;height:20px;background:var(--border,#41464d)}
.channels{list-style:none;margin:0 0 0 auto;padding:0;display:flex;gap:3px}.channels li{padding:3px 5px;border:1px solid var(--border,#41464d);border-radius:3px;font-size:10px;color:var(--muted,#a7b2b9)}
.channels li.on{border-color:var(--accent,#5bbda5);color:var(--text,#ddd);background:color-mix(in srgb,var(--accent,#5bbda5) 22%,transparent)}.channels li.off{opacity:.35;text-decoration:line-through}
.editor{flex:1;min-height:0;display:grid;grid-template-columns:230px minmax(0,1fr) 250px}.editor.no-instruments{grid-template-columns:230px minmax(0,1fr) auto}
.tracks,.instruments{overflow:auto;padding:10px;min-width:0}.tracks{border-right:1px solid var(--border,#41464d)}.instruments{border-left:1px solid var(--border,#41464d)}
.tracks-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px}
.tracks ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.tracks li{display:flex;align-items:center;gap:6px;padding:5px;border:1px solid var(--border,#41464d);border-radius:3px;cursor:pointer}
.tracks li.selected{border-color:var(--accent,#5bbda5);background:color-mix(in srgb,var(--accent,#5bbda5) 10%,transparent)}
.swatch{width:6px;align-self:stretch;border-radius:2px;flex-shrink:0}.track-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.track-main input{border-color:transparent;background:transparent;padding:2px 3px;font-weight:500;width:100%}.track-main input:hover,.track-main input:focus{border-color:var(--border,#41464d);background:var(--bg,#171c21)}
.track-main small{padding-left:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track-tools{display:flex;gap:2px}.track-tools button{padding:2px 5px;font-size:11px}
.roll{min-width:0;min-height:0;display:flex}
.current{margin:0 0 6px}.current b{color:var(--accent,#5bbda5)}.filters{display:flex;gap:3px;flex-wrap:wrap}
.instruments .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.instrument{text-align:left;padding:5px 7px;border-left-width:3px;font-size:11px;line-height:1.3}
.instrument.fm{border-left-color:#5b8fbd}.instrument.psg{border-left-color:#bd9a5b}.instrument.noise{border-left-color:#8a8f95}
.instrument[aria-checked=true]{background:color-mix(in srgb,var(--accent,#5bbda5) 14%,var(--bg,#171c21))}
.instruments.editing{width:auto}.editor:has(.instruments.editing){grid-template-columns:230px minmax(0,1fr) 430px}
.library-tools,.choice-tools{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0}
.import-error{margin:4px 0;color:#f0b3a3;line-height:1.4}
.import-choices{margin:6px 0;padding:6px;border:1px solid var(--accent,#5bbda5);border-radius:3px}.import-choices ul{list-style:none;margin:4px 0;padding:0;max-height:200px;overflow:auto}.import-choices label{display:flex;gap:5px;align-items:center;padding:2px 0}
.own{display:flex;min-width:0}.own .instrument{flex:1;min-width:0;border-radius:3px 0 0 3px}.own .edit{border-left:0;border-radius:0 3px 3px 0;padding:2px 6px}
.show-instruments{writing-mode:vertical-rl;border-radius:0;border-width:0 0 0 1px}
.keys-bar{flex-shrink:0;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:14px;padding:8px 14px;border-top:1px solid var(--border,#41464d)}
.keys{height:76px}
.key-controls{display:grid;grid-template-columns:auto auto;gap:6px 10px;align-content:center;position:relative}
.octave{display:flex;align-items:center;gap:5px}.octave output{min-width:20px;text-align:center;font-variant-numeric:tabular-nums}
.volume{display:flex;align-items:center;gap:5px}.volume input{width:90px;accent-color:var(--accent,#5bbda5);padding:0}
summary{cursor:pointer;padding:4px 0}
.midi-popover{position:absolute;right:0;bottom:calc(100% + 8px);width:min(520px,80vw);max-height:60vh;overflow:auto;padding:12px;background:var(--panel,#20252a);border:1px solid var(--border,#41464d);border-radius:4px;box-shadow:0 8px 24px #0008;z-index:5}
kbd{font:inherit;font-size:11px;padding:0 4px;border:1px solid var(--border,#41464d);border-radius:3px}
@media(max-width:1100px){.editor{grid-template-columns:190px minmax(0,1fr) 210px}.channels{margin-left:0}}
@media(max-width:760px){.editor{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(260px,1fr) auto;overflow:auto}.tracks,.instruments{border:0;border-bottom:1px solid var(--border,#41464d)}.keys-bar{grid-template-columns:minmax(0,1fr)}}
</style>
