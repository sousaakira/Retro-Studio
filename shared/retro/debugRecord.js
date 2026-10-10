// #56: reader of the diagnostic records the ROM writes to an emulator debug console.
/** One "RSD1 ..." line -> object, or null when the line is something else.
 * Fields the ROM could not measure are absent, never zero. */
export function parseDebugRecord(line){
 // The trailing " ;" is written last: without it the record was cut and is rejected whole.
 const match=String(line).match(/RSD1 b=(\S+) f=(\d+)((?: [a-z]+=\S+)*) ;\s*$/)
 if(!match)return null
 const record={build:match[1]==='-'?'':match[1],frame:Number(match[2])},integer=text=>/^-?\d+$/.test(text)?Number(text):NaN,seen=new Set()
 for(const pair of match[3].trim().split(' ').filter(Boolean)){
  const cut=pair.indexOf('='),key=pair.slice(0,cut),value=pair.slice(cut+1),parts=value.split(/[,:]/).map(integer)
  if(seen.has(key))return null
  seen.add(key)
  if(['cpu','fps','dma','vram','spr','st','an'].includes(key)&&parts.some(part=>part<0))return null
  if(key==='ct'){if(!/^[0-9A-F]{4}$/.test(value))return null;record.contacts=parseInt(value,16);continue}
  if(parts.some(Number.isNaN))return null
  if(key==='cpu'&&parts.length===1)record.cpu=parts[0]
  else if(key==='fps'&&parts.length===1)record.fps=parts[0]
  else if(key==='dma'&&parts.length===2)record.dma={queue:parts[0],bytes:parts[1]}
  else if(key==='vram'&&parts.length===3)record.vram={free:parts[0],largest:parts[1],total:parts[2]}
  else if(key==='spr'&&parts.length===2)record.sprites={engine:parts[0],hardware:parts[1]}
  else if(key==='st'&&parts.length===1)record.state=parts[0]
  else if(key==='an'&&parts.length===2)record.animation={id:parts[0],frame:parts[1]}
  else if(key==='x'&&parts.length===1)record.x=parts[0]
  else if(key==='y'&&parts.length===1)record.y=parts[0]
  else if(key==='vx'&&parts.length===1)record.velocityX=parts[0]/256
  else if(key==='vy'&&parts.length===1)record.velocityY=parts[0]/256
  else return null
 }
 return record
}
/** Records of one exported configuration. build is required: without it records of
 * different ROMs would be mixed. The identifier names the export, not each build. */
export function collectDebugRecords(text,build){
 if(typeof build!=='string'||!build)throw Error('A build identifier is required to collect debug records.')
 return String(text).split(/\r?\n/).map(parseDebugRecord).filter(record=>record&&record.build===build)
}
