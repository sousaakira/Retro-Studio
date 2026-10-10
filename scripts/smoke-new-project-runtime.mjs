import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { installRuntimeModules,runtimeInstallationStatus } from '../electron/retro/runtimeInstaller.js'
import { installCutsceneRuntime } from '../electron/retro/cutsceneRuntime.js'
import { installNewProjectRuntime, recordNewProjectToolchain, validateModuleSelection } from '../electron/retro/newProject.js'
import { validateToolchainRecord } from '../shared/retro/toolchain.js'
import { copyProjectTemplate, prepareNewProject, inspectProjectTemplate } from '../electron/retro/starterProject.js'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-new-project-'))
try{
  const template=path.join(root,'assets/toolkit/examples/sgdk-skeleton')
  // #61: a fake toolkit stands in for the configured one; tool probes are injected.
  const toolkit=path.join(temporary,'toolkit');fs.mkdirSync(path.join(toolkit,'m68k-elf/inc'),{recursive:true});fs.mkdirSync(path.join(toolkit,'m68k-elf/bin'))
  fs.writeFileSync(path.join(toolkit,'m68k-elf/inc/genesis.h'),'#define SGDK_VERSION 1.81\n');fs.writeFileSync(path.join(toolkit,'m68k-elf/bin/rescomp.jar'),'')
  const settings={toolkitPath:toolkit}
  const context={fs,path,console,structuredClone,installRuntimeModules,installCutsceneRuntime,installNewProjectRuntime,validateModuleSelection,copyProjectTemplate,prepareNewProject,inspectProjectTemplate,loadConfigFile:()=>settings,
    recordNewProjectToolchain:(project,configured)=>recordNewProjectToolchain(project,configured,{probeTool:()=>'ok 1.0'}),
    getTemplatePath:()=>({key:'sgdk-skeleton',absolutePath:template}),
    copyDirectoryRecursive:(source,target)=>fs.cpSync(source,target,{recursive:true}),
    ipcMain:{handle:(name,callback)=>handlers.set(name,callback)}}
  const handlers=new Map()
  vm.createContext(context)
  const utilities=fs.readFileSync(path.join(root,'electron/retro/projectUtils.js'),'utf8')
  const start=utilities.indexOf('export function createProjectFromTemplate(')
  const end=utilities.indexOf('export function lerDiretorio(',start)
  vm.runInContext(utilities.slice(start,end).replace('export function','function'),context)
  const tool=context.createProjectFromTemplate('tool-game',temporary,'sgdk-skeleton')
  assert.equal(tool.success,true,tool.error)
  const projectSource=fs.readFileSync(path.join(root,'electron/retro/project.js'),'utf8')
  vm.runInContext(projectSource.slice(projectSource.indexOf('export function setupProjectHandlers()')).replace('export function','function'),context)
  context.setupProjectHandlers()
  const gui=await handlers.get('retro:create-project')(null,{name:'gui-game',path:temporary,template:'sgdk-skeleton'})
  assert.equal(gui.success,true,gui.error)
  // Selected modules bring their dependencies and nothing else; a missing toolkit never blocks creation.
  settings.toolkitPath=path.join(temporary,'missing')
  const chosen=await handlers.get('retro:create-project')(null,{name:'small-game',path:temporary,template:'sgdk-skeleton',modules:['camera']})
  assert.equal(chosen.success,true,chosen.error);assert.equal(chosen.toolchain.recorded,false);assert.equal(fs.existsSync(path.join(chosen.path,'retro-studio.toolchain.json')),false)
  assert.deepEqual(fs.readdirSync(path.join(chosen.path,'src/retro_runtime')).sort(),['retro_camera.c','retro_camera.h','retro_core.c','retro_core.h'])
  const refused=await handlers.get('retro:create-project')(null,{name:'bad-game',path:temporary,template:'sgdk-skeleton',modules:['../x']});assert.equal(refused.success,false);assert.equal(fs.existsSync(path.join(temporary,'bad-game')),false,'a refused selection leaves no folder behind')
  assert.equal((await handlers.get('retro:create-project')(null,{name:'bad-game',path:temporary,template:'sgdk-skeleton',modules:['nope']})).success,false);assert.equal(fs.existsSync(path.join(temporary,'bad-game')),false)
  assert.equal((await handlers.get('retro:create-project')(null,{name:'bad-game',path:temporary,template:'sgdk-skeleton',modules:[]})).success,false);assert.equal(fs.existsSync(path.join(temporary,'bad-game')),false,'an empty selection is refused before anything is created')
  assert.equal(context.createProjectFromTemplate('bad-tool',temporary,'sgdk-skeleton',[]).success,false);assert.equal(fs.existsSync(path.join(temporary,'bad-tool')),false)
  // A failure after the folder exists removes only that folder.
  {const real=context.installNewProjectRuntime;context.installNewProjectRuntime=()=>{throw Error('disk full')}
   assert.equal((await handlers.get('retro:create-project')(null,{name:'half-game',path:temporary,template:'sgdk-skeleton'})).success,false);assert.equal(fs.existsSync(path.join(temporary,'half-game')),false,'no half-created project is left behind')
   assert.equal(context.createProjectFromTemplate('half-tool',temporary,'sgdk-skeleton').success,false);assert.equal(fs.existsSync(path.join(temporary,'half-tool')),false);context.installNewProjectRuntime=real}
  assert.equal(context.createProjectFromTemplate('tool-small',temporary,'sgdk-skeleton',['progress']).success,true)
  assert.ok(fs.existsSync(path.join(temporary,'tool-small/src/retro_runtime/retro_progress.c'))&&!fs.existsSync(path.join(temporary,'tool-small/src/retro_runtime/retro_camera.c')))
  for(const game of [tool.projectPath,gui.path]){
    const record=validateToolchainRecord(JSON.parse(fs.readFileSync(path.join(game,'retro-studio.toolchain.json'),'utf8')))
    assert.deepEqual(record.sdk,{name:'sgdk',version:'1.81'});assert.ok(record.runtime.modules.core&&record.runtime.modules['cutscene-host'],'new projects record the installed modules')
    assert.equal(runtimeInstallationStatus(game).upToDate,true)
    for(const folder of ['maps','charsets','scenes'])assert.ok(fs.statSync(path.join(game,folder)).isDirectory())
    assert.ok(fs.statSync(path.join(game,'tools/export-world-maps.py')).isFile(),'new GUI/tool skeletons receive the world compiler')
    const config=JSON.parse(fs.readFileSync(path.join(game,'retro-studio.json')))
    const ignore=fs.readFileSync(path.join(game,'.gitignore'),'utf8')
    assert.ok(ignore.includes('/.retrostudio/export-transactions/'))
    assert.ok(!ignore.includes('runtime-installation.json'))
    assert.deepEqual(config.mapExport.inputPaths,['maps','res','charsets'])
    assert.equal(config.mapExport.outputProtocol,'retro-studio-map-outputs-v1')
    assert.equal(config.retroStudio.contractVersion,1)
    assert.equal(config.retroStudio.modules.length,0,'installed library is not a claim that the game consumes it')
    assert.ok(!config.retroStudio.adapter.capabilities.includes('player.spawn'))
  }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('New project: actual GUI/tool creation functions ship core, authoring folders, staged exporter and honest runtime contract.')
