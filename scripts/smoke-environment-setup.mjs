// #83: exercise real IPC orchestration with local fixtures, never apt or downloads.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-env-setup-'))
let sequence=0
try {
  async function fixture() {
    const root=path.join(temporary,String(sequence++));fs.mkdirSync(root)
    const handlers=new Map(),store={'ui-settings.json':{theme:'dark'},'emulator-config.json':{volume:80}},downloads=[]
    const getInstallDir=segments=>path.join(root,...segments)
    const toolkit=getInstallDir(['toolkit','marsdev','mars']),emulator=getInstallDir(['emulators','md','gen_sdl2'])
    const sdkFiles=['makefile.gen','inc/genesis.h','bin/rescomp.jar',process.platform==='win32'?'bin/gcc.exe':'bin/m68k-elf-gcc']
    const writeSDK=()=>{for(const name of sdkFiles){const file=path.join(toolkit,process.platform==='win32'?'':'m68k-elf',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture')}}
    const host={ready:true,items:[{id:'java',ok:true,version:'21'}],platform:process.platform}
    let manifests=0
    const f={ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
      inspectEnvironment:async()=>host,environmentInstallPlan:()=>({supported:true,packages:[],command:''}),installEnvironment:async()=>f.install(),install:async()=>host,
      resolveEmulatorPath:()=>fs.existsSync(emulator)?emulator:null,
      loadConfigFile:(name,fallback)=>structuredClone(store[name]||fallback),saveConfigFile:(name,value)=>{store[name]=structuredClone(value);return true},
      getPackageManifest:async()=>{manifests++;return {packages:[{id:'marsdev',platforms:{[process.platform]:{extractTo:['toolkit','marsdev','mars']}}},{id:'gen_sdl2',platforms:{[process.platform]:{extractTo:['emulators','md']}}}]}},
      getPlatformKey:()=>process.platform,getInstallDir,isPackageInstalled:()=>false,
      downloadPackage:async pkg=>{downloads.push(pkg.id);if(pkg.id==='marsdev')writeSDK();else{fs.mkdirSync(path.dirname(emulator),{recursive:true});fs.writeFileSync(emulator,'fixture')}await f.afterDownload?.(pkg);return {success:true,installPath:getInstallDir(pkg.platforms[process.platform].extractTo)}}}
    globalThis.__environmentFixture=f
    let source=fs.readFileSync(new URL('../electron/retro/downloads.js',import.meta.url),'utf8')
    source=source.replace(/import \{ ipcMain \} from 'electron'/,"const {ipcMain}=globalThis.__environmentFixture")
      .replace(/import \{ resolveEmulatorPath \} from '\.\/emulatorUtils.js'/,"const {resolveEmulatorPath}=globalThis.__environmentFixture")
      .replace(/import \{ inspectEnvironment, environmentInstallPlan, installEnvironment \} from '\.\/environment.js'/,"const {inspectEnvironment,environmentInstallPlan,installEnvironment}=globalThis.__environmentFixture")
      .replace(/import \{ loadConfigFile, saveConfigFile \} from '\.\/utils.js'/,"const {loadConfigFile,saveConfigFile}=globalThis.__environmentFixture")
      .replace(/import \{\s+getPackageManifest,[\s\S]*?\} from '\.\/downloadManager.js'/,"const {getPackageManifest,getPlatformKey,isPackageInstalled,downloadPackage,getInstallDir}=globalThis.__environmentFixture")
    const file=path.join(root,'downloads.mjs');fs.writeFileSync(file,source);const module=await import(pathToFileURL(file).href)
    const frame={routingId:10,processId:20},contents={mainFrame:frame,isDestroyed:()=>false,send:()=>{}},win={webContents:contents,isDestroyed:()=>false}
    module.setMainWindow(win);module.setupDownloadHandlers()
    return {f,store,handlers,downloads,toolkit,writeSDK,root,event:{sender:contents,senderFrame:frame},manifests:()=>manifests}
  }
  const ctx=await fixture(),prepare=ctx.handlers.get('retro:prepare-environment'),status=ctx.handlers.get('retro:environment-status')
  assert.equal((await status()).ready,false);assert.equal(ctx.manifests(),0,'Startup status must work offline without fetching a manifest')
  assert.equal((await prepare({sender:{},senderFrame:{}})).error,'environmentSender')
  assert.equal((await prepare({...ctx.event,senderFrame:{routingId:999,processId:20}})).error,'environmentSender')
  assert.equal(ctx.downloads.length,0)
  const ready=await prepare(ctx.event,{command:'evil',packages:['evil']})
  assert.equal(ready.ready,true);assert.deepEqual(ctx.downloads,['marsdev','gen_sdl2'])
  assert.equal(ctx.store['ui-settings.json'].toolkitPath,ctx.toolkit);assert.equal(ctx.store['ui-settings.json'].theme,'dark');assert.equal(ctx.store['emulator-config.json'].volume,80)
  await prepare(ctx.event);assert.equal(ctx.downloads.length,2,'Valid installations must not be downloaded or replaced')
  fs.unlinkSync(path.join(ctx.toolkit,process.platform==='win32'?'':'m68k-elf','makefile.gen'))
  const saved=structuredClone(ctx.store);const partial=await prepare(ctx.event)
  assert.equal(partial.error,'environmentExistingFiles');assert.deepEqual(ctx.store,saved);assert.equal(ctx.downloads.length,2)
  const concurrent=await fixture(),concurrentPrepare=concurrent.handlers.get('retro:prepare-environment')
  let complete;concurrent.f.install=()=>new Promise(resolve=>{complete=resolve})
  const first=concurrentPrepare(concurrent.event)
  assert.equal((await concurrent.handlers.get('retro:download-package')(concurrent.event,{packageId:'marsdev'})).success,false,'Manual downloads cannot race setup extraction')
  assert.equal((await concurrentPrepare(concurrent.event)).error,'environmentBusy')
  complete({ready:true});assert.equal((await first).ready,true)
  concurrent.f.install=async()=>{throw Error('environmentCancelled')}
  assert.equal((await concurrentPrepare(concurrent.event)).error,'environmentCancelled')
  concurrent.f.install=async()=>({ready:true});assert.equal((await concurrentPrepare(concurrent.event)).ready,true,'Cancelled setup releases its lock')
  const reuse=await fixture();reuse.writeSDK();reuse.store['ui-settings.json'].toolkitPath=reuse.toolkit
  assert.equal((await reuse.handlers.get('retro:prepare-environment')(reuse.event)).ready,true)
  assert.deepEqual(reuse.downloads,['gen_sdl2'])
  const changed=await fixture()
  changed.f.afterDownload=async pkg=>{if(pkg.id==='marsdev')changed.store['ui-settings.json'].toolkitPath='/chosen-while-downloading'}
  const conflict=await changed.handlers.get('retro:prepare-environment')(changed.event)
  assert.equal(conflict.error,'environmentSettingsChanged')
  assert.equal(changed.store['ui-settings.json'].toolkitPath,'/chosen-while-downloading','Concurrent user settings are preserved')
  assert.deepEqual(changed.downloads,['marsdev'])
  console.log('Environment setup: trusted main-frame IPC, offline checks, fresh SDK/emulator configuration, existing/partial installs preserved, fixed defaults, duplicate setup and cancellation passed.')
} finally { delete globalThis.__environmentFixture;fs.rmSync(temporary,{recursive:true,force:true}) }
