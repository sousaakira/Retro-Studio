// #89: AudioWorklet do compositor — YM2612 + PSG emulados, recebendo escritas de registrador.
// Dois pares de chips: 0 toca a música (escritas agendadas no tempo do AudioContext, precisas à
// amostra) e 1 toca o teclado ao vivo, para gravar por cima sem as vozes disputarem canais.
// O FM roda na taxa nativa (clock/144 ≈ 53 kHz) e é reamostrado com interpolação linear.
import {Ym2612} from '../../shared/retro/ym2612.js'
import {Sn76489} from '../../shared/retro/sn76489.js'

// Mistura aproximada do Mega Drive: PSG um pouco abaixo de um canal FM.
const FM_GAIN=.22,PSG_GAIN=.2

function createChips(){return {fm:new Ym2612(),psg:new Sn76489(),position:0,previous:[0,0],current:[0,0],queue:[]}}
function apply(chips,writes){
 for(const write of writes){
  if(write[0]===0)chips.fm.write(write[1],write[2],write[3])
  else chips.psg.write(write[1])
 }
}

class RetroChipProcessor extends AudioWorkletProcessor{
 constructor(){
  super()
  this.chips=[createChips(),createChips()]
  this.ratio=this.chips[0].fm.sampleRate/sampleRate
  this.reported=0
  this.port.onmessage=({data})=>{
   const chips=this.chips[data?.chip===0?0:1]
   if(data?.clear){chips.queue=[];chips.fm.reset();chips.psg.reset()}
   if(!Array.isArray(data?.writes))return
   if(typeof data.at!=='number'){apply(chips,data.writes);return}
   const frame=Math.round(data.at*sampleRate),queue=chips.queue
   queue.push({frame,writes:data.writes})
   if(queue.length>1&&queue[queue.length-2].frame>frame)queue.sort((a,b)=>a.frame-b.frame)
  }
 }
 process(_inputs,outputs){
  const output=outputs[0],left=output[0],right=output[1]||output[0]
  for(let index=0;index<left.length;index++){
   let l=0,r=0
   for(const chips of this.chips){
    const queue=chips.queue
    while(queue.length&&queue[0].frame<=currentFrame+index)apply(chips,queue.shift().writes)
    chips.position+=this.ratio
    while(chips.position>=1){
     chips.position-=1
     chips.previous[0]=chips.current[0];chips.previous[1]=chips.current[1]
     chips.fm.step()
     chips.current[0]=chips.fm.left;chips.current[1]=chips.fm.right
    }
    const t=chips.position,psg=chips.psg.sample(sampleRate)*PSG_GAIN
    l+=(chips.previous[0]+(chips.current[0]-chips.previous[0])*t)*FM_GAIN+psg
    r+=(chips.previous[1]+(chips.current[1]-chips.previous[1])*t)*FM_GAIN+psg
   }
   left[index]=l;right[index]=r
  }
  // Canais FM ocupados para a interface, ~15 vezes por segundo.
  if(currentFrame-this.reported>sampleRate/15){
   this.reported=currentFrame
   this.port.postMessage({song:this.chips[0].fm.activeChannels(),live:this.chips[1].fm.activeChannels()})
  }
  return true
 }
}
registerProcessor('retro-chip',RetroChipProcessor)
