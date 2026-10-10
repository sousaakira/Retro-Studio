import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {createMovementConfiguration,validateMovementConfiguration,compileMovementHeader} from '../../shared/retro/movementConfiguration.js'
const SOURCE='physics/movement.json',HEADER='src/generated/movement_config.h',RECORD='.retrostudio/movement-export.json'
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
function read(root){
 const source=readProjectOutput(root,SOURCE),header=readProjectOutput(root,HEADER),record=readProjectOutput(root,RECORD)
 if([source,header,record].some(bytes=>bytes&&bytes.length>64*1024))throw Error('Movement configuration exceeds 64 KiB.')
 const config=source===null?createMovementConfiguration():JSON.parse(source.toString('utf8'))
 validateMovementConfiguration(config)
 let ownership=null
 if(record!==null){
  ownership=JSON.parse(record.toString('utf8'))
  if(ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported movement export record.')
 }
 return {config,source,header,record,ownership,revision:hash(Buffer.from(JSON.stringify([hash(source),hash(header),hash(record)])))}
}
export function movementConfigurationStatus(root){
 const data=read(root)
 return {config:data.config,revision:data.revision,headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash}
}
export function saveMovementConfiguration(root,{config,revision}={}){
 validateMovementConfiguration(config)
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Movement configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated movement header is customized or unmanaged; existing file preserved.')
 const source=Buffer.from(JSON.stringify(config,null,2)+'\n'),header=Buffer.from(compileMovementHeader(config))
 if(source.length>64*1024)throw Error('Movement configuration exceeds 64 KiB.')
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[
  {path:SOURCE,bytes:source,expectedHash:hash(data.source)},
  {path:HEADER,bytes:header,expectedHash:hash(data.header)},
  {path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ],{producer:'movement-configuration'})
 return {...receipt,...movementConfigurationStatus(root)}
}
