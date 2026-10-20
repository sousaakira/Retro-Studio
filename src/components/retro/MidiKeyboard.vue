<script setup>
// #89: teclado de 25 teclas como o SMK-25 (C a C: 15 brancas, 10 pretas). As pretas ficam por cima,
// na divisa entre as brancas; a faixa acompanha o botão de oitava do teclado físico.
// Com o mouse: clicar toca (press/release); arrastar com o botão apertado troca de nota.
import {computed} from 'vue'
import {midiNoteName} from '../../../shared/retro/midi.js'
const props=defineProps({notes:{type:Object,default:()=>({})},keys:{type:Number,default:25},playable:Boolean})
const emit=defineEmits(['press','release'])
let held=null
function press(note,event){if(!props.playable)return;event.currentTarget.releasePointerCapture?.(event.pointerId);if(held!==null&&held!==note)emit('release',held);held=note;emit('press',note,Math.round(40+87*Math.min(1,Math.max(0,event.offsetY/event.currentTarget.clientHeight))))}
function enter(note,event){if(held!==null&&event.buttons&1)press(note,event)}
function release(){if(held!==null){emit('release',held);held=null}}
const sharps=new Set([1,3,6,8,10])
const base=computed(()=>{
 const notes=Object.keys(props.notes).map(Number)
 if(!notes.length)return 48
 const low=Math.min(...notes),high=Math.max(...notes)
 return low>=48&&high<48+props.keys?48:Math.floor(low/12)*12
})
const layout=computed(()=>{
 const whites=[],blacks=[]
 for(let index=0;index<props.keys;index++){
  const note=base.value+index,key={note,name:midiNoteName(note),velocity:props.notes[note]}
  if(sharps.has(note%12))blacks.push({...key,at:whites.length})
  else whites.push(key)
 }
 return {whites,blacks,width:100/whites.length}
})
const pressed=computed(()=>Object.entries(props.notes).map(([note,velocity])=>midiNoteName(+note)+' ('+velocity+')').join(', '))
</script>
<template>
 <div class="midi-keyboard" :class="{playable}" role="img" @pointerup="release" @pointerleave="release" @pointercancel="release" :aria-label="pressed ? 'Teclas pressionadas: '+pressed : 'Teclado de '+midiNoteName(base)+' a '+midiNoteName(base+keys-1)+', nenhuma tecla pressionada'">
  <span v-for="key in layout.whites" :key="key.note" :class="['white',{down:key.velocity!==undefined}]" :style="key.velocity!==undefined ? {'--velocity':key.velocity/127} : null" :title="key.name" @pointerdown.prevent="press(key.note,$event)" @pointerenter="enter(key.note,$event)"><small v-if="key.note%12===0">{{ key.name }}</small></span>
  <span v-for="key in layout.blacks" :key="key.note" :class="['black',{down:key.velocity!==undefined}]" :style="{left:key.at*layout.width+'%',width:layout.width*.62+'%',...(key.velocity!==undefined ? {'--velocity':key.velocity/127} : {})}" :title="key.name" @pointerdown.prevent="press(key.note,$event)" @pointerenter="enter(key.note,$event)"></span>
 </div>
</template>
<style scoped>
.midi-keyboard{position:relative;display:flex;height:100%;min-height:72px;user-select:none}
.white{flex:1;display:flex;align-items:flex-end;justify-content:center;background:#ececec;border:1px solid #2a2e33;border-left-width:0;border-radius:0 0 4px 4px}
.white:first-child{border-left-width:1px}
.playable .white,.playable .black{cursor:pointer}
.white small{color:#555;font-size:10px;padding-bottom:4px}
.black{position:absolute;top:0;height:62%;transform:translateX(-50%);background:#1b1e22;border:1px solid #000;border-radius:0 0 3px 3px;z-index:1}
.white.down{background:color-mix(in srgb,var(--accent,#5bbda5) calc(35% + var(--velocity,1) * 65%),#ececec)}
.black.down{background:color-mix(in srgb,var(--accent,#5bbda5) calc(35% + var(--velocity,1) * 65%),#1b1e22)}
@media(prefers-reduced-motion:no-preference){.white,.black{transition:background-color .06s ease-out}}
</style>
