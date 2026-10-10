// #59: shared camera controller on the host, plus the real cutscene runner.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {compileProject,defaultCutsceneConfig} from '../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-camera-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
const cutscene=fileURLToPath(new URL('../assets/toolkit/lib/cutscene/src/retrostudio/',import.meta.url))
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "retro_camera.h"
#define Q(n) ((RetroFixed)(n)*256)
/* Room 1280x448. Corridor region (low priority), arena (lock) and a cut region. */
static const RetroCameraRegion regions[]={
 {11,{320,0,320,448},{320,0,320,224},Q(2),1,0},
 {22,{400,0,80,448},{320,224,320,224},Q(4),5,0},
 {33,{800,0,160,448},{720,0,320,224},Q(4),3,RETRO_CAMERA_REGION_LOCK},
 {44,{1100,0,100,448},{960,224,320,224},0,1,0}
};
static RetroCameraConfig c;
static RetroCamera cam;
static RetroCameraResult r;
static void tick(int x,int y,int d){r=retroCameraTick(&cam,&c,Q(x),Q(y),(signed char)d);assert(!r.invalid);}
static void settle(int x,int y,int d){int i;for(i=0;i<400;i++)tick(x,y,d);}
int main(void){
 int i;RetroCamera saved;RetroRect b;RetroCameraConfig bad;
 retroCameraPreset(&c);assert(retroCameraValidate(&c)&&c.deadZoneWidth==48&&c.maxSpeedX==2048);
 memset(&cam,0,sizeof(cam));
 assert(!retroCameraInit(&cam,400,224)&&!retroCameraInit(0,320,224));
 assert(!retroCameraEnterRoom(&cam,&c,1280,448,regions,4,Q(100),Q(200),1));
 assert(retroCameraInit(&cam,320,224));
 r=retroCameraTick(&cam,&c,Q(100),Q(200),1);assert(r.invalid);
 assert(!retroCameraBounds(&cam,&b));

 /* Limits: entering a room cuts to the clamped framing with full look-ahead. */
 assert(retroCameraEnterRoom(&cam,&c,1280,448,regions,4,Q(100),Q(200),1));
 assert(cam.x==0&&cam.y==Q(88)&&cam.look==Q(24));
 assert(retroCameraBounds(&cam,&b)&&b.x==0&&b.y==0&&b.width==1280&&b.height==448);
 assert(retroCameraEnterRoom(&cam,&c,1280,448,regions,4,Q(1270),Q(440),-1)&&cam.x==Q(960)&&cam.y==Q(224));
 /* A room smaller than the screen stays at its origin. */
 assert(retroCameraEnterRoom(&cam,&c,256,200,0,0,Q(200),Q(190),1)&&cam.x==0&&cam.y==0);
 tick(250,190,1);assert(r.x==0&&r.y==0&&!(r.flags&RETRO_CAMERA_MOVED));

 /* Dead zone: no motion while the focus stays inside it. */
 c.lookAheadX=0;c.smoothingX=c.smoothingY=0;
 assert(retroCameraEnterRoom(&cam,&c,1280,448,0,0,Q(200),Q(200),0)&&cam.x==Q(40)&&cam.y==Q(88));
 tick(223,215,0);assert(cam.x==Q(40)&&cam.y==Q(88)&&!r.flags);
 tick(176,184,0);assert(cam.x==Q(40)&&cam.y==Q(88));
 tick(225,217,0);assert(cam.x==Q(41)&&cam.y==Q(89)&&(r.flags&RETRO_CAMERA_MOVED)&&r.x==41&&r.y==89);
 tick(170,180,0);assert(cam.x==Q(34)&&cam.y==Q(84));
 /* Focus offset moves the dead zone on the screen. */
 c.focusX=-40;c.focusY=20;
 assert(retroCameraEnterRoom(&cam,&c,1280,448,0,0,Q(400),Q(300),0)&&cam.x==Q(280)&&cam.y==Q(168));
 c.focusX=c.focusY=0;

 /* Follow speed limit and per-axis follow. */
 c.maxSpeedX=Q(2);c.maxSpeedY=Q(1);
 assert(retroCameraEnterRoom(&cam,&c,1280,448,0,0,Q(200),Q(200),0));
 tick(400,400,0);assert(cam.x==Q(42)&&cam.y==Q(89));
 c.followY=0;tick(400,400,0);assert(cam.x==Q(44)&&cam.y==Q(89));
 c.followY=1;c.followX=0;tick(400,400,0);assert(cam.x==Q(44)&&cam.y==Q(90));
 c.followX=1;c.maxSpeedX=c.maxSpeedY=Q(8);

 /* Smoothing: a quarter of the remaining distance, exact landing, no drift. */
 c.smoothingX=2;c.deadZoneWidth=0;
 assert(retroCameraEnterRoom(&cam,&c,1280,448,0,0,Q(200),Q(200),0)&&cam.x==Q(40));
 tick(216,200,0);assert(cam.x==Q(44));tick(216,200,0);assert(cam.x==Q(47));
 for(i=0;i<60;i++)tick(216,200,0);
 assert(cam.x==Q(56)&&!(r.flags&RETRO_CAMERA_MOVED));
 tick(100,200,0);assert(cam.x==Q(48)); /* 29 px behind is limited to 8 px/tick */
 c.smoothingX=0;c.deadZoneWidth=48;

 /* Look-ahead approaches by its own speed and flips with the direction. */
 c.lookAheadX=24;c.lookAheadSpeed=Q(2);c.deadZoneWidth=0;
 assert(retroCameraEnterRoom(&cam,&c,1280,448,0,0,Q(600),Q(200),1)&&cam.x==Q(464));
 tick(600,200,-1);assert(cam.look==Q(22)&&cam.x==Q(462));
 for(i=0;i<30;i++)tick(600,200,-1);
 assert(cam.look==Q(-24)&&cam.x==Q(416));
 tick(600,200,0);assert(cam.look==Q(-24)&&cam.x==Q(416)); /* neutral keeps the look */
 c.lookAheadX=0;c.deadZoneWidth=48;

 /* Regions: explicit priority, transition speed of the entered/left region. */
 assert(retroCameraEnterRoom(&cam,&c,1280,448,regions,4,Q(100),Q(100),0)&&cam.x==0&&cam.y==0);
 tick(100,100,0);assert(r.region==RETRO_ID_NONE);
 settle(330,100,0);assert(r.region==11&&cam.x==Q(320)&&cam.y==0&&!cam.transition);
 assert(retroCameraBounds(&cam,&b)&&b.x==320&&b.width==320&&b.height==224);
 tick(410,100,0);
 assert(r.region==22&&(r.flags&RETRO_CAMERA_REGION_CHANGED)&&(r.flags&RETRO_CAMERA_TRANSITION));
 assert(cam.x==Q(320)&&cam.y==Q(4)); /* 4 px/tick toward the upper limit of region 22 */
 for(i=0;i<54;i++){tick(410,100,0);assert(r.flags&RETRO_CAMERA_TRANSITION);}
 assert(cam.y==Q(220));tick(410,100,0);assert(cam.y==Q(224)&&!cam.transition);
 tick(410,100,0);assert(!(r.flags&RETRO_CAMERA_TRANSITION));
 tick(390,100,0);assert(r.region==11&&cam.y==Q(222)); /* back at region 11's 2 px/tick */
 settle(390,100,0);assert(cam.y==0);
 tick(700,100,0);assert(r.region==RETRO_ID_NONE&&(r.flags&RETRO_CAMERA_TRANSITION)&&cam.x==Q(322));
 settle(700,100,0);assert(cam.x==Q(516)&&!cam.transition);

 /* Arena lock keeps its limits after the target leaves the trigger area. */
 settle(810,100,0);
 assert(r.region==33&&(r.flags&RETRO_CAMERA_LOCKED)&&cam.x==Q(720)&&cam.y==0);
 settle(1030,300,0);assert(r.region==33&&cam.x==Q(720)&&cam.y==0);
 settle(730,100,0);assert(r.region==33&&cam.x==Q(720));
 assert(retroCameraBounds(&cam,&b)&&b.x==720&&b.width==320);
 /* Unlock while inside the trigger does not lock again until re-entry. */
 settle(850,100,0);assert(retroCameraUnlock(&cam)&&!retroCameraUnlock(&cam));
 tick(850,100,0);assert(r.region==RETRO_ID_NONE&&!(r.flags&RETRO_CAMERA_LOCKED)&&(r.flags&RETRO_CAMERA_TRANSITION));
 settle(850,100,0);assert(cam.x==Q(714)&&r.region==RETRO_ID_NONE);
 settle(700,100,0);settle(810,100,0);assert(r.region==33&&(r.flags&RETRO_CAMERA_LOCKED));
 assert(retroCameraUnlock(&cam));
 /* A zero transition speed cuts. */
 settle(1090,100,0);tick(1110,300,0);
 assert(r.region==44&&cam.x==Q(960)&&cam.y==Q(224)&&!cam.transition);

 /* Scripted ownership per axis, clamped to the room, then a paced return. */
 assert(retroCameraEnterRoom(&cam,&c,1280,448,regions,4,Q(100),Q(300),0)&&cam.x==0&&cam.y==Q(188));
 assert(!retroCameraScriptSet(&cam,0,0,0)&&!retroCameraScriptSet(&cam,4,0,0));
 assert(retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X,5000,0)&&cam.x==Q(960));
 assert(retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X,-50,0)&&cam.x==0);
 assert(retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X,600,0)&&cam.x==Q(600));
 tick(100,100,0);assert(cam.x==Q(600)&&cam.y==Q(180)&&(r.flags&RETRO_CAMERA_SCRIPT)); /* Y still follows */
 for(i=0;i<20;i++)tick(100,100,0);
 assert(cam.x==Q(600));
 retroCameraScriptRelease(&cam);tick(100,100,0);
 assert(cam.x==Q(596)&&(r.flags&RETRO_CAMERA_TRANSITION)&&!(r.flags&RETRO_CAMERA_SCRIPT)); /* 4 px/tick return */
 settle(100,100,0);assert(cam.x==0&&!cam.transition);
 c.scriptReturnSpeed=0;
 assert(retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X|RETRO_CAMERA_AXIS_Y,600,224)&&cam.x==Q(600)&&cam.y==Q(224));
 retroCameraScriptRelease(&cam);tick(100,100,0);assert(cam.x==0&&cam.y==Q(4)&&!cam.transition); /* cut to the dead-zone edge */
 /* The cutscene glue returns X only; a host-scripted Y stays owned. */
 assert(retroCameraScriptSet(&cam,RETRO_CAMERA_AXIS_X|RETRO_CAMERA_AXIS_Y,600,224));
 retroCameraCutsceneSet(&cam,1,0);assert(cam.script==RETRO_CAMERA_AXIS_Y);
 tick(100,100,0);assert(cam.x==0&&cam.y==Q(224)&&(r.flags&RETRO_CAMERA_SCRIPT));
 retroCameraScriptRelease(&cam);tick(100,100,0);assert(!cam.script&&cam.y==Q(4));
 retroCameraPreset(&c);

 /* Rejected inputs preserve the whole instance. */
 saved=cam;
 r=retroCameraTick(&cam,&c,Q(100),Q(100),2);assert(r.invalid&&!memcmp(&saved,&cam,sizeof(cam)));
 r=retroCameraTick(&cam,&c,Q(40000),Q(100),0);assert(r.invalid&&!memcmp(&saved,&cam,sizeof(cam)));
 bad=c;bad.maxSpeedX=0;r=retroCameraTick(&cam,&bad,Q(100),Q(100),0);assert(r.invalid&&!memcmp(&saved,&cam,sizeof(cam)));
 bad=c;bad.smoothingY=7;assert(!retroCameraValidate(&bad));
 bad=c;bad.lookAheadSpeed=0;assert(!retroCameraValidate(&bad));bad.lookAheadX=0;assert(retroCameraValidate(&bad));
 bad=c;bad.deadZoneWidth=321;assert(!retroCameraValidate(&bad));
 bad=c;bad.followX=2;assert(!retroCameraValidate(&bad));assert(!retroCameraValidate(0));
 {RetroCameraRegion wrong=regions[0];wrong.limits.width=2000;
  assert(!retroCameraEnterRoom(&cam,&c,1280,448,&wrong,1,Q(100),Q(100),0)&&!memcmp(&saved,&cam,sizeof(cam)));
  wrong=regions[0];wrong.flags=2;assert(!retroCameraEnterRoom(&cam,&c,1280,448,&wrong,1,Q(100),Q(100),0));
  wrong=regions[0];wrong.transitionSpeed=-1;assert(!retroCameraEnterRoom(&cam,&c,1280,448,&wrong,1,Q(100),Q(100),0));}
 assert(!retroCameraEnterRoom(&cam,&c,0,448,0,0,Q(1),Q(1),0)&&!retroCameraEnterRoom(&cam,&c,1280,448,0,1,Q(1),Q(1),0));
 assert(!memcmp(&saved,&cam,sizeof(cam)));
 return 0;
}
`)
 const includes=['core','camera'].map(dir=>'-I'+path.join(library,dir))
 const source=path.join(library,'camera/retro_camera.c')
 const flags=['-std=c99','-Wall','-Wextra','-Werror']
 const built=spawnSync('cc',[...flags,...includes,fixture,source,'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||String(run.signal))

 // Real cutscene runner drives the camera through the distributed glue.
 const config={...defaultCutsceneConfig(),actors:[{id:'hero',name:'Hero',value:0}]}
 const scene={format:'retro-studio.cutscene',version:1,id:'pan',title:'Pan',steps:[
  {type:'camera',mode:'x',x:600,speed:2,wait:true},{type:'wait',frames:10},
  {type:'camera',mode:'x',x:5000,speed:0},{type:'wait',frames:5},{type:'camera',mode:'follow'},{type:'wait',frames:3}]}
 const compiled=compileProject([{path:'cutscenes/pan.cutscene.json',scene}],config)
 assert.deepEqual(compiled.errors,[])
 fs.writeFileSync(path.join(temporary,'cutscene_ids.h'),compiled.idsHeader)
 fs.writeFileSync(path.join(temporary,'cutscene_data.h'),compiled.dataHeader)
 const story=path.join(temporary,'story.c'),storyBinary=path.join(temporary,'story')
 fs.writeFileSync(story,`#include <assert.h>
#include <string.h>
#include "retro_camera.h"
#include "cutscene_data.h"
#define Q(n) ((RetroFixed)(n)*256)
int main(void){
 RetroCameraConfig c;RetroCamera cam;RetroCameraResult r;CutsceneRunner runner;CutsceneHost host;
 int frame,playerX=200,panned=0,cut=0,returned=0,last;
 retroCameraPreset(&c);c.lookAheadX=0;memset(&cam,0,sizeof(cam));memset(&host,0,sizeof(host));
 assert(retroCameraInit(&cam,320,224)&&retroCameraEnterRoom(&cam,&c,1280,224,0,0,Q(playerX),Q(200),0));
 host.context=&cam;host.cameraGet=retroCameraCutsceneGet;host.cameraSet=retroCameraCutsceneSet;
 host.cameraClamp=retroCameraCutsceneClamp;host.viewWidth=320;
 assert(retroCameraCutsceneGet(&cam)==40&&retroCameraCutsceneClamp(&cam,5000)==960&&retroCameraCutsceneClamp(&cam,-9)==0);
 cutsceneInit(&runner,&cutsceneLibrary);assert(cutsceneStart(&runner,&host,CUTSCENE_PAN));
 last=40;
 for(frame=0;frame<700;frame++){
  if(cutsceneIsActive(&runner))cutsceneStep(&runner,&host,0);
  playerX+=frame<100?1:0; /* the player keeps moving during the scene */
  r=retroCameraTick(&cam,&c,Q(playerX),Q(200),0);assert(!r.invalid);
  if(r.flags&RETRO_CAMERA_SCRIPT){
   /* The scripted axis is never pulled by the player: monotonic pan, 2 px/tick. */
   assert(r.x>=last&&(r.x-last<=2||r.x==960));
   if(r.x==600)panned=1;
   if(r.x==960){assert(panned);cut=1;}
  }else if(cut&&!returned){
   assert(r.flags&RETRO_CAMERA_TRANSITION);assert(last-r.x<=4); /* paced return, no jump */
   returned=1;
  }else if(returned&&(r.flags&RETRO_CAMERA_TRANSITION))assert(last-r.x<=4&&r.x<=last);
  last=r.x;
 }
 assert(panned&&cut&&returned&&!cutsceneIsActive(&runner));
 assert(!cam.script&&!cam.transition&&r.x==playerX+24-160); /* dead-zone edge of the follow framing */
 return 0;
}
`)
 const storyBuilt=spawnSync('cc',[...flags,...includes,'-I'+temporary,'-I'+path.dirname(cutscene),story,source,path.join(cutscene,'cutscene_runner.c'),'-o',storyBinary],{encoding:'utf8'})
 assert.equal(storyBuilt.status,0,storyBuilt.stderr)
 const storyRun=spawnSync(storyBinary,[],{encoding:'utf8'});assert.equal(storyRun.status,0,storyRun.stderr||String(storyRun.signal))
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-std=c99','-Os',...flags.slice(1),...includes,'-c',source,'-o',path.join(temporary,'camera.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr||cross.error?.message);console.log('PASS camera compiled for 68000')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Camera runtime: limits, dead zone, focus, follow axes, speed limit, smoothing, look-ahead, prioritized regions, transitions, arena lock, scripted ownership, cutscene runner and rejected inputs passed.')
