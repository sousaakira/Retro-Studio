// #60: versioned progress layout (flags, checkpoint, game fields) and optional SRAM.
export const PROGRESS_LIMITS=Object.freeze({flags:256,data:64,slots:8,history:16,copyBytes:128,slotBytes:256,headerBytes:18})
export const PROGRESS_SRAM_SIZES=Object.freeze([512,1024,2048,4096,8192,16384,32768])
const identifier=/^[a-z][a-z0-9_]{0,31}$/
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid progress '+label+'.');return value}
const name=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>128)throw Error('Invalid progress '+label+' name.')}
export function createProgressConfiguration(){
 return {format:'retro-studio.progress',version:1,schema:1,flagCapacity:32,dataSize:16,flags:[],fields:[],
  sram:{enabled:false,slots:1,offset:0,size:8192},history:[]}
}
function layout(value,label){
 integer(value.schema,1,65535,label+' schema');integer(value.flagCapacity,0,PROGRESS_LIMITS.flags,label+' flag capacity')
 if(value.flagCapacity%8)throw Error('Progress '+label+' flag capacity must be a multiple of 8.')
 integer(value.dataSize,0,PROGRESS_LIMITS.data,label+' data size')
}
export function validateProgressConfiguration(value){
 if(!value||typeof value!=='object'||value.format!=='retro-studio.progress'||value.version!==1)throw Error('Unsupported progress configuration.')
 layout(value,'current')
 if(!Array.isArray(value.flags)||value.flags.length>value.flagCapacity)throw Error('Progress flags exceed the reserved capacity.')
 const ids=new Set(),bits=new Set()
 for(const flag of value.flags){
  if(!flag||typeof flag.id!=='string'||!identifier.test(flag.id)||ids.has(flag.id))throw Error('Invalid or duplicate progress flag ID.')
  ids.add(flag.id);name(flag.name,'flag');integer(flag.bit,0,value.flagCapacity-1,'flag bit')
  if(bits.has(flag.bit))throw Error('Progress flag bit used twice: '+flag.bit);bits.add(flag.bit)
 }
 if(!Array.isArray(value.fields)||value.fields.length>PROGRESS_LIMITS.data)throw Error('Invalid progress fields.')
 const fields=new Set(),used=new Set()
 for(const field of value.fields){
  if(!field||typeof field.id!=='string'||!identifier.test(field.id)||fields.has(field.id))throw Error('Invalid or duplicate progress field ID.')
  fields.add(field.id);name(field.name,'field')
  if(![1,2,4].includes(field.bytes))throw Error('Progress field size must be 1, 2 or 4 bytes: '+field.id)
  integer(field.offset,0,PROGRESS_LIMITS.data,'field offset')
  if(field.offset+field.bytes>value.dataSize)throw Error('Progress field exceeds the reserved data: '+field.id)
  for(let i=0;i<field.bytes;i++){if(used.has(field.offset+i))throw Error('Progress fields overlap: '+field.id);used.add(field.offset+i)}
 }
 const sram=value.sram
 if(!sram||typeof sram!=='object'||typeof sram.enabled!=='boolean')throw Error('Invalid progress SRAM settings.')
 integer(sram.slots,1,PROGRESS_LIMITS.slots,'SRAM slots')
 if(!PROGRESS_SRAM_SIZES.includes(sram.size))throw Error('Invalid progress SRAM size.')
 integer(sram.offset,0,sram.size,'SRAM offset')
 if(sram.enabled&&sram.offset+sram.slots*PROGRESS_LIMITS.slotBytes>sram.size)throw Error('Progress slots do not fit in the SRAM.')
 if(!Array.isArray(value.history)||value.history.length>PROGRESS_LIMITS.history)throw Error('Invalid progress history.')
 const schemas=new Set()
 for(const item of value.history){
  if(!item||typeof item!=='object')throw Error('Invalid progress history.')
  layout(item,'history')
  if(item.schema>=value.schema||schemas.has(item.schema))throw Error('Progress history must list older, distinct schemas.')
  schemas.add(item.schema)
 }
 return value
}
/** Bytes the game spends: RAM instance, stack while saving/loading and SRAM.
 * stack: retroProgressLoad measured with m68k-elf-gcc 13.1 -O2 -fstack-usage. */
export function progressMemory(value){
 const record=PROGRESS_LIMITS.headerBytes+value.flagCapacity/8+value.dataSize+2
 return {record,ram:4+PROGRESS_LIMITS.flags/8+PROGRESS_LIMITS.data,stack:448,
  sram:value.sram.enabled?value.sram.slots*PROGRESS_LIMITS.slotBytes:0,
  firstByte:value.sram.offset,lastByte:value.sram.offset+value.sram.slots*PROGRESS_LIMITS.slotBytes-1}
}
/** Meaning of stored bits/bytes may only change together with the schema number. */
export function progressCompatibility(previous,next,{allowDroppedSchemas=false,allowMovedSlots=false}={}){
 if(!previous)return
 // Slot addresses do not depend on the schema: moving them remaps or hides every existing save.
 if(!allowMovedSlots&&previous.sram.enabled&&next.sram.enabled){
  if(next.sram.offset!==previous.sram.offset)throw Error('Progress SRAM offset changed; existing saves would be misread.')
  if(next.sram.slots<previous.sram.slots)throw Error('Progress slots were removed; their saves would be lost.')
 }
 if(next.schema<previous.schema)throw Error('Progress schema cannot go back.')
 if(next.schema===previous.schema){
  if(next.flagCapacity!==previous.flagCapacity||next.dataSize!==previous.dataSize)throw Error('Progress layout changed; create a new schema version.')
  for(const flag of next.flags){const old=previous.flags.find(item=>item.id===flag.id);if(old&&old.bit!==flag.bit)throw Error('Progress flag moved without a new schema: '+flag.id)}
  for(const field of next.fields){const old=previous.fields.find(item=>item.id===field.id);if(old&&(old.offset!==field.offset||old.bytes!==field.bytes))throw Error('Progress field moved without a new schema: '+field.id)}
 }
 if(allowDroppedSchemas)return
 const kept=item=>next.history.some(entry=>entry.schema===item.schema&&entry.flagCapacity===item.flagCapacity&&entry.dataSize===item.dataSize)
 if(next.schema!==previous.schema&&!kept(previous))throw Error('Previous progress schema is missing from the history.')
 for(const item of previous.history)if(!kept(item))throw Error('Progress history lost schema '+item.schema+'.')
}
const sorted=(items,key)=>[...items].sort((a,b)=>a[key]-b[key])
export function compileProgressHeader(value){
 validateProgressConfiguration(value)
 const sram=value.sram,row=item=>'{'+[item.schema,item.flagCapacity,item.dataSize].join(',')+'}',history=sorted(value.history,'schema')
 const lines=['/* Generated: progress layout. Flags are bits, fields are big-endian bytes inside data. */',
  '#ifndef RETRO_PROJECT_PROGRESS_CONFIG_H','#define RETRO_PROJECT_PROGRESS_CONFIG_H','#include "../retro_runtime/retro_progress.h"',
  '#define RETRO_PROJECT_PROGRESS_SCHEMA '+value.schema,
  sram.enabled?'/* Cartridge: 8-bit SRAM on odd bytes, 0x200001-0x'+(0x200001+sram.size*2-2).toString(16).toUpperCase()+'; ROM header "RA", 0xF820. */'
   :'/* Persistence disabled: progress lives in RAM only. */',
  '#define RETRO_PROJECT_PROGRESS_SRAM_BYTES '+(sram.enabled?sram.size:0),
  '#define RETRO_PROJECT_PROGRESS_SLOTS '+(sram.enabled?sram.slots:0)]
 for(const flag of sorted(value.flags,'bit'))lines.push('#define RETRO_PROJECT_PROGRESS_FLAG_'+flag.id.toUpperCase()+' '+flag.bit)
 for(const field of sorted(value.fields,'offset')){
  const symbol='RETRO_PROJECT_PROGRESS_FIELD_'+field.id.toUpperCase()
  lines.push('#define '+symbol+'_OFFSET '+field.offset,'#define '+symbol+'_BYTES '+field.bytes)
 }
 if(history.length)lines.push('static const RetroProgressLayout retroProjectProgressHistory[]={'+history.map(row).join(',')+'};')
 lines.push('static const RetroProgressConfig retroProjectProgress={'+[row(value),history.length?'retroProjectProgressHistory':0,
  history.length,sram.enabled?sram.slots:0,sram.offset].join(',')+'};','#endif','')
 return lines.join('\n')
}
