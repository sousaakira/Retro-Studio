// #58: region profiles exported into the real C controller, project isolation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {MOVEMENT_FIELDS,createMovementConfiguration,compileMovementHeader,validateMovementConfiguration} from '../shared/retro/movementConfiguration.js'
import {movementConfigurationStatus,saveMovementConfiguration} from '../electron/retro/movementConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-config-'))
try{
 const root=path.join(temporary,'game'),other=path.join(temporary,'other')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 fs.mkdirSync(other);installRuntimeModules(root);installCutsceneRuntime(root)
 const original=fs.readFileSync(path.join(root,'src/main.c'),'utf8'),otherStatus=movementConfigurationStatus(other)
 const status=movementConfigurationStatus(root);assert.deepEqual(status.config,createMovementConfiguration());assert.ok(!status.headerConflict)
 const config=structuredClone(status.config);config.profiles.pal.walkSpeed=2;config.profiles.pal.jumpSpeed=6
 const saved=saveMovementConfiguration(root,{config,revision:status.revision});assert.notEqual(saved.revision,status.revision)
 assert.deepEqual(saved.config,config);assert.deepEqual(movementConfigurationStatus(other),otherStatus)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'physics/movement.json'),'utf8')),config)
 assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),original)
 const headerPath=path.join(root,'src/generated/movement_config.h'),header=fs.readFileSync(headerPath,'utf8')
 assert.equal(header,compileMovementHeader(config))
 assert.throws(()=>saveMovementConfiguration(root,{config,revision:status.revision}),/changed/)
 const bad=structuredClone(config);bad.profiles.ntsc.gravity=.1;assert.throws(()=>validateMovementConfiguration(bad),/precision/)
 bad.profiles.ntsc.gravity=.25;bad.profiles.pal.jumpCutSpeed=8
 assert.throws(()=>saveMovementConfiguration(root,{config:bad,revision:saved.revision}),/jump cut/)
 assert.equal(fs.readFileSync(headerPath,'utf8'),header)
 for(const timing of ['real-time','auto',undefined]){assert.throws(()=>validateMovementConfiguration({...config,timing}),/timing policy/)}
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "generated/movement_config.h"
int main(void){
 RetroMovementConfig preset;RetroMovement ntsc,pal;RetroMovementResult a,b;
 RetroBody body={40*256,160*256,{-4,-16,8,16},1};
 RetroCollider floor={{0,160,320,2},1,RETRO_COLLIDER_SOLID};
 retroMovementPreset(&preset);
 ${MOVEMENT_FIELDS.map(([name])=>`assert(preset.${name}==retroProjectMovementNtsc.${name});`).join('\n ')}
 assert(preset.airDash==retroProjectMovementNtsc.airDash);
 assert(retroMovementValidate(&retroProjectMovementNtsc)&&retroMovementValidate(&retroProjectMovementPal));
 assert(retroProjectMovementPal.walkSpeed==512&&retroProjectMovementPal.jumpSpeed==1536);
 assert(retroMovementInit(&ntsc,&body)&&retroMovementInit(&pal,&body));
 a=retroMovementTick(&ntsc,&retroProjectMovementNtsc,(RetroMovementInput){0,3},&floor,1,0,0);
 b=retroMovementTick(&pal,&retroProjectMovementPal,(RetroMovementInput){0,3},&floor,1,0,0);
 assert(!a.invalid&&!b.invalid&&a.jumped&&b.jumped&&ntsc.body.y==155*256&&pal.body.y==154*256);
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime'),sources=['retro_collision.c','retro_slopes.c','retro_movement.c'].map(name=>path.join(runtime,name))
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+path.join(root,'src'),'-I'+runtime]
 const built=spawnSync('cc',[...flags,fixture,...sources,'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const sdk=process.argv[sdkIndex+1]
  fs.writeFileSync(path.join(root,'src/main.c'),`#include <genesis.h>
#include "generated/movement_config.h"
static RetroMovement player;static RetroInput input;
static const RetroCollider room[]={{{0,200,320,2},1,RETRO_COLLIDER_SOLID},{{0,40,2,160},1,RETRO_COLLIDER_SOLID},{{318,40,2,160},1,RETRO_COLLIDER_SOLID},{{80,150,64,2},1,RETRO_COLLIDER_PLATFORM}};
int main(void){
 RetroBody body={40*256,200*256,{-4,-16,8,16},1};
 const RetroMovementConfig *config=IS_PAL_SYSTEM?&retroProjectMovementPal:&retroProjectMovementNtsc;
 retroMovementInit(&player,&body);JOY_init();
 VDP_drawText("SHARED MOVEMENT CONTROLLER",1,1);VDP_drawText("B JUMP / C DASH / DOWN DROP",1,2);
 while(TRUE){
  RetroMovementInput movement;RetroMovementResult result;
  retroInputUpdate(&input,JOY_readJoypad(JOY_1));movement.axis=retroInputAxis(&input,BUTTON_LEFT,BUTTON_RIGHT);
  movement.buttons=((input.held&BUTTON_B)?RETRO_MOVE_JUMP_HELD:0)|((input.pressed&BUTTON_B)?RETRO_MOVE_JUMP_PRESSED:0)|((input.pressed&BUTTON_C)?RETRO_MOVE_DASH_PRESSED:0)|((input.held&BUTTON_DOWN)?RETRO_MOVE_DROP_HELD:0);
  result=retroMovementTick(&player,config,movement,room,4,0,0);
  VDP_drawText(result.invalid?"INVALID":player.sliding?"SLIDING":player.grounded?"GROUND ":"AIR    ",1,4);
  SYS_doVBlankProcess();
 }
 return 0;
}
`)
  const sdkBuild=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(sdkBuild.status,0,sdkBuild.stdout.slice(-4000)+sdkBuild.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  console.log('PASS per-region configuration -> shared movement C -> SGDK ROM ('+rom.length+' bytes)')
 }
 fs.appendFileSync(headerPath,'/* manual change */')
 assert.ok(movementConfigurationStatus(root).headerConflict)
 assert.throws(()=>saveMovementConfiguration(root,{config,revision:movementConfigurationStatus(root).revision}),/customized/)
 assert.ok(fs.readFileSync(headerPath,'utf8').endsWith('/* manual change */'))
 fs.writeFileSync(path.join(root,'physics/movement.json'),'{"version":99}')
 assert.throws(()=>movementConfigurationStatus(root),/Unsupported/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Movement configuration: explicit regions, Q8 precision, project isolation, transactional source/header, conflicts, stale revisions and shared C passed.')
