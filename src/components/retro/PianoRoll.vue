<script setup>
// #89: piano roll do compositor (canvas). Edita as notas da faixa selecionada; as outras faixas
// aparecem apagadas por baixo. Clique no vazio cria (arraste para o tamanho), arraste a nota para
// mover, a borda direita para mudar a duração; botão direito apaga. Régua: clique posiciona o início
// da reprodução; Shift+arrastar marca o loop.
import {ref,computed,watch,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {songLength,snapTick,snapLength,SONG_PPQ} from '../../../shared/retro/song.js'
import {midiNoteName} from '../../../shared/retro/midi.js'
const props=defineProps({song:{type:Object,required:true},track:{type:Number,default:0},grid:{type:Number,default:12},playhead:{type:Number,default:0},cursor:{type:Number,default:0},playing:Boolean,colors:{type:Array,default:()=>[]}})
// gesture: true do apertar ao soltar o mouse; o editor junta o gesto num passo de desfazer.
const emit=defineEmits(['cursor','preview','preview-end','gesture'])
const KEYS=56,RULER=24,EDGE=6,BLACK=new Set([1,3,6,8,10])
const host=ref(null),canvas=ref(null),zoomX=ref(1.5),rowH=ref(12),scrollX=ref(0),scrollY=ref(0),size=ref({w:600,h:300})
const selection=ref(new Set()),hover=ref(null)
let lastLength=12,drag=null,frame=0,observer=null,style=null
const notes=computed(()=>props.song.tracks[props.track]?.notes||[])
const length=computed(()=>songLength(props.song))
const contentW=computed(()=>length.value*zoomX.value),contentH=computed(()=>128*rowH.value)
const clampScroll=()=>{
 scrollX.value=Math.max(0,Math.min(scrollX.value,Math.max(0,contentW.value-(size.value.w-KEYS))))
 scrollY.value=Math.max(0,Math.min(scrollY.value,Math.max(0,contentH.value-(size.value.h-RULER))))
}
const tickAt=x=>(x-KEYS+scrollX.value)/zoomX.value
const pitchAt=y=>127-Math.floor((y-RULER+scrollY.value)/rowH.value)
const xOf=tick=>KEYS+tick*zoomX.value-scrollX.value
const yOf=pitch=>RULER+(127-pitch)*rowH.value-scrollY.value
function noteAt(x,y){
 const tick=tickAt(x),pitch=pitchAt(y)
 for(let index=notes.value.length-1;index>=0;index--){const note=notes.value[index];if(note.n===pitch&&tick>=note.t&&tick<note.t+note.d)return note}
 return null
}
function invalidate(){if(!frame)frame=requestAnimationFrame(draw)}
function color(index){return props.colors[index%props.colors.length]||'#5bbda5'}
function draw(){
 frame=0
 const element=canvas.value;if(!element)return
 const ratio=window.devicePixelRatio||1,{w,h}=size.value
 if(element.width!==Math.round(w*ratio)||element.height!==Math.round(h*ratio)){element.width=Math.round(w*ratio);element.height=Math.round(h*ratio)}
 const g=element.getContext('2d');g.setTransform(ratio,0,0,ratio,0,0)
 style||=getComputedStyle(host.value)
 const bg=style.getPropertyValue('--bg').trim()||'#171c21',panel=style.getPropertyValue('--panel').trim()||'#20252a',border=style.getPropertyValue('--border').trim()||'#41464d',muted=style.getPropertyValue('--muted').trim()||'#a7b2b9'
 g.fillStyle=bg;g.fillRect(0,0,w,h)
 const top=Math.max(0,127-Math.floor((h-RULER+scrollY.value)/rowH.value)-1),bottom=Math.min(127,127-Math.floor(scrollY.value/rowH.value)+1)
 // Linhas das notas: teclas pretas mais escuras, divisa forte em cada C.
 for(let pitch=top;pitch<=bottom;pitch++){
  const y=yOf(pitch)
  if(BLACK.has(pitch%12)){g.fillStyle='rgba(0,0,0,.22)';g.fillRect(KEYS,y,w-KEYS,rowH.value)}
  if(pitch%12===0){g.fillStyle=border;g.fillRect(KEYS,y+rowH.value-1,w-KEYS,1)}
 }
 const first=Math.max(0,Math.floor(tickAt(KEYS)/props.grid)*props.grid),last=Math.min(length.value,tickAt(w))
 const bar=SONG_PPQ*props.song.beatsPerBar
 for(let tick=first;tick<=last;tick+=props.grid){
  const x=Math.round(xOf(tick))+.5
  g.strokeStyle=tick%bar===0?muted:tick%SONG_PPQ===0?border:'rgba(255,255,255,.05)'
  g.globalAlpha=tick%bar===0?.55:1
  g.beginPath();g.moveTo(x,RULER);g.lineTo(x,h);g.stroke();g.globalAlpha=1
 }
 // Fim da música.
 const endX=xOf(length.value);if(endX<w){g.fillStyle='rgba(0,0,0,.45)';g.fillRect(endX,RULER,w-endX,h-RULER)}
 // Loop.
 const loop=props.song.loop
 if(loop){g.fillStyle='rgba(91,189,165,.06)';g.fillRect(xOf(loop.start),RULER,(loop.end-loop.start)*zoomX.value,h-RULER)}
 // Outras faixas, apagadas.
 props.song.tracks.forEach((track,index)=>{
  if(index===props.track)return
  g.fillStyle=color(index);g.globalAlpha=.22
  for(const note of track.notes){const x=xOf(note.t);if(x>w||x+note.d*zoomX.value<KEYS)continue;const y=yOf(note.n);if(y>h||y+rowH.value<RULER)continue;g.fillRect(x,y+1,Math.max(2,note.d*zoomX.value),rowH.value-2)}
  g.globalAlpha=1
 })
 // Faixa atual: opacidade pela velocity, contorno nas selecionadas.
 const own=color(props.track)
 for(const note of notes.value){
  const x=xOf(note.t),width=Math.max(3,note.d*zoomX.value);if(x>w||x+width<KEYS)continue
  const y=yOf(note.n);if(y>h||y+rowH.value<RULER)continue
  g.globalAlpha=.45+.55*note.v/127;g.fillStyle=own;g.fillRect(x,y+1,width,rowH.value-2);g.globalAlpha=1
  if(selection.value.has(note)){g.strokeStyle='#fff';g.lineWidth=1.5;g.strokeRect(x+.75,y+1.75,width-1.5,rowH.value-3.5);g.lineWidth=1}
  else{g.fillStyle='rgba(0,0,0,.35)';g.fillRect(x+width-2,y+1,2,rowH.value-2)}
  if(rowH.value>=11&&width>34){g.fillStyle='rgba(0,0,0,.75)';g.font='10px sans-serif';g.fillText(midiNoteName(note.n),x+3,y+rowH.value-3)}
 }
 if(drag?.mode==='box'){const b=drag.box;g.strokeStyle=own;g.setLineDash([4,3]);g.strokeRect(Math.min(b.x0,b.x1)+.5,Math.min(b.y0,b.y1)+.5,Math.abs(b.x1-b.x0),Math.abs(b.y1-b.y0));g.setLineDash([])}
 // Teclas do piano.
 for(let pitch=top;pitch<=bottom;pitch++){
  const y=yOf(pitch),black=BLACK.has(pitch%12)
  g.fillStyle=black?'#1b1e22':'#e8e8e8';g.fillRect(0,y,KEYS,rowH.value)
  g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,y+rowH.value-1,KEYS,1)
  if(hover.value===pitch){g.fillStyle='rgba(91,189,165,.55)';g.fillRect(0,y,KEYS,rowH.value)}
  if(pitch%12===0&&rowH.value>=9){g.fillStyle='#333';g.font='10px sans-serif';g.fillText(midiNoteName(pitch),KEYS-28,y+rowH.value-2)}
 }
 // Régua: compassos, loop, posição inicial.
 g.fillStyle=panel;g.fillRect(0,0,w,RULER);g.fillStyle=border;g.fillRect(0,RULER-1,w,1)
 if(loop){g.fillStyle='rgba(91,189,165,.35)';g.fillRect(Math.max(KEYS,xOf(loop.start)),RULER-7,Math.max(0,xOf(loop.end)-Math.max(KEYS,xOf(loop.start))),6)}
 g.fillStyle=muted;g.font='11px sans-serif'
 for(let tick=Math.floor(first/bar)*bar;tick<=last;tick+=bar){const x=xOf(tick);if(x>=KEYS-1)g.fillText(String(tick/bar+1),x+3,13)}
 const cx=xOf(props.cursor);if(cx>=KEYS){g.fillStyle='#f2d16b';g.beginPath();g.moveTo(cx-5,RULER-9);g.lineTo(cx+5,RULER-9);g.lineTo(cx,RULER-1);g.fill()}
 if(props.playing){const px=Math.round(xOf(props.playhead))+.5;if(px>=KEYS&&px<=w){g.strokeStyle='#f2d16b';g.beginPath();g.moveTo(px,0);g.lineTo(px,h);g.stroke()}}
 g.fillStyle=panel;g.fillRect(0,0,KEYS,RULER)
}
// ---- Edição ----
function pointer(event){const box=canvas.value.getBoundingClientRect();return {x:event.clientX-box.left,y:event.clientY-box.top}}
function onPointerDown(event){
 canvas.value.focus()
 emit('gesture',true)
 const {x,y}=pointer(event)
 if(y<RULER){
  if(x<KEYS)return
  const tick=Math.min(length.value-1,snapTick(tickAt(x),props.grid))
  if(event.shiftKey){drag={mode:'loop',from:tick};props.song.loop={start:tick,end:Math.min(length.value,tick+props.grid)}}
  else emit('cursor',Math.max(0,Math.floor(tickAt(x)/props.grid)*props.grid))
  canvas.value.setPointerCapture(event.pointerId);invalidate();return
 }
 if(x<KEYS){const pitch=pitchAt(y);emit('preview',pitch);drag={mode:'key',pitch};canvas.value.setPointerCapture(event.pointerId);return}
 const target=noteAt(x,y)
 if(event.button===2){if(target)remove([target]);drag={mode:'erase'};canvas.value.setPointerCapture(event.pointerId);return}
 if(event.button!==0)return
 canvas.value.setPointerCapture(event.pointerId)
 if(target){
  if(event.shiftKey||event.ctrlKey||event.metaKey){const next=new Set(selection.value);next.has(target)?next.delete(target):next.add(target);selection.value=next}
  else if(!selection.value.has(target))selection.value=new Set([target])
  const resize=xOf(target.t+target.d)-x<=EDGE
  drag={mode:resize?'resize':'move',x,y,target,origin:[...selection.value].map(note=>({note,t:note.t,n:note.n,d:note.d}))}
  emit('preview',target.n,target.v)
 }else if(event.shiftKey||event.ctrlKey||event.metaKey){
  drag={mode:'box',box:{x0:x,y0:y,x1:x,y1:y},base:new Set(selection.value)}
 }else{
  const t=Math.max(0,Math.min(length.value-props.grid,Math.floor(tickAt(x)/props.grid)*props.grid)),n=pitchAt(y)
  if(n<0||n>127)return
  const note={t,d:Math.min(lastLength,length.value-t),n,v:100}
  notes.value.push(note)
  const created=notes.value[notes.value.length-1]
  selection.value=new Set([created])
  drag={mode:'resize',x,y,target:created,created:true,origin:[{note:created,t:created.t,n:created.n,d:created.d}]}
  emit('preview',n,100)
 }
 invalidate()
}
function onPointerMove(event){
 const {x,y}=pointer(event)
 hover.value=x<KEYS&&y>=RULER?pitchAt(y):null
 if(!drag){canvas.value.style.cursor=(()=>{if(y<RULER)return 'pointer';const note=x>=KEYS&&noteAt(x,y);return note?(xOf(note.t+note.d)-x<=EDGE?'ew-resize':'grab'):'crosshair'})();invalidate();return}
 if(drag.mode==='loop'){const tick=snapTick(tickAt(x),props.grid);const start=Math.max(0,Math.min(drag.from,tick)),end=Math.min(length.value,Math.max(drag.from,tick)+(tick>=drag.from?0:0));props.song.loop={start,end:Math.max(start+props.grid,end)};invalidate();return}
 if(drag.mode==='key'){const pitch=pitchAt(y);if(pitch!==drag.pitch){emit('preview-end');drag.pitch=pitch;emit('preview',pitch)}return}
 if(drag.mode==='erase'){const note=x>=KEYS&&noteAt(x,y);if(note)remove([note]);return}
 if(drag.mode==='box'){
  drag.box.x1=x;drag.box.y1=y
  const t0=tickAt(Math.min(drag.box.x0,x)),t1=tickAt(Math.max(drag.box.x0,x)),p0=pitchAt(Math.max(drag.box.y0,y)),p1=pitchAt(Math.min(drag.box.y0,y))
  selection.value=new Set([...drag.base,...notes.value.filter(note=>note.t+note.d>t0&&note.t<t1&&note.n>=p0&&note.n<=p1)])
  invalidate();return
 }
 const deltaTick=(x-drag.x)/zoomX.value
 if(drag.mode==='resize'){
  for(const item of drag.origin)item.note.d=Math.max(1,Math.min(snapLength(item.d+deltaTick,props.grid),length.value-item.note.t))
 }else{
  const shift=Math.round(deltaTick/props.grid)*props.grid,rows=Math.round((drag.y-y)/rowH.value)
  const minT=Math.min(...drag.origin.map(item=>item.t)),maxEnd=Math.max(...drag.origin.map(item=>item.t+item.d))
  const dt=Math.max(-minT,Math.min(shift,length.value-maxEnd))
  const minN=Math.min(...drag.origin.map(item=>item.n)),maxN=Math.max(...drag.origin.map(item=>item.n))
  const dn=Math.max(-minN,Math.min(rows,127-maxN))
  if(drag.target&&drag.target.n!==drag.origin.find(item=>item.note===drag.target).n+dn){emit('preview-end');emit('preview',drag.origin.find(item=>item.note===drag.target).n+dn,drag.target.v)}
  for(const item of drag.origin){item.note.t=item.t+dt;item.note.n=item.n+dn}
 }
 invalidate()
}
function onPointerUp(event){
 emit('gesture',false)
 if(drag?.mode==='resize'&&drag.target)lastLength=drag.target.d
 if(drag&&drag.mode!=='box'&&drag.mode!=='loop'&&drag.mode!=='erase')emit('preview-end')
 drag=null
 if(canvas.value?.hasPointerCapture?.(event.pointerId))canvas.value.releasePointerCapture(event.pointerId)
 invalidate()
}
function remove(list){
 const doomed=new Set(list),track=props.song.tracks[props.track]
 track.notes=track.notes.filter(note=>!doomed.has(note))
 selection.value=new Set([...selection.value].filter(note=>!doomed.has(note)))
}
function onKeydown(event){
 const selected=[...selection.value]
 if((event.key==='Delete'||event.key==='Backspace')&&selected.length){event.preventDefault();remove(selected)}
 else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selection.value=new Set(notes.value)}
 else if(event.key==='Escape')selection.value=new Set()
 else if((event.key==='ArrowUp'||event.key==='ArrowDown')&&selected.length){
  event.preventDefault()
  const step=(event.key==='ArrowUp'?1:-1)*(event.shiftKey?12:1)
  if(selected.every(note=>note.n+step>=0&&note.n+step<=127))for(const note of selected)note.n+=step
 }else if((event.key==='ArrowLeft'||event.key==='ArrowRight')&&selected.length){
  event.preventDefault()
  const step=(event.key==='ArrowRight'?1:-1)*props.grid
  if(selected.every(note=>note.t+step>=0&&note.t+note.d+step<=length.value))for(const note of selected)note.t+=step
 }else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'&&selected.length){
  // Duplica a seleção logo depois dela.
  event.preventDefault()
  const start=Math.min(...selected.map(note=>note.t)),end=Math.max(...selected.map(note=>note.t+note.d)),span=end-start
  if(end+span<=length.value){const track=props.song.tracks[props.track];const copies=selected.map(note=>({...note,t:note.t+span}));track.notes.push(...copies);selection.value=new Set(track.notes.slice(-copies.length))}
 }else return
 invalidate()
}
function onWheel(event){
 event.preventDefault()
 if(event.ctrlKey||event.metaKey){
  const {x}=pointer(event),tick=tickAt(x)
  zoomX.value=Math.max(.25,Math.min(8,zoomX.value*(event.deltaY<0?1.15:1/1.15)))
  scrollX.value=tick*zoomX.value-(x-KEYS)
 }else if(event.altKey){rowH.value=Math.max(6,Math.min(24,rowH.value+(event.deltaY<0?1:-1)))}
 else if(event.shiftKey)scrollX.value+=event.deltaY||event.deltaX
 else{scrollY.value+=event.deltaY;scrollX.value+=event.deltaX}
 clampScroll();invalidate()
}
/** Mostra a região das notas (ou C4) na troca de faixa. */
function reveal(){
 const list=notes.value,center=list.length?Math.round(list.reduce((sum,note)=>sum+note.n,0)/list.length):60
 scrollY.value=(127-center)*rowH.value-(size.value.h-RULER)/2
 clampScroll();invalidate()
}
// Acompanha a reprodução: vira a página quando o cursor sai da tela.
watch(()=>props.playhead,tick=>{
 if(props.playing){const x=xOf(tick);if(x>size.value.w-40||x<KEYS){scrollX.value=Math.max(0,tick*zoomX.value-60);clampScroll()}}
 invalidate()
})
watch(()=>props.track,()=>{selection.value=new Set();nextTick(reveal)})
watch(()=>[props.song,props.grid,props.cursor,props.playing,props.colors],invalidate,{deep:true})
onMounted(()=>{
 observer=new ResizeObserver(([entry])=>{size.value={w:Math.max(200,entry.contentRect.width),h:Math.max(120,entry.contentRect.height)};clampScroll();invalidate()})
 observer.observe(host.value);reveal()
})
onBeforeUnmount(()=>{observer?.disconnect();cancelAnimationFrame(frame)})
defineExpose({reveal,selectAll:()=>{selection.value=new Set(notes.value);invalidate()}})
</script>
<template>
 <div ref="host" class="piano-roll">
  <canvas ref="canvas" tabindex="0" role="application" aria-roledescription="piano roll"
   :aria-label="'Piano roll da faixa '+(song.tracks[track]?.name||'')+': '+notes.length+' notas. Clique para criar, arraste para mover, Delete apaga, setas transpõem.'"
   @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="hover=null;invalidate()"
   @contextmenu.prevent @wheel="onWheel" @keydown="onKeydown"></canvas>
 </div>
</template>
<style scoped>
.piano-roll{position:relative;width:100%;height:100%;min-height:160px;overflow:hidden}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
canvas:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:-2px}
</style>
