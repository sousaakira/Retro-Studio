import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {createInputConfiguration,inputWarnings,createInputPreviewState,updateInputPreview,consumeInputPreview} from '../src/utils/retro/inputMapping.js'
import {inputConfigurationStatus,saveInputConfiguration} from '../electron/retro/inputConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-input-mapping-'))
try{
 const root=path.join(temporary,'game');fs.mkdirSync(root)
 const status=inputConfigurationStatus(root)
 const config=createInputConfiguration()
 assert.equal(inputWarnings(config).length,0)
 assert.equal(status.headerConflict,false)
 assert.throws(()=>saveInputConfiguration(root,{config,revision:'stale'}),/changed/)
 installRuntimeModules(root,{moduleIds:['input']})
 let saved=saveInputConfiguration(root,{config,revision:status.revision})
 const header=path.join(root,'src/generated/input_map.h')
 const original=fs.readFileSync(header)
 fs.utimesSync(header,new Date(1000),new Date(1000))
 saved=saveInputConfiguration(root,{config,revision:saved.revision})
 assert.equal(fs.statSync(header).mtimeMs,1000)
 config.players[1]=createInputConfiguration(6).players[0]
 config.players[1].pad=3
 assert.ok(inputWarnings(config).some(item=>item.kind==='unsupported'))
 config.players[1].pad=6
 saved=saveInputConfiguration(root,{config,revision:saved.revision})
 const states=[createInputPreviewState(),createInputPreviewState()]
 const trace=[[16,1024],[16,1024],[0,0],[34,64],[32,8],[0,0],[16,512],[0,0],[0,0],[0,0],[0,0]]
 const expected=[]
 trace.forEach((buttons,index)=>{
  const row=[]
  config.players.forEach((player,p)=>{
   updateInputPreview(states[p],player,buttons[p])
   const consumed=index===8?Number(consumeInputPreview(states[p],4)):0
   row.push(...['held','pressed','released','pending'].map(key=>states[p][key]),states[p].buffered[4],consumed)
  });expected.push(row.join(','))
 })
 const fixture=path.join(root,'src/test.c')
 fs.writeFileSync(fixture,`#include <stdio.h>
#include "generated/input_map.h"
int main(void){
 RetroActions state[2]={{0},{0}};
 const uint16_t trace[][2]={${trace.map(row=>'{'+row.join(',')+'}').join(',')}};
 unsigned i,p;
 for(i=0;i<sizeof(trace)/sizeof(trace[0]);i++){
  for(p=0;p<2;p++){
   unsigned consumed=0;
   retroActionsUpdate(&state[p],&retroProjectInputMaps[p],trace[i][p],retroProjectInputMasks[p]);
   if(i==8)consumed=retroActionConsume(&state[p],RETRO_ACTION_JUMP);
   printf("%u,%u,%u,%u,%u,%u%s",state[p].held,state[p].pressed,state[p].released,state[p].pending,state[p].buffered[RETRO_ACTION_JUMP],consumed,p==0?",":"\\n");
  }
 }
 return 0;
}`)
 const binary=path.join(temporary,'test')
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I',path.join(root,'src/retro_runtime'),fixture,path.join(root,'src/retro_runtime/retro_actions.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'})
 assert.equal(run.status,0,run.stderr)
 assert.deepEqual(run.stdout.trim().split('\n'),expected,'JavaScript preview must match generated C mapping')
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const sdk=path.resolve(process.argv[sdkIndex+1])
  fs.copyFileSync(new URL('../assets/toolkit/fixtures/runtime-input-sgdk.c',import.meta.url),path.join(root,'src/main.c'))
  fs.rmSync(fixture)
  fs.writeFileSync(path.join(root,'Makefile'),'export GDK := '+sdk+'\ninclude $(GDK)/makefile.gen\n')
  const build=spawnSync('make',['release'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(build.status,0,String(build.stdout).slice(-8000)+String(build.stderr).slice(-8000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'))
  {const keep=process.argv.indexOf('--keep-rom');if(keep>=0)fs.copyFileSync(path.join(root,'out/rom.bin'),process.argv[keep+1])}
  assert.ok(rom.length>=512)
  assert.ok(rom.subarray(256,272).toString('ascii').includes('SEGA'))
  console.log('PASS: SGDK input diagnostic ROM built ('+rom.length+' bytes)')
 }
 fs.appendFileSync(header,'/* custom */')
 assert.equal(inputConfigurationStatus(root).headerConflict,true)
 assert.throws(()=>saveInputConfiguration(root,{config,revision:inputConfigurationStatus(root).revision}),/customized or unmanaged/)
 fs.writeFileSync(header,original)
 assert.throws(()=>saveInputConfiguration(root,{config,revision:saved.revision}),/changed/)
 const malformed=structuredClone(config);malformed.players[0].bindings[0].primary=4096
 assert.throws(()=>saveInputConfiguration(root,{config:malformed,revision:saved.revision}),/Invalid input/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Input mapping: transactional save, stable output, stale guards, custom protection and JavaScript/C parity passed.')
