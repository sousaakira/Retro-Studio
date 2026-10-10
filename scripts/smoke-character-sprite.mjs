import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {buildSgdkAnimationHeader,charsetGeometryHeader} from '../src/utils/retro/charsetMaker.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-character-sprite-'))
const library=new URL('../assets/toolkit/lib/runtime/',import.meta.url).pathname
try {
 fs.writeFileSync(path.join(temporary,'genesis.h'),`#ifndef TEST_GENESIS_H
#define TEST_GENESIS_H
#include <stdint.h>
typedef uint8_t u8;typedef uint16_t u16;typedef int16_t s16;typedef int32_t s32;
typedef struct {u16 timer;} AnimationFrame;
typedef struct {u16 numFrame;AnimationFrame **frames;} Animation;
typedef struct {u16 w,h,numAnimation;Animation **animations;} SpriteDefinition;
typedef struct Sprite {const SpriteDefinition*definition;AnimationFrame*frame;void(*onFrameChange)(struct Sprite*);u16 timer,attribut;uint32_t data;s16 x,y,animInd,frameInd;u8 visible;} Sprite;
#endif
`.replace('#endif',`typedef void FrameChangeCallback(Sprite*);
enum {HIDDEN=0,AUTO_FAST=2};extern u16 screenWidth,screenHeight;
void SPR_setFrameChangeCallback(Sprite*,FrameChangeCallback*);
void SPR_setAnimAndFrame(Sprite*,s16,s16);void SPR_setHFlip(Sprite*,u8);void SPR_setVFlip(Sprite*,u8);void SPR_setPriority(Sprite*,u8);
void SPR_setVisibility(Sprite*,u16);void SPR_setPosition(Sprite*,s16,s16);
#endif`))
 fs.writeFileSync(path.join(temporary,'test.c'),`#include <assert.h>
#include "retro_character_sprite.h"
u16 screenWidth=320,screenHeight=224;
static RetroCharacterSprite adapter={0};
static unsigned poses,events,callbacks;
void SPR_setFrameChangeCallback(Sprite*s,FrameChangeCallback*f){s->onFrameChange=f;}
void SPR_setAnimAndFrame(Sprite*s,s16 a,s16 f){s->animInd=a;s->frameInd=f;s->frame=s->definition->animations[a]->frames[f];s->timer=9;}
void SPR_setHFlip(Sprite*s,u8 v){s->attribut=(s->attribut&~0x800)|(v?0x800:0);}
void SPR_setVFlip(Sprite*s,u8 v){s->attribut=(s->attribut&~0x1000)|(v?0x1000:0);}
void SPR_setPriority(Sprite*s,u8 v){s->attribut=(s->attribut&~0x8000)|(v?0x8000:0);}
void SPR_setVisibility(Sprite*s,u16 v){s->visible=(u8)v;}
void SPR_setPosition(Sprite*s,s16 x,s16 y){s->x=x;s->y=y;}
static void oldCallback(Sprite*s){(void)s;callbacks++;assert(!retroCharacterSpriteDetach(&adapter));}
static void otherCallback(Sprite*s){(void)s;}
static void oldPose(void*ctx,uint16_t id,uint16_t animation,uint16_t frame,const RetroCharacterPose*p){
 assert(ctx==(void*)123);(void)id;(void)animation;(void)frame;(void)p;poses++;
 assert(!retroCharacterSpriteDetach(&adapter));}
static void oldEvent(void*ctx,uint16_t state,const RetroCharacterEvent*e){assert(ctx==(void*)123);(void)state;(void)e;events++;}
static void otherEvent(void*ctx,uint16_t state,const RetroCharacterEvent*e){(void)ctx;(void)state;(void)e;}
int main(void){
 AnimationFrame f0={9},f1={9};AnimationFrame*frames[]={&f0,&f1};Animation animation={2,frames};Animation*animations[]={&animation};
 SpriteDefinition resource={64,48,1,animations};
 Sprite sprite={0};RetroCharacter c={0};RetroCharacterSprite duplicate={0};
 uint16_t times[]={1,2};RetroCharacterPose p[]={{64,48,40,48,0,0},{64,48,40,48,1,0}};
 RetroCharacterEvent e[]={{0,1,8},{1,2,9}};
 RetroCharacterState states[]={{10,0,2,times,p,e,2,0,1}};
 RetroCharacterDefinition d={states,1,0,0};RetroCharacterHost host={(void*)123,0,0,oldPose,oldEvent};
 sprite.definition=&resource;sprite.onFrameChange=oldCallback;sprite.data=1234;sprite.attribut=0x8000;
 assert(retroCharacterInit(&c,&d,10,&host));assert(poses==1&&events==1);
 assert(retroCharacterSpriteAttach(&adapter,&c,&sprite));assert(poses==1&&events==1&&sprite.data==1234);
 assert(!retroCharacterSpriteAttach(&duplicate,&c,&sprite));
 retroCharacterSpritePosition(&adapter,100,100,10,20);assert(sprite.x==50&&sprite.y==32&&sprite.visible==AUTO_FAST);
 retroCharacterSpriteFacing(&adapter,1,0);assert(sprite.x==66&&(sprite.attribut&0x800));
 retroCharacterSpritePriority(&adapter,0);assert(!(sprite.attribut&0x8000));
 retroCharacterTick(&c,0);assert(sprite.frameInd==1&&poses==2&&events==2&&sprite.timer==0);
 assert(sprite.x==50&&!(sprite.attribut&0x800)); /* facing XOR pose flip */
 sprite.timer=9;sprite.onFrameChange(&sprite);assert(callbacks==1&&sprite.timer==0);
 retroCharacterSpritePosition(&adapter,32767,100,-32768,0);assert(sprite.visible==HIDDEN);
 retroCharacterSpritePosition(&adapter,-32768,100,32767,0);assert(sprite.visible==HIDDEN);
 retroCharacterSpritePosition(&adapter,0,0,0,0);assert(sprite.visible==HIDDEN);
 assert(retroCharacterSpriteDetach(&adapter));assert(sprite.onFrameChange==oldCallback&&c.host.pose==oldPose&&c.host.context==(void*)123);
 assert(sprite.timer==9&&sprite.data==1234);assert(!retroCharacterSpriteDetach(&adapter));
 animation.numFrame=1;assert(!retroCharacterSpriteAttach(&adapter,&c,&sprite));assert(sprite.onFrameChange==oldCallback);animation.numFrame=2;
 assert(retroCharacterSpriteAttach(&adapter,&c,&sprite));sprite.onFrameChange=otherCallback;
 assert(retroCharacterSpriteDetach(&adapter));assert(sprite.onFrameChange==otherCallback);
 assert(retroCharacterSpriteAttach(&adapter,&c,&sprite));
 c.host.event=otherEvent;
 assert(!retroCharacterSpriteDetach(&adapter));
 assert(adapter.active&&adapter.sprite==&sprite&&c.host.event==otherEvent&&c.host.context==&adapter);
 c.host=host;c.host.event=otherEvent; /* fully independent host replacement */
 assert(retroCharacterSpriteDetach(&adapter));
 assert(c.host.event==otherEvent&&c.host.context==host.context&&sprite.onFrameChange==otherCallback);
 assert(retroCharacterSpriteAttach(&adapter,&c,&sprite));
 c.host.pose=oldPose;
 assert(!retroCharacterSpriteDetach(&adapter));assert(adapter.active&&c.host.context==&adapter);
 c.host=host;assert(retroCharacterSpriteDetach(&adapter));assert(c.host.pose==oldPose);
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+temporary,'-I'+path.join(library,'character'),'-I'+path.join(library,'core')]
 const binary=path.join(temporary,'test')
 const compiled=spawnSync('cc',[...flags,path.join(temporary,'test.c'),path.join(library,'character/retro_character_sprite.c'),path.join(library,'character/retro_character.c'),path.join(library,'core/retro_core.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(compiled.status,0,compiled.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const index=process.argv.indexOf('--sgdk')
 if(index>=0){
  const sdk=process.argv[index+1]
  const cross=spawnSync(path.join(sdk,'bin/m68k-elf-gcc'),['-m68000','-Os','-fno-builtin','-std=c99','-Wall','-Wextra','-Werror','-I'+path.join(sdk,'inc'),'-I'+path.join(sdk,'res'),'-I'+path.join(library,'character'),'-I'+path.join(library,'core'),'-c',path.join(library,'character/retro_character_sprite.c'),'-o',path.join(temporary,'sprite.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr||cross.error?.message)
  console.log('PASS adapter compiled against real SGDK headers for 68000')
  const game=path.join(temporary,'game')
  fs.cpSync(new URL('../assets/toolkit/examples/sgdk-skeleton/',import.meta.url).pathname,game,{recursive:true})
  installRuntimeModules(game);installCutsceneRuntime(game)
  const image=spawnSync('python3',['-c',"from PIL import Image\nim=Image.new('P',(64,48),0)\nim.putpalette([0,0,0,224,96,32,32,192,96]+[0]*759)\nfor y in range(4,48):\n for x in range(8,24):\n  im.putpixel((x,y),1)\n  im.putpixel((x+32,y),2)\nim.info['transparency']=0\nim.save('res/test-ninja.png')"],{cwd:game,encoding:'utf8'})
  assert.equal(image.status,0,image.stderr)
  fs.appendFileSync(path.join(game,'res/resources.res'),'\nSPRITE TEST_NINJA "test-ninja.png" 4 6 NONE [[2,3]] NONE\n')
  const exportedAnimations=[
   {id:'idle',name:'idle',frameCount:2,loop:true,attack:{enabled:true,x:4,y:-32,width:24,height:16,firstFrame:1,lastFrame:1},frames:[{width:32,height:48,anchorX:16,anchorY:48,durationTicks:2},{width:32,height:48,anchorX:16,anchorY:48,durationTicks:3}]}
  ]
  fs.writeFileSync(path.join(game,'src/ninja_animations.h'),buildSgdkAnimationHeader('ninja',exportedAnimations)
   .replace(/\n#endif\s*$/,'\n'+charsetGeometryHeader('ninja',exportedAnimations,{x:-8,y:-40,width:16,height:40})+'\n#endif\n'))
  fs.writeFileSync(path.join(game,'src/main.c'),`#include <genesis.h>
#include "resources.h"
#include "retro_runtime/retro_character_sprite.h"
#include "retro_runtime/retro_collision.h"
#include "retro_runtime/retro_slopes.h"
#include "ninja_animations.h"
int main(void) {
 RetroCharacter c={0};RetroCharacterSprite adapter={0};Sprite *sprite;
 RetroSlope slope={{0,160,320,16},1,0,0};
 RetroBody physics={160*RETRO_FIXED_ONE,120*RETRO_FIXED_ONE,{-8,-40,16,40},1};
 JOY_init();SPR_init();PAL_setPalette(PAL1,TEST_NINJA.palette->data,DMA);
 sprite=SPR_addSprite(&TEST_NINJA,0,0,TILE_ATTR(PAL1,1,0,0));
 if(!sprite || !retroCharacterInit(&c,&ninja_character_definition,NINJA_ANIM_IDLE,0) ||
    !retroCharacterSpriteAttach(&adapter,&c,sprite)) { VDP_drawText("Character init failed",1,1);while(1)SYS_doVBlankProcess(); }
 while(1) {
  u16 buttons=JOY_readJoypad(JOY_1);RetroRect body,attack,hurt;
  retroMoveBodySlopes(&physics,0,RETRO_FIXED_ONE,0,0,&slope,1,2,1,0);
  retroCharacterSpriteFacing(&adapter,(buttons&BUTTON_LEFT)!=0,0);
  retroCharacterSpritePosition(&adapter,160,160,0,0);
  if(!retroWorldRect(&ninja_body_box,160*RETRO_FIXED_ONE,160*RETRO_FIXED_ONE,(buttons&BUTTON_LEFT)!=0,0,&body))
   VDP_drawText("Body outside domain",1,1);
  retroFrameWorldRect(&ninja_attack_geometry[NINJA_ANIM_IDLE],c.animation.frame,
                      160*RETRO_FIXED_ONE,160*RETRO_FIXED_ONE,(buttons&BUTTON_LEFT)!=0,0,&attack);
  retroWorldRect(&ninja_hurt_box,160*RETRO_FIXED_ONE,160*RETRO_FIXED_ONE,(buttons&BUTTON_LEFT)!=0,0,&hurt);
  SPR_update();SYS_doVBlankProcess();retroCharacterTick(&c,0);
 }
 return 0;
}
`)
  const built=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:game,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(built.status,0,built.stdout.slice(-6000)+built.stderr.slice(-6000))
  const rom=fs.readFileSync(path.join(game,'out/rom.bin'))
  assert.ok(rom.subarray(256,272).toString('ascii').includes('SEGA'))
  console.log('PASS generated Charset Maker header -> ResComp -> character adapter -> SGDK ROM ('+rom.length+' bytes)')

 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Character sprite: borrowed ownership, callback chaining, manual timers, pivots/flips/camera, culling, validation and detach passed.')
