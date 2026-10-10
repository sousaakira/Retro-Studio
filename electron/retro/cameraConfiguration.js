// #59: camera source/header are managed; games without camera/camera.json stay untouched.
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {createCameraConfiguration,validateCameraConfiguration,compileCameraHeader} from '../../shared/retro/cameraConfiguration.js'
import {validateWorldConfiguration} from '../../shared/retro/worldConfiguration.js'
const SOURCE='camera/camera.json',HEADER='src/generated/camera_config.h',RECORD='.retrostudio/camera-export.json',WORLD='world/world.json'
const LIMIT=256*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
// Room sizes come from the world graph (#55), the single source of room pixels.
function worldRooms(root){
 const bytes=readProjectOutput(root,WORLD)
 if(bytes===null)return {rooms:[],hash:null}
 if(bytes.length>1024*1024)throw Error('World configuration exceeds 1 MiB.')
 const world=validateWorldConfiguration(JSON.parse(bytes.toString('utf8')),{allowEmpty:true})
 return {hash:hash(bytes),rooms:world.rooms.map(room=>({id:room.id,name:room.name,width:room.width,height:room.height,
  entries:room.entries.map(entry=>({id:entry.id,x:entry.x,y:entry.y,facing:entry.facing}))}))}
}
const sizes=rooms=>Object.fromEntries(rooms.map(room=>[room.id,{width:room.width,height:room.height}]))
function read(root){
 const source=readProjectOutput(root,SOURCE),header=readProjectOutput(root,HEADER),record=readProjectOutput(root,RECORD)
 if([source,header,record].some(bytes=>bytes&&bytes.length>LIMIT))throw Error('Camera configuration exceeds 256 KiB.')
 const config=source===null?createCameraConfiguration():JSON.parse(source.toString('utf8'))
 validateCameraConfiguration(config)
 let ownership=null
 if(record!==null){
  ownership=JSON.parse(record.toString('utf8'))
  if(!ownership||typeof ownership!=='object'||ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported camera export record.')
 }
 return {config,source,header,record,ownership,revision:hash(Buffer.from(JSON.stringify([hash(source),hash(header),hash(record)])))}
}
export function cameraConfigurationStatus(root){
 const data=read(root);let rooms=[],worldError=''
 try{
  rooms=worldRooms(root).rooms
  validateCameraConfiguration(data.config,{rooms:sizes(rooms)})
 }catch(error){worldError=error.message}
 return {config:data.config,revision:data.revision,rooms,worldError,
  headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash}
}
export function saveCameraConfiguration(root,{config,revision}={}){
 validateCameraConfiguration(config)
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Camera configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated camera header is customized or unmanaged; existing file preserved.')
 const world=worldRooms(root),options={rooms:sizes(world.rooms)}
 const source=Buffer.from(JSON.stringify(config,null,2)+'\n'),header=Buffer.from(compileCameraHeader(config,options))
 if(source.length>LIMIT||header.length>LIMIT)throw Error('Camera configuration exceeds 256 KiB.')
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[
  {path:SOURCE,bytes:source,expectedHash:hash(data.source)},
  {path:HEADER,bytes:header,expectedHash:hash(data.header)},
  {path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ],{producer:'camera-configuration',beforePublish:()=>{
  if(worldRooms(root).hash!==world.hash)throw Error('World configuration changed during camera export.')
 }})
 return {...receipt,...cameraConfigurationStatus(root)}
}
/** Opt-in preflight: no camera source means legacy/custom projects are untouched.
 * Never exports or executes project code; it only refuses a stale/edited header
 * or regions that no longer fit the rooms of the world graph. */
export function validateCameraForBuild(root){
 if(readProjectOutput(root,SOURCE)===null)return {configured:false}
 const data=read(root),world=worldRooms(root)
 const compiled=Buffer.from(compileCameraHeader(data.config,{rooms:sizes(world.rooms)}))
 if(data.header===null||data.ownership===null)throw Error('A câmera ainda não foi exportada. Use Salvar e exportar câmera.')
 if(hash(data.header)!==data.ownership.hash)throw Error('O header da câmera foi personalizado; revise-o antes do build. O arquivo foi preservado.')
 if(!compiled.equals(data.header))throw Error('A configuração da câmera mudou. Use Salvar e exportar câmera antes do build.')
 return {configured:true,revision:data.revision,roomCount:data.config.rooms.length}
}
