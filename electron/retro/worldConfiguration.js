// #55: graph source/header are managed; legacy TMX/room code stay untouched.
import {mapSpawnPoint} from '../../shared/retro/mapSpawn.js'
import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {createWorldConfiguration,validateWorldConfiguration,compileWorldHeader} from '../../shared/retro/worldConfiguration.js'
import {prepareWorldMapExport,validateWorldMapExportForBuild} from './worldMapExport.js'
const SOURCE='world/world.json',HEADER='src/generated/world_config.h',RECORD='.retrostudio/world-export.json'
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
function bounded(root,name,limit=1024*1024){
 // Check regular parents and file size before allocating/reading a buffer.
 if(typeof name!=='string'||/[\\\x00-\x1f]/.test(name)||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid world input path.')
 let target=fs.realpathSync(root);const parts=name.split('/')
 for(let i=0;i<parts.length;i++){
  target=path.join(target,parts[i]);let stat
  try{stat=fs.lstatSync(target)}catch(error){if(error.code==='ENOENT')return null;throw error}
  if(stat.isSymbolicLink()||(i<parts.length-1?!stat.isDirectory():!stat.isFile()))throw Error('World input must be a regular file with regular parents.')
  if(i===parts.length-1&&stat.size>limit)throw Error('World input exceeds limit: '+name)
 }
 const bytes=readProjectOutput(root,name);if(bytes&&bytes.length>limit)throw Error('World input exceeds limit: '+name);return bytes
}
function read(root){
 const source=bounded(root,SOURCE),header=bounded(root,HEADER,2*1024*1024),record=bounded(root,RECORD)
 const config=source===null?createWorldConfiguration():JSON.parse(source.toString('utf8'))
 validateWorldConfiguration(config,{allowEmpty:true})
 let ownership=null
 if(record!==null){ownership=JSON.parse(record.toString('utf8'));if(ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported world export record.')}
 return {config,source,header,record,ownership,revision:hash(Buffer.from(JSON.stringify([hash(source),hash(header),hash(record)])))}
}
/* Only root dimensions are consumed here; map content is validated by its exporter.
 * No XML entities, DTDs, infinite maps, or non-orthogonal projection are accepted. */
function dimensions(bytes){
 const xml=bytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('World map XML declarations are unsupported.')
 const clean=xml.replace(/<!--[\s\S]*?-->/g,'').replace(/^\s*<\?xml[^?]*\?>/,'').trim()
 const opening=clean.match(/^<map((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*>/)
 if(!opening||!/<\/map>\s*$/.test(clean))throw Error('Invalid world map root.')
 const attributes={};for(const match of opening[1].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)){
  if(Object.hasOwn(attributes,match[1]))throw Error('Duplicate world map attribute.');attributes[match[1]]=match[2]??match[3]
 }
 if((attributes.orientation&&attributes.orientation!=='orthogonal')||(attributes.infinite&&attributes.infinite!=='0'))throw Error('World requires finite orthogonal maps.')
 const values=['width','height','tilewidth','tileheight'].map(key=>{if(!/^\d+$/.test(attributes[key]||''))throw Error('Invalid world map dimension.');const n=Number(attributes[key]);if(!Number.isSafeInteger(n)||n<1||n>32767)throw Error('Invalid world map dimension.');return n})
 return {width:values[0]*values[2],height:values[1]*values[3]}
}
export function inspectWorldMaps(root,config){
 validateWorldConfiguration(config,{allowEmpty:true});const maps=new Map();let total=0
 for(const room of config.rooms){
  const existing=maps.get(room.map)
  const bytes=existing?.bytes??bounded(root,room.map,4*1024*1024)
  if(bytes===null)throw Error('Missing world map: '+room.map)
  if(!existing&&(total+=bytes.length)>28*1024*1024)throw Error('World map inputs exceed 28 MiB.')
  const size=dimensions(bytes)
  if(size.width!==room.width||size.height!==room.height)throw Error('World room dimensions disagree with map: '+room.id)
  maps.set(room.map,{path:room.map,bytes,hash:hash(bytes),...size})
 }
 return [...maps.values()]
}
/** Opt-in preflight: no world source means legacy/custom projects are untouched.
 * expected binds completion to the exact graph/header/maps observed pre-make.
 * This never exports, installs runtime, executes project code or scans a catalog. */
export function validateWorldForBuild(root,{expected}={}){
 const source=bounded(root,SOURCE)
 if(source===null){
  if(expected&&expected.configured)throw Error('O mundo foi removido durante a compilação. Execute o build novamente.')
  return {configured:false}
 }
 const data=read(root);validateWorldConfiguration(data.config)
 const maps=inspectWorldMaps(root,data.config),compiled=Buffer.from(compileWorldHeader(data.config))
 if(data.header===null||data.ownership===null)throw Error('O mundo ainda não foi exportado. Use Salvar e exportar mundo.')
 if(hash(data.header)!==data.ownership.hash)throw Error('O header do mundo foi personalizado; revise-o antes do build. O arquivo foi preservado.')
 if(!compiled.equals(data.header))throw Error('A configuração do mundo mudou. Use Salvar e exportar mundo antes do build.')
 const generation=validateWorldMapExportForBuild(root,data.config)
 const signature=hash(Buffer.from(JSON.stringify([data.revision,maps.map(({path,hash})=>({path,hash})).sort((a,b)=>a.path.localeCompare(b.path)),generation])))
 if(expected&&(!expected.configured||expected.signature!==signature))throw Error('O mundo ou seus mapas mudaram durante a compilação. Execute o build novamente.')
 return {configured:true,signature,roomCount:data.config.rooms.length,mapCount:maps.length,assetsConfigured:generation.configured}
}
// Bounded catalog, no symlink traversal. Every candidate is read through confinement.
export function worldMapCatalog(root){
 const maps=[],errors=[];let visited=0,truncated=false,totalBytes=0,stopped=false
 const canonical=fs.realpathSync(root)
 function walk(relative,depth){
  if(stopped)return
  if(depth>16){truncated=true;return}
  const directory=path.join(canonical,relative)
  let entries
  try{
   const stat=fs.lstatSync(directory)
   if(!stat.isDirectory()||stat.isSymbolicLink())return
   const real=fs.realpathSync(directory)
   if(!real.startsWith(canonical+path.sep))throw Error('World catalog directory escapes project.')
   entries=fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))
  }catch(error){if(error.code!=='ENOENT')errors.push({path:relative,error:error.message});return}
  for(const entry of entries){
   if(stopped)return
   if(++visited>4096||maps.length+errors.length>=256){truncated=true;stopped=true;return}
   const name=relative+'/'+entry.name
   if(entry.isSymbolicLink())continue
   if(entry.isDirectory()){walk(name,depth+1);continue}
   if(!entry.isFile()||!entry.name.endsWith('.tmx'))continue
   try{
    const sizeOnDisk=fs.lstatSync(path.join(canonical,name)).size
    if(sizeOnDisk>4*1024*1024)throw Error('World input exceeds limit: '+name)
    if(totalBytes+sizeOnDisk>32*1024*1024){truncated=true;stopped=true;return}
    totalBytes+=sizeOnDisk
    const bytes=bounded(canonical,name,4*1024*1024),size=dimensions(bytes)
    if(size.width>32767||size.height>32767)throw Error('World map exceeds 32767 pixels.')
    // spawn: o ponto de início desenhado no mapa, para o editor de salas oferecer como entrada.
    const point=mapSpawnPoint(bytes.toString('utf8'))
    maps.push({path:name,...size,spawn:point&&point.x<size.width&&point.y<=size.height?point:null})
   }catch(error){errors.push({path:name,error:error.message})}
  }
 }
 walk('maps',0)
 return {maps,errors,truncated}
}
export function worldConfigurationStatus(root){
 const data=read(root);let mapError='',assetsError=''
 try{inspectWorldMaps(root,data.config)}catch(error){mapError=error.message}
 try{validateWorldMapExportForBuild(root,data.config)}catch(error){assetsError=error.message}
 return {config:data.config,revision:data.revision,headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash,mapError,assetsError,catalog:worldMapCatalog(root)}
}
function worldPublication(root,{config,revision}={}){
 validateWorldConfiguration(config);const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('World configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated world header is customized or unmanaged; preserved.')
 const maps=inspectWorldMaps(root,config),source=Buffer.from(JSON.stringify(config,null,2)+'\n'),header=Buffer.from(compileWorldHeader(config))
 if(source.length>1024*1024||header.length>2*1024*1024)throw Error('World export exceeds size limit.')
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header),maps:maps.map(({path,hash,width,height})=>({path,hash,width,height}))},null,2)+'\n')
 return {maps,outputs:[{path:SOURCE,bytes:source,expectedHash:hash(data.source)},{path:HEADER,bytes:header,expectedHash:hash(data.header)},{path:RECORD,bytes:record,expectedHash:hash(data.record)},
  ...maps.map(map=>({path:map.path,bytes:map.bytes,expectedHash:map.hash}))]}
}
export function saveWorldConfiguration(root,{config,revision,beforePublish}={}){
 const {maps,outputs}=worldPublication(root,{config,revision})
 const result=publishProjectOutputs(root,outputs,{producer:'world-configuration',beforePublish:(index,target)=>{
  beforePublish?.(index,target)
  for(const map of maps)if(hash(bounded(root,map.path,4*1024*1024))!==map.hash)throw Error('World map changed during export: '+map.path)
 }})
 return {...result,...worldConfigurationStatus(root)}
}
export async function saveWorldConfigurationWithMaps(root,{config,revision,beforePublish,runCompiler}={}){
 root=fs.realpathSync(root)
 config=JSON.parse(JSON.stringify(config))
 const plan=worldPublication(root,{config,revision})
 const maps=await prepareWorldMapExport(root,config,{runCompiler})
 const result=publishProjectOutputs(root,[...plan.outputs,...maps.outputs],{producer:'world-map-export',beforePublish:(index,target)=>{
  beforePublish?.(index,target);maps.guard()
  for(const map of plan.maps)if(hash(bounded(root,map.path,4*1024*1024))!==map.hash)throw Error('World map changed during export: '+map.path)
 }})
 return {...result,...worldConfigurationStatus(root),mapsExported:maps.roomCount}
}
