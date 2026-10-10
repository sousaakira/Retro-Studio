// #54: actual C controller, isolated from games and SGDK rendering.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSgdkAnimationHeader } from '../src/utils/retro/charsetMaker.js'
const root=fileURLToPath(new URL('../',import.meta.url))
const library=path.join(root,'assets/toolkit/lib/runtime')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-character-'))
try {
 const fixture=path.join(temporary,'test.c')
 fs.writeFileSync(fixture,`#include <assert.h>
#include "retro_character.h"
static RetroCharacter player={0};
static unsigned events=0, poses=0, entries=0;
static uint8_t allowed=0;
static void pose(void *ctx,uint16_t state,uint16_t anim,uint16_t frame,const RetroCharacterPose *p) {
 (void)ctx; (void)frame; assert(state!=RETRO_ID_NONE && anim!=RETRO_ID_NONE);
 assert(p->width==32 || p->width==64); poses++;
 assert(!retroCharacterSetState(&player,10));
 assert(!retroCharacterTick(&player,0));
 assert(!retroCharacterInit(&player,player.definition,10,&player.host));
}
static void event(void *ctx,uint16_t state,const RetroCharacterEvent *e) {
 (void)ctx; (void)state; assert(e->type==RETRO_CHARACTER_SOUND || e->type==RETRO_CHARACTER_ATTACK); events++;
}
static void enter(void *ctx,uint16_t before,uint16_t after) {
 (void)ctx; (void)before; assert(after!=RETRO_ID_NONE); entries++;
}
static uint8_t condition(void *ctx,uint16_t id) { (void)ctx; assert(id==77); return allowed; }
int main(void) {
 const uint16_t times[]={2,1};
 const RetroCharacterPose posesData[]={{32,48,16,48,0,0},{64,48,40,48,1,0}};
 const RetroCharacterEvent eventsData[]={{0,RETRO_CHARACTER_SOUND,8},{1,RETRO_CHARACTER_ATTACK,9}};
 RetroCharacterState states[]={
  {10,7,2,times,posesData,eventsData,2,1,1},
  {20,8,2,times,posesData,eventsData,2,0,0},
  {30,9,2,times,posesData,0,0,1,1}};
 RetroCharacterTransition transitions[]={
  {10,20,1,2,0,RETRO_ID_NONE,1,0},
  {10,30,1,2,0,77,5,0},
  {20,10,0,0,0,RETRO_ID_NONE,4,1},
  {30,10,0,0,0,RETRO_ID_NONE,0,0}};
 RetroCharacterDefinition definition={states,3,transitions,4};
 RetroCharacterHost host={0,condition,enter,pose,event};
 assert(retroCharacterValidate(&definition));
 assert(!retroCharacterInit(&player,&definition,999,&host));
 assert(retroCharacterInit(&player,&definition,10,&host));
 assert(retroCharacterStateId(&player)==10 && events==1 && poses==1 && entries==1);
 retroCharacterTick(&player,0); assert(events==1 && player.animation.frame==0);
 retroCharacterTick(&player,0); assert(events==2 && player.animation.frame==1);
 retroCharacterTick(&player,0); assert(events==3 && player.animation.frame==0);
 retroCharacterTick(&player,3); assert(retroCharacterStateId(&player)==10); /* excluded bit */
 allowed=1; assert(retroCharacterTick(&player,1)); assert(retroCharacterStateId(&player)==30);
 assert(retroCharacterTick(&player,0)); assert(retroCharacterStateId(&player)==10);
 allowed=0; assert(retroCharacterTick(&player,1)); assert(retroCharacterStateId(&player)==20);
 retroCharacterTick(&player,0); assert(retroCharacterStateId(&player)==20);
 retroCharacterTick(&player,0); assert(player.animation.frame==1);
 assert(retroCharacterTick(&player,0)); assert(retroCharacterStateId(&player)==10);
 transitions[0].minimumTicks=2;
 assert(!retroCharacterTick(&player,1));
 assert(retroCharacterTick(&player,1)); assert(retroCharacterStateId(&player)==20);
 assert(retroCharacterSetState(&player,10)); /* explicit custom override */
 assert(!retroCharacterSetState(&player,999));
 { /* A one-tick finite pose transitions after exactly one drawn frame. */
  const uint16_t one[]={1};
  states[1].durations=one; states[1].frameCount=1; states[1].events=0; states[1].eventCount=0;
  assert(retroCharacterSetState(&player,20));
  assert(retroCharacterTick(&player,0)); assert(retroCharacterStateId(&player)==10);
  states[1].durations=times; states[1].frameCount=2; states[1].events=eventsData; states[1].eventCount=2;
 }
 player.elapsed=65535; retroCharacterTick(&player,0); assert(player.elapsed==65535);
 states[1].id=10; assert(!retroCharacterValidate(&definition)); states[1].id=20;
 transitions[0].to=999; assert(!retroCharacterValidate(&definition)); transitions[0].to=20;
 transitions[0].requireNone=1; assert(!retroCharacterValidate(&definition)); transitions[0].requireNone=2;
 states[0].frameCount=256; assert(!retroCharacterValidate(&definition)); states[0].frameCount=2;
 states[0].eventCount=2049; assert(!retroCharacterValidate(&definition)); states[0].eventCount=2;
 states[0].durations=0; assert(!retroCharacterValidate(&definition)); states[0].durations=times;
 assert(!retroCharacterValidate(0)); assert(!retroCharacterTick(0,0));
 assert(retroCharacterStateId(0)==RETRO_ID_NONE);
 return 0;
}`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+path.join(library,'core'),'-I'+path.join(library,'character')]
 const binary=path.join(temporary,'test')
 const built=spawnSync('cc',[...flags,fixture,path.join(library,'character/retro_character.c'),path.join(library,'core/retro_core.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 // Compile the actual header exported by Charset Maker and use its named IDs.
 fs.writeFileSync(path.join(temporary,'genesis.h'),`#ifndef GENESIS_H
#define GENESIS_H
typedef unsigned short u16;
typedef struct { unsigned short numFrame; } Animation;
typedef struct { Animation *animation; unsigned short animInd,frameInd,timer; } Sprite;
static inline void SPR_setFrameChangeCallback(Sprite *s,void (*cb)(Sprite *)) { (void)s; (void)cb; }
static inline void SPR_setAnim(Sprite *s,u16 a) { (void)s; (void)a; }
#endif\n`)
 const exported=buildSgdkAnimationHeader('ninja',[
  {id:'idle-id',name:'idle',frameCount:2,loop:true,fps:8,controller:{interruptible:true,events:[],transitions:[{target:'sword-id',requireAll:2,requireNone:0,minimumTicks:0,priority:1,predicate:65535,finished:false}]},frames:[
   {width:32,height:48,anchorX:16,anchorY:48,durationTicks:2},
   {width:32,height:48,anchorX:16,anchorY:48,durationTicks:3}]},
  {id:'sword-id',name:'sword',frameCount:1,loop:false,fps:8,controller:{interruptible:false,events:[{frame:0,type:2,argument:99}],transitions:[{target:'idle-id',requireAll:0,requireNone:0,minimumTicks:0,priority:0,predicate:65535,finished:true}]},frames:[{width:64,height:48,anchorX:40,anchorY:48,durationTicks:4}]}
 ])
 fs.writeFileSync(path.join(temporary,'ninja.h'),exported)
 fs.writeFileSync(fixture,`#include <assert.h>
#include "retro_character.h"
#include "ninja.h"
static unsigned attacks=0;
static void hit(void *ctx,uint16_t state,const RetroCharacterEvent *event) { (void)ctx; assert(state==NINJA_ANIM_SWORD && event->type==RETRO_CHARACTER_ATTACK && event->argument==99); attacks++; }
int main(void) {
 RetroCharacter c={0};
 RetroCharacterHost host={0,0,0,0,hit};
 assert(retroCharacterInit(&c,&ninja_character_definition,NINJA_ANIM_IDLE,&host));
 assert(c.animation.remaining==2);
 retroCharacterTick(&c,0); retroCharacterTick(&c,0);
 assert(c.animation.frame==1 && c.animation.remaining==3);
 assert(ninja_character_states[0].poses[0].width==64);
 assert(ninja_character_states[0].poses[0].anchorX==40);
 assert(retroCharacterTick(&c,NINJA_CONDITION_MOVING));
 assert(retroCharacterStateId(&c)==NINJA_ANIM_SWORD && attacks==1);
 assert(c.animation.remaining==4 && !c.animation.loop);
 retroCharacterTick(&c,0); retroCharacterTick(&c,0); retroCharacterTick(&c,0);
 assert(retroCharacterStateId(&c)==NINJA_ANIM_SWORD && attacks==1);
 assert(retroCharacterTick(&c,0)); assert(retroCharacterStateId(&c)==NINJA_ANIM_IDLE && attacks==1);
 return 0;
}\n`)
 const exportedBuild=spawnSync('cc',[...flags,'-I'+temporary,fixture,path.join(library,'character/retro_character.c'),path.join(library,'core/retro_core.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(exportedBuild.status,0,exportedBuild.stderr)
 const exportedRun=spawnSync(binary,[],{encoding:'utf8'});assert.equal(exportedRun.status,0,exportedRun.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-Os',...flags,'-c',path.join(library,'character/retro_character.c'),'-o',path.join(temporary,'character.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr || cross.error?.message)
  console.log('PASS character controller compiled for 68000')
 }
 console.log('Character C: priority, conditions, interruptions, finite sequences, per-frame events/poses, reentrancy and invalid definitions passed.')
} finally { fs.rmSync(temporary,{recursive:true,force:true}) }
