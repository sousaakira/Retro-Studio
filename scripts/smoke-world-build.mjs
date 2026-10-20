// #55: production IDE/tools build paths, actual make, no user game/ROM writes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {worldConfigurationStatus,saveWorldConfiguration,saveWorldConfigurationWithMaps,validateWorldForBuild} from '../electron/retro/worldConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-build-'))
try{
 const root=path.join(temporary,'game'),toolkit=path.join(temporary,'toolkit'),outside=path.join(temporary,'other')
 fs.mkdirSync(root);fs.mkdirSync(outside);fs.mkdirSync(path.join(toolkit,'m68k-elf'),{recursive:true});fs.writeFileSync(path.join(toolkit,'m68k-elf/makefile.gen'),'')
 assert.deepEqual(validateWorldForBuild(root),{configured:false})
 fs.mkdirSync(path.join(root,'src/generated'),{recursive:true});fs.writeFileSync(path.join(root,'src/generated/world_config.h'),'legacy custom')
 assert.deepEqual(validateWorldForBuild(root),{configured:false},'stray custom headers do not opt legacy games into the graph')
 fs.unlinkSync(path.join(root,'src/generated/world_config.h'))
 fs.mkdirSync(path.join(root,'maps'));const tmx='<map orientation="orthogonal" width="40" height="28" tilewidth="8" tileheight="8"></map>'
 fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx)
 const config={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},conditions:[],rooms:[{id:'hall',name:'Hall',map:'maps/a.tmx',width:320,height:224,entries:[{id:'spawn',x:24,y:160,facing:false}],exits:[],checkpoints:[]}]}
 const saved=saveWorldConfiguration(root,{config,revision:worldConfigurationStatus(root).revision}),valid=validateWorldForBuild(root)
 assert.equal(valid.configured,true);assert.equal(valid.roomCount,1);assert.equal(valid.mapCount,1)
 assert.deepEqual(validateWorldForBuild(root,{expected:valid}),valid)
 assert.throws(()=>validateWorldForBuild(root,{expected:{configured:false}}),/durante/)
 fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx+'\n');assert.throws(()=>validateWorldForBuild(root,{expected:valid}),/durante/)
 assert.equal(validateWorldForBuild(root).configured,true,'same-size content edits are validated at the next build without forcing a graph reexport')
 fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx)
 const source=path.join(root,'world/world.json'),header=path.join(root,'src/generated/world_config.h'),originalSource=fs.readFileSync(source),originalHeader=fs.readFileSync(header)
 const changed=structuredClone(config);changed.rooms[0].entries[0].x=30
 fs.writeFileSync(source,JSON.stringify(changed));assert.throws(()=>validateWorldForBuild(root),/exportar/);fs.writeFileSync(source,originalSource)
 fs.writeFileSync(header,'custom');assert.throws(()=>validateWorldForBuild(root),/personalizado/);assert.equal(fs.readFileSync(header,'utf8'),'custom');fs.writeFileSync(header,originalHeader)
 fs.unlinkSync(source);assert.throws(()=>validateWorldForBuild(root,{expected:valid}),/removido/);fs.writeFileSync(source,originalSource)
 const broken=structuredClone(config);broken.rooms[0].exits=[{id:'missing',area:{x:0,y:0,width:1,height:1},targetRoom:'absent',targetEntry:'spawn',requires:[]}]
 fs.writeFileSync(source,JSON.stringify(broken));assert.throws(()=>validateWorldForBuild(root),/Broken/);fs.writeFileSync(source,originalSource)
 fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx.replace('width="40"','width="41"'));assert.throws(()=>validateWorldForBuild(root),/dimensions/);fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx)
 fs.symlinkSync(path.join(root,'maps/a.tmx'),path.join(root,'maps/link.tmx'));const linked=structuredClone(config);linked.rooms[0].map='maps/link.tmx';fs.writeFileSync(source,JSON.stringify(linked));assert.throws(()=>validateWorldForBuild(root),/regular file/);fs.writeFileSync(source,originalSource)
 fs.unlinkSync(path.join(root,'maps/link.tmx'))
 assert.deepEqual(validateWorldForBuild(outside),{configured:false})
 if(process.platform!=='win32'){
  const emulator=path.join(temporary,'emulator');fs.writeFileSync(emulator,'#!/bin/sh\nprintf launched > "'+path.join(root,'emulator-ran')+'"\n');fs.chmodSync(emulator,0o700)
  const emulatorSource=fs.readFileSync(new URL('../electron/retro/emulatorUtils.js',import.meta.url),'utf8'),findRom=emulatorSource.slice(emulatorSource.indexOf('export function findRomOutput')).replace('export function','function')
  async function importBuild(name){
   let code=fs.readFileSync(new URL('../electron/retro/'+name+'.js',import.meta.url),'utf8')
   code=code.replace("import { loadConfigFile } from './utils.js'",'const loadConfigFile = (_name,fallback) => fallback')
    .replace("import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'",'const resolveEmulatorPath = () => '+JSON.stringify(emulator)+'\n'+findRom)
    .replace("import { ipcMain } from 'electron'",'export const fixtureHandlers=new Map();const ipcMain={on(name,fn){fixtureHandlers.set(name,fn)}}')
   code=code.replace("'../../shared/retro/toolchain.js'",JSON.stringify(new URL('../shared/retro/toolchain.js',import.meta.url).href)).replace("'../../shared/retro/buildProgress.js'",JSON.stringify(new URL('../shared/retro/buildProgress.js',import.meta.url).href))
   for(const module of ['environment','errorParser','buildSnapshot','worldConfiguration','cameraConfiguration','progressConfiguration','audioConfiguration','cutsceneAdapter','debugConfiguration','paletteConfiguration','buildFlavor','hudConfiguration','gameHost','enemyConfiguration'])code=code.replace("'./"+module+".js'",JSON.stringify(new URL('../electron/retro/'+module+'.js',import.meta.url).href))
   const file=path.join(temporary,name+'.mjs');fs.writeFileSync(file,code);return import(pathToFileURL(file).href)
  }
  const tools=await importBuild('buildForTools'),ide=await importBuild('game');ide.setupGameHandlers()
  const makefile=path.join(root,'Makefile'),marker=path.join(root,'make-ran'),rom=path.join(root,'out/rom.bin')
  const make='all:\n\tprintf ran > make-ran\n\tmkdir -p out\n\tprintf fixture > out/rom.bin\n'
  fs.writeFileSync(makefile,make)
  const runIde=({play=false,clean=false}={})=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('IDE build did not finish')),10000)
   const event={reply(channel,payload){if(['retro:run-game-error','retro:build-complete','retro:run-game-build-complete'].includes(channel)){clearTimeout(timer);resolve({channel,payload})}}}
   ide.fixtureHandlers.get(play?'retro:run-game':'retro:build-only')(event,{path:root,toolkitPath:toolkit,clean})
  })
  let result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,true,result.error);assert.equal(result.worldValidation.configured,true)
  const receipt=path.join(root,'.retro-studio/builds/latest.json'),priorReceipt=fs.readFileSync(receipt),priorRom=fs.readFileSync(rom)
  fs.unlinkSync(marker);fs.writeFileSync(source,JSON.stringify(broken))
  result=await tools.runBuildAsync(root,toolkit,{clean:true});assert.equal(result.success,false);assert.equal(result.validation.stage,'before-build');assert.match(result.error,/Broken/);assert.equal(fs.existsSync(marker),false)
  result=await runIde({play:true});assert.equal(result.channel,'retro:run-game-error');assert.equal(result.payload.validation.stage,'before-build');assert.equal(fs.existsSync(marker),false);assert.equal(fs.existsSync(path.join(root,'emulator-ran')),false)
  assert.deepEqual(fs.readFileSync(rom),priorRom);assert.deepEqual(fs.readFileSync(receipt),priorReceipt)
  fs.writeFileSync(source,originalSource)
  fs.writeFileSync(makefile,make+'\tprintf "\\n" >> maps/a.tmx\n')
  result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,false);assert.equal(result.validation.stage,'after-build');assert.deepEqual(fs.readFileSync(receipt),priorReceipt)
  fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx)
  result=await runIde({play:true});assert.equal(result.channel,'retro:run-game-error');assert.equal(result.payload.validation.stage,'after-build');assert.equal(fs.existsSync(path.join(root,'emulator-ran')),false);assert.deepEqual(fs.readFileSync(receipt),priorReceipt)
  fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx);fs.writeFileSync(makefile,make)
  result=await runIde();assert.equal(result.channel,'retro:build-complete');assert.equal(result.payload.worldValidation.configured,true)
  result=await runIde({play:true});assert.equal(result.channel,'retro:run-game-build-complete');assert.equal(result.payload.worldValidation.roomCount,1)
  await new Promise(r=>setTimeout(r,60));assert.equal(fs.readFileSync(path.join(root,'emulator-ran'),'utf8'),'launched')
  fs.unlinkSync(source);result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,true);assert.equal(result.worldValidation.configured,false,'legacy Makefiles continue to run')
  fs.writeFileSync(source,originalSource)
  installRuntimeModules(root);fs.mkdirSync(path.join(root,'res'),{recursive:true});fs.writeFileSync(path.join(root,'res/resources.res'),'');fs.writeFileSync(path.join(root,'retro-studio.json'),'{"mapExport":{}}')
  await saveWorldConfigurationWithMaps(root,{config,revision:worldConfigurationStatus(root).revision})
  result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,true,result.error);assert.equal(result.worldValidation.assetsConfigured,true)
  const managedReceipt=fs.readFileSync(receipt),asset=path.join(root,'res/generated/world-'+worldNumericId('hall')+'-bg.png'),assetBytes=fs.readFileSync(asset)
  fs.unlinkSync(marker);fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx+'\n')
  result=await tools.runBuildAsync(root,toolkit,{clean:true});assert.equal(result.success,false);assert.equal(result.validation.stage,'before-build');assert.equal(fs.existsSync(marker),false)
  result=await runIde();assert.equal(result.channel,'retro:run-game-error');assert.equal(result.payload.validation.stage,'before-build');assert.deepEqual(fs.readFileSync(receipt),managedReceipt)
  fs.writeFileSync(path.join(root,'maps/a.tmx'),tmx)
  const append='\tprintf manual >> res/generated/world-'+worldNumericId('hall')+'-bg.png\n';fs.writeFileSync(makefile,make+append)
  result=await tools.runBuildAsync(root,toolkit);assert.equal(result.success,false);assert.equal(result.validation.stage,'after-build');assert.deepEqual(fs.readFileSync(receipt),managedReceipt)
  fs.writeFileSync(asset,assetBytes);fs.unlinkSync(path.join(root,'emulator-ran'))
  result=await runIde({play:true});assert.equal(result.channel,'retro:run-game-error');assert.equal(result.payload.validation.stage,'after-build');assert.equal(fs.existsSync(path.join(root,'emulator-ran')),false);assert.deepEqual(fs.readFileSync(receipt),managedReceipt)
  fs.writeFileSync(asset,assetBytes);fs.writeFileSync(makefile,make)
 }
 assert.equal(worldConfigurationStatus(root).revision,saved.revision,'build gate never changes graph outputs')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('World build gate: source/header/maps, broken links, symlinks, before/after actual IDE+tools make, last receipt preservation, emulator guard and legacy opt-out passed.')
