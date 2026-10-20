// #89: música → escritas de registrador por quadro (60 Hz). A mesma linha do tempo toca no editor
// (agendada no AudioWorklet) e vira o VGM: o que se ouve é o que vai para a ROM.
import {createChipDriver} from './chipDriver.js'
import {PRESET_INSTRUMENTS} from './chipInstruments.js'
import {songLength,tickFrame} from './song.js'

export function resolveInstrument(song,id){
 return song.instruments?.find(item=>item.id===id)||PRESET_INSTRUMENTS.find(item=>item.id===id)||null
}
/**
 * from/to: trecho em ticks (padrão: a música toda). audition: respeita mudo/solo (só no editor).
 * loop: no início do trecho de loop o chip é zerado (notas soltas, patches recarregados) e no fim
 * todas as notas param, para o VGM voltar ao loop sempre no mesmo estado.
 * Devolve {frames:[{frame, writes}], end, loopFrame, missing} com quadros relativos a `from`.
 */
export function songTimeline(song,{from=0,to=songLength(song),audition=false,loop=song.loop}={}){
 const driver=createChipDriver({fmChannels:song.fmChannels})
 const soloing=audition&&song.tracks.some(track=>track.solo)
 const base=tickFrame(song,from),end=tickFrame(song,to)-base
 const loopFrame=loop&&loop.start>=from&&loop.start<to?tickFrame(song,loop.start)-base:null
 const events=[],missing=new Set()
 song.tracks.forEach((track,index)=>{
  if(audition&&(track.mute||(soloing&&!track.solo)))return
  const instrument=resolveInstrument(song,track.instrument)
  if(!instrument){missing.add(track.instrument);return}
  for(const note of track.notes){
   if(note.t<from||note.t>=to)continue
   const on=tickFrame(song,note.t)-base
   // Pelo menos um quadro de nota; e solta antes do fim do trecho.
   const off=Math.min(end,Math.max(on+1,tickFrame(song,note.t+note.d)-base))
   if(on>=end)continue
   events.push({frame:on,kind:1,instrument,note:note.n,velocity:note.v,owner:index},{frame:off,kind:0,note:note.n,owner:index})
  }
 })
 // No mesmo quadro: solturas antes de ataques, para a nota repetida reatacar.
 events.sort((a,b)=>a.frame-b.frame||a.kind-b.kind)
 const frames=[{frame:0,writes:driver.take()}]
 let cursor=0
 for(let frame=0;frame<=end;frame++){
  if(frame===loopFrame&&frame>0){driver.allNotesOff();driver.invalidate()}
  if(frame>0)driver.tick()
  while(cursor<events.length&&events[cursor].frame===frame){
   const event=events[cursor++]
   if(event.kind)driver.noteOn(event.instrument,event.note,event.velocity,event.owner)
   else driver.noteOff(event.note,event.owner)
  }
  if(frame===end)driver.allNotesOff()
  const writes=driver.take()
  if(frame===0)frames[0].writes.push(...writes)
  else if(writes.length||frame===loopFrame)frames.push({frame,writes})
 }
 return {frames,end,loopFrame,missing:[...missing]}
}
