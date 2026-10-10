// #47: the documented custom-adapter example compiles and runs against the distributed modules.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const repository=fileURLToPath(new URL('../',import.meta.url)),library=path.join(repository,'assets/toolkit/lib/runtime')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-adapter-example-'))
try{
 const example=path.join(repository,'assets/toolkit/fixtures/custom-adapter-example.c'),binary=path.join(temporary,'example')
 const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',...['core','audio','progress'].map(dir=>'-I'+path.join(library,dir)),example,
  path.join(library,'audio/retro_audio.c'),path.join(library,'progress/retro_progress.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 assert.deepEqual(ran.stdout.trim().split('\n'),['music=1 effect0->channel 1 voices=0,-1','saved room=7 checkpoint=2 flag3=1'])
 // The guide points at this file and names every callback the example implements.
 const guide=fs.readFileSync(path.join(repository,'docs/MODULAR_RUNTIME.md'),'utf8'),source=fs.readFileSync(example,'utf8')
 assert.ok(guide.includes('assets/toolkit/fixtures/custom-adapter-example.c'),'the guide links the example')
 for(const name of ['RetroAudioDriver','RetroProgressStorage','CutsceneHost'])assert.ok(guide.includes(name),'guide explains '+name)
 for(const name of ['myMusic','myEffect','myBusy','myRead','myWrite'])assert.ok(source.includes('static')&&source.includes(name))
 assert.doesNotMatch(source,/genesis\.h|SGDK_|VDP_|XGM_/,'the example needs no SGDK')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Custom adapter example: own sound driver and own storage against the distributed audio and progress modules compiled, ran and are linked from the guide.')
