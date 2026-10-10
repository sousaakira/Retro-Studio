import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {createInputConfiguration,validateInputConfiguration,inputWarnings,compileInputHeader} from '../../shared/retro/inputMapping.js'
const SOURCE='controls/input-map.json',HEADER='src/generated/input_map.h',RECORD='.retrostudio/input-export.json'
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
function read(root){
 const source=readProjectOutput(root,SOURCE),header=readProjectOutput(root,HEADER),record=readProjectOutput(root,RECORD)
 if([source,header,record].some(bytes=>bytes&&bytes.length>64*1024))throw Error('Input configuration exceeds 64 KiB.')
 const config=source===null?createInputConfiguration():JSON.parse(source.toString('utf8'))
 validateInputConfiguration(config)
 let ownership=null
 if(record!==null){
  ownership=JSON.parse(record.toString('utf8'))
  if(ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported input export record.')
 }
 const revision=hash(Buffer.from(JSON.stringify([hash(source),hash(header),hash(record)])))
 return {config,source,header,record,ownership,revision}
}
export function inputConfigurationStatus(root){
 const data=read(root)
 return {config:data.config,revision:data.revision,warnings:inputWarnings(data.config),
  headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash}
}
export function saveInputConfiguration(root,{config,revision}={}){
 validateInputConfiguration(config)
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Input configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated input header is customized or unmanaged; existing file preserved.')
 const source=Buffer.from(JSON.stringify(config,null,2)+'\n'),header=Buffer.from(compileInputHeader(config))
 if(source.length>64*1024)throw Error('Input configuration exceeds 64 KiB.')
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[
  {path:SOURCE,bytes:source,expectedHash:hash(data.source)},
  {path:HEADER,bytes:header,expectedHash:hash(data.header)},
  {path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ],{producer:'input-configuration'})
 return {...receipt,...inputConfigurationStatus(root)}
}
