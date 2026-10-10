import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-collision-'))
try{
 const fixture=path.join(temporary,'test.c')
 fs.writeFileSync(fixture,"#include <assert.h>\n#include <stdint.h>\n#include \"retro_collision.h\"\n#define Q(n) ((RetroFixed)(n)*256)\nint main(void){\n RetroBody body={Q(20),Q(20),{0,0,8,8},1};\n RetroCollider walls[]={{{40,0,2,100},1,RETRO_COLLIDER_SOLID},{{10,0,2,100},1,RETRO_COLLIDER_SOLID}};\n RetroMoveResult result;\n RetroRect box={-4,-20,12,20}, mirrored,invalid={-32768,0,1,1};\n assert(retroMirrorRect(&box,1,&mirrored) && mirrored.x==-8 && mirrored.y==-20);\n assert(retroMirrorRect(&mirrored,1,&mirrored) && mirrored.x==-4);\n invalid.x=32767;invalid.width=2;\n assert(!retroMirrorRect(&invalid,1,&mirrored));\n result=retroMoveBody(&body,Q(1000),0,walls,2,0);\n assert(!result.invalid && body.x==Q(32) && result.contacts==RETRO_CONTACT_RIGHT);\n result=retroMoveBody(&body,-Q(1000),0,walls,2,0);\n assert(body.x==Q(12) && result.contacts==RETRO_CONTACT_LEFT);\n {\n  RetroCollider ahead[]={{{40,0,2,100},1,RETRO_COLLIDER_SOLID},{{30,0,2,100},1,RETRO_COLLIDER_SOLID}};\n  RetroCollider reverse[]={ahead[1],ahead[0]};\n  body.x=Q(20)+128;\n  result=retroMoveBody(&body,Q(100),0,ahead,2,0);\n  assert(body.x==Q(22) && result.dx==384);\n  body.x=Q(20)+128;\n  result=retroMoveBody(&body,Q(100),0,reverse,2,0);\n  assert(body.x==Q(22) && result.dx==384);\n }\n body.x=Q(20);body.mask=2;\n result=retroMoveBody(&body,Q(100),0,walls,2,0);\n assert(body.x==Q(120) && !result.contacts);\n {\n  RetroCollider floor={{0,40,100,2},1,RETRO_COLLIDER_SOLID};\n  body.x=Q(20);body.y=Q(20);body.mask=1;\n  result=retroMoveBody(&body,0,Q(1000),&floor,1,0);\n  assert(body.y==Q(32) && result.contacts==RETRO_CONTACT_FLOOR);\n  body.y=Q(50);\n  result=retroMoveBody(&body,0,-Q(1000),&floor,1,0);\n  assert(body.y==Q(42) && result.contacts==RETRO_CONTACT_CEILING);\n  floor.kind=RETRO_COLLIDER_PLATFORM;body.y=Q(50);\n  result=retroMoveBody(&body,0,-Q(100),&floor,1,0);\n  assert(body.y==-Q(50) && !result.contacts);\n  body.y=Q(20);\n  result=retroMoveBody(&body,0,Q(1000),&floor,1,0);\n  assert(body.y==Q(32) && result.contacts==RETRO_CONTACT_FLOOR);\n  body.y=Q(20);\n  result=retroMoveBody(&body,0,Q(100),&floor,1,1);\n  assert(body.y==Q(120) && !result.contacts);\n }\n body.x=0;body.y=0;\n result=retroMoveBody(&body,INT32_MAX,INT32_MIN,0,0,0);\n assert(!result.invalid && body.x==Q(32767) && body.y==Q(-32768));\n body.x=INT32_MAX;\n result=retroMoveBody(&body,1,1,0,0,0);assert(result.invalid && body.x==INT32_MAX);\n assert(retroMoveBody(0,0,0,0,0,0).invalid);\n body.x=0;assert(retroMoveBody(&body,0,0,0,1,0).invalid);\n body.box.width=0;assert(retroMoveBody(&body,0,0,0,0,0).invalid);\n return 0;\n}\n")
 const library=path.join(root,'assets/toolkit/lib/runtime')
 const source=path.join(library,'collision/retro_collision.c'),binary=path.join(temporary,'test')
 const includes=['-I',path.join(library,'core'),'-I',path.join(library,'collision')]
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror',...includes,fixture,source,'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'})
 assert.equal(run.status,0,run.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-std=c99','-Os','-Wall','-Wextra','-Werror',...includes,'-c',source,'-o',path.join(temporary,'collision-m68k.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr || cross.error?.message)
  console.log('PASS: collision compiled for 68000')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime collision: box mirrors, both walls, floor/ceiling, high-speed sweep, groups, platforms/drop and numeric bounds passed.')
