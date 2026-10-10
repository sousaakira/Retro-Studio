// Developer command: existing Clang/wasm-ld only. End users need neither tool.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {repository,sourceHash,roomHeader,sources,includeFlags} from './movement-lab-sources.mjs'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-wasm-'))
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]}
try{
 fs.writeFileSync(path.join(temporary,'movement-room-data.h'),roomHeader())
 const file=path.join(temporary,'movement-lab.wasm')
 const functions=['movementLabPreset','movementLabConfigure','movementLabReset','movementLabTick','movementLabRead']
 const flags=['--target=wasm32','-O2','-std=c99','-nostdlib','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror',
  '-fuse-ld='+arg('--wasm-ld','wasm-ld'),'-Wl,--no-entry','-Wl,--strip-all',...functions.map(name=>'-Wl,--export='+name),
  ...includeFlags,'-I'+temporary,path.join(repository,'assets/toolkit/fixtures/movement-lab.c'),...sources,'-o',file]
 const result=spawnSync(arg('--clang','clang'),flags,{encoding:'utf8'})
 assert.equal(result.status,0,result.stderr||result.error?.message)
 const bytes=fs.readFileSync(file);assert.ok(WebAssembly.validate(bytes))
 const stamp={version:1,sourceHash:sourceHash(),binaryHash:(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')}
 const target=path.join(repository,'src/assets/runtime');fs.mkdirSync(target,{recursive:true})
 fs.writeFileSync(path.join(target,'movement-lab.wasm'),bytes)
 fs.writeFileSync(path.join(target,'movement-lab.json'),JSON.stringify(stamp,null,2)+'\n')
 console.log('Shared C movement lab: '+bytes.length+' bytes, source fingerprint '+stamp.sourceHash)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
