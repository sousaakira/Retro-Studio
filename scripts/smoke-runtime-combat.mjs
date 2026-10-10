import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-combat-'))
try{
 const fixture=path.join(temporary,'test.c')
 fs.writeFileSync(fixture,"#include <assert.h>\n#include \"retro_combat.h\"\nstatic unsigned callbacks;\nstatic void react(void *context,uint8_t result,uint16_t damage,RetroFixed x,RetroFixed y){\n unsigned *total=(unsigned *)context;\n assert(result==RETRO_DAMAGE_HIT || result==RETRO_DAMAGE_DEFEATED);\n assert(damage==3 || damage==65535);\n assert(x==256 && y==-512);\n (*total)++;\n}\nint main(void){\n RetroAttackState attack={0};\n RetroCombatant victim={8,0,2},other={8,0,2};\n RetroRect box={0,0,8,8},miss={20,20,8,8};\n assert(retroAttackBegin(&attack,1,4,2));\n assert(retroAttackApply(&attack,&box,&victim,&box,0,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_NONE);\n retroAttackTick(&attack);\n assert(retroAttackApply(&attack,&box,&victim,&miss,0,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_NONE);\n assert(retroAttackApply(&attack,&box,&victim,&box,32,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_NONE);\n assert(retroAttackApply(&attack,&box,&victim,&box,0,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_HIT);\n assert(victim.health==5 && victim.invulnerable==2 && callbacks==1);\n retroCombatTick(&victim);retroCombatTick(&victim);\n assert(retroAttackApply(&attack,&box,&victim,&box,0,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_NONE);\n assert(retroAttackApply(&attack,&box,&other,&box,31,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_HIT);\n assert(other.health==5 && callbacks==2);\n assert(retroAttackBegin(&attack,0,2,1));\n assert(retroAttackApply(&attack,&box,&victim,&box,0,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_NONE);\n assert(retroAttackBegin(&attack,0,2,2));\n victim.invulnerable=1;\n assert(retroAttackApply(&attack,&box,&victim,&box,0,3,2,256,-512,react,&callbacks)==RETRO_DAMAGE_NONE);\n retroCombatTick(&victim);\n assert(retroAttackApply(&attack,&box,&victim,&box,0,65535,2,256,-512,react,&callbacks)==RETRO_DAMAGE_DEFEATED);\n assert(victim.health==0 && callbacks==3);\n retroAttackTick(&attack);retroAttackTick(&attack);\n assert(!attack.running);\n assert(!retroAttackBegin(&attack,4,4,2));\n assert(!retroAttackBegin(&attack,0,4,0));\n assert(!retroAttackBegin(0,0,4,2));\n retroAttackTick(0);retroCombatTick(0);\n assert(retroAttackApply(0,&box,&victim,&box,0,1,0,0,0,0,0)==RETRO_DAMAGE_NONE);\n assert(retroAttackBegin(&attack,65534,65535,2));\n attack.age=65534;retroAttackTick(&attack);assert(attack.age==65535 && !attack.running);\n return 0;\n}\n")
 const library=path.join(root,'assets/toolkit/lib/runtime'),binary=path.join(temporary,'test')
 const source=path.join(library,'collision/retro_combat.c')
 const includes=['-I',path.join(library,'core'),'-I',path.join(library,'collision')]
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror',...includes,fixture,source,path.join(library,'core/retro_core.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-std=c99','-Os','-Wall','-Wextra','-Werror',...includes,'-c',source,'-o',path.join(temporary,'combat-m68k.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr || cross.error?.message)
  console.log('PASS: combat compiled for 68000')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime combat: attack windows, independent boxes, group masks, one hit per victim, invulnerability, callbacks, defeat and numeric limits passed.')
