import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-input-'))
try{
 const fixture=path.join(temporary,'test.c')
 fs.writeFileSync(fixture,"#include <assert.h>\n#include \"retro_actions.h\"\nint main(void) {\n RetroActionMap map;\n RetroActions one={0},two={0};\n uint8_t i;\n retroActionPreset(&map,0);\n assert(!retroActionUnsupported(&map,RETRO_PAD3_MASK));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_B,RETRO_PAD3_MASK);\n assert(retroActionPressed(&one,RETRO_ACTION_JUMP));\n assert(retroActionConsume(&one,RETRO_ACTION_JUMP));\n assert(!retroActionConsume(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_B,RETRO_PAD3_MASK);\n assert(retroActionHeld(&one,RETRO_ACTION_JUMP) && !retroActionPressed(&one,RETRO_ACTION_JUMP));\n assert(!retroActionConsume(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,&map,0,RETRO_PAD3_MASK);\n assert(retroActionReleased(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_B,RETRO_PAD3_MASK);\n for(i=0;i<3;i++)retroActionsUpdate(&one,&map,0,RETRO_PAD3_MASK);\n assert(retroActionConsume(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_B,RETRO_PAD3_MASK);\n for(i=0;i<4;i++)retroActionsUpdate(&one,&map,0,RETRO_PAD3_MASK);\n assert(!retroActionConsume(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_DOWN|RETRO_BUTTON_C,RETRO_PAD3_MASK);\n assert(retroActionPressed(&one,RETRO_ACTION_TRANSFORM));\n assert(!retroActionHeld(&one,RETRO_ACTION_DASH));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_C,RETRO_PAD3_MASK);\n assert(retroActionReleased(&one,RETRO_ACTION_TRANSFORM));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_LEFT|RETRO_BUTTON_RIGHT,RETRO_PAD3_MASK);\n assert(retroActionAxis(&one,RETRO_ACTION_LEFT,RETRO_ACTION_RIGHT)==0);\n retroActionsUpdate(&two,&map,RETRO_BUTTON_LEFT,RETRO_PAD3_MASK);\n assert(retroActionAxis(&two,RETRO_ACTION_LEFT,RETRO_ACTION_RIGHT)==-1);\n assert(retroActionAxis(&one,RETRO_ACTION_LEFT,RETRO_ACTION_RIGHT)==0);\n retroActionPreset(&map,1);\n assert(retroActionUnsupported(&map,RETRO_PAD3_MASK)&(1u<<RETRO_ACTION_TRANSFORM));\n map.bindings[RETRO_ACTION_TRANSFORM].primary=RETRO_BUTTON_X|RETRO_BUTTON_C;\n retroActionsUpdate(&one,&map,RETRO_BUTTON_C,RETRO_PAD3_MASK);\n assert(!retroActionHeld(&one,RETRO_ACTION_TRANSFORM));\n map.bindings[RETRO_ACTION_JUMP].alternate=RETRO_BUTTON_C;\n retroActionsUpdate(&one,&map,RETRO_BUTTON_B,RETRO_PAD6_MASK);\n assert(retroActionPressed(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,&map,RETRO_BUTTON_C,RETRO_PAD6_MASK);\n assert(!retroActionPressed(&one,RETRO_ACTION_JUMP));\n assert(!retroActionReleased(&one,RETRO_ACTION_JUMP));\n retroActionsUpdate(&one,0,0,0);\n assert(retroActionReleased(&one,RETRO_ACTION_JUMP));\n assert(!retroActionHeld(&one,255));\n assert(!retroActionConsume(&one,255));\n retroActionsUpdate(0,&map,0,0);\n retroActionPreset(0,0);\n return 0;\n}\n")
 const library=path.join(root,'assets/toolkit/lib/runtime')
 const binary=path.join(temporary,'test')
 const sources=[path.join(library,'core/retro_core.c'),path.join(library,'input/retro_actions.c')]
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I',path.join(library,'core'),'-I',path.join(library,'input'),fixture,...sources,'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'})
 assert.equal(run.status,0,run.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-std=c99','-Os','-Wall','-Wextra','-Werror','-I',path.join(library,'core'),'-c',sources[1],'-o',path.join(temporary,'input-m68k.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr || cross.error?.message)
  console.log('PASS: input compiled for 68000')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime input: action edges, combinations, alternatives, buffers, consumption, unsupported controls and independent players passed.')
