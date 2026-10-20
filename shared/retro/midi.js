// #89: MIDI input shared by the BLE (Web Bluetooth) and Web MIDI sources. Pure: no browser APIs.
export const BLE_MIDI_SERVICE='03b80e5a-ede8-4b33-a751-6ce34ec4c700'
export const BLE_MIDI_CHARACTERISTIC='7772e5db-3868-4112-a1a9-f2669d106bf3'
export const MIDI_SYSEX_LIMIT=4096
// Data bytes after each status; system messages are keyed by their full byte.
const channelLength=[2,2,2,2,1,1,2],systemLength={0xf1:1,0xf2:2,0xf3:1,0xf6:0}
export function midiDataLength(status){
 if(status<0x80)return-1
 if(status<0xf0)return channelLength[(status>>4)-8]
 if(status>=0xf8)return 0
 return systemLength[status]??-1
}
/**
 * BLE-MIDI packets: header (timestamp high), then timestamp low + status + data, with running status,
 * real-time bytes in between and SysEx split across packets. Returns {timestamp, data}[] (ms, 13 bits).
 */
export function createBleMidiParser(){
 let running=0,sysex=null
 return function parse(packet){
  const bytes=packet instanceof Uint8Array?packet:new Uint8Array(packet?.buffer??packet??[])
  const out=[]
  if(bytes.length<2||!(bytes[0]&0x80)||bytes[0]&0x40)return out
  let base=(bytes[0]&0x3f)<<7,last=-1
  // A low timestamp smaller than the previous one means the high part advanced inside the packet.
  const stamp=byte=>{const low=byte&0x7f;if(low<last)base=(base+128)&0x1fff;last=low;timestamp=base|low}
  let timestamp=base,status=0,data=[],needed=-1,stamped=false
  const emit=message=>out.push({timestamp,data:message})
  for(let index=1;index<bytes.length;index++){
   const byte=bytes[index]
   if(sysex){
    if(!(byte&0x80)){if(sysex.length<MIDI_SYSEX_LIMIT)sysex.push(byte);continue}
    // Inside SysEx a high byte is a timestamp, followed by F7 (end) or a real-time byte.
    const next=bytes[index+1]
    if(next===0xf7){stamp(byte);sysex.push(0xf7);emit(sysex);sysex=null;index++;continue}
    if(next>=0xf8){stamp(byte);emit([next]);index++;continue}
    if(byte===0xf7){sysex.push(0xf7);emit(sysex);sysex=null;continue}
    sysex=null
   }
   if(byte&0x80){
    // Every status byte, real-time included, follows its own timestamp byte.
    if(!stamped){stamp(byte);stamped=true;continue}
    stamped=false
    // Real-time bytes may sit inside another message without breaking it.
    if(byte>=0xf8){emit([byte]);continue}
    if(byte===0xf0){sysex=[0xf0];running=0;continue}
    status=byte;needed=midiDataLength(byte);data=[]
    if(byte<0xf0)running=byte
    else running=0
    if(needed===0){emit([byte]);needed=-1}
    continue
   }
   stamped=false
   if(needed<0){
    if(!running)continue
    status=running;needed=midiDataLength(running);data=[]
   }
   data.push(byte)
   if(data.length===needed){emit([status,...data]);needed=-1;data=[]}
  }
  return out
 }
}
/** Turns raw MIDI bytes into an editor event; note-on with velocity 0 is a note-off. */
export function decodeMidiMessage(data){
 const [status,a=0,b=0]=data??[]
 if(!(status>=0x80))return null
 if(status>=0xf0){
  const names={0xf0:'sysex',0xf8:'clock',0xfa:'start',0xfb:'continue',0xfc:'stop',0xfe:'active-sensing',0xff:'reset'}
  return {type:names[status]??'system',status,...(status===0xf0?{data:[...data]}:{})}
 }
 const channel=status&0x0f
 switch(status>>4){
  case 0x8:return {type:'note-off',channel,note:a,velocity:b}
  case 0x9:return b?{type:'note-on',channel,note:a,velocity:b}:{type:'note-off',channel,note:a,velocity:0}
  case 0xa:return {type:'poly-pressure',channel,note:a,value:b}
  case 0xb:return {type:'control-change',channel,controller:a,value:b}
  case 0xc:return {type:'program-change',channel,program:a}
  case 0xd:return {type:'channel-pressure',channel,value:a}
  default:return {type:'pitch-bend',channel,value:((b<<7)|a)-8192}
 }
}
const noteNames=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
/** MIDI 60 = C4 (Yamaha/SGDK convention used across the editor). */
export const midiNoteName=note=>noteNames[note%12]+(Math.floor(note/12)-1)
/** A control binding learned from the keyboard: same channel + controller (or pitch bend) matches. */
export function midiBindingFor(event){
 if(event?.type==='control-change')return {type:'control-change',channel:event.channel,controller:event.controller}
 if(event?.type==='pitch-bend')return {type:'pitch-bend',channel:event.channel}
 return null
}
export const midiBindingMatches=(binding,event)=>!!binding&&event?.type===binding.type&&event.channel===binding.channel&&
 (binding.type!=='control-change'||event.controller===binding.controller)
/**
 * Teclados USB com várias portas repetem as mensagens (o SMK-25 manda cada nota pela porta Master e
 * pela Private, a segunda porta em blocos atrasados). Devolve accept(device, port, time, data): false para
 * a mesma mensagem do mesmo aparelho vinda de outra porta em até windowMs. A mesma porta nunca é
 * filtrada (notas repetidas valem), nem outro aparelho.
 */
export function createPortDeduper(windowMs=500){
 const recent=new Map()
 return function accept(device,port,time,data){
  const key=device+'|'+Array.from(data).join(',')
  const last=recent.get(key)
  if(last&&last.port!==port&&Math.abs(time-last.time)<windowMs)return false
  recent.set(key,{port,time})
  if(recent.size>256)recent.delete(recent.keys().next().value)
  return true
 }
}
