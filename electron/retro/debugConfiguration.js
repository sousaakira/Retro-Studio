// #56: diagnostics switch -> managed header; games without debug/debug.json stay untouched.
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomInt} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {createDebugConfiguration,validateDebugConfiguration,compileDebugHeader} from '../../shared/retro/debugConfiguration.js'
const SOURCE='debug/debug.json',HEADER='src/generated/debug_config.h',RECORD='.retrostudio/debug-export.json',RECEIPT='.retro-studio/builds/latest.json'
const LIMIT=64*1024,ROM_LIMIT=16*1024*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
/** Identifier of one exported configuration (not of each build): shown by the ROM and in records. */
export const debugBuildId=config=>hash(Buffer.from(JSON.stringify(config))).slice(0,6).toUpperCase()
// "debug" is a common folder name. A file there that is not ours (another tool's
// debug.json, a non-directory called debug) means this feature is simply not in use.
function source(root){
 let bytes
 try{bytes=readProjectOutput(root,SOURCE)}catch{return {bytes:null,foreign:true}}
 if(bytes===null)return {bytes:null,foreign:false}
 if(bytes.length>LIMIT)return {bytes:null,foreign:true}
 try{if(JSON.parse(bytes.toString('utf8'))?.format!=='retro-studio.debug')return {bytes:null,foreign:true}}catch{return {bytes:null,foreign:true}}
 return {bytes,foreign:false}
}
function read(root){
 const found=source(root),header=readProjectOutput(root,HEADER),record=readProjectOutput(root,RECORD)
 if([header,record].some(bytes=>bytes&&bytes.length>LIMIT))throw Error('Debug configuration exceeds 64 KiB.')
 const config=found.bytes===null?createDebugConfiguration():JSON.parse(found.bytes.toString('utf8'))
 validateDebugConfiguration(config)
 let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||typeof ownership!=='object'||ownership.version!==1||ownership.path!==HEADER||!/^[a-f0-9]{64}$/.test(ownership.hash))throw Error('Unsupported debug export record.')
 }
 // exported: the header on disk is exactly what this configuration generates and is ours.
 const exported=found.bytes!==null&&header!==null&&hash(header)===ownership?.hash&&Buffer.from(compileDebugHeader(config,debugBuildId(config))).equals(header)
 return {config,source:found.bytes,foreign:found.foreign,header,record,ownership,exported,revision:hash(Buffer.from(JSON.stringify([hash(found.bytes),hash(header),hash(record)])))}
}
/** What can be PROVEN about the ROM on disk. Anything else is "unknown":
 *  - the receipt is the IDE's and describes the ROM file that is on disk now;
 *  - that build read the header that is on disk now, and the header is the exported one;
 *  - for a diagnostic build, the identifier is present in the ROM bytes (SGDK's
 *    makefile does not track header dependencies, so a matching header alone
 *    does not prove the game was recompiled). */
function lastBuild(root,data){
 try{
  const bytes=readProjectOutput(root,RECEIPT)
  if(bytes===null||bytes.length>1024*1024)return null
  const receipt=JSON.parse(bytes.toString('utf8'))
  if(receipt.version!==1||receipt.producer!=='retro-studio-build'||!Array.isArray(receipt.inputs)||!Array.isArray(receipt.outputs)||!receipt.outputs[0])return null
  const output=receipt.outputs[0],relative=String(output.path||''),file=path.join(root,relative)
  const info={finishedAt:String(receipt.finishedAt||''),rom:{path:relative,hash:String(output.hash||'')},state:'unknown',reason:''}
  const real=fs.realpathSync(file),base=fs.realpathSync(root)
  if(!real.startsWith(base+path.sep)||!fs.statSync(real).isFile()||fs.statSync(real).size>ROM_LIMIT)return {...info,reason:'rom-unreadable'}
  const rom=fs.readFileSync(real)
  if(hash(rom)!==info.rom.hash)return {...info,reason:'rom-changed'}
  const input=receipt.inputs.find(item=>item.path===HEADER)
  if(!input)return {...info,reason:'no-header'}
  if(!data.exported||input.hash!==hash(data.header))return {...info,reason:'other-configuration'}
  if(receipt.inputStability!=='unchanged-between-observations')return {...info,reason:'inputs-changed'}
  if(!data.config.enabled)return {...info,state:'production-header'}
  return rom.includes(Buffer.from(debugBuildId(data.config)))?{...info,state:'diagnostic',build:debugBuildId(data.config)}:{...info,reason:'identifier-not-in-rom'}
 }catch{return null}
}
export function debugConfigurationStatus(root){
 const data=read(root)
 return {config:data.config,revision:data.revision,exported:data.exported,foreign:data.foreign,build:data.exported&&data.config.enabled?debugBuildId(data.config):'',
  headerConflict:data.header!==null&&hash(data.header)!==data.ownership?.hash,lastBuild:lastBuild(root,data)}
}
export function saveDebugConfiguration(root,{config,revision}={}){
 validateDebugConfiguration(config)
 const data=read(root)
 if(data.foreign)throw Error('debug/debug.json belongs to another tool; it was preserved and diagnostics cannot be exported here.')
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Debug configuration changed; reload before saving.')
 if(data.header!==null&&hash(data.header)!==data.ownership?.hash)throw Error('Generated debug header is customized or unmanaged; existing file preserved.')
 // A project-specific seed plus a serial that grows on every export: identifiers
 // repeat neither across projects nor between two exports of the same project.
 const seed=data.source!==null&&Number.isInteger(data.config.seed)&&data.config.seed>0&&data.config.serial<0xFFFFFF?data.config.seed:randomInt(1,0xFFFFFFFF)
 const serial=data.source===null?1:data.config.serial>=0xFFFFFF?1:data.config.serial+1
 const next={...config,overlay:{...config.overlay},serial,seed}
 const bytes=Buffer.from(JSON.stringify(next,null,2)+'\n'),header=Buffer.from(compileDebugHeader(next,debugBuildId(next)))
 const record=Buffer.from(JSON.stringify({version:1,path:HEADER,hash:hash(header)},null,2)+'\n')
 const receipt=publishProjectOutputs(root,[
  {path:SOURCE,bytes,expectedHash:hash(data.source)},{path:HEADER,bytes:header,expectedHash:hash(data.header)},{path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ],{producer:'debug-configuration'})
 return {...receipt,...debugConfigurationStatus(root)}
}
/** Opt-in preflight: no debug source of ours means legacy/custom projects are untouched. */
export function validateDebugForBuild(root){
 if(source(root).bytes===null)return {configured:false}
 const data=read(root)
 if(data.header===null||data.ownership===null)throw Error('O diagnóstico ainda não foi exportado. Use Salvar e exportar diagnóstico.')
 if(hash(data.header)!==data.ownership.hash)throw Error('O header de diagnóstico foi personalizado; revise-o (ou apague src/generated/debug_config.h e exporte de novo) antes do build. O arquivo foi preservado.')
 if(!data.exported)throw Error('A configuração de diagnóstico mudou. Use Salvar e exportar diagnóstico antes do build.')
 return {configured:true,revision:data.revision,enabled:data.config.enabled,build:data.config.enabled?debugBuildId(data.config):''}
}
