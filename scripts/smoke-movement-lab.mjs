// Shared C compiled to WASM vs native C, same room/profile/inputs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {sourceHash,roomHeader,repository,sources,includeFlags} from './movement-lab-sources.mjs'
import {createMovementConfiguration,MOVEMENT_FIELDS} from '../shared/retro/movementConfiguration.js'
import {createMovementLab} from '../src/utils/retro/movementLab.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-parity-'))
try{
 const bytes=fs.readFileSync(path.join(repository,'src/assets/runtime/movement-lab.wasm'))
 const stamp=JSON.parse(fs.readFileSync(path.join(repository,'src/assets/runtime/movement-lab.json'),'utf8'))
 assert.equal(stamp.version,1);assert.equal(stamp.sourceHash,sourceHash(),'Runtime changed: rebuild movement lab before shipping.')
 assert.equal(stamp.binaryHash,createHash('sha256').update(bytes).digest('hex'))
 const module=await WebAssembly.compile(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[])
 fs.writeFileSync(path.join(temporary,'movement-room-data.h'),roomHeader())
 const config=createMovementConfiguration();config.profiles.pal.walkSpeed=2;config.profiles.pal.jumpSpeed=6
 const trace=Array.from({length:300},(_,i)=>[
  i<100?1:i<200?-1:0,
  ((i>=3&&i<35)||(i>=115&&i<160)?1:0)|([3,115,220].includes(i)?2:0)|([65,165,270].includes(i)?4:0)|(i>=190&&i<210?8:0)
 ])
 for(const region of ['ntsc','pal']){
  const profile=config.profiles[region],values=MOVEMENT_FIELDS.map(([key],i)=>profile[key]*(i<12?256:1)).concat(profile.airDash?1:0)
  const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
  fs.writeFileSync(fixture,`#include <stdio.h>
#include <stdint.h>
void movementLabPreset(void);int32_t movementLabConfigure(int32_t,int32_t);
int32_t movementLabReset(void);int32_t movementLabTick(int32_t,int32_t);int32_t movementLabRead(int32_t);
int main(void){
 const int32_t values[]={${values.join(',')}};const int trace[][2]={${trace.map(row=>'{'+row+'}').join(',')}};
 unsigned i,j;movementLabPreset();for(i=0;i<19;i++)if(!movementLabConfigure((int)i,values[i]))return 1;
 if(!movementLabReset())return 2;
 for(i=0;i<300;i++){
  if(!movementLabTick(trace[i][0],trace[i][1]))return 3;
  for(j=0;j<15;j++)printf("%d%s",(int)movementLabRead((int)j),j==14?"\\n":",");
 }
 return 0;
}
`)
  const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror',...includeFlags,'-I'+temporary,fixture,path.join(repository,'assets/toolkit/fixtures/movement-lab.c'),...sources,'-o',binary],{encoding:'utf8'})
  assert.equal(compile.status,0,compile.stderr)
  const native=spawnSync(binary,[],{encoding:'utf8'});assert.equal(native.status,0,native.stderr)
  const expected=native.stdout.trim().split('\n').map(row=>row.split(',').map(Number))
  const lab=await createMovementLab(bytes);lab.reset(profile)
  const fixed=new Set([0,1,2,3,12,13])
  const actual=trace.map(row=>Object.values(lab.step(...row)).map((value,i)=>value*(fixed.has(i)?256:1)))
  assert.deepEqual(actual,expected,region+': WASM and native shared controller must agree for 300 ticks')
  assert.throws(()=>lab.step(256,0),/recusado/);assert.throws(()=>lab.step(0,.5),/recusado/)
  const before=lab.snapshot(),invalid={...profile,gravity:.1}
  assert.throws(()=>lab.reset(invalid),/precision/);assert.deepEqual(lab.snapshot(),before)
  const another=await createMovementLab(bytes);another.reset(profile)
  assert.equal(another.snapshot().ticks,0);assert.equal(lab.snapshot().ticks,300,'labs never share a mutable instance')
 }
 const metrics=await createMovementLab(bytes),profile=createMovementConfiguration().profiles.ntsc
 metrics.reset(profile);for(let i=0;i<5;i++)metrics.step(1,0)
 assert.equal(metrics.snapshot().distance,0,'ground walking is not jump distance')
 metrics.reset(profile)
 let flight
 for(let i=0;i<80;i++){flight=metrics.step(0,1|(i===0?2:0));if(flight.grounded&&i>0)break}
 assert.equal(flight.height,52.5);assert.equal(flight.flightTicks,41);assert.equal(flight.distance,0)
 const landingX=flight.x
 for(let i=0;i<5;i++)metrics.step(1,0)
 assert.ok(metrics.snapshot().x>landingX);assert.equal(metrics.snapshot().distance,flight.distance,'landing freezes the last jump distance')
 assert.equal(metrics.snapshot().height,52.5);assert.equal(metrics.snapshot().flightTicks,41)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Movement lab: bundled source/binary fingerprints, 600 native C/WASM parity ticks, explicit profiles, independent instances and invalid input preservation passed.')
