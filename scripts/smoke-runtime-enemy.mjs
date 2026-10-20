import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-enemy-'))
try{
 const library=path.join(root,'assets/toolkit/lib/runtime'),binary=path.join(temporary,'test')
 const includes=['-I',path.join(library,'core'),'-I',path.join(library,'collision'),'-I',path.join(library,'enemy')]
 const sources=['enemy/retro_enemy.c','collision/retro_collision.c','collision/retro_slopes.c','core/retro_core.c'].map(file=>path.join(library,file))
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror',...includes,path.join(root,'scripts/fixtures/runtime-enemy-test.c'),...sources,'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'})
 assert.equal(run.status,0,run.stderr||run.stdout)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-std=c99','-Os','-Wall','-Wextra','-Werror',...includes,'-c',sources[0],'-o',path.join(temporary,'enemy-m68k.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr||cross.error?.message)
  console.log('PASS: enemy compiled for 68000')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime enemy: patrulha, parede, borda, limites, câmera, pool, VRAM adiada, espada por golpe, kunai, invulnerabilidade, morte, contato, ataque, respawn e troca de sala conferidos.')
