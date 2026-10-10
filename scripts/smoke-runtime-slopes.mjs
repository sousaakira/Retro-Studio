// #49: documented floor ramps, without changing the legacy collision API.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-slopes-'))
const library=new URL('../assets/toolkit/lib/runtime/',import.meta.url).pathname
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <stdint.h>
#include <limits.h>
#include "retro_slopes.h"
#define Q(n) ((RetroFixed)(n)*256)
int main(void){
 RetroSlope ramp={{0,40,32,16},1,16,0},down={{0,40,32,16},1,0,16};
 RetroFixed surface=123;
 RetroBody body={Q(12),Q(0),{-4,-8,8,8},1};RetroMoveResult result;
 assert(retroSlopeSurface(&ramp,Q(0),&surface)&&surface==Q(56));
 assert(retroSlopeSurface(&ramp,Q(16),&surface)&&surface==Q(48));
 assert(!retroSlopeSurface(&ramp,Q(32),&surface)&&surface==Q(48));
 assert(!retroSlopeSurface(&ramp,-1,&surface)&&surface==Q(48));
 assert(!retroSlopeSurface(&ramp,INT32_MIN,&surface));assert(!retroSlopeSurface(&ramp,0,0));
 result=retroMoveBodySlopes(&body,0,Q(1000),0,0,&ramp,1,2,0,0);
 assert(!result.invalid&&body.y==Q(50)&&result.contacts==RETRO_CONTACT_FLOOR);
 result=retroMoveBodySlopes(&body,Q(8),0,0,0,&ramp,1,2,1,0);
 assert(body.y==Q(46)&&result.dy==-Q(4)&&result.contacts==RETRO_CONTACT_FLOOR);
 result=retroMoveBodySlopes(&body,-Q(4),0,0,0,&ramp,1,2,1,0);
 assert(body.y==Q(48)&&result.dy==Q(2)&&result.contacts==RETRO_CONTACT_FLOOR);
 result=retroMoveBodySlopes(&body,-Q(8),0,0,0,&ramp,1,2,1,0);
 assert(body.y==Q(48)&&!result.contacts); /* downhill beyond snap becomes airborne */
 body.x=Q(12);body.y=Q(60);
 result=retroMoveBodySlopes(&body,0,-Q(20),0,0,&ramp,1,2,1,0);
 assert(body.y==Q(40)&&!result.contacts); /* upward jump passes through floor ramp */
 body.y=Q(60);result=retroMoveBodySlopes(&body,0,Q(2),0,0,&ramp,1,2,0,0);
 assert(body.y==Q(62)&&!result.contacts); /* below ramp isn't depenetrated */
 body.y=0;result=retroMoveBodySlopes(&body,0,Q(100),0,0,&ramp,1,2,0,1);
 assert(body.y==Q(100)&&!result.contacts); /* drop skips ramp */
 body.y=0;body.mask=2;result=retroMoveBodySlopes(&body,0,Q(100),0,0,&ramp,1,2,0,0);
 assert(body.y==Q(100)&&!result.contacts);body.mask=1;
 body.x=Q(12);body.y=0;result=retroMoveBodySlopes(&body,0,Q(100),0,0,&down,1,2,0,0);
 assert(body.y==Q(46)&&result.contacts==RETRO_CONTACT_FLOOR);
 {RetroSlope pair[]={ramp,down},reverse[]={down,ramp};
  body.y=0;result=retroMoveBodySlopes(&body,0,Q(100),0,0,pair,2,2,0,0);assert(body.y==Q(46));
  body.y=0;result=retroMoveBodySlopes(&body,0,Q(100),0,0,reverse,2,2,0,0);assert(body.y==Q(46));}
 {RetroCollider floor={{0,42,32,2},1,RETRO_COLLIDER_SOLID};
  body.y=Q(42);result=retroMoveBodySlopes(&body,0,Q(1),&floor,1,&ramp,1,20,1,0);
  assert(body.y==Q(42)&&result.contacts==RETRO_CONTACT_FLOOR); /* no snapping through solids */}
 {RetroCollider ceiling={{0,36,32,2},1,RETRO_COLLIDER_SOLID};
  body.x=Q(12);body.y=Q(50);
  result=retroMoveBodySlopes(&body,Q(16),0,&ceiling,1,&ramp,1,2,1,0);
  assert(body.x==Q(12)&&body.y==Q(50)&&result.dx==0&&result.dy==0);
  assert(result.contacts==(RETRO_CONTACT_CEILING|RETRO_CONTACT_FLOOR|RETRO_CONTACT_RIGHT));
  result=retroMoveBodySlopes(&body,0,Q(1),&ceiling,1,&ramp,1,2,1,0);
  assert(body.x==Q(12)&&body.y==Q(50)&&result.contacts==RETRO_CONTACT_FLOOR);}
 {RetroSlope bad=ramp;RetroFixed oldX=body.x,oldY=body.y;bad.rightHeight=17;
  result=retroMoveBodySlopes(&body,Q(5),Q(5),0,0,&bad,1,2,1,0);
  assert(result.invalid&&body.x==oldX&&body.y==oldY);
  assert(retroMoveBodySlopes(&body,1,1,0,0,&ramp,1,-1,0,0).invalid);
  assert(retroMoveBodySlopes(&body,1,1,0,0,0,1,0,0,0).invalid);}
 {RetroSlope huge={{-16000,-16000,32767,32767},1,32767,0};int i;
  for(i=0;i<256;i++){
   RetroFixed relative=(RetroFixed)i*32767;
   int64_t expected=(int64_t)Q(-16000)+Q(32767)-(int64_t)32767*relative/32767;
   assert(retroSlopeSurface(&huge,Q(-16000)+relative,&surface));assert(surface==expected);
  }}
 {RetroSlope outside={{0,32767,32,16},1,0,16};
  body.x=0;body.y=Q(32767);result=retroMoveBodySlopes(&body,Q(12),0,0,0,&outside,1,16,1,0);
  assert(result.invalid&&body.y==Q(32767));}
 {RetroSlope elevated={{0,20,32,16},1,0,0};
  body.x=Q(12);body.y=Q(100);
  result=retroMoveBodySlopes(&body,0,0,0,0,&elevated,1,2,1,0);
  assert(body.y==Q(100)&&!result.contacts); /* grounded elsewhere cannot teleport */
  {RetroSlope pair[]={elevated,ramp};body.y=Q(50);
   result=retroMoveBodySlopes(&body,Q(8),0,0,0,pair,2,2,1,0);
   assert(body.y==Q(46)&&result.contacts==RETRO_CONTACT_FLOOR);}}
 body.x=-Q(4);body.y=Q(56);
 result=retroMoveBodySlopes(&body,Q(8),0,0,0,&ramp,1,2,1,0);
 assert(body.x==Q(4)&&body.y==Q(54)&&result.contacts==RETRO_CONTACT_FLOOR); /* endpoint continuity */
 assert(retroMoveBodySlopes(0,0,0,0,0,0,0,0,0,0).invalid);
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+path.join(library,'core'),'-I'+path.join(library,'collision')]
 const source=path.join(library,'collision/retro_slopes.c')
 const built=spawnSync('cc',[...flags,fixture,source,path.join(library,'collision/retro_collision.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){const cross=spawnSync(process.argv[index+1],['-m68000','-Os',...flags,'-c',source,'-o',path.join(temporary,'slopes.o')],{encoding:'utf8'});assert.equal(cross.status,0,cross.stderr||cross.error?.message);console.log('PASS floor ramps compiled for 68000')}
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime ramps: surface interpolation, landing, uphill/downhill, jump/drop, masks, solid limits, overlap ordering and numeric bounds passed.')
