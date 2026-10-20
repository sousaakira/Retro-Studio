// #89: linha do tempo do compositor → VGM 1.50 (YM2612 + SN76489), o formato que o rescomp do SGDK
// converte para XGM. Um quadro = 735 amostras (44100/60). Com loop, o offset aponta para o quadro
// de início do loop e o tocador volta para lá no fim.
import {YM2612_CLOCK_NTSC} from './ym2612.js'
import {PSG_CLOCK_NTSC} from './sn76489.js'

export const VGM_RATE=44100
const FRAME=735,HEADER=0x40

function gd3(title,author){
 // 11 textos UTF-16LE: título, título (japonês), jogo, jogo (jp), sistema, sistema (jp), autor, autor (jp), data, quem converteu, notas.
 const fields=[title,'','','','Sega Mega Drive / Genesis','',author,'','','Retro Studio','']
 const text=Buffer.concat(fields.map(value=>Buffer.from(String(value||'').slice(0,256)+'\0','utf16le')))
 const head=Buffer.alloc(12);head.write('Gd3 ',0,'latin1');head.writeUInt32LE(0x100,4);head.writeUInt32LE(text.length,8)
 return Buffer.concat([head,text])
}

/** timeline: saída de songTimeline. Devolve os bytes do arquivo .vgm (Uint8Array). */
export function writeVgm(timeline,{title='',author=''}={}){
 const body=[]
 let position=0,loopOffset=null
 const wait=frames=>{
  let samples=frames*FRAME
  while(samples>0){
   if(samples===FRAME){body.push(0x62);samples=0}
   else{const chunk=Math.min(samples,0xffff);body.push(0x61,chunk&0xff,chunk>>8);samples-=chunk}
  }
 }
 for(const {frame,writes} of timeline.frames){
  if(frame>position){wait(frame-position);position=frame}
  if(frame===timeline.loopFrame)loopOffset=HEADER+body.length
  for(const write of writes){
   if(write[0]===0)body.push(write[1]?0x53:0x52,write[2],write[3])
   else body.push(0x50,write[1])
  }
 }
 if(timeline.loopFrame===0&&loopOffset===null)loopOffset=HEADER
 if(timeline.end>position)wait(timeline.end-position)
 body.push(0x66)
 const tag=gd3(title,author)
 const size=HEADER+body.length+tag.length
 const header=Buffer.alloc(HEADER)
 header.write('Vgm ',0,'latin1')
 header.writeUInt32LE(size-4,0x04)
 header.writeUInt32LE(0x150,0x08)
 header.writeUInt32LE(PSG_CLOCK_NTSC,0x0c)
 header.writeUInt32LE(HEADER+body.length-0x14,0x14)
 header.writeUInt32LE(timeline.end*FRAME,0x18)
 if(loopOffset!==null&&timeline.loopFrame!==null){
  header.writeUInt32LE(loopOffset-0x1c,0x1c)
  header.writeUInt32LE((timeline.end-timeline.loopFrame)*FRAME,0x20)
 }
 header.writeUInt32LE(60,0x24)
 header.writeUInt16LE(0x0009,0x28)  // taps do ruído do PSG do Mega Drive
 header.writeUInt8(16,0x2a)          // LFSR de 16 bits
 header.writeUInt32LE(YM2612_CLOCK_NTSC,0x2c)
 header.writeUInt32LE(HEADER-0x34,0x34)
 return new Uint8Array(Buffer.concat([header,Buffer.from(body),tag]))
}

/** Leitura mínima (para testes e para conferir um VGM): cabeçalho e comandos até 0x66. */
export function readVgm(bytes){
 const data=Buffer.from(bytes)
 if(data.toString('latin1',0,4)!=='Vgm ')throw Error('Not a VGM file.')
 const version=data.readUInt32LE(8),start=version>=0x150?0x34+data.readUInt32LE(0x34):0x40
 const loopRelative=data.readUInt32LE(0x1c)
 const result={version,psgClock:data.readUInt32LE(0x0c),ymClock:data.readUInt32LE(0x2c),samples:data.readUInt32LE(0x18),
  loopOffset:loopRelative?0x1c+loopRelative:null,loopSamples:data.readUInt32LE(0x20),commands:[]}
 let index=start,time=0
 while(index<data.length){
  const command=data[index]
  if(index===result.loopOffset)result.loopTime=time
  if(command===0x66)break
  if(command===0x52||command===0x53){result.commands.push({time,chip:'fm',port:command-0x52,address:data[index+1],data:data[index+2]});index+=3}
  else if(command===0x50){result.commands.push({time,chip:'psg',data:data[index+1]});index+=2}
  else if(command===0x61){time+=data.readUInt16LE(index+1);index+=3}
  else if(command===0x62){time+=735;index++}
  else if(command===0x63){time+=882;index++}
  else if(command>=0x70&&command<=0x7f){time+=(command&15)+1;index++}
  else throw Error('Unsupported VGM command 0x'+command.toString(16)+' at '+index)
 }
 result.duration=time
 return result
}
