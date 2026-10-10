import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-runtime-scene-'))
try{
 fs.writeFileSync(path.join(temporary,'genesis.h'),[
 '#ifndef TEST_GENESIS_H','#define TEST_GENESIS_H','#include <stdint.h>',
 'typedef uint8_t u8;typedef uint16_t u16;typedef int16_t s16;typedef int32_t s32;typedef uint32_t u32;',
 'typedef struct {u8 timer;} AnimationFrame;',
 'typedef struct {u8 numFrame;AnimationFrame **frames;} Animation;',
 'typedef struct {u16 length;u16 *data;} Palette;typedef struct {u16 w,h,numAnimation;Animation **animations;Palette *palette;u16 maxNumTile,maxNumSprite;} SpriteDefinition;',
 'typedef struct Sprite {u16 timer,attr;s16 x,y,frame;u8 visibility;void (*callback)(struct Sprite*);} Sprite;',
 'typedef void FrameChangeCallback(Sprite*);',
 'enum {HIDDEN=0,AUTO_FAST=2};extern u16 screenWidth,screenHeight;',
 '#define TILE_ATTR(p,priority,v,h) ((u16)(((p)<<13)|((priority)<<15)|((v)<<12)|((h)<<11)))',
 'Sprite *SPR_addSprite(const SpriteDefinition*,s16,s16,u16);void SPR_releaseSprite(Sprite*);',
 'void SPR_setAnimAndFrame(Sprite*,s16,s16);void SPR_setVisibility(Sprite*,u16);',
 'void SPR_setPosition(Sprite*,s16,s16);void SPR_setFrameChangeCallback(Sprite*,FrameChangeCallback*);','#endif',''].join('\n'))
 const fixture=path.join(temporary,'test.c')
 fs.writeFileSync(fixture,[
 '#include <assert.h>','#include "retro_scene.h"',
 'u16 screenWidth=320,screenHeight=224;static Sprite allocated[80];',
 'static int adds,releases,failAt=-1;',
 'Sprite *SPR_addSprite(const SpriteDefinition *d,s16 x,s16 y,u16 attr){',
 ' Sprite *sprite;(void)d;if(adds==failAt){adds++;return 0;}',
 ' sprite=&allocated[adds++];sprite->x=x;sprite->y=y;sprite->attr=attr;return sprite;}',
 'void SPR_releaseSprite(Sprite *sprite){assert(sprite);releases++;}',
 'void SPR_setAnimAndFrame(Sprite *sprite,s16 anim,s16 frame){(void)anim;sprite->frame=frame;sprite->timer=9;}',
 'void SPR_setVisibility(Sprite *sprite,u16 value){sprite->visibility=(u8)value;}',
 'void SPR_setPosition(Sprite *sprite,s16 x,s16 y){sprite->x=x;sprite->y=y;}',
 'void SPR_setFrameChangeCallback(Sprite *sprite,FrameChangeCallback *callback){sprite->callback=callback;}',
 'int main(void){',
 ' AnimationFrame f0={2},f1={1};AnimationFrame *frames[]={&f0,&f1};',
 ' Animation anim={2,frames};Animation *animations[]={&anim};',
 ' u16 colors[16]={0},otherColors[16]={0};Palette palette={16,colors},other={16,otherColors};const Palette *slots[4]={0,&palette,0,0};',
 ' SpriteDefinition resource={32,24,1,animations,&palette,12,2};u16 durations[]={3,1};',
 ' RetroSceneObjectDefinition defs[]={',
 ' {11,&resource,80,80,8,24,0,1,1,1,0,0,durations,2},',
 ' {12,&resource,120,80,8,24,0,1,0,0,1,1,0,0}};',
 ' RetroScene scene={0};RetroSceneObject objects[2];',
 ' RetroSceneResourceBudget budget={99,99};',
 ' assert(retroSceneMeasureResources(defs,2,&budget)==RETRO_SCENE_OK&&budget.tiles==24&&budget.sprites==4);',
 ' assert(retroSceneValidatePalettes(defs,2,slots)==RETRO_SCENE_OK&&adds==0);',
 ' slots[1]=&other;otherColors[0]=0xEEE;assert(retroSceneValidatePalettes(defs,2,slots)==RETRO_SCENE_OK);',
 ' otherColors[1]=0x111;assert(retroSceneValidatePalettes(defs,2,slots)==RETRO_SCENE_OK);',
 ' otherColors[1]=0x002;assert(retroSceneValidatePalettes(defs,2,slots)==RETRO_SCENE_PALETTE&&adds==0);',
 ' otherColors[1]=0;other.length=15;assert(retroSceneValidatePalettes(defs,2,slots)==RETRO_SCENE_PALETTE);other.length=16;',
 ' slots[1]=0;assert(retroSceneValidatePalettes(defs,2,slots)==RETRO_SCENE_PALETTE);slots[1]=&palette;',
 ' assert(retroSceneValidatePalettes(defs,2,0)==RETRO_SCENE_PALETTE);',
 ' assert(retroSceneValidatePalettes(0,0,0)==RETRO_SCENE_OK);',
 ' assert(retroSceneMeasureResources(0,0,&budget)==RETRO_SCENE_OK&&!budget.tiles&&!budget.sprites);',
 ' budget.tiles=99;defs[1].id=11;assert(retroSceneMeasureResources(defs,2,&budget)==RETRO_SCENE_INVALID&&budget.tiles==99);defs[1].id=12;',
 ' assert(retroSceneMeasureResources(defs,81,&budget)==RETRO_SCENE_INVALID&&budget.tiles==99);',
 ' assert(retroSceneMeasureResources(defs,2,0)==RETRO_SCENE_INVALID);',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_OK);',
 ' assert(adds==2 && scene.count==2);',
 ' assert(objects[0].sprite->x==56 && objects[0].sprite->y==56);',
 ' assert(objects[1].sprite->x==112 && objects[1].sprite->y==80);',
 ' assert(objects[0].sprite->attr==TILE_ATTR(1,1,0,1));',
 ' /* SGDK resets timer during SPR_update: disable it in actual frame callback. */',
 ' objects[0].sprite->timer=9;objects[0].sprite->callback(objects[0].sprite);',
 ' assert(objects[0].sprite->timer==0);',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_INVALID);',
 ' assert(retroSceneFind(&scene,11)==&objects[0] && !retroSceneFind(&scene,65535));',
 ' retroSceneTick(&scene);assert(objects[0].frame==0 && objects[1].frame==0);',
 ' retroSceneTick(&scene);assert(objects[0].frame==0 && objects[1].frame==1);',
 ' retroSceneTick(&scene);assert(objects[0].frame==1 && objects[1].frame==0);',
 ' retroSceneTick(&scene);assert(!objects[0].playing && objects[0].frame==1);',
 ' objects[0].x=-32768;retroScenePosition(&scene,32767,0);',
 ' assert(objects[0].sprite->visibility==HIDDEN);',
 ' objects[0].x=80;retroScenePosition(&scene,0,0);',
 ' assert(objects[0].sprite->visibility==AUTO_FAST && objects[0].sprite->x==56);',
 ' retroSceneFree(&scene);assert(releases==2 && !scene.initialized);',
 ' retroSceneFree(&scene);assert(releases==2);',
 ' adds=0;releases=0;failAt=1;',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_ALLOCATION);',
 ' assert(releases==1 && !scene.initialized);',
 ' adds=0;failAt=-1;defs[1].id=11;',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_INVALID && adds==0);',
 ' defs[1].id=12;defs[0].durationCount=1;',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_INVALID && adds==0);',
 ' defs[0].durationCount=2;defs[0].supportX=33;',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_INVALID);',
 ' defs[0].supportX=8;defs[0].animation=1;',
 ' assert(retroSceneInit(&scene,objects,2,defs,2)==RETRO_SCENE_INVALID);',
 ' assert(retroSceneInit(&scene,0,0,0,0)==RETRO_SCENE_OK);retroSceneFree(&scene);',
 ' retroSceneTick(0);retroScenePosition(0,0,0);retroSceneFree(0);return 0;}',''].join('\n'))
 const library=path.join(root,'assets/toolkit/lib/runtime/scene'),binary=path.join(temporary,'test')
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I',temporary,'-I',library,fixture,path.join(library,'retro_scene.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Scene runtime: mirrored support, attributes, owned timers, camera clipping, lookup, nonloop/loop, validation and allocation rollback passed.')
