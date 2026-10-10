import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRuntimeLibraryPath,runtimeInstallationStatus,installRuntimeModules } from '../electron/retro/runtimeInstaller.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-install-'))
try{
  const root=path.join(temporary,'game'),lib=path.join(temporary,'library')
  fs.mkdirSync(path.join(root,'src'),{recursive:true})
  fs.writeFileSync(path.join(root,'src/main.c'),'/* Alice preserved */')
  fs.writeFileSync(path.join(root,'retro-studio.json'),'{"name":"Alice","custom":true}')
  assert.ok(resolveRuntimeLibraryPath())
  const bundled=fileURLToPath(new URL('../assets/toolkit/lib/runtime',import.meta.url))
  fs.cpSync(bundled,lib,{recursive:true})
  let status=runtimeInstallationStatus(root,{libraryPath:lib})
  assert.equal(status.installed,false)
  assert.equal(status.modules[0].id,'core')
  assert.throws(()=>installRuntimeModules(root,{libraryPath:lib,expectedPlanId:'stale'}),/plan changed/)
  assert.throws(()=>installRuntimeModules(root,{libraryPath:lib,beforePublish(index){if(index===1)throw Error('injected')}}),/injected/)
  assert.ok(!fs.existsSync(path.join(root,'src/retro_runtime/retro_core.h')))
  const installed=installRuntimeModules(root,{libraryPath:lib,expectedPlanId:status.planId})
  assert.equal(installed.modules[0].version,1)
  status=runtimeInstallationStatus(root,{libraryPath:lib})
  assert.equal(status.upToDate,true)
  const header=path.join(root,'src/retro_runtime/retro_core.h')
  fs.utimesSync(header,new Date(1000),new Date(1000))
  installRuntimeModules(root,{libraryPath:lib})
  assert.equal(fs.statSync(header).mtimeMs,1000)
  const customized=fs.readFileSync(header,'utf8')+'\n/* custom game edit */\n'
  fs.writeFileSync(header,customized)
  const manifest=JSON.parse(fs.readFileSync(path.join(lib,'manifest.json')))
  manifest.modules[0].version=2
  fs.writeFileSync(path.join(lib,'manifest.json'),JSON.stringify(manifest))
  fs.appendFileSync(path.join(lib,'core/retro_core.h'),'\n/* bundled v2 */\n')
  status=runtimeInstallationStatus(root,{libraryPath:lib})
  assert.equal(status.conflicts.length,1)
  assert.throws(()=>installRuntimeModules(root,{libraryPath:lib}),/explicit review/)
  assert.equal(fs.readFileSync(header,'utf8'),customized)
  const upgraded=installRuntimeModules(root,{libraryPath:lib,expectedPlanId:status.planId,allowConflicts:true})
  assert.equal(upgraded.backups.length,1)
  assert.equal(fs.readFileSync(path.join(root,upgraded.backups[0]),'utf8'),customized)
  assert.equal(runtimeInstallationStatus(root,{libraryPath:lib}).upToDate,true)
  assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),'/* Alice preserved */')
  assert.equal(fs.readFileSync(path.join(root,'retro-studio.json'),'utf8'),'{"name":"Alice","custom":true}')
  const newerHeader=fs.readFileSync(header,'utf8')
  manifest.modules[0].version=1
  fs.writeFileSync(path.join(lib,'manifest.json'),JSON.stringify(manifest))
  assert.throws(()=>runtimeInstallationStatus(root,{libraryPath:lib}),/downgrade refused/)
  assert.throws(()=>installRuntimeModules(root,{libraryPath:lib,allowConflicts:true}),/downgrade refused/)
  assert.equal(fs.readFileSync(header,'utf8'),newerHeader)
  manifest.modules[0].version=2
  manifest.modules[0].dependencies=['core']
  fs.writeFileSync(path.join(lib,'manifest.json'),JSON.stringify(manifest))
  assert.throws(()=>runtimeInstallationStatus(root,{libraryPath:lib}),/Circular/)
  manifest.modules[0].dependencies=[]
  manifest.modules[0].files[0].source='../escape.h'
  fs.writeFileSync(path.join(lib,'manifest.json'),JSON.stringify(manifest))
  assert.throws(()=>runtimeInstallationStatus(root,{libraryPath:lib}),/Invalid runtime/)
  fs.writeFileSync(path.join(root,'.retrostudio/runtime-installation.json'),'{"version":99,"modules":[]}')
  assert.throws(()=>installRuntimeModules(root),/Unsupported runtime installation/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime install: versions, graph, rollback, no rewrites, custom backups, stale plans, future records and Alice preservation passed.')
