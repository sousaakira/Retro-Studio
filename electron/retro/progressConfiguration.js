// #60: progress source/header are managed; games without progress/progress.json stay untouched.
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {createProgressConfiguration,validateProgressConfiguration,compileProgressHeader,progressCompatibility,progressMemory} from '../../shared/retro/progressConfiguration.js'
const SOURCE='progress/progress.json',HEADER='src/generated/progress_config.h',RECORD='.retrostudio/progress-export.json',ROM_HEADER='src/boot/rom_head.c'
const LIMIT=256*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
// SGDK's own rom_head.c declares SRAM; only a project copy without "RA" is a known mismatch.
// Textual check: comments are removed without touching string contents. Unreadable
// or unusual sources (symlink, oversized) are reported as unknown, never as an error.
function romHeader(root){
 try{
  const bytes=readProjectOutput(root,ROM_HEADER)
  if(bytes===null||bytes.length>LIMIT)return null
  const code=bytes.toString('utf8').replace(/"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/.*$/gm,match=>match[0]==='"'?match:'')
  return /"RA"|'R'\s*,\s*'A'|"R"\s*"A"/.test(code)
 }catch{return null}
}
function read(root){
 const source=readProjectOutput(root,SOURCE),header=readProjectOutput(root,HEADER),record=readProjectOutput(root,RECORD)
 if([source,header,record].some(bytes=>bytes&&bytes.length>LIMIT))throw Error('Progress configuration exceeds 256 KiB.')
 const config=source===null?createProgressConfiguration():JSON.parse(source.toString('utf8'))
 validateProgressConfiguration(config)
 let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||typeof ownership!=='object'||ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported progress export record.')
 }
 return {config,source,header,record,ownership,revision:hash(Buffer.from(JSON.stringify([hash(source),hash(header),hash(record)])))}
}
export function progressConfigurationStatus(root){
 const data=read(root)
 return {config:data.config,revision:data.revision,exported:data.source!==null,memory:progressMemory(data.config),
  romHeaderDeclaresSram:romHeader(root),headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash}
}
export function saveProgressConfiguration(root,{config,revision,allowDroppedSchemas=false,allowMovedSlots=false}={}){
 validateProgressConfiguration(config)
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Progress configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated progress header is customized or unmanaged; existing file preserved.')
 progressCompatibility(data.source===null?null:data.config,config,{allowDroppedSchemas:allowDroppedSchemas===true,allowMovedSlots:allowMovedSlots===true})
 const source=Buffer.from(JSON.stringify(config,null,2)+'\n'),header=Buffer.from(compileProgressHeader(config))
 if(source.length>LIMIT||header.length>LIMIT)throw Error('Progress configuration exceeds 256 KiB.')
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[
  {path:SOURCE,bytes:source,expectedHash:hash(data.source)},
  {path:HEADER,bytes:header,expectedHash:hash(data.header)},
  {path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ],{producer:'progress-configuration'})
 return {...receipt,...progressConfigurationStatus(root)}
}
/** Opt-in preflight: no progress source means legacy/custom projects are untouched.
 * Never exports or executes project code. */
export function validateProgressForBuild(root){
 if(readProjectOutput(root,SOURCE)===null)return {configured:false}
 const data=read(root),compiled=Buffer.from(compileProgressHeader(data.config))
 if(data.header===null||data.ownership===null)throw Error('O progresso ainda não foi exportado. Use Salvar e exportar progresso.')
 if(hash(data.header)!==data.ownership.hash)throw Error('O header de progresso foi personalizado; revise-o antes do build. O arquivo foi preservado.')
 if(!compiled.equals(data.header))throw Error('A configuração de progresso mudou. Use Salvar e exportar progresso antes do build.')
 if(data.config.sram.enabled&&romHeader(root)===false)throw Error('A SRAM está ativada, mas src/boot/rom_head.c não declara "RA". Declare a SRAM no cabeçalho da ROM ou desative a persistência.')
 return {configured:true,revision:data.revision,schema:data.config.schema,sram:data.config.sram.enabled}
}
