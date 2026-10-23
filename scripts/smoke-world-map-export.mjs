import './smoke-map-music.mjs'
// #55: actual bundled Python compiler + one transaction, no game workspace writes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {worldConfigurationStatus,saveWorldConfigurationWithMaps} from '../electron/retro/worldConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {publishProjectOutputs,inspectPendingProjectExport,recoverProjectExport} from '../electron/retro/exportTransaction.js'
const execute=promisify(execFile),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-publication-'))
try{
 const root=path.join(temporary,'game');fs.mkdirSync(root);fs.mkdirSync(path.join(root,'maps'));fs.mkdirSync(path.join(root,'res'))
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({mapExport:{}}))
 fs.writeFileSync(path.join(root,'res/resources.res'),'// manual declaration stays\nIMAGE USER_IMAGE "user.png" NONE\n')
 installRuntimeModules(root)
 const saveMap=(name,solid=false)=>fs.writeFileSync(path.join(root,'maps',name+'.tmx'),toTMX({width:8,height:4,collision:Array(32).fill(solid?31:0)}))
 saveMap('hall',true);saveMap('cave')
 const room=id=>({id,name:id,map:'maps/'+id+'.tmx',width:64,height:32,entries:[{id:'spawn',x:8,y:16,facing:false}],exits:[],checkpoints:[]})
 let config={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},rooms:[room('hall'),room('cave')],conditions:[]}
 const publish=options=>saveWorldConfigurationWithMaps(root,{config,revision:worldConfigurationStatus(root).revision,...options})
 const first=await publish();assert.equal(first.success,true);assert.equal(first.mapsExported,2)
 const resources=fs.readFileSync(path.join(root,'res/resources.res'),'utf8');assert.match(resources,/IMAGE USER_IMAGE/)
 assert.match(resources,new RegExp('TILESET RETRO_WORLD_ROOM_'+worldNumericId('hall')+'_TILES'))
 assert.ok(fs.existsSync(path.join(root,'src/generated/world_maps.h')))
 const repeat=await publish();assert.equal(repeat.transactionId,null);assert.equal(repeat.changed.length,0)
 const files=['world/world.json','src/generated/world_config.h','.retrostudio/world-export.json','src/generated/world_maps.h','res/resources.res','.retrostudio/world-map-export.json']
 const before=new Map(files.map(name=>[name,fs.readFileSync(path.join(root,name))]))
 config=structuredClone(config);config.rooms[0].name='renamed';config.rooms[0].entries[0].x=9
 await assert.rejects(()=>publish({beforePublish(index){if(index===1)throw Error('disk unavailable')}}),/disk unavailable/)
 for(const [name,bytes] of before)assert.deepEqual(fs.readFileSync(path.join(root,name)),bytes,'Rollback preserves '+name)
 await assert.rejects(()=>publish({runCompiler:async(...args)=>{await execute(...args);saveMap('cave',true)}}),/inputs changed/)
 for(const [name,bytes] of before)assert.deepEqual(fs.readFileSync(path.join(root,name)),bytes,'Concurrent input failure preserves '+name)
 saveMap('cave')
 const generated=path.join(root,'src/generated/world_maps.h'),original=fs.readFileSync(generated)
 fs.appendFileSync(generated,'\n// custom\n');await assert.rejects(()=>publish(),/customized or unmanaged/);assert.match(fs.readFileSync(generated,'utf8'),/custom/);fs.writeFileSync(generated,original)
 const sourceRes=path.join(root,'res/resources.res');fs.writeFileSync(sourceRes,resources.replace('TILESET RETRO_WORLD_ROOM_','TILESET CUSTOMIZED_ROOM_'))
 await assert.rejects(()=>publish(),/customized or missing/);fs.writeFileSync(sourceRes,resources)
 const manualMap='MAP USER_MAP "generated/world-'+worldNumericId('hall')+'-bg.png" RETRO_WORLD_ROOM_'+worldNumericId('hall')+'_TILES NONE\n'
 const comment='// RETRO_WORLD_ROOM_'+worldNumericId('hall')+'_TILES explanation stays\n'
 fs.appendFileSync(sourceRes,manualMap+comment);await publish()
 const merged=fs.readFileSync(sourceRes,'utf8');assert.ok(merged.indexOf('TILESET RETRO_WORLD_ROOM_'+worldNumericId('hall')+'_TILES')<merged.indexOf('MAP USER_MAP'),'Manual dependency retains declaration order')
 assert.ok(merged.includes(comment),'Comments mentioning managed symbols remain comments')
 saveMap('extra');config.rooms.push(room('extra'));fs.appendFileSync(sourceRes,'IMAGE RETRO_WORLD_ROOM_'+worldNumericId('extra')+' "user.png" NONE\n')
 await assert.rejects(()=>publish(),/Unmanaged resource symbol/)
 config.rooms.pop();fs.writeFileSync(sourceRes,merged)
 const ledgerPath=path.join(root,'.retrostudio/world-map-export.json'),ledgerBytes=fs.readFileSync(ledgerPath),ledger=JSON.parse(ledgerBytes)
 while(ledger.files.length<1024)ledger.files.push({path:'src/generated/world_room_'+(100000+ledger.files.length)+'.h',hash:'a'.repeat(64)})
 fs.writeFileSync(ledgerPath,JSON.stringify(ledger));config.rooms.push(room('extra'))
 await assert.rejects(()=>publish(),/ownership exceeds item limits/)
 assert.deepEqual(JSON.parse(fs.readFileSync(ledgerPath)),ledger,'Oversized next ledger preserves existing record')
 config.rooms.pop();fs.writeFileSync(ledgerPath,ledgerBytes)
 const script=path.join(root,'tools');fs.mkdirSync(script);fs.writeFileSync(path.join(script,'export-world-maps.py'),"raise Exception('project script must not execute')")
 assert.equal((await publish()).success,true,'Only bundled compiler runs')
 config.rooms=config.rooms.filter(r=>r.id==='hall');assert.equal((await publish()).mapsExported,1)
 assert.match(fs.readFileSync(generated,'utf8'),/RETRO_WORLD_MAP_COUNT 1/)
 assert.ok(fs.existsSync(path.join(root,'src/generated/world_room_'+worldNumericId('cave')+'.h')),'Obsolete files retained for consumer reconciliation')
 fs.symlinkSync(path.join(root,'maps/hall.tmx'),path.join(root,'maps/linked.tmx'))
 await assert.rejects(()=>publish(),/cannot contain links/)
 const many=path.join(temporary,'many');fs.mkdirSync(many);fs.mkdirSync(path.join(many,'maps'));fs.mkdirSync(path.join(many,'res'))
 fs.writeFileSync(path.join(many,'retro-studio.json'),'{"mapExport":{}}');fs.writeFileSync(path.join(many,'res/resources.res'),'')
 fs.copyFileSync(path.join(root,'maps/hall.tmx'),path.join(many,'maps/hall.tmx'));installRuntimeModules(many)
 const rooms=[],ids=new Set();for(let n=0;rooms.length<64;n++){const id='room_'+n;if(ids.has(worldNumericId(id)))continue;ids.add(worldNumericId(id));rooms.push({...room(id),map:'maps/hall.tmx'})}
 const maximum={...config,initial:{room:rooms[0].id,entry:'spawn'},rooms}
 const large=await saveWorldConfigurationWithMaps(many,{config:maximum,revision:worldConfigurationStatus(many).revision})
 assert.equal(large.mapsExported,64);assert.ok(large.changed.length>128,'All 64 rooms publish together through scoped transaction capacity')
 const shared=path.join(temporary,'shared');fs.mkdirSync(shared);for(const name of ['maps','res','tools'])fs.mkdirSync(path.join(shared,name));installRuntimeModules(shared)
 fs.writeFileSync(path.join(shared,'res/resources.res'),'');fs.writeFileSync(path.join(shared,'retro-studio.json'),JSON.stringify({mapExport:{sourceMaps:['maps/hall.tmx'],runtimeGeometry:true}}))
 await execute('python3',['-c','from PIL import Image; Image.new("RGBA",(8,8),(224,96,32,255)).save("maps/object.png")'],{cwd:shared})
 fs.writeFileSync(path.join(shared,'maps/hall.tmx'),toTMX({width:8,height:4,tilesets:[{firstgid:1,columns:1,tilecount:1,path:'object.png'}],objects:[{id:1,type:'lamp',x:1,y:1,width:1,height:1,visual:{gid:1,width:1,height:1,frames:1,fps:4,loop:true}}]}))
 const legacyTool=path.join(shared,'tools/export-map.py');fs.copyFileSync(fileURLToPath(new URL('../assets/toolkit/examples/sgdk-skeleton/tools/export-map.py',import.meta.url)),legacyTool)
 await execute('python3',[legacyTool],{cwd:shared})
 const legacy=JSON.parse(fs.readFileSync(path.join(shared,'res/generated/map-manifest.json'))),sprite=legacy.objectResources[0],spriteBytes=fs.readFileSync(path.join(shared,sprite.path))
 const compatible={...config,initial:{room:'hall',entry:'spawn'},rooms:[room('hall')]}
 assert.equal((await saveWorldConfigurationWithMaps(shared,{config:compatible,revision:worldConfigurationStatus(shared).revision})).mapsExported,1)
 assert.deepEqual(fs.readFileSync(path.join(shared,sprite.path)),spriteBytes,'Shared legacy sprite stays byte-identical')
 assert.equal(fs.readFileSync(path.join(shared,'res/resources.res'),'utf8').split('\n').filter(line=>line.startsWith('SPRITE '+sprite.symbol+' ')).length,1,'Shared sprite declaration appears once')
 const crash=path.join(temporary,'crash');fs.mkdirSync(crash)
 const bulk=Array.from({length:129},(_,i)=>({path:'res/'+i+'.bin',bytes:Buffer.from('new')}))
 assert.throws(()=>publishProjectOutputs(crash,bulk),/Invalid export transaction/,'Other producers retain the 128-output limit')
 const moduleUrl=new URL('../electron/retro/exportTransaction.js',import.meta.url).href
 const child='import {publishProjectOutputs} from '+JSON.stringify(moduleUrl)+';publishProjectOutputs('+JSON.stringify(crash)+',Array.from({length:129},(_,i)=>({path:"res/"+i+".bin",bytes:Buffer.from("new")})),{producer:"world-map-export",beforePublish(index){if(index===2)process.exit(23)}})'
 await assert.rejects(()=>execute(process.execPath,['--input-type=module','-e',child]),e=>e.code===23)
 const pending=inspectPendingProjectExport(crash);assert.equal(pending.active,false);assert.equal(pending.outputs.length,129)
 recoverProjectExport(crash,pending.transactionId);assert.equal(inspectPendingProjectExport(crash).pending,false)
 assert.equal(fs.existsSync(path.join(crash,'res/0.bin')),false,'Expanded world journal recovers an actual interrupted process')
 console.log('World publication: real compiler, combined transaction/no-op, rollback, concurrent input guard, manual resources/headers, bundled-only execution, retained obsolete outputs and symlink refusal passed.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
