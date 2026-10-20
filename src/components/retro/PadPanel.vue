<script setup>
// #89: os 8 pads na tela, iguais aos do teclado (2 fileiras de 4). Acendem com a força da batida, tocam
// com o mouse, e em "Configurar" cada pad escolhe instrumento e nota; "Aprender" lê a nota de cada pad.
import {ref,computed} from 'vue'
import {useDrumPads} from '../../composables/useDrumPads.js'
import {PAD_ACTIONS} from '../../../shared/retro/drumPads.js'
import {midiNoteName} from '../../../shared/retro/midi.js'
const props=defineProps({instruments:{type:Array,default:()=>[]}})
const {pads,setPadMode,setPad,learnPads,cancelLearn,resetPads,pressPad,releasePad}=useDrumPads()
const configuring=ref(false)
const nameOf=id=>props.instruments.find(item=>item.id===id)?.name?.replace(/ \(ruído\)$/,'')||id
// Percussão primeiro; depois o resto do banco e os instrumentos da música.
const options=computed(()=>[...props.instruments].sort((a,b)=>(a.category==='Percussão'?0:1)-(b.category==='Percussão'?0:1)))
const label=index=>pads.mode==='controls'?PAD_ACTIONS[index][1]:nameOf(pads.kit[index].instrument)
let held=-1
function down(index,event){event.currentTarget.setPointerCapture?.(event.pointerId);held=index;pressPad(index,100)}
function up(){if(held>=0){releasePad(held);held=-1}}
</script>
<template>
 <section class="pad-panel" aria-labelledby="pads-title">
  <div class="head">
   <h3 id="pads-title">Pads</h3>
   <div class="modes" role="radiogroup" aria-label="Função dos pads">
    <button type="button" role="radio" :aria-checked="pads.mode==='drums'" @click="setPadMode('drums')">Bateria</button>
    <button type="button" role="radio" :aria-checked="pads.mode==='controls'" @click="setPadMode('controls')">Controles</button>
   </div>
   <button type="button" :aria-pressed="configuring" title="Instrumento e nota de cada pad" @click="configuring=!configuring">Configurar</button>
  </div>
  <div class="grid" role="group" :aria-label="pads.mode==='drums' ? 'Pads de bateria' : 'Pads de atalho'">
   <button v-for="index in 8" :key="index" type="button" class="pad" :class="{lit:pads.lit[index-1]!==undefined,learning:pads.learning===index-1}"
    :style="pads.lit[index-1]!==undefined ? {'--velocity':pads.lit[index-1]/127} : null"
    :title="(pads.mode==='drums' ? 'Pad '+index+': '+label(index-1)+' ('+midiNoteName(pads.kit[index-1].note)+')' : 'Pad '+index+': '+label(index-1))+' · nota MIDI '+pads.notes[index-1]"
    @pointerdown.prevent="down(index-1,$event)" @pointerup="up" @pointercancel="up" @keydown.enter.prevent="pressPad(index-1,100)" @keyup.enter="releasePad(index-1)">
    <span class="number">{{ index }}</span><span class="name">{{ label(index-1) }}</span>
   </button>
  </div>
  <p v-if="pads.learning>=0" role="status" class="help">Bata no pad {{ pads.learning+1 }} do teclado… <button type="button" @click="cancelLearn">Cancelar</button></p>
  <div v-if="configuring" class="config">
   <template v-if="pads.mode==='drums'">
    <div v-for="(pad,index) in pads.kit" :key="index" class="pad-config">
     <span>{{ index+1 }}</span>
     <select :value="pad.instrument" :aria-label="'Instrumento do pad '+(index+1)" @change="setPad(index,{instrument:$event.target.value})">
      <option v-for="item in options" :key="item.id" :value="item.id">{{ item.name }}</option>
     </select>
     <input type="number" min="0" max="127" :value="pad.note" :aria-label="'Nota do pad '+(index+1)" :title="midiNoteName(pad.note)" @change="setPad(index,{note:Math.max(0,Math.min(127,Math.round(+$event.target.value)||0))})" />
    </div>
    <p class="help">O ruído do PSG é um só: caixa, chimbal, prato e palmas cortam um ao outro, como no Mega Drive. Bumbo e toms são FM.</p>
   </template>
   <p v-else class="help">Atalhos: {{ PAD_ACTIONS.map(([,name],index)=>(index+1)+' '+name).join(' · ') }}.</p>
   <div class="config-tools"><button type="button" title="Toque os pads em ordem, do 1 ao 8" @click="learnPads">Aprender pads</button><button type="button" @click="resetPads">Restaurar padrão</button></div>
  </div>
 </section>
</template>
<style scoped>
.pad-panel{position:relative;display:flex;flex-direction:column;gap:6px;min-width:250px}
.head{display:flex;align-items:center;gap:6px}h3{margin:0;font-size:12px;flex:1}
.modes{display:flex}.modes button{border-radius:0}.modes button:first-child{border-radius:3px 0 0 3px}.modes button:last-child{border-radius:0 3px 3px 0;border-left:0}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.pad{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;height:34px;padding:3px 5px;text-align:left;border-radius:4px;background:color-mix(in srgb,var(--bg,#171c21) 80%,#888 20%);overflow:hidden;user-select:none;touch-action:none}
.pad .number{position:absolute;top:2px;right:4px;font-size:9px;color:var(--muted,#a7b2b9)}
.pad .name{font-size:10px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pad.lit{border-color:var(--accent,#5bbda5);background:color-mix(in srgb,var(--accent,#5bbda5) calc(30% + var(--velocity,1) * 60%),var(--bg,#171c21))}
.pad.learning{outline:2px dashed #f2d16b;outline-offset:1px}
.config{position:absolute;z-index:5;left:0;bottom:calc(100% + 8px);width:min(320px,80vw);display:flex;flex-direction:column;gap:4px;padding:8px;background:var(--panel,#20252a);border:1px solid var(--border,#41464d);border-radius:4px;box-shadow:0 8px 24px #0008;max-height:60vh;overflow:auto}
.pad-config{display:grid;grid-template-columns:14px minmax(0,1fr) 52px;gap:4px;align-items:center}
.config-tools{display:flex;gap:4px;flex-wrap:wrap}
small,.help{color:var(--muted,#a7b2b9)}.help{margin:0;font-size:11px;line-height:1.4}
button,input,select{box-sizing:border-box;font:inherit;font-size:11px;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:3px 6px;min-width:0}
button{cursor:pointer}[aria-checked=true],[aria-pressed=true]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,input,select):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
@media(prefers-reduced-motion:no-preference){.pad{transition:background-color .05s ease-out}}
</style>
