// #60: byte format of one stored progress copy, mirrored from retro_progress.c.
// Used to inspect SRAM images (emulator .srm files) and to build test images.
import {PROGRESS_LIMITS} from './progressConfiguration.js'
const HEADER=PROGRESS_LIMITS.headerBytes,COPY=PROGRESS_LIMITS.copyBytes
export function progressCrc(bytes){
 let value=0xFFFF
 for(const byte of bytes){
  value^=byte<<8
  for(let bit=0;bit<8;bit++)value=(value&0x8000?(value<<1)^0x1021:value<<1)&0xFFFF
 }
 return value
}
const get16=(b,i)=>(b[i]<<8)|b[i+1]
/** state: 'blank' (no signature), 'damaged' or 'valid'. */
export function decodeProgressCopy(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<COPY)throw Error('Progress copy needs '+COPY+' bytes.')
 if(bytes[0]!==0x52||bytes[1]!==0x50)return {state:'blank'}
 const schema=get16(bytes,4),flagCount=get16(bytes,6),dataSize=get16(bytes,8)
 if(bytes[2]!==1||bytes[3]||!schema||flagCount>PROGRESS_LIMITS.flags||dataSize>PROGRESS_LIMITS.data)return {state:'damaged'}
 const flagBytes=Math.ceil(flagCount/8),length=HEADER+flagBytes+dataSize
 if(progressCrc(bytes.subarray(0,length))!==get16(bytes,length))return {state:'damaged'}
 if(flagCount&7&&bytes[HEADER+(flagCount>>3)]>>(flagCount&7))return {state:'damaged'}
 return {state:'valid',schema,flagCount,dataSize,sequence:get16(bytes,10)*65536+get16(bytes,12),room:get16(bytes,14),checkpoint:get16(bytes,16),
  flags:bytes.slice(HEADER,HEADER+flagBytes),data:bytes.slice(HEADER+flagBytes,length)}
}
export function encodeProgressCopy({schema,flagCount,dataSize,sequence,room=0xFFFF,checkpoint=0xFFFF,flags=[],data=[]}){
 const out=new Uint8Array(COPY),flagBytes=Math.ceil(flagCount/8),length=HEADER+flagBytes+dataSize
 const put16=(i,v)=>{out[i]=v>>8;out[i+1]=v&255}
 out[0]=0x52;out[1]=0x50;out[2]=1;put16(4,schema);put16(6,flagCount);put16(8,dataSize)
 put16(10,Math.floor(sequence/65536));put16(12,sequence%65536);put16(14,room);put16(16,checkpoint)
 for(let i=0;i<flagBytes;i++)out[HEADER+i]=flags[i]||0
 for(let i=0;i<dataSize;i++)out[HEADER+flagBytes+i]=data[i]||0
 put16(length,progressCrc(out.subarray(0,length)));return out
}
/** Both copies of every slot of an SRAM image, as the runtime sees them. */
export function inspectProgressImage(image,{offset=0,slots=1}={}){
 const rows=[]
 for(let slot=0;slot<slots;slot++){
  const base=offset+slot*PROGRESS_LIMITS.slotBytes
  if(base+PROGRESS_LIMITS.slotBytes>image.length)throw Error('SRAM image is smaller than the configured slots.')
  rows.push([0,1].map(copy=>decodeProgressCopy(image.subarray(base+copy*COPY,base+(copy+1)*COPY))))
 }
 return rows
}
