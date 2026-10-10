// #55: managed map save refreshes every room; build rejects stale source/artifacts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {worldConfigurationStatus,saveWorldConfigurationWithMaps,validateWorldForBuild} from '../electron/retro/worldConfiguration.js'
import {runConfiguredMapExporter} from '../electron/retro/mapExporter.js'
const execute=promisify(execFile),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-refresh-'))
try{
 const root=path.join(temporary,'game');fs.mkdirSync(root);for(const name of ['maps','res','tools'])fs.mkdirSync(path.join(root,name));installRuntimeModules(root)
 fs.writeFileSync(path.join(root,'res/resources.res'),'')
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({mapExport:{script:'tools/export-map.py',sourceMaps:['maps/hall.tmx'],runtimeGeometry:true}}))
 const legacyTool=path.join(root,'tools/export-map.py');fs.copyFileSync(fileURLToPath(new URL('../assets/toolkit/examples/sgdk-skeleton/tools/export-map.py',import.meta.url)),legacyTool)
 const art=color=>execute('python3',['-c','from PIL import Image; Image.new("RGBA",(16,16),tuple('+JSON.stringify(color)+')).save("maps/art.png")'],{cwd:root})
 await art([224,96,32,255])
 const save=(id,solid=false)=>fs.writeFileSync(path.join(root,'maps',id+'.tmx'),toTMX({width:8,height:4,background:{path:'art.png',fit:'repeat'},collision:Array(32).fill(solid?31:0),tilesets:[{firstgid:1,columns:2,tilecount:4,path:'art.png'}],objects:id==='hall'?[{id:1,type:'lamp',x:1,y:1,width:1,height:1,visual:{gid:1,width:1,height:1,frames:1,fps:4,loop:true}}]:[]}))
 save('hall',true);save('cave')
 await execute('python3',[legacyTool],{cwd:root})
 const oldSprite=JSON.parse(fs.readFileSync(path.join(root,'res/generated/map-manifest.json'))).objectResources[0]
 const room=id=>({id,name:id,map:'maps/'+id+'.tmx',width:64,height:32,entries:[{id:'spawn',x:8,y:16,facing:false}],exits:[],checkpoints:[]})
 const config={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},conditions:[],rooms:[room('hall'),room('cave')]}
 await saveWorldConfigurationWithMaps(root,{config,revision:worldConfigurationStatus(root).revision})
 const first=validateWorldForBuild(root);assert.equal(first.assetsConfigured,true)
 const refresh=id=>runConfiguredMapExporter({projectPath:root,mapPath:path.join(root,'maps',id+'.tmx')})
 save('cave',true);assert.throws(()=>validateWorldForBuild(root),/mapas ou imagens/)
 const updated=await refresh('cave');assert.equal(updated.success,true,updated.error);assert.equal(updated.world,true);assert.equal(updated.transaction.mapsExported,2,'Room absent from legacy sourceMaps refreshes the world')
 assert.match(fs.readFileSync(path.join(root,'src/generated/world_room_'+worldNumericId('cave')+'.h'),'utf8'),/31,31/)
 assert.equal(validateWorldForBuild(root).assetsConfigured,true)
 assert.notEqual(validateWorldForBuild(root).signature,first.signature)
 assert.equal((await refresh('cave')).transaction.transactionId,null,'Identical save has no new generation journal')
 await art([32,96,224,255]);assert.throws(()=>validateWorldForBuild(root),/mapas ou imagens/)
 assert.equal((await refresh('hall')).success,true)
 const refreshed=validateWorldForBuild(root)
 // The existing skeleton Makefile regenerates its single-map derivatives too.
 await execute('python3',[legacyTool],{cwd:root})
 assert.deepEqual(validateWorldForBuild(root),refreshed,'Known legacy derivatives do not invalidate the managed room source snapshot')
 assert.ok(fs.readFileSync(path.join(root,'res/resources.res'),'utf8').includes('SPRITE '+oldSprite.symbol+' '),'Old world-owned shared sprite declaration survives legacy regeneration')
 const image=path.join(root,'res/generated/world-'+worldNumericId('hall')+'-bg.png'),imageBytes=fs.readFileSync(image)
 fs.appendFileSync(image,'manual');assert.throws(()=>validateWorldForBuild(root),/modified or missing/)
 const failed=await refresh('hall');assert.equal(failed.success,false);assert.match(failed.error,/customized or unmanaged/);assert.ok(fs.readFileSync(image).subarray(imageBytes.length).equals(Buffer.from('manual')))
 fs.writeFileSync(image,imageBytes)
 const runtime=path.join(root,'src/retro_runtime/retro_world_sgdk.c'),runtimeBytes=fs.readFileSync(runtime)
 fs.appendFileSync(runtime,'\n// custom\n');assert.throws(()=>validateWorldForBuild(root),/runtime changed/);fs.writeFileSync(runtime,runtimeBytes)
 const ledger=path.join(root,'.retrostudio/world-map-export.json'),ledgerBytes=fs.readFileSync(ledger),record=JSON.parse(ledgerBytes)
 fs.unlinkSync(ledger);assert.throws(()=>validateWorldForBuild(root),/record is missing/);fs.writeFileSync(ledger,ledgerBytes)
 fs.writeFileSync(ledger,JSON.stringify({...record,activeFiles:record.activeFiles.filter(name=>name!==path.relative(root,image).split(path.sep).join('/'))}));assert.throws(()=>validateWorldForBuild(root),/manifest disagrees/);fs.writeFileSync(ledger,ledgerBytes)
 fs.writeFileSync(ledger,JSON.stringify({...record,version:1}));assert.throws(()=>validateWorldForBuild(root),/novamente/);assert.equal((await refresh('hall')).success,true);assert.equal(JSON.parse(fs.readFileSync(ledger)).version,2)
 assert.equal(validateWorldForBuild(root).assetsConfigured,true)
 console.log('World refresh: saved room outside legacy sourceMaps, all room resources, no-op, changed art, derived/custom/runtime guards, legacy shared sprites and v1 generation upgrade passed.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
