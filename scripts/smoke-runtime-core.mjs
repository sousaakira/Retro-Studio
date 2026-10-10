import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-core-'))
try{
  const fixture=path.join(temporary,'test.c')
  fs.writeFileSync(fixture,`#include <assert.h>
#include "retro_core.h"
int main(void) {
 RetroInput input={0,0,0};
 RetroAnimation animation={0,0,0,0};
 const uint16_t durations[]={2,3};
 RetroRect a={32760,0,20,10}, b={32767,0,20,10}, edge={0,10,4,4}, empty={0,0,0,4};
 assert(RETRO_RUNTIME_CORE_VERSION==1);
 retroInputUpdate(&input,3); assert(input.pressed==3 && input.released==0);
 assert(retroInputAction(&input,3,1)); assert(retroInputAxis(&input,1,2)==0);
 retroInputUpdate(&input,2); assert(input.pressed==0 && input.released==1);
 assert(retroInputAxis(&input,1,2)==1); assert(!retroInputAction(&input,2,1));
 retroInputUpdate(&input,0); assert(input.released==2); assert(!retroInputAction(&input,0,0));
 assert(retroRectsOverlap(&a,&b)); assert(!retroRectsOverlap(&a,&empty)); assert(!retroRectsOverlap(&a,&edge));
 retroAnimationStart(&animation,durations[0],0);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_NONE);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_FRAME && animation.frame==1);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_NONE);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_NONE);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_FINISHED && animation.frame==1);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_NONE);
 retroAnimationStart(&animation,1,1);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_FRAME);
 retroAnimationTick(&animation,durations,2); retroAnimationTick(&animation,durations,2);
 assert(retroAnimationTick(&animation,durations,2)==RETRO_ANIM_FRAME && animation.frame==0);
 retroAnimationStart(&animation,0,0); assert(animation.remaining==1);
 assert(retroAnimationTick(&animation,0,0)==RETRO_ANIM_FINISHED);
 return 0;
}`)
  const library=path.join(root,'assets/toolkit/lib/runtime/core')
  const binary=path.join(temporary,'test')
  const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I',library,fixture,path.join(library,'retro_core.c'),'-o',binary],{encoding:'utf8'})
  assert.equal(compile.status,0,compile.stderr)
  const ccIndex=process.argv.indexOf('--m68k-cc')
  if(ccIndex>=0){
    const cross=spawnSync(process.argv[ccIndex+1],['-m68000','-std=c99','-Os','-Wall','-Wextra','-Werror','-c',path.join(library,'retro_core.c'),'-o',path.join(temporary,'core-m68k.o')],{encoding:'utf8'})
    assert.equal(cross.status,0,cross.stderr || cross.error?.message)
    console.log('PASS: core compiled for 68000 with configured cross compiler')
  }
  const run=spawnSync(binary,[],{encoding:'utf8'})
  assert.equal(run.status,0,run.stderr)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime core: input edges/combos, rectangle overflow, per-frame ticks, loops and terminal frames passed.')
