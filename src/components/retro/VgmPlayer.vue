<script setup>
// #103: barra do player de VGM para um arquivo do projeto. O som é o dos chips emulados do
// compositor: parecido com o Mega Drive, bom para reconhecer a música (não é idêntico ao console).
import {computed,onBeforeUnmount} from 'vue'
import {vgmPlayer,playVgm,pauseVgm,resumeVgm,seekVgm,stopVgm,stopVgmIf,setVgmVolume,projectVgm} from '../../audio/vgmPlayer.js'
import {formatSeconds} from '../../../shared/retro/vgmPlayback.js'
const props=defineProps({projectPath:{type:String,default:''},file:{type:String,default:''},name:{type:String,default:''},compact:Boolean,stopOnUnmount:{type:Boolean,default:true}})
const key=computed(()=>props.projectPath+'::'+props.file)
const mine=computed(()=>!!props.file&&vgmPlayer.key===key.value)
const status=computed(()=>mine.value?vgmPlayer.status:'idle')
const label=computed(()=>props.name||props.file.split(/[/\\]/).pop())
const loops=computed(()=>mine.value&&vgmPlayer.duration&&(vgmPlayer.loopStart||vgmPlayer.looped)?'loop a partir de '+formatSeconds(vgmPlayer.loopStart)+(vgmPlayer.looped?' (repetindo)':''):'')
const details=computed(()=>{const tags=mine.value?vgmPlayer.tags:{};return [tags.title,tags.game,tags.author].filter(Boolean).join(' · ')})
function play(){
 if(status.value==='playing')return void pauseVgm()
 if(status.value==='paused')return void resumeVgm()
 void playVgm({key:key.value,name:label.value,load:()=>projectVgm(props.projectPath,props.file)})
}
function seek(event){if(mine.value)void seekVgm(Number(event.target.value))}
onBeforeUnmount(()=>{if(props.stopOnUnmount)stopVgmIf(key.value)})
</script>
<template>
 <div class="vgm-player" :class="{compact}" role="group" :aria-label="'Player: '+label">
  <div class="row">
   <button type="button" class="play" :disabled="!file||status==='loading'" :aria-label="status==='playing'?'Pausar':'Tocar'" :title="status==='playing'?'Pausar':'Tocar o VGM'" @click="play">{{ status==='playing' ? '❚❚' : '▶' }}</button>
   <button type="button" :disabled="!mine||status==='idle'" aria-label="Parar" title="Parar" @click="stopVgm">■</button>
   <input class="position" type="range" min="0" :max="mine?vgmPlayer.duration||0:0" step="0.1" :value="mine?vgmPlayer.position:0" :disabled="!mine||!['playing','paused'].includes(status)" :aria-label="'Posição em '+label" @change="seek" />
   <span class="time">{{ mine ? formatSeconds(vgmPlayer.position) : '0:00' }} / {{ mine && vgmPlayer.duration ? formatSeconds(vgmPlayer.duration) : '–:––' }}</span>
   <input v-if="!compact" class="volume" type="range" min="0" max="1" step="0.05" :value="vgmPlayer.volume" aria-label="Volume" title="Volume" @input="setVgmVolume($event.target.value)" />
  </div>
  <p v-if="status==='loading'" class="help" role="status">Carregando…</p>
  <p v-else-if="status==='error'" class="help problem" role="status">{{ vgmPlayer.error }}</p>
  <p v-else-if="mine&&(details||loops)" class="help">{{ [details,loops].filter(Boolean).join(' · ') }}</p>
 </div>
</template>
<style scoped>
.vgm-player{display:grid;gap:4px;min-width:0}
.row{display:flex;align-items:center;gap:6px;min-width:0}
button{flex:0 0 auto;width:28px;height:26px;padding:0;font:inherit;font-size:11px;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.play{color:var(--accent,#5bbda5)}
.position{flex:1 1 auto;min-width:60px}
.volume{flex:0 0 70px;width:70px}
.time{flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:11px;color:var(--muted,#a7b2b9)}
.help{margin:0;font-size:11px;color:var(--muted,#a7b2b9);overflow-wrap:anywhere}
.problem{color:#f0b3a3}
</style>
