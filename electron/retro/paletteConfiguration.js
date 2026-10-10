// #57: project palettes -> managed header; games without palettes/palettes.json stay untouched.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {inspectCompiledResources} from './compiledResources.js'
import {PALETTE_FORMAT,createPaletteConfiguration,validatePaletteConfiguration,compilePaletteHeader,paletteCost} from '../../shared/retro/paletteConfiguration.js'
const SOURCE='palettes/palettes.json',HEADER='src/generated/palette_config.h',RECORD='.retrostudio/palette-export.json',RUNTIME='src/retro_runtime/retro_palette.h'
const LIMIT=256*1024,IMAGE_LIMIT=8*1024*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
// A palettes/ folder may belong to the game. A file there that is not ours means this
// feature is simply not in use; the file is never read as configuration nor rewritten.
function source(root){
 let bytes
 try{bytes=readProjectOutput(root,SOURCE)}catch{return {bytes:null,foreign:true}}
 if(bytes===null)return {bytes:null,foreign:false}
 let ours=false
 try{ours=bytes.length<=LIMIT&&JSON.parse(bytes.toString('utf8'))?.format===PALETTE_FORMAT}catch{ours=false}
 if(ours)return {bytes,foreign:false}
 // Unreadable, but this project already exported palettes from the IDE: it is OUR file,
 // damaged. Calling it foreign would let a build go on with the old header.
 let exported=false
 try{exported=readProjectOutput(root,RECORD)!==null}catch{exported=true}
 if(exported)throw Error('palettes/palettes.json está ilegível ou não é mais uma configuração de paletas da IDE. Restaure o arquivo (ou apague-o junto com src/generated/palette_config.h) antes de continuar.')
 return {bytes:null,foreign:true}
}
function read(root){
 const found=source(root),header=readProjectOutput(root,HEADER),record=readProjectOutput(root,RECORD)
 if([header,record].some(bytes=>bytes&&bytes.length>LIMIT))throw Error('Palette configuration exceeds 256 KiB.')
 const config=found.bytes===null?createPaletteConfiguration():JSON.parse(found.bytes.toString('utf8'))
 validatePaletteConfiguration(config)
 let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||typeof ownership!=='object'||ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported palette export record.')
 }
 const exported=found.bytes!==null&&header!==null&&hash(header)===ownership?.hash&&Buffer.from(compilePaletteHeader(config)).equals(header)
 return {config,source:found.bytes,foreign:found.foreign,header,record,ownership,exported,revision:hash(Buffer.from(JSON.stringify([hash(found.bytes),hash(header),hash(record)])))}
}
/** PNG images of the project that can be assigned to a palette (bounded, no links followed). */
function images(root){
 const found=[]
 const walk=(relative,depth)=>{
  const directory=path.join(root,relative)
  let entries
  try{if(fs.lstatSync(directory).isSymbolicLink())return;entries=fs.readdirSync(directory,{withFileTypes:true})}catch{return}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
   if(found.length>=512||entry.name.startsWith('.')||entry.isSymbolicLink())continue
   const name=relative+'/'+entry.name
   if(entry.isDirectory()){if(depth<6)walk(name,depth+1)}
   else if(entry.isFile()&&/\.png$/i.test(entry.name))found.push(name)
  }
 }
 walk('res',0)
 return found
}
/** Palettes inside the compiled game (last build), next to what the project assigns to them. */
function compiled(root,config){
 try{
  const report=inspectCompiledResources(root)
  const assigned=new Map(config.assignments.map(item=>[item.resource,item.palette]))
  const resources=report.resources.filter(item=>Array.isArray(item.facts?.paletteWords)).slice(0,128).map(item=>{
   const words=item.facts.paletteWords.slice(0,64).map(word=>word&0x0EEE),palette=assigned.has(item.origin)?assigned.get(item.origin):null
   // Compared from color 1: color 0 is the transparency and its stored value is never seen.
   const different=palette===null?null:words.slice(1,16).reduce((count,word,index)=>count+(word!==config.palettes[palette].colors[index+1]?1:0),0)
   return {symbol:item.symbol,kind:item.kind,origin:item.origin,words,palette,different}
  })
  return {built:!!report.elf,abi:report.abi,elf:report.elf?{path:report.elf.path,modifiedAt:report.elf.modifiedAt}:null,
   snapshot:report.buildSnapshot?.status||'not-recorded',resources,
   pending:report.resources.filter(item=>['not-built','unknown-abi'].includes(item.status)).length}
 }catch(error){return {built:false,abi:null,elf:null,snapshot:'unavailable',resources:[],pending:0,error:error.message}}
}
export function paletteConfigurationStatus(projectPath){
 const root=fs.realpathSync(projectPath),data=read(root)
 return {config:data.config,revision:data.revision,saved:data.source!==null,exported:data.exported,foreign:data.foreign,
  headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash,runtimeInstalled:readProjectOutput(root,RUNTIME)!==null,
  images:images(root),compiled:compiled(root,data.config),cost:paletteCost(data.config),files:{source:SOURCE,header:HEADER}}
}
export function savePaletteConfiguration(projectPath,{config,revision}={}){
 validatePaletteConfiguration(config)
 const root=fs.realpathSync(projectPath),data=read(root)
 if(data.foreign)throw Error('palettes/palettes.json belongs to another tool; it was preserved and palettes cannot be exported here.')
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Palette configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated palette header is customized or unmanaged; existing file preserved.')
 const bytes=Buffer.from(JSON.stringify(config,null,2)+'\n'),header=Buffer.from(compilePaletteHeader(config))
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[
  {path:SOURCE,bytes,expectedHash:hash(data.source)},{path:HEADER,bytes:header,expectedHash:hash(data.header)},{path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ],{producer:'palette-configuration'})
 return {...receipt,...paletteConfigurationStatus(root)}
}
/** Opt-in preflight: no palette source of ours means legacy/custom projects are untouched. */
export function validatePaletteForBuild(projectPath){
 const root=fs.realpathSync(projectPath)
 if(source(root).bytes===null)return {configured:false}
 const data=read(root)
 if(data.header===null||data.ownership===null)throw Error('As paletas ainda não foram exportadas. Use Salvar e exportar paletas.')
 if(hash(data.header)!==data.ownership.hash)throw Error('O header de paletas foi personalizado; revise-o (ou apague src/generated/palette_config.h e exporte de novo) antes do build. O arquivo foi preservado.')
 if(!data.exported)throw Error('As paletas mudaram. Use Salvar e exportar paletas antes do build.')
 return {configured:true,revision:data.revision}
}
/** Bytes of one project PNG for the editor (read only; the file is never modified here). */
export function readPaletteImage(projectPath,relative){
 const root=fs.realpathSync(projectPath)
 if(typeof relative!=='string'||!/\.png$/i.test(relative))throw Error('Only PNG images can be inspected.')
 // Size first: nothing larger than the limit is read into memory.
 const file=path.resolve(root,relative),inside=path.relative(root,file)
 if(inside.startsWith('..')||path.isAbsolute(inside))throw Error('Image outside the project.')
 let info
 try{info=fs.lstatSync(file)}catch{throw Error('Image not found: '+relative)}
 if(info.isFile()&&info.size>IMAGE_LIMIT)throw Error('Image exceeds 8 MiB.')
 const bytes=readProjectOutput(root,relative)
 if(bytes===null)throw Error('Image not found: '+relative)
 return {path:relative,size:bytes.length,hash:hash(bytes),dataUrl:'data:image/png;base64,'+bytes.toString('base64')}
}
