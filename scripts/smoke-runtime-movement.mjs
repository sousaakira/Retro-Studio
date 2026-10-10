// #58: actual shared controller, without overwriting custom games.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include <limits.h>
#include "retro_movement.h"
#define Q(n) ((RetroFixed)(n)*256)
static const RetroCollider room[]={
 {{0,160,320,2},1,RETRO_COLLIDER_SOLID},
 {{0,0,2,160},1,RETRO_COLLIDER_SOLID},
 {{318,0,2,160},1,RETRO_COLLIDER_SOLID},
 {{64,100,40,2},1,RETRO_COLLIDER_PLATFORM},
 {{120,60,40,2},1,RETRO_COLLIDER_SOLID}
};
static RetroMovementConfig c;
static RetroMovement p;
static RetroMovementResult result;
static void init(int x,int y){RetroBody body={Q(x),Q(y),{-4,-16,8,16},1};memset(&p,0,sizeof(p));assert(retroMovementInit(&p,&body));}
static void tick(signed char axis,uint8_t buttons){result=retroMovementTick(&p,&c,(RetroMovementInput){axis,buttons},room,5,0,0);assert(!result.invalid);}
int main(void){
 int i;RetroMovement saved;
 retroMovementPreset(&c);assert(retroMovementValidate(&c)&&c.jumpSpeed==1280&&c.gravity==64);
 init(40,160);tick(0,0);assert(p.grounded&&!p.velocityY&&result.contacts==RETRO_CONTACT_FLOOR);
 tick(0,RETRO_MOVE_DROP_HELD);assert(p.grounded&&!p.sliding&&(result.conditions&1)&&p.body.y==Q(160));
 init(314,160);tick(1,RETRO_MOVE_DROP_HELD);assert(p.grounded&&!p.sliding&&(result.conditions&1));
 init(40,160);
 tick(1,0);assert(p.velocityX==128);tick(1,0);assert(p.velocityX==256);tick(1,0);assert(p.velocityX==384);
 tick(0,0);assert(p.velocityX==256);tick(0,0);tick(0,0);assert(!p.velocityX);
 init(40,160);tick(0,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD);
 assert(result.jumped&&p.velocityY==-Q(5)&&p.body.y==Q(155)&&(result.conditions&4));
 tick(0,RETRO_MOVE_JUMP_HELD);assert(p.velocityY==-1216);
 tick(0,0);assert(p.velocityY==-576); /* release: cut to -2.5 then gravity */
 for(i=0;i<80&&!p.grounded;i++){tick(0,0);}assert(p.grounded&&p.body.y==Q(160));
 {RetroFixed highest=Q(160);int elapsed=0;
  init(40,160);
  do{tick(1,RETRO_MOVE_JUMP_HELD|(elapsed?0:RETRO_MOVE_JUMP_PRESSED));
   if(p.body.y<highest)highest=p.body.y;
   elapsed++;
  }while(!p.grounded&&elapsed<80);
  assert(elapsed==41&&highest==Q(160)-13440&&p.body.x==Q(100)); /* 52.5px high, 60px travel. */
 }
 init(6,100);p.velocityY=Q(6);tick(-1,0);assert(p.sliding&&p.wall==-1&&!p.facing&&p.velocityY==Q(1));
 tick(-1,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD);assert(result.jumped&&p.velocityX==Q(3)&&p.velocityY==-Q(5)&&!p.sliding);
 tick(-1,RETRO_MOVE_JUMP_HELD);assert(p.velocityX==Q(3));
 init(314,100);p.velocityY=Q(6);tick(1,0);assert(p.sliding&&p.wall==1&&p.facing&&p.velocityY==Q(1));
 tick(0,0);assert(!p.sliding&&!p.facing); /* Flip away is exclusive to the slide. */
 tick(1,0);assert(p.sliding&&p.facing);
 tick(1,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD);assert(result.jumped&&p.velocityX==-Q(3)&&p.facing);
 init(314,100);p.velocityY=Q(6);tick(0,0);assert(!p.sliding&&p.velocityY>Q(1));
 init(40,100);tick(1,RETRO_MOVE_DASH_PRESSED);assert(result.dashStarted&&p.velocityX==Q(4)&&!p.velocityY&&p.dashRemaining==7);
 for(i=0;i<7;i++){tick(-1,0);assert(p.velocityX==Q(4)&&!p.velocityY);}assert(!p.dashRemaining);
 tick(1,RETRO_MOVE_DASH_PRESSED);assert(!result.dashStarted);
 init(308,100);tick(1,RETRO_MOVE_DASH_PRESSED);tick(1,0);assert(p.body.x==Q(314)&&!p.velocityX&&!p.dashRemaining);
 c.dashSpeed=Q(32);init(300,100);tick(1,RETRO_MOVE_DASH_PRESSED);assert(p.body.x==Q(314)&&!p.dashRemaining);retroMovementPreset(&c);
 c.airDash=0;init(40,100);tick(1,RETRO_MOVE_DASH_PRESSED);assert(!result.dashStarted);retroMovementPreset(&c);
 init(80,95);p.velocityY=Q(7);tick(0,0);assert(p.body.y==Q(100)&&p.grounded);
 tick(0,RETRO_MOVE_DROP_HELD);assert(p.body.y>Q(100)&&!p.grounded);
 init(130,80);p.velocityY=-Q(7);tick(0,RETRO_MOVE_JUMP_HELD);assert(p.body.y==Q(78)&&!p.velocityY&&(result.contacts&RETRO_CONTACT_CEILING));
 init(40,140);p.coyote=2;tick(0,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD);assert(result.jumped);
 init(40,140);p.coyote=0;tick(0,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD);assert(!result.jumped&&p.jumpBuffer==3);
 {RetroCollider ledge={{0,160,32,2},1,RETRO_COLLIDER_SOLID};
  init(34,160);p.velocityX=384;
  for(i=0;i<2;i++){result=retroMovementTick(&p,&c,(RetroMovementInput){1,0},&ledge,1,0,0);assert(!result.invalid);}
  assert(!p.grounded&&p.coyote==3);
  result=retroMovementTick(&p,&c,(RetroMovementInput){1,3},&ledge,1,0,0);assert(!result.invalid&&result.jumped);
 }
 init(40,154);p.velocityY=Q(7);tick(0,RETRO_MOVE_JUMP_PRESSED|RETRO_MOVE_JUMP_HELD);assert(!result.jumped&&p.grounded);
 tick(0,RETRO_MOVE_JUMP_HELD);assert(result.jumped);
 {RetroSlope ramp={{128,144,4,16},1,16,0};
  c.dashSpeed=Q(32);init(126,160);
  result=retroMovementTick(&p,&c,(RetroMovementInput){1,RETRO_MOVE_DASH_PRESSED},room,5,&ramp,1);
  assert(!result.invalid&&p.body.y==Q(148)); /* Narrow ramp cannot be skipped by the 32px dash. */
 }
 retroMovementPreset(&c);init(40,0);
 for(i=0;i<20;i++){tick(0,0);}assert(p.velocityY<=c.maxFallSpeed);
 saved=p;c.gravity=0;result=retroMovementTick(&p,&c,(RetroMovementInput){0,0},room,5,0,0);
 assert(result.invalid&&!memcmp(&saved,&p,sizeof(p)));retroMovementPreset(&c);
 result=retroMovementTick(&p,&c,(RetroMovementInput){2,0},room,5,0,0);assert(result.invalid&&!memcmp(&saved,&p,sizeof(p)));
 {RetroSlope bad={{0,0,2,2},1,3,0};result=retroMovementTick(&p,&c,(RetroMovementInput){1,0},room,5,&bad,1);assert(result.invalid&&!memcmp(&saved,&p,sizeof(p)));}
 p.velocityX=INT32_MIN;saved=p;
 result=retroMovementTick(&p,&c,(RetroMovementInput){0,0},room,5,0,0);assert(result.invalid&&!memcmp(&saved,&p,sizeof(p)));
 init(40,160);p.dashRemaining=1;p.dashDirection=127;saved=p;
 result=retroMovementTick(&p,&c,(RetroMovementInput){0,0},room,5,0,0);assert(result.invalid&&!memcmp(&saved,&p,sizeof(p)));
 assert(!retroMovementInit(0,&p.body));assert(!retroMovementValidate(0));
 return 0;
}
`)
 const includes=['core','collision','movement'].map(dir=>'-I'+path.join(library,dir))
 const sources=['collision/retro_collision.c','collision/retro_slopes.c','movement/retro_movement.c'].map(file=>path.join(library,file))
 const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror',...includes,fixture,...sources,'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-std=c99','-Os','-Wall','-Wextra','-Werror',...includes,'-c',sources[2],'-o',path.join(temporary,'movement.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr||cross.error?.message);console.log('PASS movement compiled for 68000')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Movement runtime: acceleration, jump/cut, floor/ceiling, both wall slides/jumps, dash/cooldown, buffers, platform/drop, narrow ramps and rejected inputs passed.')
