// #63: derived header with map triggers and flag links; opt-in by exporting it once.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {parseCutsceneTriggers,unparsedCutsceneTriggers,inspectCutsceneAdapter,compileCutsceneAdapterHeader,cutsceneRoomNumber} from '../../shared/retro/cutsceneAdapter.js'
import {validateWorldConfiguration} from '../../shared/retro/worldConfiguration.js'
import {validateProgressConfiguration} from '../../shared/retro/progressConfiguration.js'
const HEADER='src/generated/cutscene_adapter.h',RECORD='.retrostudio/cutscene-adapter-export.json'
const CONFIG='cutscenes/cutscene-config.json',WORLD='world/world.json',PROGRESS='progress/progress.json',SINGLE='maps/map.tmx'
const LIMIT=2*1024*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
function bounded(root,name){
 const bytes=readProjectOutput(root,name)
 if(bytes&&bytes.length>LIMIT)throw Error('Cutscene adapter input exceeds 2 MiB: '+name)
 return bytes
}
function sceneIds(root){
 const ids=[];let entries=0
 const walk=(relative,depth)=>{
  const directory=path.join(root,relative)
  if(depth>16||!fs.existsSync(directory)||fs.lstatSync(directory).isSymbolicLink())return
  for(const item of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
   if(++entries>512)throw Error('Cutscene catalog exceeds 512 entries.')
   if(item.name.startsWith('.')||item.isSymbolicLink())continue
   if(item.isDirectory())walk(relative+'/'+item.name,depth+1)
   else if(item.isFile()&&item.name.endsWith('.cutscene.json')){
    const bytes=bounded(root,relative+'/'+item.name);let scene=null
    try{scene=bytes&&JSON.parse(bytes.toString('utf8'))}catch(error){throw Error(relative+'/'+item.name+': JSON inválido ('+error.message+').')}
    if(typeof scene?.id==='string'&&scene.id)ids.push(scene.id)
   }
  }
 }
 walk('cutscenes',0);return ids
}
// Everything the header is derived from; missing optional sources are simply absent.
function gather(root){
 const room_=(id,numericId,map,required)=>{
  const bytes=bounded(root,map),tmx=bytes===null?'':bytes.toString('utf8')
  return {id,numericId,map,missing:bytes===null,required,triggers:parseCutsceneTriggers(tmx),unparsed:unparsedCutsceneTriggers(tmx)}
 }
 const configBytes=bounded(root,CONFIG)
 if(configBytes===null)throw Error('O projeto não tem cutscenes/cutscene-config.json. Instale o runtime de cutscenes.')
 const config=JSON.parse(configBytes.toString('utf8')),ids=config.output?.ids||'src/cutscene_ids.h'
 if(typeof ids!=='string'||!/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.h$/.test(ids))throw Error('Cutscene output must be a header under src/.')
 const flags=(Array.isArray(config.flags)?config.flags:[]).map(flag=>String(flag?.id||'')).filter(Boolean)
 const worldBytes=bounded(root,WORLD),rooms=[]
 if(worldBytes!==null){
  for(const room of validateWorldConfiguration(JSON.parse(worldBytes.toString('utf8')),{allowEmpty:true}).rooms){
   rooms.push(room_(room.id,cutsceneRoomNumber(room.id),room.map,true))
  }
 }else{
  // Single-map project: the map the exporter is configured to read, not a fixed name.
  let single=SINGLE,configured=false
  try{
   const project=bounded(root,'retro-studio.json'),first=project&&JSON.parse(project.toString('utf8'))?.mapExport?.sourceMaps?.[0]
   if(typeof first==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}\.tmx$/.test(first)&&!first.split('/').includes('..')){single=first;configured=true}
  }catch{/* unreadable project file: fall back to the default map */}
  const row=room_('map',cutsceneRoomNumber(null),single,false)
  if(!row.missing||configured&&single!==SINGLE)rooms.push(row)
 }
 const progressBytes=bounded(root,PROGRESS)
 const progress=progressBytes===null?null:validateProgressConfiguration(JSON.parse(progressBytes.toString('utf8')))
 return {input:{rooms,scenes:sceneIds(root),flags,progress},idsInclude:path.posix.relative('src/generated',ids)}
}
function read(root){
 const header=bounded(root,HEADER),record=bounded(root,RECORD);let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||typeof ownership!=='object'||ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported cutscene adapter export record.')
 }
 return {header,record,ownership,revision:hash(Buffer.from(JSON.stringify([hash(header),hash(record)])))}
}
export function cutsceneAdapterStatus(root){
 const data=read(root);let report=null,error='',current=false
 try{
  const gathered=gather(root);report=inspectCutsceneAdapter(gathered.input)
  if(!report.errors)current=data.header!==null&&Buffer.from(compileCutsceneAdapterHeader(gathered.input,gathered.idsInclude)).equals(data.header)
 }catch(caught){error=caught.message}
 return {revision:data.revision,exported:data.ownership!==null,current,report,error,headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash}
}
export function saveCutsceneAdapter(root,{revision}={}){
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Cutscene adapter changed; reload before exporting.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated cutscene adapter header is customized or unmanaged; existing file preserved.')
 const gathered=gather(root),header=Buffer.from(compileCutsceneAdapterHeader(gathered.input,gathered.idsInclude))
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[{path:HEADER,bytes:header,expectedHash:hash(data.header)},{path:RECORD,bytes:record,expectedHash:hash(data.record)}],{producer:'cutscene-adapter'})
 return {...receipt,...cutsceneAdapterStatus(root)}
}
/** Opt-in preflight: projects that never exported the adapter header are untouched. */
export function validateCutsceneAdapterForBuild(root){
 const data=read(root)
 if(data.ownership===null)return {configured:false}
 if(data.header===null)throw Error('O header do adaptador de cutscenes sumiu. Use Exportar gatilhos e flags.')
 if(hash(data.header)!==data.ownership.hash)throw Error('O header do adaptador de cutscenes foi personalizado; revise-o antes do build. O arquivo foi preservado.')
 const gathered=gather(root)
 if(!Buffer.from(compileCutsceneAdapterHeader(gathered.input,gathered.idsInclude)).equals(data.header))throw Error('Gatilhos, cenas, flags ou progresso mudaram. Use Exportar gatilhos e flags antes do build.')
 return {configured:true,revision:data.revision,rooms:gathered.input.rooms.filter(room=>room.triggers.length).length}
}
