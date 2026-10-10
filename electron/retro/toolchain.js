// #61: record and diagnose the technical base of a project. Recording never changes game code.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {resolveRuntimeLibraryPath} from './runtimeInstaller.js'
import {TOOLCHAIN_FILE,createToolchainRecord,validateToolchainRecord,compareToolchain} from '../../shared/retro/toolchain.js'
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
const firstLine=text=>String(text||'').split(/\r?\n/).find(line=>line.trim())?.trim().slice(0,120)||''
function probe(command,args,env){
 try{
  const result=spawnSync(command,args,{encoding:'utf8',timeout:5000,windowsHide:true,...(env?{env}:{})})
  if(result.error||result.status!==0)return ''
  return firstLine(result.stdout)||firstLine(result.stderr)||'ok'
 }catch{return ''}
}
/** Tools on this machine. Nothing is installed, downloaded or modified. */
export function detectToolchain(toolkit,{probeTool=probe}={}){
 const detected={toolkit:'',sdk:null,compiler:'',rescomp:false,tools:{},layout:''}
 let search=process.env
 if(typeof toolkit==='string'&&toolkit&&fs.existsSync(toolkit)){
  detected.toolkit=toolkit
  const root=[toolkit,path.join(toolkit,'m68k-elf')].find(base=>fs.existsSync(path.join(base,'inc','genesis.h')))
  if(root){
   const header=fs.readFileSync(path.join(root,'inc','genesis.h'),'utf8').slice(0,4096),match=header.match(/#define\s+SGDK_VERSION\s+([0-9][0-9A-Za-z._]*)/)
   detected.sdk={name:'sgdk',version:match?match[1]:'unknown',root}
   // The build looks for <toolkit>/m68k-elf (or the toolkit itself on Windows) and puts its bin first in PATH.
   detected.layout=root===toolkit&&process.platform!=='win32'&&!fs.existsSync(path.join(toolkit,'m68k-elf','makefile.gen'))?'sdk-root':''
   search={...process.env,PATH:[path.join(toolkit,'bin'),path.join(root,'bin'),process.env.PATH||''].join(path.delimiter)}
   const gcc=['m68k-elf-gcc','m68k-elf-gcc.exe'].map(name=>path.join(root,'bin',name)).find(file=>fs.existsSync(file))
   if(gcc){const number=probeTool(gcc,['--version']).match(/\d+\.\d+(?:\.\d+)?/);detected.compiler=number?'m68k-elf-gcc '+number[0]:'m68k-elf-gcc'}
   detected.rescomp=fs.existsSync(path.join(root,'bin','rescomp.jar'))
  }
 }
 for(const [tool,args] of [['make',['--version']],['java',['-version']],['python3',['--version']]])detected.tools[tool]=probeTool(tool,args,search)
 return detected
}
/** Versions this IDE distributes: runtime modules and generators. */
export function libraryVersions(){
 const manifest=JSON.parse(fs.readFileSync(path.join(resolveRuntimeLibraryPath(),'manifest.json'),'utf8'))
 const cutscene=path.join(path.dirname(resolveRuntimeLibraryPath()),'cutscene')
 const generators={'map-outputs':1}
 try{
  generators['cutscene-runtime']=JSON.parse(fs.readFileSync(path.join(cutscene,'manifest.json'),'utf8')).version
  generators['cutscene-bytecode']=Number(fs.readFileSync(path.join(cutscene,'src/retrostudio/cutscene_runner.h'),'utf8').match(/#define CUTSCENE_RUNTIME_VERSION (\d+)/)[1])
 }catch{/* cutscene library not shipped with this build */}
 let ide=''
 try{ide=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json',import.meta.url)),'utf8')).version||''}catch{ide=''}
 return {modules:Object.fromEntries(manifest.modules.map(module=>[module.id,module.version])),generators,ide}
}
function read(root){
 const bytes=readProjectOutput(root,TOOLCHAIN_FILE)
 let record=null,error=''
 if(bytes&&bytes.length>64*1024)return {bytes,record,error:'arquivo maior que 64 KiB',revision:hash(Buffer.from(JSON.stringify([hash(bytes)])))}
 if(bytes!==null){
  try{
   const value=JSON.parse(bytes.toString('utf8'))
   if(value?.format==='retro-studio.toolchain'&&Number.isInteger(value.version)&&value.version>1)throw Error('registro da versão '+value.version+', feito por uma IDE mais nova; atualize a IDE')
   record=validateToolchainRecord(value)
  }catch(caught){error=caught.message}
 }
 return {bytes,record,error,revision:hash(Buffer.from(JSON.stringify([hash(bytes)])))}
}
// Modules the project actually has installed, at their installed versions.
// null: the installation record exists but cannot be read (never treated as "no modules").
function installedModules(root){
 try{
  const bytes=readProjectOutput(root,'.retrostudio/runtime-installation.json')
  if(bytes===null)return {}
  if(bytes.length>1024*1024)return null
  const record=JSON.parse(bytes.toString('utf8'))
  if(!record||!Array.isArray(record.modules))return null
  return Object.fromEntries((Array.isArray(record.modules)?record.modules:[]).filter(module=>typeof module?.id==='string'&&Number.isInteger(module.version)).map(module=>[module.id,module.version]))
 }catch{return null}
}
export function toolchainStatus(root,{toolkit,probeTool}={}){
 const data=read(root),detected=detectToolchain(toolkit,{probeTool}),library=libraryVersions()
 const issues=compareToolchain(data.record,detected,library)
 const installed=installedModules(root)
 if(data.error)issues.unshift({severity:'error',scope:'project',code:'record-invalid',message:TOOLCHAIN_FILE+' não pôde ser lido ('+data.error+'). O arquivo foi preservado.'})
 if(installed===null)issues.unshift({severity:'error',scope:'project',code:'runtime-record-invalid',message:'O registro de instalação do runtime (.retrostudio/runtime-installation.json) não pôde ser lido; a base técnica não pode ser registrada até ele ser corrigido em Runtime.'})
 return {revision:data.revision,record:data.record,recordInvalid:!!data.error||installed===null,detected,library,installed:installed||{},issues,
  environmentErrors:issues.filter(item=>item.scope==='environment'&&item.severity==='error').length}
}
/** Writes retro-studio.toolchain.json from what is installed in the project and on this machine. */
export function recordToolchain(root,{toolkit,revision,probeTool}={}){
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Toolchain record changed; reload before recording.')
 if(data.error)throw Error('Existing toolchain record is unreadable; preserved.')
 const detected=detectToolchain(toolkit,{probeTool}),library=libraryVersions()
 if(!detected.sdk)throw Error('O SGDK não foi encontrado no toolkit configurado; nada foi registrado.')
 const modules=installedModules(root)
 if(modules===null)throw Error('Runtime installation record is unreadable; nothing was recorded.')
 const record=createToolchainRecord({sdk:detected.sdk,compiler:detected.compiler,modules,generators:library.generators,ide:library.ide})
 const receipt=publishProjectOutputs(root,[{path:TOOLCHAIN_FILE,bytes:Buffer.from(JSON.stringify(record,null,2)+'\n'),expectedHash:hash(data.bytes)}],{producer:'toolchain-record'})
 return {...receipt,...toolchainStatus(root,{toolkit,probeTool})}
}
