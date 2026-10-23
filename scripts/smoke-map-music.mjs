import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {worldConfigurationStatus,saveWorldConfigurationWithMaps,validateWorldForBuild} from '../electron/retro/worldConfiguration.js'
import {audioConfigurationStatus,saveAudioConfiguration,validateAudioForBuild} from '../electron/retro/audioConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-map-music-'))
try {
 const root=path.join(temporary,'game');fs.mkdirSync(root);fs.mkdirSync(path.join(root,'maps'));fs.mkdirSync(path.join(root,'res'))
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({mapExport:{playerFrame:{width:24,height:32},playerHitbox:{x:7,y:6,w:10,h:26}}}))
 fs.writeFileSync(path.join(root,'res/resources.res'),'// custom resources\n')
 installRuntimeModules(root)
 const room=id=>({id,name:id,map:'maps/'+id+'.tmx',width:64,height:32,entries:[{id:'spawn',x:8,y:16,facing:false}],exits:[],checkpoints:[]})
 const config={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},rooms:[room('hall'),room('cave')],conditions:[]}
 const saveMap=(id,musicTrack='')=>fs.writeFileSync(path.join(root,'maps/'+id+'.tmx'),toTMX({width:8,height:4,collision:Array(32).fill(0),musicTrack}))
 const publish=options=>saveWorldConfigurationWithMaps(root,{config,revision:worldConfigurationStatus(root).revision,...options})
 saveMap('hall');saveMap('cave');await publish()
 const audio={format:'retro-studio.audio',version:1,driver:'xgm',effectChannels:3,effects:[],music:[{id:'z_theme',name:'Z',source:'res/z.vgm',timing:'auto'},{id:'a_theme',name:'A',source:'res/a.vgm',timing:'auto'}],rooms:[{room:'hall',music:'a_theme'},{room:'cave',music:'a_theme'}]}
 for(const name of ['a','z'])fs.writeFileSync(path.join(root,'res/'+name+'.vgm'),'Vgm ')
 saveAudioConfiguration(root,{config:audio,revision:audioConfigurationStatus(root).revision})
 saveMap('hall','z_theme');const mapBefore=fs.readFileSync(path.join(root,'maps/hall.tmx'))
 await publish()
 const saved=JSON.parse(fs.readFileSync(path.join(root,'audio/audio.json')))
 assert.equal(saved.rooms.find(r=>r.room==='hall').music,'z_theme')
 assert.equal(saved.rooms.find(r=>r.room==='cave').music,'a_theme','empty selection preserves room default')
 assert.deepEqual(saved.music,audio.music,'catalog order and settings stay intact')
 assert.deepEqual(fs.readFileSync(path.join(root,'maps/hall.tmx')),mapBefore,'map metadata is preserved')
 const header=fs.readFileSync(path.join(root,'src/generated/audio_config.h'),'utf8')
 assert.ok(header.includes('{'+worldNumericId('hall')+',1}'),'runtime consumes selected track in ID order')
 assert.ok(header.includes('{'+worldNumericId('cave')+',0}'))
 validateAudioForBuild(root);validateWorldForBuild(root)
 assert.match(fs.readFileSync(path.join(root,'src/generated/world_room_'+worldNumericId('hall')+'.h'),'utf8'),/_PLAYER_HITBOX_W 10/)
 const before=new Map(['audio/audio.json','src/generated/audio_config.h','.retrostudio/audio-export.json','src/generated/world_maps.h'].map(name=>[name,fs.readFileSync(path.join(root,name))]))
 saveMap('hall','missing_track');await assert.rejects(()=>publish(),/unknown music|não encontrada|desconhecida/i)
 for(const [name,bytes] of before)assert.deepEqual(fs.readFileSync(path.join(root,name)),bytes,'invalid music preserves '+name)
 saveMap('hall','a_theme')
 await assert.rejects(()=>publish({beforePublish(index,target){if(target==='src/generated/audio_config.h')throw Error('audio disk failure')}}),/audio disk failure/)
 for(const [name,bytes] of before)assert.deepEqual(fs.readFileSync(path.join(root,name)),bytes,'rollback preserves '+name)
 await publish();validateAudioForBuild(root);validateWorldForBuild(root)
 console.log('Map music: selection exported to runtime, defaults/settings preserved, invalid IDs and rollback covered')
} finally {fs.rmSync(temporary,{recursive:true,force:true})}
