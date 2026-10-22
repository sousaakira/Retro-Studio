// #62: ponte do mundo + adaptador de cenário + núcleo, contra um VDP de mentira com VRAM,
// dois planos, tabelas de scroll e fila de DMA aplicada no VBlank. A cada quadro confere, célula
// a célula, o que a tela mostra nos dois planos; as velocidades das faixas do panorama; o
// orçamento de DMA; e que nenhum tile fora da faixa da sala foi escrito. Troca de sala entre
// cenário (streaming) e caminho antigo (MAP do SGDK) nos dois sentidos.
// #90: a sala 3 tem dois planos de mapa (BG_A e BG_B) com 3000 padrões, números num vetor próprio
// e células vazias.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-scenery-sgdk-'))
try{
 fs.writeFileSync(path.join(temporary,'genesis.h'),String.raw`#ifndef TEST_GENESIS_H
#define TEST_GENESIS_H
#include <stdint.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;
typedef int16_t s16;typedef int32_t s32;typedef uint8_t bool;
typedef enum {BG_A,BG_B,WINDOW} VDPPlane;
typedef enum {CPU,DMA,DMA_QUEUE} TransferMethod;
#define TRUE 1
#define FALSE 0
#define COMPRESSION_NONE 0
#define PAL0 0
#define HSCROLL_PLANE 0
#define HSCROLL_TILE 2
#define HSCROLL_LINE 3
#define VSCROLL_PLANE 0
#define DMA_VRAM 0
#define TILE_USER_INDEX 16
#define TILE_FONT_INDEX 1400
#define TILE_SPRITE_INDEX (TILE_FONT_INDEX-spriteVramSize)
#define TILE_ATTR_FULL(p,pri,v,h,t) ((u16)(((p)<<13)|((pri)<<15)|((v)<<12)|((h)<<11)|(t)))
typedef struct {u16 compression,numTile;u32 *tiles;} TileSet;
typedef struct {u16 compression,w,h;u16 *tilemap;} TileMap;
typedef struct {u16 length;u16 *data;} Palette;
typedef struct {u16 w,h,hp,compression,numMetaTile,numBlock;u16 *metaTiles;void *blocks,*blockIndexes;u16 *blockRowOffsets;} MapDefinition;
typedef struct {const MapDefinition *definition;VDPPlane plane;u16 base;s16 x,y;int live;} Map;
extern u16 screenWidth,screenHeight,planeWidth,planeHeight,spriteVramSize;
u16 DMA_getMaxTransferSize(void);u16 DMA_getBufferSize(void);u16 DMA_getMaxQueueSize(void);u16 DMA_getQueueSize(void);bool DMA_getAutoFlush(void);
void *DMA_allocateAndQueueDma(u8,u16,u16,u16);bool DMA_queueDma(u8,void*,u16,u16,u16);
u8 VDP_getHorizontalScrollingMode(void);u8 VDP_getVerticalScrollingMode(void);void VDP_setScrollingMode(u16,u16);
u16 VDP_getPlaneAddress(VDPPlane,u16,u16);
Map *MAP_create(const MapDefinition*,VDPPlane,u16);void MAP_release(Map*);
TileSet *unpackTileSet(const TileSet*,TileSet*);void *MEM_alloc(u32);void MEM_free(void*);
void SYS_doVBlankProcess(void);void VDP_clearPlane(VDPPlane,bool);
void VDP_setHorizontalScroll(VDPPlane,s16);void VDP_setVerticalScroll(VDPPlane,s16);
void VDP_setHorizontalScrollVSync(VDPPlane,s16);void VDP_setVerticalScrollVSync(VDPPlane,s16);
void VDP_setHorizontalScrollTile(VDPPlane,u16,s16*,u16,TransferMethod);
void VDP_setHorizontalScrollLine(VDPPlane,u16,s16*,u16,TransferMethod);
extern u32 vtimer;u16 SYS_isPAL(void);
void MAP_scrollToEx(Map*,u32,u32,bool);void MAP_scrollTo(Map*,u32,u32);
u16 VDP_loadTileSet(const TileSet*,u16,TransferMethod);
bool VDP_setTileMapEx(VDPPlane,const TileMap*,u16,u16,u16,u16,u16,u16,u16,TransferMethod);
void PAL_setPalette(u16,const u16*,TransferMethod);bool VDP_getEnable(void);void VDP_setEnable(bool);
#endif
`)
 const lib=path.join(repository,'assets/toolkit/lib/runtime'),fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,String.raw`#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "retro_scenery_sgdk.h"
u16 screenWidth=320,screenHeight=224,planeWidth=64,planeHeight=32,spriteVramSize=128;
/* ---- VDP de mentira ---------------------------------------------------------------- */
#define PLANE_A 0xE000u
#define PLANE_B 0xC000u
static u16 vram[0x8000];              /* palavras */
static int writer[2048];              /* quem escreveu cada tile: 0 ninguém, 1 sala, 9 outro consumidor */
static s16 hscroll[2],vscroll[2],pendingH[2],pendingV[2],tileScroll[2][32];static u8 pendingHSet[2],pendingVSet[2];
static u8 hmode,display=1;static u16 limit=7200,bufferSize=8192,queueCapacity=64;
typedef struct {const u16 *from;u16 to,len,step;} Job;
static Job queue[256];static u16 queueSize,queueBytes;static u16 temp[8192];static u16 tempUsed;
static s16 *pendingTile[2];static u16 pendingTileLen[2];
static unsigned frameBytes,frameEntries,peakBytes,peakEntries,allocations,vblanks;
static void put(u16 address,u16 value,int who){
 assert(!(address&1));vram[address>>1]=value;
 if(address<PLANE_B){u16 tile=address>>5;assert(tile<2048);if(who){assert(writer[tile]!=9||!"escreveu no tile de outro consumidor");writer[tile]=who;}}
}
/* Salas sem faixas de correnteza (versão 3): o scroll por linha nunca é usado. */
u32 vtimer;u16 SYS_isPAL(void){return 0;}
void VDP_setHorizontalScrollLine(VDPPlane p,u16 l,s16 *v,u16 n,TransferMethod m){(void)p;(void)l;(void)v;(void)n;(void)m;assert(!"scroll por linha numa sala sem faixas");}
u16 DMA_getMaxTransferSize(void){return limit;}u16 DMA_getBufferSize(void){return bufferSize;}u16 DMA_getMaxQueueSize(void){return queueCapacity;}u16 DMA_getQueueSize(void){return queueSize;}bool DMA_getAutoFlush(void){return 1;}
bool DMA_queueDma(u8 location,void *from,u16 to,u16 len,u16 step){
 assert(location==DMA_VRAM&&from&&len&&queueSize<queueCapacity);
 queue[queueSize++]=(Job){from,to,len,step};queueBytes=(u16)(queueBytes+len*2);assert(!limit||queueBytes<=limit);return TRUE;
}
void *DMA_allocateAndQueueDma(u8 location,u16 to,u16 len,u16 step){
 u16 *buffer=temp+tempUsed;assert((tempUsed+len)*2<=bufferSize);tempUsed=(u16)(tempUsed+len);
 return DMA_queueDma(location,buffer,to,len,step)?buffer:0;
}
u8 VDP_getHorizontalScrollingMode(void){return hmode;}u8 VDP_getVerticalScrollingMode(void){return VSCROLL_PLANE;}
void VDP_setScrollingMode(u16 h,u16 v){assert(v==VSCROLL_PLANE);hmode=(u8)h;}
u16 VDP_getPlaneAddress(VDPPlane plane,u16 x,u16 y){assert(x<64&&y<32);return (u16)((plane==BG_A?PLANE_A:PLANE_B)+(y*64+x)*2);}
void SYS_doVBlankProcess(void){
 u16 i,k;int p;
 for(i=0;i<queueSize;i++)for(k=0;k<queue[i].len;k++)put((u16)(queue[i].to+k*queue[i].step),queue[i].from[k],1);
 if(queueBytes>peakBytes)peakBytes=queueBytes;if(queueSize>peakEntries)peakEntries=queueSize;
 frameBytes=queueBytes;frameEntries=queueSize;queueSize=queueBytes=tempUsed=0;vblanks++;
 for(p=0;p<2;p++){
  if(pendingHSet[p]){hscroll[p]=pendingH[p];pendingHSet[p]=0;}
  if(pendingVSet[p]){vscroll[p]=pendingV[p];pendingVSet[p]=0;}
  if(pendingTile[p]){memcpy(tileScroll[p],pendingTile[p],pendingTileLen[p]*2);pendingTile[p]=0;}
 }
}
void VDP_clearPlane(VDPPlane plane,bool wait){u16 i;assert(wait);for(i=0;i<64*32;i++)vram[((plane==BG_A?PLANE_A:PLANE_B)>>1)+i]=0;}
void VDP_setHorizontalScroll(VDPPlane p,s16 v){hscroll[p]=v;}void VDP_setVerticalScroll(VDPPlane p,s16 v){vscroll[p]=v;}
void VDP_setHorizontalScrollVSync(VDPPlane p,s16 v){pendingH[p]=v;pendingHSet[p]=1;}void VDP_setVerticalScrollVSync(VDPPlane p,s16 v){pendingV[p]=v;pendingVSet[p]=1;}
void VDP_setHorizontalScrollTile(VDPPlane p,u16 tile,s16 *values,u16 len,TransferMethod method){
 assert(hmode==HSCROLL_TILE&&!tile&&len<=32);
 /* A tabela ocupa uma entrada da fila; o destino (tabela de scroll) fica fora da VRAM simulada. */
 if(method==DMA_QUEUE){assert(queueSize<queueCapacity);queue[queueSize++]=(Job){0,0,0,0};queueBytes=(u16)(queueBytes+len*2);pendingTile[p]=values;pendingTileLen[p]=len;}
 else memcpy(tileScroll[p],values,len*2);
}
u16 VDP_loadTileSet(const TileSet *t,u16 index,TransferMethod method){u32 i;assert(t->compression==COMPRESSION_NONE&&method==DMA&&!display);for(i=0;i<(u32)t->numTile*8;i++){put((u16)(index*32+i*4),(u16)(t->tiles[i]>>16),1);put((u16)(index*32+i*4+2),(u16)t->tiles[i],0);}return TRUE;}
bool VDP_setTileMapEx(VDPPlane plane,const TileMap *map,u16 base,u16 xp,u16 yp,u16 x,u16 y,u16 w,u16 h,TransferMethod method){
 u16 i,k;assert(method==DMA&&!display&&!xp&&!yp&&!x&&!y);
 for(k=0;k<h;k++)for(i=0;i<w;i++){u16 cell=map->tilemap[k*map->w+i];put(VDP_getPlaneAddress(plane,i,k),(u16)((cell&0xF800)|((cell&0x7FF)+(base&0x7FF))|(base&0xF800)),0);}
 return TRUE;
}
void PAL_setPalette(u16 slot,const u16 *colors,TransferMethod method){(void)slot;(void)colors;assert(method==DMA);}
bool VDP_getEnable(void){return display;}void VDP_setEnable(bool value){display=value;}
void *MEM_alloc(u32 size){allocations++;return malloc(size);}void MEM_free(void *p){assert(p);allocations--;free(p);}
TileSet *unpackTileSet(const TileSet *src,TileSet *dest){(void)src;(void)dest;assert(!"sem compressão neste teste");return 0;}
/* Caminho antigo: o MAP do SGDK vira um carimbo no plano (não é o que está em teste aqui). */
static int mapsLive;static s16 legacyX,legacyY;
Map *MAP_create(const MapDefinition *d,VDPPlane p,u16 base){Map *m=malloc(sizeof *m);*m=(Map){d,p,base,0,0,1};mapsLive++;return m;}
void MAP_release(Map *m){assert(m->live);mapsLive--;free(m);}
void MAP_scrollToEx(Map *m,u32 x,u32 y,bool force){assert(force&&hmode==HSCROLL_PLANE);queue[queueSize++]=(Job){0,0,0,0};m->x=legacyX=(s16)x;m->y=legacyY=(s16)y;put(VDP_getPlaneAddress(m->plane,0,0),0x4242,0);}
void MAP_scrollTo(Map *m,u32 x,u32 y){assert(hmode==HSCROLL_PLANE);m->x=legacyX=(s16)x;m->y=legacyY=(s16)y;}
/* ---- Dados das salas ----------------------------------------------------------------- */
#define W 220
#define H 64
#define TILES 900
#define PAN_TILES 70
#define BUDGET 520
#define SENTINEL (TILE_USER_INDEX+BUDGET)
static u32 seed=0xC0FFEE;static unsigned rnd(unsigned n){seed=seed*1664525u+1013904223u;return (unsigned)(((uint64_t)seed*n)>>32);}
#define BIG 3000
static u32 streamPatterns[TILES*8],panPatterns[PAN_TILES*8],legacyPatterns[40*8],bigPatterns[BIG*8];
static u16 frontCells[W*H],frontIds[W*H],backCells[W*H],backIds[W*H];
static u16 streamCells[W*H],panCells[64*32],meta[4]={1,2,3,4},rowOffsets[4];
static const RetroSceneryBand twoBands[]={{64,0,15},{128,15,13}},oneBand[]={{96,0,28}};
static TileSet streamTiles={COMPRESSION_NONE,TILES,streamPatterns},panTiles={COMPRESSION_NONE,PAN_TILES,panPatterns},legacyTiles={COMPRESSION_NONE,40,legacyPatterns};
static TileSet bigTiles={COMPRESSION_NONE,BIG,bigPatterns};
static TileMap streamMap={COMPRESSION_NONE,W,H,streamCells},panMap={COMPRESSION_NONE,64,32,panCells},frontMap={COMPRESSION_NONE,W,H,frontCells},backMap={COMPRESSION_NONE,W,H,backCells};
static const RetroSceneryPanorama bandsPanorama={&panTiles,&panMap,twoBands,2,0},verticalPanorama={&panTiles,&panMap,oneBand,1,128};
static const RetroScenerySgdkRoom hallScenery={&streamTiles,&streamMap,&bandsPanorama,0,BUDGET,0,1530,47,0,0,0,0,0,0};
static const RetroScenerySgdkRoom towerScenery={&streamTiles,&streamMap,&verticalPanorama,0,BUDGET,0,1700,50,0,0,0,0,0,0};
static const RetroScenerySgdkRoom plainScenery={&bigTiles,&frontMap,0,0,BUDGET,0,2048,56,frontIds,&backMap,backIds,0,0,0}; /* a configuração padrão dos jogos: fila de 64 */
static MapDefinition legacyMap={64,64,4,0,1,1,meta,meta,meta,rowOffsets};
static const RetroWorldSpawn entry[]={{1,400,300,1}};
static const RetroWorldRoom rooms[]={{1,W*8,H*8,entry,1,0,0,0,0},{2,W*8,H*8,entry,1,0,0,0,0},{3,W*8,H*8,entry,1,0,0,0,0},{4,512,448,entry,1,0,0,0,0}};
static const RetroWorldDefinition definition={rooms,4,1,1};
static const RetroWorldSgdkRoom bindings[]={
 {1,0,0,0,0,{{0,0},{0,0},{0,0},{0,0}},&retroScenerySgdkRenderer,&hallScenery},
 {2,0,0,0,0,{{0,0},{0,0},{0,0},{0,0}},&retroScenerySgdkRenderer,&towerScenery},
 {3,0,0,0,0,{{0,0},{0,0},{0,0},{0,0}},&retroScenerySgdkRenderer,&plainScenery},
 {4,&legacyTiles,&legacyMap,0,0,{{0,0},{0,0},{0,0},{0,0}},0,0}};
static RetroWorld world;static RetroWorldSgdk bridge;
static const u16 *expectCells=streamCells;static u16 capCells[W*H];
/* Tela: para cada faixa de 8 linhas e cada coluna de 8 pixels, o que os planos mostram. */
static u16 planeCell(u16 base,int px,int py){return vram[(base>>1)+((py>>3)&31)*64+((px>>3)&63)];}
/* Célula de um plano de mapa com padrão pelo vetor de números: vazia aponta para o tile 0. */
static void mapCell(const char *label,unsigned frame,const char *plane,u16 got,u16 want,u16 pattern,u16 first){
 if(pattern==RETRO_SCENERY_EMPTY?got==(want&0xF800):((got&0xF800)==(want&0xF800)&&(got&0x7FF)>=first&&(got&0x7FF)<TILE_USER_INDEX+BUDGET&&vram[((got&0x7FF)*32)>>1]==(u16)(pattern+1)))return;
 printf("%s quadro %u: plano %s célula %04x (VRAM %u), queria padrão %u attr %04x\n",label,frame,plane,got,vram[((got&0x7FF)*32)>>1]-1,pattern,want&0xF800);exit(1);
}
static void screen(const RetroScenerySgdkRoom *room,const char *label,unsigned frame){
 int row,sx,camX=bridge.cameraX,camY=bridge.cameraY;const RetroSceneryPanorama *p=room->panorama;
 u16 first=TILE_USER_INDEX,panoramaTiles=p?p->tiles->numTile:0;
 for(row=0;row<28;row++)for(sx=0;sx<320;sx+=sx==312?7:8){
  int hA=hmode==HSCROLL_TILE?tileScroll[BG_A][row]:hscroll[BG_A],px=sx-hA,py=row*8+vscroll[BG_A];
  u16 got=planeCell(PLANE_A,px,py),want=expectCells[(py>>3)*W+(px>>3)];
  assert(px>=0&&px<W*8&&py>=0&&py<H*8);
  if(room->patterns){
   /* Dois planos que andam juntos com o mapa. */
   unsigned at=(unsigned)((py>>3)*W+(px>>3));
   if(px!=camX+sx||py!=camY+row*8||-hscroll[BG_B]!=camX||vscroll[BG_B]!=camY){printf("%s quadro %u: scroll A %d/%d B %d/%d câmera (%d,%d)\n",label,frame,hA,vscroll[BG_A],hscroll[BG_B],vscroll[BG_B],camX,camY);exit(1);}
   mapCell(label,frame,"A",got,room->cells->tilemap[at],room->patterns[at],first);
   mapCell(label,frame,"B",planeCell(PLANE_B,px,py),room->back->tilemap[at],room->backPatterns[at],first);
   continue;
  }
  /* O plano A mostra o mapa na posição da câmera... */
  if(px!=camX+sx||py!=camY+row*8||(got&0xF800)!=(want&0xF800)||(got&0x7FF)<first+panoramaTiles||(got&0x7FF)>=first+BUDGET||
   vram[((got&0x7FF)*32)>>1]!=(u16)((want&0x7FF)+1)){
   printf("%s quadro %u: plano A em (%d,%d) câmera (%d,%d): célula %04x (padrão na VRAM %u), queria padrão %u attr %04x; scroll A %d/%d px %d py %d\n",label,frame,sx,row,camX,camY,got,vram[((got&0x7FF)*32)>>1]-1,want&0x7FF,want&0xF800,hA,vscroll[BG_A],px,py);
   {int ax,ay;for(ay=(py>>3)&31;ay<H;ay+=32)for(ax=(px>>3)&63;ax<W;ax+=64)printf("  mapa (%d,%d): padrão %u attr %04x\n",ax,ay,streamCells[ay*W+ax]&0x7FF,streamCells[ay*W+ax]&0xF800);
    for(ay=0;ay<H;ay++)for(ax=0;ax<W;ax++)if((streamCells[ay*W+ax]&0xF800)==(got&0xF800)&&(streamCells[ay*W+ax]&0x7FF)==(u16)(vram[((got&0x7FF)*32)>>1]-1))printf("  igual ao plano: mapa (%d,%d)\n",ax,ay);}exit(1);
  }
  if(p){
   /* ...e o plano B mostra o panorama com a velocidade da faixa: cam * fator, em 8.8. */
   int band=0,hB=hmode==HSCROLL_TILE?tileScroll[BG_B][row]:hscroll[BG_B],vB=vscroll[BG_B],bx,by;u16 cell,expected;
   while(band+1<p->bandCount&&row>=p->bands[band+1].firstRow)band++;
   if(-hB!=(camX*p->bands[band].factorX)>>8||vB!=(camY*p->factorY)>>8){printf("%s quadro %u: faixa %d com scroll %d/%d para câmera (%d,%d)\n",label,frame,band,-hB,vB,camX,camY);exit(1);}
   bx=sx-hB;by=row*8+vB;cell=planeCell(PLANE_B,bx,by);expected=panCells[((by>>3)&31)*64+((bx>>3)&63)];
   if(cell!=(u16)((expected&0xF800)|((expected&0x7FF)+first))||vram[((cell&0x7FF)*32)>>1]!=(u16)(0x4000+(expected&0x7FF))){printf("%s quadro %u: panorama errado em (%d,%d)\n",label,frame,sx,row);exit(1);}
  }
 }
}
static void others(void){
 u16 tile;
 for(tile=0;tile<2048;tile++)if(tile<TILE_USER_INDEX||tile>=SENTINEL)assert(writer[tile]!=1||!"a sala escreveu fora da sua faixa de VRAM");
 assert(vram[(SENTINEL*32)>>1]==0x5E57&&vram[(TILE_SPRITE_INDEX*32)>>1]==0x5B17&&vram[(TILE_FONT_INDEX*32)>>1]==0xF047);
}
static void enter(u16 room){u8 status=retroWorldEnter(&world,room,1);if(status!=RETRO_WORLD_OK||bridge.lastError)printf("sala %u: mundo %u, ponte %u\n",room,status,bridge.lastError);assert(status==RETRO_WORLD_OK);assert(bridge.lastError==RETRO_WORLD_SGDK_OK);assert(display);}
int main(void){
 unsigned i,frame,held=0,jumps=0,changes=0;int x,y,tx,ty;RetroScenerySgdkStats stats;
 for(i=0;i<TILES*8;i++)streamPatterns[i]=((u32)(i/8+1)<<16)|(i/8+1);       /* cada palavra do padrão = id+1 (vale em qualquer ordem de bytes) */
 for(i=0;i<PAN_TILES*8;i++)panPatterns[i]=((u32)(0x4000+i/8)<<16)|(0x4000+i/8);
 for(i=0;i<W*H;i++){unsigned cx=i%W,cy=i/W,zone=(cx/40+cy/24*5)%(TILES/40);streamCells[i]=(u16)((rnd(2)<<15)|(rnd(4)<<13)|(rnd(4)<<11)|(zone*40+rnd(40)));}
 for(i=0;i<64*32;i++)panCells[i]=(u16)((rnd(4)<<13)|rnd(PAN_TILES));
 for(i=0;i<BIG*8;i++)bigPatterns[i]=((u32)(i/8+1)<<16)|(i/8+1);
 for(i=0;i<W*H;i++){unsigned cx=i%W,cy=i/W,zone=(cx/32+cy/32*7)%(BIG/20);
  /* Os 11 bits de padrão da célula são lixo: valem os do vetor (acima de 2047 também). */
  frontCells[i]=(u16)((rnd(2)<<15)|(rnd(4)<<13)|(rnd(4)<<11)|rnd(2048));frontIds[i]=rnd(4)?RETRO_SCENERY_EMPTY:(u16)(zone*20+rnd(20));
  backCells[i]=(u16)((rnd(2)<<15)|(rnd(4)<<13)|(rnd(4)<<11)|rnd(2048));backIds[i]=rnd(8)?(u16)((zone*20+rnd(20)+1500)%BIG):RETRO_SCENERY_EMPTY;}
 /* Outros consumidores de VRAM: tile logo depois da faixa da sala, sprites e fonte. */
 for(i=SENTINEL;i<2048;i++)writer[i]=9;
 vram[(SENTINEL*32)>>1]=0x5E57;vram[(TILE_SPRITE_INDEX*32)>>1]=0x5B17;vram[(TILE_FONT_INDEX*32)>>1]=0xF047;
 assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,4,0,0,0)==RETRO_WORLD_OK);if(bridge.lastError||hmode!=HSCROLL_TILE||!display){printf("início: erro %u modo %u display %u câmera %d,%d\n",bridge.lastError,hmode,display,bridge.cameraX,bridge.cameraY);return 1;}
 x=bridge.cameraX;y=bridge.cameraY;assert(x==400-160&&y==300-112);
 screen(&hallScenery,"início",0);others();
 tx=x;ty=y;
 for(frame=1;frame<=9000;frame++){
  const RetroScenerySgdkRoom *room=world.room->id==1?&hallScenery:world.room->id==2?&towerScenery:world.room->id==3?&plainScenery:0;
  int maxX=world.room->width-320,maxY=world.room->height-224,wantX,wantY,speed=1+(int)(frame/900)%14,dx,dy;unsigned roll=rnd(700);u8 status;
  if(roll==0){static const u16 order[]={2,3,4,1};u16 next=order[world.room->id-1];enter(next);changes++;x=bridge.cameraX;y=bridge.cameraY;tx=x;ty=y;
   assert(hmode==(next==1?HSCROLL_TILE:HSCROLL_PLANE));
   if(next!=4)screen(next==1?&hallScenery:next==2?&towerScenery:&plainScenery,"troca de sala",frame);
   else assert(vram[PLANE_B>>1]==0x4242&&vram[(TILE_USER_INDEX*32)>>1]==(u16)(legacyPatterns[0]>>16));
   others();continue;}
  if(roll<10){tx=(int)rnd((unsigned)maxX+1);ty=(int)rnd((unsigned)maxY+1);}
  else if(roll<16){tx=x+(int)rnd(5)-2;ty=y+(int)rnd(5)-2;}
  dx=tx-x;dy=ty-y;if(dx>speed)dx=speed;if(dx<-speed)dx=-speed;if(dy>speed)dy=speed;if(dy<-speed)dy=-speed;
  wantX=x+dx;wantY=y+dy;
  if(roll==20){wantX=(int)rnd((unsigned)maxX+1);wantY=(int)rnd((unsigned)maxY+1);tx=wantX;ty=wantY;jumps++;} /* salto de câmera */
  if(wantX<0)wantX=0;if(wantX>maxX)wantX=maxX;if(wantY<0)wantY=0;if(wantY>maxY)wantY=maxY;
  assert(!queueSize);
  status=retroWorldSgdkScroll(&bridge,(s16)wantX,(s16)wantY);assert(status==RETRO_WORLD_SGDK_OK&&display);
  if(room&&roll!=20){
   /* O que a sala enfileirou neste quadro cabe no orçamento dela (mais as duas tabelas de scroll das faixas). */
   unsigned tables=room->panorama&&room->panorama->bandCount>1?2:0;
   assert(queueBytes<=room->dmaBytes+tables*56&&queueSize<=room->dmaEntries+tables);
   assert((bridge.cameraX>=x&&bridge.cameraX<=wantX)||(bridge.cameraX<=x&&bridge.cameraX>=wantX));assert((bridge.cameraY>=y&&bridge.cameraY<=wantY)||(bridge.cameraY<=y&&bridge.cameraY>=wantY));
   if(bridge.cameraX!=wantX||bridge.cameraY!=wantY)held++;
  }
  /* Outros produtores de DMA do jogo (sprites) entram depois da sala, no mesmo quadro. */
  if(queueSize<queueCapacity){static u16 sprite[16];DMA_queueDma(DMA_VRAM,sprite,0xF800,16,2);}
  SYS_doVBlankProcess();
  x=bridge.cameraX;y=bridge.cameraY;
  if(room)screen(room,"quadro",frame);else assert(legacyX==x&&legacyY==y);
  others();
 }
 retroScenerySgdkStats(&bridge,&stats);
 printf("9000 quadros em 4 salas: %u trocas de sala, %u saltos de câmera, pico de %u bytes e %u entradas de DMA por quadro, câmera segurada pelo orçamento em %u quadros\n",changes,jumps,peakBytes,peakEntries,held);
 fflush(stdout);assert(changes>=6&&jumps>=5); /* a câmera segurada pelo orçamento é exercitada em smoke-runtime-scenery */
 /* Faixa de VRAM menor do que a sala precisa: recusada antes de aparecer, sala atual intacta. */
 {static RetroScenerySgdkRoom tight;static RetroWorldSgdkRoom table[4];u16 before=world.room->id;
  assert(retroWorldSgdkFree(&bridge)==RETRO_WORLD_OK);assert(!allocations&&!mapsLive&&hmode==HSCROLL_PLANE);
  tight=hallScenery;tight.minimumSlots=BUDGET;memcpy(table,bindings,sizeof table);table[1].rendererData=&tight;
  assert(retroWorldSgdkInit(&bridge,&world,&definition,table,4,0,0,0)==RETRO_WORLD_OK);
  assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_VRAM&&world.room->id==1);screen(&hallScenery,"depois da recusa",0);(void)before;
  /* Orçamento de DMA menor do que uma linha, fila curta, faixa além dos sprites, padrões comprimidos. */
  tight=hallScenery;tight.dmaBytes=1000;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_QUEUE);
  tight=hallScenery;queueCapacity=50;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_VDP);queueCapacity=64;
  tight=hallScenery;tight.tileBudget=1300;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_VRAM);
  tight=hallScenery;tight.firstTile=8;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_VRAM);
  {static TileSet packed;packed=streamTiles;packed.compression=1;tight=hallScenery;tight.tiles=&packed;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);}
  {static RetroSceneryPanorama wrong;static const RetroSceneryBand gap[]={{64,0,10},{128,12,16}};wrong=bandsPanorama;wrong.bands=gap;tight=hallScenery;tight.panorama=&wrong;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
   wrong=bandsPanorama;wrong.factorY=64;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);}
  /* Segundo plano junto com panorama (três planos), números sem o plano e plano de outro tamanho. */
  {static TileMap narrow;tight=hallScenery;tight.back=&backMap;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
   tight=plainScenery;tight.back=0;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
   narrow=backMap;narrow.w=W-1;tight=plainScenery;tight.back=&narrow;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
   tight=plainScenery;tight.patterns=0;tight.backPatterns=0;assert(retroWorldEnter(&world,2,1)==RETRO_WORLD_LOAD_FAILED&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);}
  assert(world.room->id==1&&allocations==2);screen(&hallScenery,"depois das recusas",0);others();
  /* Faixa que comporta o começo da sala mas não o resto (o exportador calcula minimumSlots para isto
   * não acontecer; aqui ele é zerado de propósito): a câmera para onde os tiles acabam, a tela continua
   * certa para a posição devolvida, e voltar funciona. */
  {static TileMap capMap={COMPRESSION_NONE,W,H,capCells};static RetroScenerySgdkRoom cap;int step,stopped=-1;u8 status=0;
   for(i=0;i<W*H;i++)capCells[i]=(u16)(i%W<80?0:1+(i%W*31+i/W)%800);
   cap=plainScenery;cap.tiles=&streamTiles;cap.patterns=0;cap.back=0;cap.backPatterns=0;cap.cells=&capMap;cap.tileBudget=60;cap.minimumSlots=0;table[1].rendererData=&cap;
   enter(2);expectCells=capCells;screen(&cap,"faixa curta, início",0);
   for(step=0;step<200;step++){
    s16 want=(s16)(bridge.cameraX+6);assert(!queueSize);
    status=retroWorldSgdkScroll(&bridge,want,bridge.cameraY);
    assert(status==RETRO_WORLD_SGDK_OK||status==RETRO_WORLD_SGDK_VRAM);assert(bridge.cameraX<=want);
    SYS_doVBlankProcess();screen(&cap,"faixa curta",(unsigned)step);others();
    if(status==RETRO_WORLD_SGDK_VRAM){if(stopped<0)stopped=bridge.cameraX;assert(bridge.cameraX==stopped||bridge.cameraX==stopped+0);}
   }
   assert(stopped>0&&status==RETRO_WORLD_SGDK_VRAM&&bridge.cameraX<80*8);printf("faixa de 60 tiles: a câmera parou em x=%d, com a tela certa, quando os tiles acabaram\n",stopped);
   for(step=0;step<40;step++){assert(retroWorldSgdkScroll(&bridge,(s16)(bridge.cameraX-6),bridge.cameraY)==RETRO_WORLD_SGDK_OK);SYS_doVBlankProcess();screen(&cap,"faixa curta, volta",(unsigned)step);}
   /* Salto para dentro da região que não cabe: redesenho incompleto, erro em lastError, nada fora da faixa. */
   status=retroWorldSgdkScroll(&bridge,1200,bridge.cameraY);assert(status==RETRO_WORLD_SGDK_VRAM&&bridge.lastError==RETRO_WORLD_SGDK_VRAM&&display);others();
   /* Sair dali para uma sala que cabe recupera tudo. */
   expectCells=streamCells;assert(retroWorldEnter(&world,1,1)==RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_OK);screen(&hallScenery,"depois da faixa curta",0);others();
  }
  assert(retroWorldSgdkFree(&bridge)==RETRO_WORLD_OK&&!allocations&&!mapsLive);
 }
 printf("faixa de VRAM, orçamento de DMA, fila, compressão e faixas inválidas recusados antes de a sala aparecer; memória devolvida\n");
 return 0;
}
`)
 const build=spawnSync('gcc',['-std=c99','-O1','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-fsanitize=address,undefined','-fno-sanitize-recover=all','-I',temporary,'-I',path.join(lib,'core'),'-I',path.join(lib,'world'),'-I',path.join(lib,'scenery'),fixture,
  path.join(lib,'world/retro_world.c'),path.join(lib,'world/retro_world_sgdk.c'),path.join(lib,'scenery/retro_scenery.c'),path.join(lib,'scenery/retro_scenery_sgdk.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(build.status,0,build.stderr)
 const run=spawnSync(binary,{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr)
 process.stdout.write(run.stdout)
 console.log('Scenery on the world bridge: both planes match map and panorama on every frame, band speeds equal the configured factors, room changes between streamed and legacy rooms, VRAM of other consumers untouched.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
