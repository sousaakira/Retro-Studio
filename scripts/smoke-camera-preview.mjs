// #59: preview controller (JS) vs distributed C, same exported data and inputs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createCameraConfiguration,compileCameraHeader,cameraRegionRows} from '../shared/retro/cameraConfiguration.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {createCameraController,CAMERA_FLAGS} from '../shared/retro/cameraController.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-camera-parity-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 const config=createCameraConfiguration()
 Object.assign(config.profiles.pal,{maxSpeedX:6.5,maxSpeedY:3,smoothingX:3,smoothingY:0,deadZoneWidth:17,deadZoneHeight:63,focusX:-33,focusY:21,lookAheadX:40,lookAheadSpeed:.75,scriptReturnSpeed:2.25})
 const room={id:'cave',regions:[
  {id:'corridor',name:'Corredor',area:{x:320,y:0,width:320,height:448},limits:{x:320,y:0,width:320,height:224},priority:1,lock:false,transitionSpeed:2},
  {id:'shaft',name:'Poço',area:{x:400,y:0,width:80,height:448},limits:{x:320,y:224,width:320,height:224},priority:5,lock:false,transitionSpeed:4.5},
  {id:'arena',name:'Arena',area:{x:800,y:0,width:160,height:448},limits:{x:720,y:0,width:320,height:224},priority:3,lock:true,transitionSpeed:4},
  {id:'cut',name:'Corte',area:{x:1100,y:0,width:100,height:448},limits:{x:960,y:224,width:320,height:224},priority:1,lock:false,transitionSpeed:0}
 ]}
 config.rooms.push(room)
 const rooms={cave:{width:1280,height:448}}
 fs.mkdirSync(path.join(temporary,'generated'));fs.mkdirSync(path.join(temporary,'retro_runtime'))
 fs.writeFileSync(path.join(temporary,'generated/camera_config.h'),compileCameraHeader(config,{rooms}))
 for(const name of ['core/retro_core.h','camera/retro_camera.h','camera/retro_camera.c'])
  fs.copyFileSync(path.join(library,name),path.join(temporary,'retro_runtime',path.basename(name)))
 // Deterministic walk in Q8 with direction changes, unlocks and scripted spans.
 let seed=0x2F6E2B1
 const random=()=>(seed=(Math.imul(seed,1103515245)+12345)>>>0)/4294967296
 const trace=[];let x=100*256,y=200*256,vx=0,vy=0
 for(let i=0;i<3000;i++){
  if(i%37===0){vx=Math.round((random()-.42)*12*256);vy=Math.round((random()-.5)*8*256)}
  x=Math.max(0,Math.min(1279*256,x+vx));y=Math.max(0,Math.min(447*256,y+vy))
  const event=i%211===200?1:i%503===300?2:i%503===380?3:i%997===600?4:i%997===650?5:0
  trace.push([x,y,vx>64?1:vx<-64?-1:0,event,Math.floor(random()*1400)-60,Math.floor(random()*500)-20])
 }
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <stdio.h>
#include <string.h>
#include "generated/camera_config.h"
static const long trace[][6]={${trace.map(row=>'{'+row+'}').join(',')}};
int main(int argc,char **argv){
 const RetroCameraConfig *config=argc>1&&argv[1][0]=='p'?&retroProjectCameraPal:&retroProjectCameraNtsc;
 RetroCamera cam;RetroCameraResult r;unsigned i;
 if(RETRO_PROJECT_CAMERA_ROOM_COUNT!=1||retroProjectCameraRooms[0].room!=${worldNumericId('cave')}||retroProjectCameraRooms[0].count!=4)return 4;
 memset(&cam,0,sizeof(cam));
 if(!retroCameraValidate(config)||!retroCameraInit(&cam,320,224))return 1;
 if(!retroCameraEnterRoom(&cam,config,1280,448,retroProjectCameraRooms[0].regions,retroProjectCameraRooms[0].count,trace[0][0],trace[0][1],1))return 2;
 for(i=0;i<sizeof(trace)/sizeof(trace[0]);i++){
  if(trace[i][3]==1)retroCameraUnlock(&cam);
  if(trace[i][3]==2)retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X,(int32_t)trace[i][4],0);
  if(trace[i][3]==4)retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X|RETRO_CAMERA_AXIS_Y,(int32_t)trace[i][4],(int32_t)trace[i][5]);
  if(trace[i][3]==3)retroCameraScriptRelease(&cam);
  if(trace[i][3]==5)retroCameraCutsceneSet(&cam,1,0); /* releases X only */
  r=retroCameraTick(&cam,config,(RetroFixed)trace[i][0],(RetroFixed)trace[i][1],(signed char)trace[i][2]);
  if(r.invalid)return 3;
  printf("%d,%d,%d,%d,%ld,%ld,%ld,%d,%d,%d,%d,%d,%d\\n",r.x,r.y,r.region,r.flags,(long)cam.x,(long)cam.y,(long)cam.look,
   cam.region,cam.released,cam.locked,cam.transition,cam.script,cam.returning);
 }
 return 0;
}
`)
 const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I'+temporary,fixture,path.join(temporary,'retro_runtime/retro_camera.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const rows=cameraRegionRows(room)
 assert.deepEqual(rows.map(row=>row.source),['arena','corridor','cut','shaft'],'exported rows are sorted by stable ID')
 const seen={transition:0,locked:0,script:0,regionChanged:0,moved:0}
 for(const region of ['ntsc','pal']){
  const native=spawnSync(binary,[region],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(native.status,0,native.stderr)
  const expected=native.stdout.trim().split('\n').map(row=>row.split(',').map(Number))
  const camera=createCameraController(config.profiles[region])
  assert.ok(camera.enterRoom(1280,448,rows,trace[0][0],trace[0][1],1))
  trace.forEach(([tx,ty,direction,event,sx,sy],i)=>{
   if(event===1)camera.unlock()
   if(event===2)camera.scriptSet(1,sx,0)
   if(event===4)camera.scriptSet(3,sx,sy)
   if(event===3)camera.scriptRelease()
   if(event===5)camera.scriptRelease(1)
   const r=camera.tick(tx,ty,direction),s=camera.state()
   assert.ok(!r.invalid)
   assert.deepEqual([r.x,r.y,r.region,r.flags,s.x,s.y,s.look,s.region,s.released,s.locked,s.transition,s.script,s.returning],expected[i],region+' tick '+i)
   for(const key of Object.keys(seen))if(r.flags&CAMERA_FLAGS[key])seen[key]++
  })
 }
 for(const [key,count] of Object.entries(seen))assert.ok(count>20,'trace must exercise '+key+' ('+count+')')
 // Rejections mirror the C contract and never change the instance.
 const camera=createCameraController(config.profiles.ntsc)
 assert.equal(camera.tick(0,0,0).invalid,true,'tick before entering a room');assert.equal(camera.bounds(),null)
 assert.equal(camera.enterRoom(1280,448,[{...rows[0],limits:{x:0,y:0,width:4000,height:224}}],0,0,0),false)
 assert.ok(camera.enterRoom(1280,448,rows,100*256,100*256,0));const before=camera.state()
 assert.equal(camera.tick(100.5,0,0).invalid,true);assert.equal(camera.tick(0,0,2).invalid,true)
 assert.equal(camera.scriptSet(4,0,0),false);assert.equal(camera.unlock(),false);assert.deepEqual(camera.state(),before)
 assert.deepEqual(camera.bounds(),{x:0,y:0,width:1280,height:448})
 assert.throws(()=>createCameraController({...config.profiles.ntsc,maxSpeedX:.1}),/precision/)
 assert.throws(()=>createCameraController(config.profiles.ntsc,{width:400,height:224}),/view/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Camera preview: 6000 native C/JS parity ticks from the exported header, both regions, regions/locks/scripts exercised and rejected inputs passed.')
