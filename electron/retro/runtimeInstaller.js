import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { publishProjectOutputs, readProjectOutput } from './exportTransaction.js'

const DIRECTORY = path.join('assets','toolkit','lib','runtime')
const RECORD = '.retrostudio/runtime-installation.json'
const digest = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
const encode = data => {
  const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n')
  if(bytes.length>1024*1024)throw Error('Runtime metadata exceeds 1 MiB.')
  return bytes
}
const validId = id => typeof id==='string' && /^[a-z][a-z0-9_-]{0,63}$/.test(id)
const relative = value => typeof value==='string' && !value.includes('\\') && !value.startsWith('/') &&
  !/^[A-Za-z]:/.test(value) && !/[\x00-\x1f]/.test(value) &&
  value.split('/').every(part=>part && part!=='.' && part!=='..')
const inside = (root,target) => {const p=path.relative(root,target);return p!=='..'&&!p.startsWith('..'+path.sep)&&!path.isAbsolute(p)}
export function resolveRuntimeLibraryPath(){
  const location=path.dirname(fileURLToPath(import.meta.url))
  return [path.join(location,'..','..',DIRECTORY),
    process.resourcesPath&&path.join(process.resourcesPath,DIRECTORY),
    process.resourcesPath&&path.join(process.resourcesPath,'app.asar.unpacked',DIRECTORY),
    path.join(process.cwd(),DIRECTORY)].filter(Boolean).find(dir=>fs.existsSync(path.join(dir,'manifest.json'))) || null
}
function library(libraryPath){
  if(!libraryPath)throw Error('Bundled runtime library unavailable.')
  const root=fs.realpathSync(libraryPath), manifestPath=path.join(root,'manifest.json')
  const stat=fs.lstatSync(manifestPath)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('Invalid runtime library manifest.')
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
  if(manifest.format!=='retro-studio-runtime-library'||manifest.version!==1||
    !Array.isArray(manifest.modules)||!manifest.modules.length||manifest.modules.length>64)throw Error('Unsupported runtime library.')
  const ids=new Set(),targets=new Set(),modules=new Map()
  for(const module of manifest.modules){
    if(!validId(module.id)||ids.has(module.id)||!Number.isSafeInteger(module.version)||module.version<1||
      !Array.isArray(module.dependencies)||module.dependencies.some(id=>!validId(id))||
      !Array.isArray(module.files)||!module.files.length||module.files.length>48)throw Error('Invalid runtime module.')
    ids.add(module.id)
    const files=module.files.map(file=>{
      if(!relative(file.source)||!relative(file.target)||!file.target.startsWith('src/retro_runtime/')||
        !/\.(c|h)$/.test(file.target)||targets.has(file.target))throw Error('Invalid runtime file target.')
      targets.add(file.target)
      const source=path.join(root,file.source), sourceStat=fs.lstatSync(source)
      if(!sourceStat.isFile()||sourceStat.isSymbolicLink()||sourceStat.size>256*1024||
        !inside(root,fs.realpathSync(source)))throw Error('Invalid runtime source file.')
      const bytes=fs.readFileSync(source)
      return {...file,bytes,hash:digest(bytes)}
    })
    modules.set(module.id,{...module,files})
  }
  const visiting=new Set(),visited=new Set()
  function visit(id){
    if(visiting.has(id))throw Error('Circular runtime dependencies.')
    if(visited.has(id))return
    const module=modules.get(id);if(!module)throw Error('Unknown runtime dependency: '+id)
    visiting.add(id);module.dependencies.forEach(visit);visiting.delete(id);visited.add(id)
  }
  modules.forEach(module=>visit(module.id))
  return modules
}
function installation(root){
  const bytes=readProjectOutput(root,RECORD)
  if(bytes===null)return{record:{version:1,modules:[]},hash:null}
  if(bytes.length>1024*1024)throw Error('Runtime installation record exceeds 1 MiB.')
  const record=JSON.parse(bytes.toString('utf8'))
  validateInstallationRecord(record)
  return{record,hash:digest(bytes)}
}
function prepare(projectPath,moduleIds,libraryPath){
  const root=fs.realpathSync(projectPath),modules=library(libraryPath),installed=installation(root)
  const selected=moduleIds===undefined?[...modules.keys()]:moduleIds
  if(!Array.isArray(selected)||!selected.length||selected.length>64||selected.some(id=>!validId(id)))throw Error('Invalid runtime module selection.')
  const ordered=[],seen=new Set()
  function add(id){if(seen.has(id))return;const module=modules.get(id);if(!module)throw Error('Unknown runtime module: '+id);module.dependencies.forEach(add);seen.add(id);ordered.push(module)}
  selected.forEach(add)
  const files=[]
  for(const module of ordered){
    const previous=installed.record.modules.find(item=>item.id===module.id)
    if(previous && previous.version>module.version)throw Error('Installed runtime module '+module.id+' is newer than this IDE library; downgrade refused.')
    for(const file of module.files){
      const old=readProjectOutput(root,file.target)
      if(old&&old.length>256*1024)throw Error('Runtime target is too large; existing file preserved.')
      const oldHash=digest(old),owned=previous?.files.find(item=>item.path===file.target)
      const status=old===null?'new':oldHash===file.hash?'current':!owned?'unmanaged':oldHash===owned.hash?'update':'modified'
      files.push({...file,moduleId:module.id,old,oldHash,status})
    }
  }
  const publicFiles=files.map(file=>({path:file.target,moduleId:file.moduleId,status:file.status,oldHash:file.oldHash,newHash:file.hash}))
  const moduleVersions=ordered.map(module=>({id:module.id,version:module.version,dependencies:module.dependencies}))
  const planId=digest(encode({modules:moduleVersions,files:publicFiles,installation:installed.hash}))
  return{root,files,installed,ordered,plan:{planId,modules:moduleVersions,files:publicFiles,
    conflicts:publicFiles.filter(file=>['unmanaged','modified'].includes(file.status))}}
}
export function runtimeInstallationStatus(projectPath,{libraryPath=resolveRuntimeLibraryPath()}={}){
  const prepared=prepare(projectPath,undefined,libraryPath)
  return{available:true,...prepared.plan,
    installed:prepared.files.every(file=>file.old!==null),
    upToDate:prepared.files.every(file=>file.status==='current') &&
      prepared.ordered.every(module=>prepared.installed.record.modules.some(item=>item.id===module.id&&item.version===module.version)),
    retainedFiles:prepared.installed.record.modules.flatMap(module=>module.files
      .filter(file=>!prepared.files.some(item=>item.target===file.path)).map(file=>file.path))}
}
export function installRuntimeModules(projectPath,{moduleIds,expectedPlanId,allowConflicts=false,libraryPath=resolveRuntimeLibraryPath(),beforePublish}={}){
  const prepared=prepare(projectPath,moduleIds,libraryPath)
  if(expectedPlanId&&expectedPlanId!==prepared.plan.planId)throw Error('Runtime plan changed; review again.')
  if(prepared.plan.conflicts.length&&!allowConflicts)throw Error('Runtime contains modified or unmanaged files; explicit review required.')
  const outputs=[],backups=[],backupId=randomUUID()
  for(const file of prepared.files){
    if(['modified','unmanaged'].includes(file.status)){
      const backup='.retrostudio/runtime-backups/'+backupId+'/'+file.target
      backups.push(backup);outputs.push({path:backup,bytes:file.old,expectedHash:null})
    }
    outputs.push({path:file.target,bytes:file.bytes,expectedHash:file.oldHash})
  }
  const record=prepared.installed.record
  for(const module of prepared.ordered){
    const previous=record.modules.find(item=>item.id===module.id)
    const currentTargets=new Set(module.files.map(file=>file.target))
    const next={...previous,id:module.id,version:module.version,
      files:[...(previous?.files||[]).filter(file=>!currentTargets.has(file.path)),
        ...module.files.map(file=>({path:file.target,hash:file.hash}))]}
    if(previous)record.modules[record.modules.indexOf(previous)]=next
    else record.modules.push(next)
  }
  validateInstallationRecord(record)
  outputs.push({path:RECORD,bytes:encode(record),expectedHash:prepared.installed.hash})
  const receipt=publishProjectOutputs(prepared.root,outputs,{producer:'runtime-install',beforePublish})
  return{...receipt,modules:prepared.plan.modules,backups}
}

function validateInstallationRecord(record){
  if(record.version!==1||!Array.isArray(record.modules)||record.modules.length>128)throw Error('Unsupported runtime installation record.')
  const ids=new Set(),targets=new Set()
  for(const module of record.modules){
    if(!validId(module.id)||ids.has(module.id)||!Number.isSafeInteger(module.version)||module.version<1||
      !Array.isArray(module.files)||module.files.length>2048)throw Error('Invalid installed runtime module.')
    ids.add(module.id)
    for(const file of module.files){
      if(!relative(file.path)||!file.path.startsWith('src/retro_runtime/')||targets.has(file.path)||
        !/\.(c|h)$/.test(file.path)||!/^[a-f0-9]{64}$/.test(file.hash))throw Error('Invalid installed runtime file.')
      targets.add(file.path)
    }
  }
  return record
}
