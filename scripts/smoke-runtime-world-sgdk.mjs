// #55: real bridge+world C with SGDK call spies, no game project writes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-sgdk-'))
try{
 fs.writeFileSync(path.join(temporary,'genesis.h'),`#ifndef TEST_GENESIS_H
#define TEST_GENESIS_H
#include <stdint.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;
typedef int16_t s16;typedef int32_t s32;typedef uint8_t bool;
typedef enum {BG_A,BG_B} VDPPlane;
typedef enum {CPU,DMA,DMA_QUEUE} TransferMethod;
#define TRUE 1
#define FALSE 0
#define COMPRESSION_NONE 0
#define COMPRESSION_LZ4W 2
#define PAL0 0
#define HSCROLL_PLANE 0
#define VSCROLL_PLANE 0
#define TILE_USER_INDEX 16
#define TILE_FONT_INDEX 1400
#define TILE_SPRITE_INDEX (TILE_FONT_INDEX-spriteVramSize)
#define TILE_ATTR_FULL(p,pri,v,h,t) ((u16)(((p)<<13)|((pri)<<15)|((v)<<12)|((h)<<11)|(t)))
typedef struct {u16 compression,numTile;u32 *tiles;} TileSet;
typedef struct {u16 length;u16 *data;} Palette;
typedef struct {u16 w,h,hp,compression,numMetaTile,numBlock;u16 *metaTiles;void *blocks,*blockIndexes;u16 *blockRowOffsets;} MapDefinition;
typedef struct {const MapDefinition *definition;VDPPlane plane;u16 base;s16 x,y;int live;} Map;
extern u16 screenWidth,screenHeight,planeWidth,planeHeight,spriteVramSize;
u16 DMA_getMaxTransferSize(void);u16 DMA_getBufferSize(void);u16 DMA_getMaxQueueSize(void);u16 DMA_getQueueSize(void);bool DMA_getAutoFlush(void);
u8 VDP_getHorizontalScrollingMode(void);u8 VDP_getVerticalScrollingMode(void);void VDP_setScrollingMode(u16,u16);
Map *MAP_create(const MapDefinition*,VDPPlane,u16);void MAP_release(Map*);
TileSet *unpackTileSet(const TileSet*,TileSet*);void MEM_free(void*);
void SYS_doVBlankProcess(void);void VDP_clearPlane(VDPPlane,bool);
void VDP_setHorizontalScroll(VDPPlane,s16);void VDP_setVerticalScroll(VDPPlane,s16);
void VDP_setHorizontalScrollVSync(VDPPlane,s16);void VDP_setVerticalScrollVSync(VDPPlane,s16);
void MAP_scrollToEx(Map*,u32,u32,bool);void MAP_scrollTo(Map*,u32,u32);
u16 VDP_loadTileSet(const TileSet*,u16,TransferMethod);
void PAL_setPalette(u16,const u16*,TransferMethod);bool VDP_getEnable(void);void VDP_setEnable(bool);
#endif
`)
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test'),world=path.join(repository,'assets/toolkit/lib/runtime/world'),core=path.join(repository,'assets/toolkit/lib/runtime/core')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include "retro_world_sgdk.h"
u16 screenWidth=320,screenHeight=224,planeWidth=64,planeHeight=32,spriteVramSize=100;
static u16 transferLimit=7200,bufferSize=8192,queueCapacity=64,queueSize,tempBytes;
static bool autoFlush=1,display=1;static u8 horizontalMode,verticalMode;
static int allocations,releases,mapsLive,ownedLive,loads,clears,blanks,callbacks,failedMap=-1,unpacks,failedUnpack=-1,conditions;
static RetroWorld *callbackWorld;static RetroWorldSgdk *callbackBridge;static int testReentry;
static u16 paletteSlots[4],planeRoom[2],vrIndex[8],vrCount[8];
u16 DMA_getMaxTransferSize(void){return transferLimit;}u16 DMA_getBufferSize(void){return bufferSize;}u16 DMA_getMaxQueueSize(void){return queueCapacity;}u16 DMA_getQueueSize(void){return queueSize;}bool DMA_getAutoFlush(void){return autoFlush;}
void VDP_setScrollingMode(u16 h,u16 v){horizontalMode=(u8)h;verticalMode=(u8)v;}
u8 VDP_getHorizontalScrollingMode(void){return horizontalMode;}u8 VDP_getVerticalScrollingMode(void){return verticalMode;}
Map *MAP_create(const MapDefinition *d,VDPPlane p,u16 base){Map *m;if(allocations++==failedMap)return 0;m=malloc(sizeof(*m));assert(m);*m=(Map){d,p,base,0,0,1};mapsLive++;return m;}
void MAP_release(Map *m){assert(m&&m->live);m->live=0;mapsLive--;releases++;free(m);}
TileSet *unpackTileSet(const TileSet *src,TileSet *dest){TileSet *t;assert(!dest);if(unpacks++==failedUnpack)return 0;t=malloc(sizeof(*t));assert(t);*t=*src;t->compression=COMPRESSION_NONE;ownedLive++;return t;}
void MEM_free(void *p){assert(p);ownedLive--;free(p);}
void SYS_doVBlankProcess(void){assert(autoFlush);queueSize=0;tempBytes=0;blanks++;if(testReentry){assert(callbackWorld->busy);assert(retroWorldEnter(callbackWorld,1,10)==RETRO_WORLD_BUSY);assert(retroWorldFree(callbackWorld)==RETRO_WORLD_BUSY);assert(retroWorldSgdkFree(callbackBridge)==RETRO_WORLD_BUSY);assert(retroWorldSgdkScroll(callbackBridge,0,0)==RETRO_WORLD_SGDK_BUSY);}}
void VDP_clearPlane(VDPPlane p,bool wait){assert(wait);planeRoom[p]=0;clears++;}
void VDP_setHorizontalScroll(VDPPlane p,s16 x){(void)p;(void)x;}void VDP_setVerticalScroll(VDPPlane p,s16 y){(void)p;(void)y;}
void VDP_setHorizontalScrollVSync(VDPPlane p,s16 x){(void)p;(void)x;}void VDP_setVerticalScrollVSync(VDPPlane p,s16 y){(void)p;(void)y;}
void MAP_scrollToEx(Map *m,u32 x,u32 y,bool force){assert(m->live&&force);queueSize+=32;tempBytes+=4096;assert(queueSize<=queueCapacity&&tempBytes<=bufferSize);m->x=(s16)x;m->y=(s16)y;planeRoom[m->plane]=m->definition->metaTiles[0];}
void MAP_scrollTo(Map *m,u32 x,u32 y){int dx=(int)(x>>4)-(m->x>>4),dy=(int)(y>>4)-(m->y>>4);assert(m->live&&dx>=-1&&dx<=1&&dy>=-1&&dy<=1);if(dx){queueSize+=2;tempBytes+=128;}if(dy){queueSize+=2;tempBytes+=256;}assert(queueSize<=queueCapacity&&tempBytes<=bufferSize);m->x=(s16)x;m->y=(s16)y;}
u16 VDP_loadTileSet(const TileSet *t,u16 index,TransferMethod method){assert(t->compression==COMPRESSION_NONE&&method==DMA);assert(index+t->numTile<=TILE_SPRITE_INDEX);vrIndex[loads%8]=index;vrCount[loads%8]=t->numTile;loads++;return TRUE;}
void PAL_setPalette(u16 slot,const u16 *colors,TransferMethod method){assert(method==DMA&&slot<4);paletteSlots[slot]=colors[0];}
bool VDP_getEnable(void){return display;}void VDP_setEnable(bool value){display=value;}
static void activated(void *context,const RetroWorld *w){int *called=context;assert(w->busy&&w->room&&w->handle);assert(!display);(*called)++;}
static u8 allowed(void *context,u16 id){(void)context;assert(id==9);return (u8)conditions;}
typedef struct {u16 room;int live;} Content;
static Content *activeContent;
static int contentLive,contentPrepared,contentActivated,contentReleased,contentFail,contentAlias;
static u8 contentPrepare(void *context,const RetroWorldRoom *room,void **handle){
 Content *item;(void)context;assert(callbackWorld->busy);contentPrepared++;
 if(contentAlias){*handle=activeContent;return 1;}
 item=malloc(sizeof(*item));assert(item);*item=(Content){room->id,1};contentLive++;*handle=item;
 return (u8)!contentFail;
}
static void contentActivate(void *context,const RetroWorldRoom *room,void *handle){
 Content *item=handle;(void)context;assert(callbackWorld->busy&&!display);
 assert(item&&item->live&&item->room==room->id);activeContent=item;contentActivated++;
}
static void contentRelease(void *context,const RetroWorldRoom *room,void *handle){
 Content *item=handle;(void)context;assert(callbackWorld->busy&&item&&item->live&&item->room==room->id);
 if(item==activeContent)activeContent=0;
 item->live=0;contentLive--;contentReleased++;free(item);
}
int main(void){
 u32 pixels[16]={0};u16 dataA[4]={0x8001},dataB[4]={0x0002},dataFG[4]={0xA003},colorsA[64]={0x222},colorsB[16]={0x444};
 u8 blocks[64]={0},indices[8]={0};u16 rows[2]={0};
 TileSet tilesA={0,4,pixels},tilesB={2,6,pixels},tilesFG={2,3,pixels};
 MapDefinition mapA={4,2,2,0,1,1,dataA,blocks,indices,rows},mapB={5,2,2,0,1,1,dataB,blocks,indices,rows},mapFG={4,2,2,0,1,1,dataFG,blocks,indices,rows};
 RetroWorldSpawn entryA={10,32,180,0},entryB={11,600,180,1},checkpoint={30,200,200,1};u16 needs[1]={9};
 RetroWorldExit exitA={20,2,11,needs,1},exitB={21,1,10,0,0};
 RetroWorldRoom rooms[2]={{1,480,224,&entryA,1,&checkpoint,1,&exitA,1},{2,640,224,&entryB,1,0,0,&exitB,1}};
 RetroWorldDefinition definition={rooms,2,1,10};
 Palette paletteA={64,colorsA},paletteB={16,colorsB};
 RetroWorldSgdkRoom bindings[2]={{1,&tilesA,&mapA,&tilesFG,&mapFG,{{&paletteA,0},{0,0},{&paletteA,32},{0,0}}},{2,&tilesB,&mapB,0,0,{{&paletteB,0},{0,0},{0,0},{0,0}}}};
 RetroWorld world={0},prior;RetroWorldSgdk bridge={0};int before;
 paletteSlots[1]=0xEEE;
 colorsA[32]=0x666;callbackWorld=&world;callbackBridge=&bridge;
 /* Initial failure frees partial maps and compressed tiles, no VDP writes. */
 failedMap=1;assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,activated,allowed,&callbacks)==RETRO_WORLD_LOAD_FAILED);
 assert(!world.initialized&&!bridge.initialized&&mapsLive==0&&ownedLive==0&&loads==0&&clears==0&&blanks==0);
 assert(bridge.lastError==RETRO_WORLD_SGDK_MEMORY);failedMap=-1;
 assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,activated,allowed,&callbacks)==RETRO_WORLD_OK);
 assert(world.room->id==1&&world.x==32&&world.y==180&&!world.facing&&callbacks==1);
 assert(mapsLive==2&&ownedLive==1&&paletteSlots[1]==0xEEE&&paletteSlots[2]==0x666&&display&&queueSize==0);
 assert(vrIndex[0]==TILE_USER_INDEX&&vrIndex[1]==TILE_USER_INDEX+tilesA.numTile);
 assert(bridge.active->background->base==TILE_USER_INDEX&&bridge.active->foreground->base==TILE_USER_INDEX+tilesA.numTile);
 assert(planeRoom[BG_A]==0xA003&&planeRoom[BG_B]==0x8001&&bridge.cameraX==0);
 assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_INVALID);
 prior=world;before=loads;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_DENIED);assert(!memcmp(&prior,&world,sizeof(world))&&loads==before);
 conditions=1;
 /* A dynamically larger sprite reserve blocks the destination before allocation. */
 spriteVramSize=1380;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_LOAD_FAILED);assert(bridge.lastError==RETRO_WORLD_SGDK_VRAM);assert(!memcmp(&prior,&world,sizeof(world))&&loads==before);spriteVramSize=100;
 failedUnpack=unpacks;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_LOAD_FAILED);assert(ownedLive==1&&mapsLive==2&&loads==before&&!memcmp(&prior,&world,sizeof(world)));failedUnpack=-1;
 failedMap=allocations;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_LOAD_FAILED);assert(ownedLive==1&&mapsLive==2&&loads==before&&!memcmp(&prior,&world,sizeof(world)));failedMap=-1;
 assert(retroWorldCheckpoint(&world,30)==RETRO_WORLD_OK);
 before=clears;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_OK);
 assert(world.room->id==2&&world.x==600&&world.facing&&bridge.cameraX==320&&mapsLive==1&&ownedLive==1&&callbacks==2);
 assert(clears==before+2&&planeRoom[BG_A]==0&&planeRoom[BG_B]==2);
 assert(paletteSlots[0]==0x444&&paletteSlots[1]==0xEEE);
 before=blanks;assert(retroWorldSgdkScroll(&bridge,319,0)==RETRO_WORLD_SGDK_OK);assert(blanks==before&&bridge.cameraX==319);
 assert(retroWorldSgdkScroll(&bridge,318,0)==RETRO_WORLD_SGDK_QUEUE&&bridge.cameraX==319);SYS_doVBlankProcess();
 before=blanks;display=0;testReentry=1;assert(retroWorldSgdkScroll(&bridge,0,0)==RETRO_WORLD_SGDK_OK);testReentry=0;assert(blanks==before+1&&!display&&bridge.cameraX==0&&!world.busy);display=1;
 horizontalMode=1;assert(retroWorldSgdkScroll(&bridge,10,0)==RETRO_WORLD_SGDK_VDP&&bridge.cameraX==0);horizontalMode=0;
 assert(retroWorldRespawn(&world)==RETRO_WORLD_OK);assert(world.room->id==1&&world.x==200&&world.y==200&&world.facing&&bridge.cameraX==40&&mapsLive==2&&ownedLive==1);
 before=loads;assert(retroWorldRespawn(&world)==RETRO_WORLD_OK);assert(loads==before&&mapsLive==2&&callbacks==4);
 before=loads;queueSize=1;assert(retroWorldSgdkFree(&bridge)==RETRO_WORLD_OK);assert(mapsLive==0&&ownedLive==0&&planeRoom[0]==0&&planeRoom[1]==0&&queueSize==0&&!bridge.initialized&&!world.initialized&&loads==before&&paletteSlots[1]==0xEEE);
 bufferSize=2048;assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_LOAD_FAILED);assert(bridge.lastError==RETRO_WORLD_SGDK_VDP&&mapsLive==0);bufferSize=8192;
 bindings[1].room=1;assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_INVALID);bindings[1].room=2;
 bindings[0].palettes[0].offset=63;assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_INVALID);bindings[0].palettes[0].offset=0;
 paletteB.length=8;assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_INVALID);paletteB.length=16;
 assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_OK);assert(retroWorldFree(&world)==RETRO_WORLD_OK&&!bridge.initialized&&mapsLive==0&&ownedLive==0);
 mapA.w=1;assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,2,0,0,0)==RETRO_WORLD_INVALID);
 mapA.w=4;
 {
  RetroWorldSgdkContentHooks hooks={contentPrepare,contentActivate,contentRelease,0};Content *old;
  hooks.release=0;assert(retroWorldSgdkInitWithContent(&bridge,&world,&definition,bindings,2,&hooks,0,0,0)==RETRO_WORLD_INVALID);hooks.release=contentRelease;
  contentFail=1;
  assert(retroWorldSgdkInitWithContent(&bridge,&world,&definition,bindings,2,&hooks,0,0,0)==RETRO_WORLD_LOAD_FAILED);
  assert(bridge.lastError==RETRO_WORLD_SGDK_CONTENT&&contentLive==0&&contentReleased==1&&mapsLive==0&&!world.initialized);
  contentFail=0;conditions=1;
  assert(retroWorldSgdkInitWithContent(&bridge,&world,&definition,bindings,2,&hooks,0,allowed,0)==RETRO_WORLD_OK);
  assert(contentLive==1&&contentActivated==1);old=activeContent;prior=world;before=loads;
  contentFail=1;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_LOAD_FAILED);contentFail=0;
  assert(!memcmp(&prior,&world,sizeof(world))&&activeContent==old&&old->live&&contentLive==1&&loads==before);
  contentAlias=1;assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_LOAD_FAILED);contentAlias=0;
  assert(activeContent==old&&old->live&&contentLive==1&&!memcmp(&prior,&world,sizeof(world)));
  assert(retroWorldExitThrough(&world,20)==RETRO_WORLD_OK&&activeContent!=old&&contentLive==1&&contentActivated==2);
  before=contentPrepared;assert(retroWorldEnter(&world,2,11)==RETRO_WORLD_OK&&contentPrepared==before&&contentActivated==3);
  assert(retroWorldSgdkFree(&bridge)==RETRO_WORLD_OK&&contentLive==0&&!activeContent&&mapsLive==0&&ownedLive==0);
  assert(contentReleased==4);
 }
 return 0;
}
`)
 const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-Wno-missing-field-initializers','-I',temporary,'-I',world,'-I',core,fixture,path.join(world,'retro_world.c'),path.join(world,'retro_world_sgdk.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr);const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const sdk=process.argv[sdkIndex+1],cross=spawnSync(path.join(sdk,'bin/m68k-elf-gcc'),['-std=c99','-Wall','-Wextra','-Werror','-fno-builtin','-m68000','-I',path.join(sdk,'inc'),'-I',path.join(sdk,'res'),'-I',world,'-I',core,'-c',path.join(world,'retro_world_sgdk.c'),'-o',path.join(temporary,'bridge.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr);console.log('PASS world SGDK bridge -> strict 68000 compilation')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('World SGDK bridge: preparation rollback, VRAM reserve, palette preservation, missing foreground clear, owned MAP/tile release, position/facing, checkpoint and queue/scroll guards passed.')
