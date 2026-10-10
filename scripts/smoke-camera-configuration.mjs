// #59: framing profiles/regions exported into the real C controller, project isolation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {CAMERA_FIELDS,createCameraConfiguration,compileCameraHeader,validateCameraConfiguration} from '../shared/retro/cameraConfiguration.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {cameraConfigurationStatus,saveCameraConfiguration,validateCameraForBuild} from '../electron/retro/cameraConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-camera-config-'))
const world=rooms=>JSON.stringify({format:'retro-studio.world',version:1,initial:{room:rooms[0].id,entry:'spawn'},conditions:[],
 rooms:rooms.map(room=>({...room,name:room.id,map:'maps/'+room.id+'.tmx',entries:[{id:'spawn',x:24,y:160,facing:false}],exits:[],checkpoints:[]}))})
try{
 const root=path.join(temporary,'game'),other=path.join(temporary,'other')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 fs.mkdirSync(other);installRuntimeModules(root);installCutsceneRuntime(root)
 assert.ok(fs.statSync(path.join(root,'src/retro_runtime/retro_camera.c')).isFile(),'runtime installer distributes the camera module')
 const original=fs.readFileSync(path.join(root,'src/main.c'),'utf8'),otherStatus=cameraConfigurationStatus(other)
 assert.deepEqual(validateCameraForBuild(root),{configured:false},'projects without a camera source are never gated')
 let status=cameraConfigurationStatus(root)
 assert.deepEqual(status.config,createCameraConfiguration());assert.ok(!status.headerConflict);assert.deepEqual(status.rooms,[])
 // Profiles alone need no world graph.
 const config=structuredClone(status.config);config.profiles.pal.maxSpeedX=6;config.profiles.pal.deadZoneWidth=64
 let saved=saveCameraConfiguration(root,{config,revision:status.revision});assert.notEqual(saved.revision,status.revision)
 assert.deepEqual(saved.config,config);assert.deepEqual(cameraConfigurationStatus(other),otherStatus)
 assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),original)
 assert.throws(()=>saveCameraConfiguration(root,{config,revision:status.revision}),/changed/)
 // Regions require the room to exist in the world graph and to fit its pixels.
 const region={id:'arena',name:'Arena',area:{x:800,y:0,width:160,height:448},limits:{x:720,y:0,width:320,height:224},priority:3,lock:true,transitionSpeed:4}
 config.rooms=[{id:'cave',regions:[region,{id:'corridor',name:'Corredor',area:{x:320,y:0,width:320,height:448},limits:{x:320,y:224,width:320,height:224},priority:1,lock:false,transitionSpeed:.5}]}]
 assert.throws(()=>saveCameraConfiguration(root,{config,revision:saved.revision}),/not in the world graph/)
 fs.mkdirSync(path.join(root,'world'));fs.writeFileSync(path.join(root,'world/world.json'),world([{id:'cave',width:1280,height:448},{id:'hall',width:256,height:200}]))
 status=cameraConfigurationStatus(root)
 assert.deepEqual(status.rooms.map(room=>[room.id,room.width,room.height,room.entries[0].x]),[['cave',1280,448,24],['hall',256,200,24]]);assert.equal(status.worldError,'')
 saved=saveCameraConfiguration(root,{config,revision:status.revision})
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'camera/camera.json'),'utf8')),config)
 const headerPath=path.join(root,'src/generated/camera_config.h'),header=fs.readFileSync(headerPath,'utf8')
 assert.equal(header,compileCameraHeader(config,{rooms:{cave:{width:1280,height:448},hall:{width:256,height:200}}}))
 assert.deepEqual(validateCameraForBuild(root),{configured:true,revision:saved.revision,roomCount:1})
 // Validation: precision, timing policy, bounds, screen-sized limits and explicit priority.
 const rooms={cave:{width:1280,height:448},hall:{width:256,height:200}}
 const reject=(change,pattern)=>{const bad=structuredClone(config);change(bad);assert.throws(()=>validateCameraConfiguration(bad,{rooms}),pattern)}
 reject(bad=>{bad.profiles.ntsc.maxSpeedX=.1},/precision/);reject(bad=>{bad.profiles.ntsc.maxSpeedY=0},/range/)
 reject(bad=>{bad.profiles.pal.smoothingX=7},/range/);reject(bad=>{bad.profiles.pal.deadZoneWidth=1.5},/precision/)
 reject(bad=>{bad.profiles.ntsc.lookAheadSpeed=0},/look-ahead needs a speed/);reject(bad=>{bad.profiles.ntsc.followX=1},/follow/)
 reject(bad=>{bad.rooms[0].regions[0].area.width=600},/exceeds room bounds/)
 reject(bad=>{bad.rooms[0].regions[0].limits.width=300},/smaller than the screen/)
 reject(bad=>{bad.rooms[0].regions[1].priority=3;bad.rooms[0].regions[1].area.x=700},/overlap with the same priority/)
 reject(bad=>{bad.rooms[0].regions[1].id='arena'},/Duplicate/);reject(bad=>{bad.rooms[0].regions[0].priority=256},/priority/)
 reject(bad=>{bad.rooms[0].regions[0].transitionSpeed=33},/transition speed/);reject(bad=>{bad.rooms[0].regions[0].lock=1},/lock/)
 reject(bad=>{bad.rooms.push({id:'cave',regions:[]})},/duplicate camera room/i);reject(bad=>{bad.rooms[0].id='missing'},/not in the world graph/)
 for(const timing of ['real-time','auto',undefined])assert.throws(()=>validateCameraConfiguration({...config,timing}),/timing policy/)
 // Inherited Object keys never stand in for a world room.
 reject(bad=>{bad.rooms[0].id='constructor'},/not in the world graph/);reject(bad=>{bad.rooms[0].id='toString'},/not in the world graph/)
 // A room smaller than the screen accepts limits of its own size.
 const small=structuredClone(config);small.rooms.push({id:'hall',regions:[{id:'all',name:'Tudo',area:{x:0,y:0,width:256,height:200},limits:{x:0,y:0,width:256,height:200},priority:0,lock:false,transitionSpeed:0}]})
 validateCameraConfiguration(small,{rooms})
 const invalid=structuredClone(config);invalid.rooms[0].regions[0].limits.height=100
 assert.throws(()=>saveCameraConfiguration(root,{config:invalid,revision:saved.revision}),/smaller than the screen/)
 assert.equal(fs.readFileSync(headerPath,'utf8'),header)
 // Exported header -> distributed C controller.
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "generated/camera_config.h"
int main(void){
 RetroCameraConfig preset;RetroCamera camera;RetroCameraResult r;RetroRect b;int i;
 retroCameraPreset(&preset);
 ${CAMERA_FIELDS.map(([name])=>`assert(preset.${name}==retroProjectCameraNtsc.${name});`).join('\n ')}
 assert(preset.followX==retroProjectCameraNtsc.followX&&preset.followY==retroProjectCameraNtsc.followY);
 assert(retroCameraValidate(&retroProjectCameraNtsc)&&retroCameraValidate(&retroProjectCameraPal));
 assert(retroProjectCameraPal.maxSpeedX==1536&&retroProjectCameraPal.deadZoneWidth==64);
 assert(RETRO_PROJECT_CAMERA_ROOM_COUNT==1&&retroProjectCameraRooms[0].room==${worldNumericId('cave')}&&retroProjectCameraRooms[0].count==2);
 assert(retroProjectCameraRooms[0].regions[0].id==${worldNumericId('arena')}&&retroProjectCameraRooms[0].regions[0].flags==RETRO_CAMERA_REGION_LOCK);
 assert(retroProjectCameraRooms[0].regions[1].transitionSpeed==128&&retroProjectCameraRooms[0].regions[1].priority==1);
 memset(&camera,0,sizeof(camera));assert(retroCameraInit(&camera,320,224));
 assert(retroCameraEnterRoom(&camera,&retroProjectCameraPal,1280,448,retroProjectCameraRooms[0].regions,2,100*256,200*256,1));
 for(i=0;i<600;i++){r=retroCameraTick(&camera,&retroProjectCameraPal,810*256,100*256,1);assert(!r.invalid);}
 assert(r.region==${worldNumericId('arena')}&&(r.flags&RETRO_CAMERA_LOCKED)&&r.x==720&&r.y==0);
 assert(retroCameraBounds(&camera,&b)&&b.x==720&&b.width==320);
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime')
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+path.join(root,'src'),'-I'+runtime]
 const built=spawnSync('cc',[...flags,fixture,path.join(runtime,'retro_camera.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const sdk=process.argv[sdkIndex+1]
  // Separate temporary game: a 512x448 room that fits one scrolling plane.
  const game=path.join(temporary,'rom')
  fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),game,{recursive:true})
  installRuntimeModules(game);installCutsceneRuntime(game)
  fs.mkdirSync(path.join(game,'world'));fs.writeFileSync(path.join(game,'world/world.json'),world([{id:'lab',width:512,height:448}]))
  const lab=createCameraConfiguration()
  lab.rooms=[{id:'lab',regions:[
   {id:'arena',name:'Arena',area:{x:384,y:224,width:128,height:224},limits:{x:192,y:224,width:320,height:224},priority:3,lock:true,transitionSpeed:4},
   {id:'upper',name:'Corredor superior',area:{x:256,y:0,width:256,height:224},limits:{x:0,y:0,width:512,height:224},priority:1,lock:false,transitionSpeed:2}]}]
  saveCameraConfiguration(game,{config:lab,revision:cameraConfigurationStatus(game).revision})
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/camera-diagnostic.c'),path.join(game,'src/main.c'))
  const sdkBuild=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:game,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(sdkBuild.status,0,sdkBuild.stdout.slice(-4000)+sdkBuild.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(game,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  const keep=process.argv.indexOf('--keep-rom')
  if(keep>=0)fs.copyFileSync(path.join(game,'out/rom.bin'),process.argv[keep+1])
  console.log('PASS exported camera -> shared camera C -> SGDK ROM ('+rom.length+' bytes)')
 }
 // World changes that invalidate regions are refused before the build.
 fs.writeFileSync(path.join(root,'world/world.json'),world([{id:'cave',width:640,height:448}]))
 assert.match(cameraConfigurationStatus(root).worldError,/exceeds room bounds/)
 assert.throws(()=>validateCameraForBuild(root),/exceeds room bounds/)
 fs.writeFileSync(path.join(root,'world/world.json'),world([{id:'cave',width:1280,height:448},{id:'hall',width:256,height:200}]))
 assert.equal(validateCameraForBuild(root).configured,true)
 // Stale source and customized header are both reported; nothing is overwritten.
 const edited=structuredClone(config);edited.profiles.ntsc.focusX=-20
 fs.writeFileSync(path.join(root,'camera/camera.json'),JSON.stringify(edited))
 assert.throws(()=>validateCameraForBuild(root),/mudou/)
 fs.writeFileSync(path.join(root,'camera/camera.json'),JSON.stringify(config,null,2)+'\n')
 fs.appendFileSync(headerPath,'/* manual change */')
 assert.ok(cameraConfigurationStatus(root).headerConflict);assert.throws(()=>validateCameraForBuild(root),/personalizado/)
 assert.throws(()=>saveCameraConfiguration(root,{config,revision:cameraConfigurationStatus(root).revision}),/customized/)
 assert.ok(fs.readFileSync(headerPath,'utf8').endsWith('/* manual change */'))
 fs.writeFileSync(path.join(root,'.retrostudio/camera-export.json'),'null')
 assert.throws(()=>cameraConfigurationStatus(root),/Unsupported camera export record/)
 fs.writeFileSync(path.join(root,'camera/camera.json'),'{"version":99}')
 assert.throws(()=>cameraConfigurationStatus(root),/Unsupported/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Camera configuration: explicit regions, Q8 precision, world-bound regions, explicit priority, project isolation, transactional source/header, build gate, conflicts, stale revisions and shared C passed.')
