// #61: what every new project gets besides the template files.
import fs from 'node:fs'
import path from 'node:path'
import {installRuntimeModules,resolveRuntimeLibraryPath} from './runtimeInstaller.js'
import {toolchainStatus,recordToolchain} from './toolchain.js'
/** modules: optional list of runtime module IDs chosen at creation (dependencies
 * are added by the installer); omitted = every distributed module. */
/** required: modules the template itself needs; they join any selection. */
export function installNewProjectRuntime(projectPath,modules,required=[]){
 validateModuleSelection(modules)
 return modules===undefined||modules===null?installRuntimeModules(projectPath):installRuntimeModules(projectPath,{moduleIds:[...new Set([...modules,...required])]})
}
/** Called before anything is created, so a bad selection leaves no folder behind. */
export function validateModuleSelection(modules){
 if(modules===undefined||modules===null)return
 const known=new Set(JSON.parse(fs.readFileSync(path.join(resolveRuntimeLibraryPath(),'manifest.json'),'utf8')).modules.map(module=>module.id))
 if(!Array.isArray(modules)||!modules.length||modules.length>64||modules.some(id=>typeof id!=='string'||!known.has(id)))throw Error('Invalid runtime module selection.')
}
/** Records the technical base when the toolkit is available. A missing or
 * incomplete toolkit never blocks creation: the project just stays unrecorded. */
export function recordNewProjectToolchain(projectPath,toolkit,options={}){
 try{
  // Only SGDK projects are recorded: other templates do not use this SDK.
  const project=JSON.parse(fs.readFileSync(path.join(projectPath,'retro-studio.json'),'utf8'))
  if(project?.retroStudio?.target?.sdk!=='sgdk')return {recorded:false,reason:'O projeto não declara o SDK SGDK.'}
  const status=toolchainStatus(projectPath,{toolkit,...options})
  if(!status.detected.sdk)return {recorded:false,reason:'O SGDK não foi encontrado no toolkit configurado.'}
  recordToolchain(projectPath,{toolkit,revision:status.revision,...options})
  return {recorded:true}
 }catch(error){return {recorded:false,reason:error.message}}
}
