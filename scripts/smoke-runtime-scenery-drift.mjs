// Faixas de correnteza do cenário em streaming (runtime scenery/scenery-sgdk versão 3):
// - sem faixas, a versão 3 envia exatamente o que a versão 2 enviava (mesmas chamadas, mesma VRAM);
// - com margem, nenhuma célula que a tela possa mostrar (com o deslocamento máximo) fica sem desenho,
//   com a câmera a até 16 px por quadro nos dois sentidos, dentro do orçamento;
// - tabela de scroll por linha: fora das faixas = -câmera, nas faixas = -câmera + deslocamento,
//   seguindo a linha do MUNDO com câmera Y que não é múltipla de 8;
// - mesmos pixels por segundo em PAL e NTSC, volta no período sem salto maior que 1 px;
// - adaptador SGDK com a ponte do mundo e um VDP de mentira (scroll por linha, fila de DMA): o que a
//   tela mostra em cada linha dos dois planos, animação com a câmera parada (tick), orçamento por
//   quadro, redesenho mantendo a fase e recusas de configurações que não cabem.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const lib = path.join(repository, 'assets/toolkit/lib/runtime')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-scenery-drift-'))
const flags = ['-std=c99', '-O1', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation', '-fsanitize=address,undefined', '-fno-sanitize-recover=all']
function build(name, sources, includes) {
  const binary = path.join(temporary, name)
  const result = spawnSync('gcc', [...flags, ...includes.flatMap(dir => ['-I', dir]), ...sources, '-o', binary], {encoding: 'utf8'})
  assert.equal(result.status, 0, result.stderr)
  return binary
}
function run(binary, args = []) {
  const result = spawnSync(binary, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}

try {
  // ---- 1. Versão 2 e versão 3 sem margem: mesmas transferências -------------------------------
  const old = path.join(temporary, 'v2')
  fs.mkdirSync(old)
  // A versão 2 é a publicada na release 0.13.0, guardada em scripts/fixtures/scenery-v2 (o CI
  // faz checkout raso, sem as tags).
  for (const file of ['retro_scenery.c', 'retro_scenery.h'])
    fs.copyFileSync(path.join(repository, 'scripts/fixtures/scenery-v2', file), path.join(old, file))
  assert.match(fs.readFileSync(path.join(old, 'retro_scenery.h'), 'utf8'), /RETRO_RUNTIME_SCENERY_VERSION 2/)
  const trace = path.join(temporary, 'trace.c')
  fs.writeFileSync(trace, String.raw`#include <stdio.h>
#include <stdlib.h>
#include "retro_scenery.h"
/* Mesmo roteiro nas duas versões: cada chamada do sink entra no registro (hash FNV). */
#define W 300
#define H 80
#define TILES 4000
static uint16_t cells[W*H],ids[W*H],back[W*H],backIds[W*H],buffer[4096];static unsigned used;
static uint32_t hash=2166136261u;static void mix(uint32_t v){hash=(hash^v)*16777619u;}
static uint16_t *sinkCells(void *c,uint8_t p,uint16_t x,uint16_t y,uint16_t n,uint8_t v){(void)c;mix(p);mix(x);mix(y);mix(n);mix(v);used+=n;if(used>4096)used=n;return buffer+used-n;}
static uint8_t sinkPattern(void *c,uint16_t t,uint16_t v){(void)c;mix(0xAA);mix(t);mix(v);return 1;}
static uint32_t seed=7;static unsigned rnd(unsigned n){seed=seed*1664525u+1013904223u;return (unsigned)(((unsigned long long)seed*n)>>32);}
int main(void){
 static uint16_t slotOf[TILES],uses[1200],freeSlots[1200];RetroSceneryStream s;RetroSceneryLayer layer={W,H,TILES,cells,ids,back,backIds};
 RetroScenerySink sink={0,sinkCells,sinkPattern};RetroSceneryBudget budget={1800,56};unsigned i,f;int x=600,y=100;
 for(i=0;i<W*H;i++){cells[i]=(uint16_t)(rnd(65536)&0xF800);ids[i]=rnd(5)?(uint16_t)((i%W/20*37+rnd(30))%TILES):0xFFFF;back[i]=(uint16_t)(rnd(65536)&0xF800);backIds[i]=(uint16_t)((i%W/16*41+rnd(25)+2000)%TILES);}
 if(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,16,1200,64,32,320,224))return 1;
 for(f=0;f<5000;f++){
  RetroSceneryResult r;unsigned roll=rnd(400);
  if(roll==0){x=(int)rnd(W*8);y=(int)rnd(H*8);}else{x+=(int)rnd(33)-16;y+=(int)rnd(17)-8;}
  if(x<0)x=0;if(y<0)y=0;if(x>W*8-320)x=W*8-320;if(y>H*8-224)y=H*8-224;
  r=retroSceneryStreamAdvance(&s,(int16_t)x,(int16_t)y,&budget,&sink);
  mix(r.x);mix((uint32_t)r.y);mix(r.bytes);mix(r.entries);mix(r.status);mix(r.complete);x=r.x;y=r.y;
 }
 printf("%08x %u\n",hash,s.peak);return 0;
}
`)
  const oldTrace = run(build('trace-v2', [trace, path.join(old, 'retro_scenery.c')], [old, path.join(lib, 'core')]))
  const newTrace = run(build('trace-v3', [trace, path.join(lib, 'scenery/retro_scenery.c')], [path.join(lib, 'scenery'), path.join(lib, 'core')]))
  assert.equal(newTrace, oldTrace, 'sem margem, a versão 3 faz exatamente as mesmas transferências da versão 2')
  console.log('versão 3 sem faixas = versão 2: ' + newTrace.trim())

  // ---- 2. Margem, tabela de linhas e tempo (código portátil) -----------------------------------
  const portable = path.join(temporary, 'portable.c')
  fs.writeFileSync(portable, String.raw`#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "retro_scenery.h"
#define W 260
#define H 60
#define TILES 3000
#define PERIOD 40
#define BAND0 22
#define BAND1 40
static uint16_t cells[W*H],ids[W*H],back[W*H],backIds[W*H];
/* Planos de 64x32 células: guardam o padrão que a célula mostra (pelo slot carregado). */
static uint16_t plane[2][32][64],slotPattern[2048];static uint8_t written[2][32][64];
static unsigned bytes;
static int jobs;
static uint16_t store[256][256];static struct{int p,x,y,n,v;}job[256];
static uint16_t *sinkCells(void *c,uint8_t p,uint16_t x,uint16_t y,uint16_t n,uint8_t v){(void)c;assert(jobs<256&&n<=256);job[jobs].p=p;job[jobs].x=x;job[jobs].y=y;job[jobs].n=n;job[jobs].v=v;bytes+=n*2u;return store[jobs++];}
static uint8_t sinkPattern(void *c,uint16_t t,uint16_t v){(void)c;slotPattern[v]=t;bytes+=32;return 1;}
/* "VBlank": aplica as células enfileiradas. */
static void flush(void){int j,k;for(j=0;j<jobs;j++)for(k=0;k<job[j].n;k++){int x=job[j].v?job[j].x:(job[j].x+k)&63,y=job[j].v?(job[j].y+k)&31:job[j].y;plane[job[j].p][y][x]=store[j][k];written[job[j].p][y][x]=1;}jobs=0;}
static uint32_t seed=99;static unsigned rnd(unsigned n){seed=seed*1664525u+1013904223u;return (unsigned)(((unsigned long long)seed*n)>>32);}
/* O que o plano mostra na célula de mundo (cx,cy) confere com o mapa? */
static void same(int p,int cx,int cy,int frame){
 uint16_t got=plane[p][cy&31][cx&63],want=p?backIds[cy*W+cx]:ids[cy*W+cx],attr=p?back[cy*W+cx]:cells[cy*W+cx];
 if(!written[p][cy&31][cx&63]){printf("quadro %d: plano %d célula (%d,%d) nunca desenhada\n",frame,p,cx,cy);exit(1);}
 if(want==0xFFFF){if(got!=(attr&0xF800)){printf("quadro %d: vazia errada\n",frame);exit(1);}return;}
 if((got&0xF800)!=(attr&0xF800)||slotPattern[got&0x7FF]!=want){printf("quadro %d: plano %d célula (%d,%d) mostra %u, queria %u\n",frame,p,cx,cy,slotPattern[got&0x7FF],want);exit(1);}
}
int main(void){
 static uint16_t slotOf[TILES],uses[1400],freeSlots[1400];RetroSceneryStream s;RetroSceneryLayer layer={W,H,TILES,cells,ids,back,backIds};
 RetroScenerySink sink={0,sinkCells,sinkPattern};RetroSceneryBudget budget;unsigned i;int f,x=900,y=97,maxX=W*8-320,maxY=H*8-224,worst=0;uint16_t ww,wh;
 for(i=0;i<W*H;i++){cells[i]=(uint16_t)(rnd(65536)&0xF800);ids[i]=rnd(4)?(uint16_t)((i%W/16*29+rnd(24))%TILES):0xFFFF;back[i]=(uint16_t)(rnd(65536)&0xF800);backIds[i]=(uint16_t)((i%W/16*31+rnd(20)+1500)%TILES);}
 assert(!retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,16,1400,64,32,320,224));
 /* Margem: período 40 pede 5 colunas; a tela (41) com 2x10 ainda deixa 3 no plano de 64; 11 não cabe. */
 assert(retroSceneryDriftMargin(40)==5&&retroSceneryDriftMargin(41)==5&&retroSceneryDriftMargin(42)==6&&retroSceneryDriftMargin(1)==0&&retroSceneryDriftMargin(8)==1&&retroSceneryDriftMargin(9)==1&&retroSceneryDriftMargin(10)==2);
 assert(retroSceneryStreamSetMargin(&s,10,22,40)==RETRO_SCENERY_INVALID);
 assert(!retroSceneryStreamSetMargin(&s,9,22,40));assert(retroSceneryStreamSetMargin(&s,5,22,22)==RETRO_SCENERY_INVALID&&retroSceneryStreamSetMargin(&s,5,50,61)==RETRO_SCENERY_INVALID);
 assert(!retroSceneryStreamSetMargin(&s,retroSceneryDriftMargin(PERIOD),BAND0,BAND1));retroSceneryStreamWindow(&s,&ww,&wh);assert(ww==41+2+1+1);
 budget=retroSceneryStreamMinimumBudget(&s);assert(budget.bytes==ww*34u);budget.bytes=(uint16_t)(budget.bytes*2);budget.entries=(uint16_t)(budget.entries*2);
 for(f=0;f<8000;f++){
  RetroSceneryResult r;int cx,cy,left,right,top,bottom;unsigned roll=rnd(500);
  if(roll==0){x=(int)rnd((unsigned)maxX+1);y=(int)rnd((unsigned)maxY+1);}
  else{int speed=1+f/500%16;x+=(f/700)%2?speed:-speed;y+=(int)rnd(2*(unsigned)speed+1)-speed;}
  if(x<0)x=0;if(y<0)y=0;if(x>maxX)x=maxX;if(y>maxY)y=maxY;
  bytes=0;
  r=retroSceneryStreamAdvance(&s,(int16_t)x,(int16_t)y,&budget,&sink);assert(r.status==RETRO_SCENERY_OK);assert(bytes<=budget.bytes);
  flush();x=r.x;y=r.y;
  {static uint16_t want[1400];int px,py,q;memset(want,0,sizeof want);
   for(q=0;q<2;q++)for(py=s.y0;py<s.y1;py++)for(px=s.x0;px<s.x1;px++){uint16_t t=q?backIds[py*W+px]:ids[py*W+px];if(t!=0xFFFF)want[s.slotOf[t]-0]++;}
   for(py=s.leftY0;py<s.leftY1;py++)for(px=s.leftX;px<s.x0;px++){uint16_t t=backIds[py*W+px];if(t!=0xFFFF)want[s.slotOf[t]]++;}
   for(py=s.rightY0;py<s.rightY1;py++)for(px=s.x1;px<s.rightX;px++){uint16_t t=backIds[py*W+px];if(t!=0xFFFF)want[s.slotOf[t]]++;}
   for(i=0;i<1400;i++)if(want[i]!=s.uses[i]&&!s.partialPlanes){printf("quadro %d: slot %u conta %u, devia %u; janela [%d,%d)x[%d,%d) esq %d [%d,%d) dir %d [%d,%d)\n",f,i,s.uses[i],want[i],s.x0,s.x1,s.y0,s.y1,s.leftX,s.leftY0,s.leftY1,s.rightX,s.rightY0,s.rightY1);return 1;}}
  if(!s.built)continue;
  /* O plano A e as linhas do B fora das faixas: o que a tela mostra. As linhas das faixas no B:
   * também o alcance de um deslocamento de até PERIOD-1 px para qualquer lado. */
  top=y>>3;bottom=(y+223)>>3;
  for(cy=top;cy<=bottom;cy++){
   int band=cy>=BAND0&&cy<BAND1;
   left=(x-(band?PERIOD-1:0))>>3;right=(x+319+(band?PERIOD-1:0))>>3;if(left<0)left=0;if(right>=W)right=W-1;
   for(cx=x>>3;cx<=(x+319)>>3;cx++)same(0,cx,cy,f);
   for(cx=left;cx<=right;cx++)same(1,cx,cy,f);
  }
  if(s.peak>worst)worst=s.peak;
 }
 printf("margem de 5 colunas: 8000 quadros a até 16 px/quadro, nenhuma célula ao alcance do deslocamento sem desenho; janela %ux%u, pico de %d slots\n",ww,wh,worst);
 /* Tabela de linhas: câmera Y fora da grade de 8, faixas pelo Y do mundo. */
 {static const RetroSceneryDrift drifts[2]={{176,200,16*256,40},{200,320,-24*256,40}};int16_t shifts[2]={7,-13},a[224],b[224];int camY,camX,line;
  for(camY=0;camY<400;camY+=3)for(camX=0;camX<600;camX+=97){
   retroSceneryLineScroll(a,b,224,(int16_t)camX,(int16_t)camY,drifts,shifts,2);
   for(line=0;line<224;line++){int row=camY+line,want=-camX+(row>=176&&row<200?7:row>=200&&row<320?-13:0);assert(a[line]==-camX);if(b[line]!=want){printf("linha %d câmera %d: %d em vez de %d\n",line,camY,b[line],want);return 1;}}
  }
  retroSceneryLineScroll(0,b,224,10,170,drifts,shifts,2);assert(b[5]==-10&&b[6]==-3&&b[29]==-3&&b[30]==-23);
 }
 /* Tempo: 6 s em PAL e em NTSC andam o mesmo; passo de no máximo 1 px; período fecha. */
 {static const RetroSceneryDrift right={0,8,16*256,40},left={0,8,-24*256,40},slow={0,8,(int16_t)(5.5*256),40};const RetroSceneryDrift *list[3]={&right,&left,&slow};int k;
  for(k=0;k<3;k++){int hz;long total[2];for(hz=50;hz<=60;hz+=10){RetroSceneryDriftPhase phase=0;int frames=hz*6,prev=retroSceneryDriftShift(list[k],0,(uint8_t)hz,100),g;long moved=0;
    for(g=0;g<frames;g++){int now,step;phase=retroSceneryDriftAdvance(list[k],phase,1,(uint8_t)hz);now=retroSceneryDriftShift(list[k],phase,(uint8_t)hz,100);
     step=((now-prev)%40+40)%40;if(list[k]->speed<0)step=(40-step)%40;assert(step<=1);moved+=step;prev=now;
     assert(now>=0&&now<40);}
    total[hz==60]=moved;}
   {long want=(long)(list[k]->speed<0?-list[k]->speed:list[k]->speed)*6/256;assert(labs(total[0]-want)<=1&&labs(total[1]-want)<=1);
    printf("faixa %d: %ld px em 6 s a 50 Hz e %ld px a 60 Hz (esperado %ld)\n",k,total[0],total[1],want);}}
  /* Câmera junto à borda esquerda: o mesmo deslocamento pelo outro lado (negativo). */
  {RetroSceneryDriftPhase phase=retroSceneryDriftAdvance(&right,0,(uint16_t)(30*60),60);int shift=retroSceneryDriftShift(&right,phase,60,1000);
   assert(shift==((30*16)%40));/* 150 quadros a 16 px/s = 40 px: a volta inteira. 30 quadros = 8 px; com a câmera em x=3 vem pelo outro lado. */
   phase=retroSceneryDriftAdvance(&right,0,150,60);assert(retroSceneryDriftShift(&right,phase,60,1000)==0);
   phase=retroSceneryDriftAdvance(&right,0,30,60);assert(retroSceneryDriftShift(&right,phase,60,3)==8-40&&retroSceneryDriftShift(&right,phase,60,8)==8);}
 }
 return 0;
}
`)
  process.stdout.write(run(build('portable', [portable, path.join(lib, 'scenery/retro_scenery.c')], [path.join(lib, 'scenery'), path.join(lib, 'core')])))

  // ---- 3. Adaptador SGDK com a ponte do mundo --------------------------------------------------
  fs.writeFileSync(path.join(temporary, 'genesis.h'), String.raw`#ifndef TEST_GENESIS_H
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
extern u32 vtimer;u16 SYS_isPAL(void);
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
void MAP_scrollToEx(Map*,u32,u32,bool);void MAP_scrollTo(Map*,u32,u32);
u16 VDP_loadTileSet(const TileSet*,u16,TransferMethod);
bool VDP_setTileMapEx(VDPPlane,const TileMap*,u16,u16,u16,u16,u16,u16,u16,TransferMethod);
void PAL_setPalette(u16,const u16*,TransferMethod);bool VDP_getEnable(void);void VDP_setEnable(bool);
#endif
`)
  const adapter = path.join(temporary, 'adapter.c')
  fs.writeFileSync(adapter, String.raw`#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "retro_scenery_sgdk.h"
u16 screenWidth=320,screenHeight=224,planeWidth=64,planeHeight=32,spriteVramSize=128;u32 vtimer;static u8 pal;
u16 SYS_isPAL(void){return pal;}
#define PLANE_A 0xE000u
#define PLANE_B 0xC000u
static u16 vram[0x8000];static s16 lineScroll[2][240],vscroll[2],pendingV[2];static u8 pendingVSet[2],hmode,display=1;
static u16 limit=7200,bufferSize=8192,queueCapacity=64;
typedef struct {const u16 *from;u16 to,len,step;s16 plane,line;} Job;
static Job queue[256];static u16 queueSize,queueBytes;static u16 temp[8192];static u16 tempUsed;static unsigned peakBytes,peakEntries;
u16 DMA_getMaxTransferSize(void){return limit;}u16 DMA_getBufferSize(void){return bufferSize;}u16 DMA_getMaxQueueSize(void){return queueCapacity;}u16 DMA_getQueueSize(void){return queueSize;}bool DMA_getAutoFlush(void){return 1;}
bool DMA_queueDma(u8 location,void *from,u16 to,u16 len,u16 step){assert(location==DMA_VRAM&&from&&len&&queueSize<queueCapacity);queue[queueSize++]=(Job){from,to,len,step,-1,0};queueBytes=(u16)(queueBytes+len*2);assert(!limit||queueBytes<=limit);return TRUE;}
void *DMA_allocateAndQueueDma(u8 location,u16 to,u16 len,u16 step){u16 *b=temp+tempUsed;assert((tempUsed+len)*2<=bufferSize);tempUsed=(u16)(tempUsed+len);return DMA_queueDma(location,b,to,len,step)?b:0;}
u8 VDP_getHorizontalScrollingMode(void){return hmode;}u8 VDP_getVerticalScrollingMode(void){return VSCROLL_PLANE;}
void VDP_setScrollingMode(u16 h,u16 v){assert(v==VSCROLL_PLANE);hmode=(u8)h;}
u16 VDP_getPlaneAddress(VDPPlane p,u16 x,u16 y){assert(x<64&&y<32);return (u16)((p==BG_A?PLANE_A:PLANE_B)+(y*64+x)*2);}
void SYS_doVBlankProcess(void){
 u16 i,k;int p;
 for(i=0;i<queueSize;i++){
  if(queue[i].plane>=0){memcpy(&lineScroll[queue[i].plane][queue[i].line],queue[i].from,queue[i].len*2);continue;}
  for(k=0;k<queue[i].len;k++)vram[(u16)(queue[i].to+k*queue[i].step)>>1]=queue[i].from[k];
 }
 if(queueBytes>peakBytes)peakBytes=queueBytes;if(queueSize>peakEntries)peakEntries=queueSize;
 queueSize=queueBytes=tempUsed=0;vtimer++;
 for(p=0;p<2;p++)if(pendingVSet[p]){vscroll[p]=pendingV[p];pendingVSet[p]=0;}
}
void VDP_clearPlane(VDPPlane p,bool w){u16 i;assert(w);for(i=0;i<64*32;i++)vram[((p==BG_A?PLANE_A:PLANE_B)>>1)+i]=0;}
void VDP_setHorizontalScroll(VDPPlane p,s16 v){int l;for(l=0;l<240;l++)lineScroll[p][l]=v;}
void VDP_setVerticalScroll(VDPPlane p,s16 v){vscroll[p]=v;}
void VDP_setHorizontalScrollVSync(VDPPlane p,s16 v){VDP_setHorizontalScroll(p,v);} /* a ponte zera o scroll ao soltar a sala */
void VDP_setVerticalScrollVSync(VDPPlane p,s16 v){pendingV[p]=v;pendingVSet[p]=1;}
void VDP_setHorizontalScrollTile(VDPPlane p,u16 t,s16 *v,u16 n,TransferMethod m){(void)p;(void)t;(void)v;(void)n;(void)m;assert(!"scroll por tile numa sala de faixas");}
void VDP_setHorizontalScrollLine(VDPPlane p,u16 line,s16 *values,u16 len,TransferMethod method){
 assert(hmode==HSCROLL_LINE&&len&&line+len<=screenHeight);
 if(method==DMA_QUEUE){assert(queueSize<queueCapacity);queue[queueSize++]=(Job){(const u16*)values,0,len,0,(s16)p,(s16)line};queueBytes=(u16)(queueBytes+len*2);assert(!limit||queueBytes<=limit);}
 else{assert(method==DMA);memcpy(&lineScroll[p][line],values,len*2);}
}
u16 VDP_loadTileSet(const TileSet *t,u16 i,TransferMethod m){(void)t;(void)i;(void)m;assert(!"sem panorama");return 0;}
bool VDP_setTileMapEx(VDPPlane p,const TileMap *m,u16 b,u16 a,u16 c,u16 d,u16 e,u16 f,u16 g,TransferMethod t){(void)p;(void)m;(void)b;(void)a;(void)c;(void)d;(void)e;(void)f;(void)g;(void)t;assert(!"sem panorama");return 0;}
void PAL_setPalette(u16 s,const u16 *c,TransferMethod m){(void)s;(void)c;(void)m;}
bool VDP_getEnable(void){return display;}void VDP_setEnable(bool v){display=v;}
static int allocations;void *MEM_alloc(u32 n){allocations++;return malloc(n);}void MEM_free(void *p){allocations--;free(p);}
TileSet *unpackTileSet(const TileSet *s,TileSet *d){(void)s;(void)d;return 0;}
Map *MAP_create(const MapDefinition *d,VDPPlane p,u16 b){(void)d;(void)p;(void)b;return 0;}void MAP_release(Map *m){(void)m;}
void MAP_scrollToEx(Map *m,u32 x,u32 y,bool f){(void)m;(void)x;(void)y;(void)f;}void MAP_scrollTo(Map *m,u32 x,u32 y){(void)m;(void)x;(void)y;}
/* Sala: 4528x544 px como o Ibirapuera, água no BG_B de 176 a 319 em duas faixas. */
#define W 566
#define H 68
#define TILES 2500
#define BUDGET 1200
static u32 patterns[TILES*8];static u16 frontCells[W*H],frontIds[W*H],backCells[W*H],backIds[W*H];
static TileSet tiles={COMPRESSION_NONE,TILES,patterns};static TileMap front={COMPRESSION_NONE,W,H,frontCells},back={COMPRESSION_NONE,W,H,backCells};
static const RetroSceneryDrift water[]={{176,200,16*256,40},{200,320,24*256,40}};
static RetroScenerySgdkRoom lake={&tiles,&front,0,0,BUDGET,0,2048,56,frontIds,&back,backIds,water,2,5};
static const RetroWorldSpawn entry[]={{1,300,300,1}};
static const RetroWorldRoom rooms[]={{1,W*8,H*8,entry,1,0,0,0,0}};
static const RetroWorldDefinition definition={rooms,1,1,1};
static const RetroWorldSgdkRoom bindings[]={{1,0,0,0,0,{{0,0},{0,0},{0,0},{0,0}},&retroScenerySgdkRenderer,&lake}};
static RetroWorld world;static RetroWorldSgdk bridge;
static u32 seed=5;static unsigned rnd(unsigned n){seed=seed*1664525u+1013904223u;return (unsigned)(((unsigned long long)seed*n)>>32);}
static u16 planeCell(u16 base,int px,int py){return vram[(base>>1)+((py>>3)&31)*64+((px>>3)&63)];}
static void cell(const char *what,int frame,u16 got,u16 attr,u16 pattern){
 if(pattern==RETRO_SCENERY_EMPTY?got==(attr&0xF800):((got&0xF800)==(attr&0xF800)&&vram[((got&0x7FF)*32)>>1]==(u16)(pattern+1)))return;
 printf("quadro %d: %s mostra %04x (padrão %u), queria %u\n",frame,what,got,vram[((got&0x7FF)*32)>>1]-1,pattern);exit(1);
}
/* Tela inteira, linha a linha: o plano A segue a câmera; o B também, com o deslocamento da faixa. */
static int shiftOf[2];
static void screen(int frame){
 int line,sx,camX=bridge.cameraX,camY=bridge.cameraY,i;
 assert(hmode==HSCROLL_LINE&&vscroll[BG_A]==camY&&vscroll[BG_B]==camY);
 for(i=0;i<2;i++)shiftOf[i]=-999;
 for(line=0;line<224;line++){
  int row=camY+line,band=row>=176&&row<200?0:row>=200&&row<320?1:-1,shift=lineScroll[BG_B][line]+camX;
  assert(lineScroll[BG_A][line]==-camX);
  if(band<0)assert(shift==0);else{assert(shift>-40&&shift<40);if(shiftOf[band]==-999)shiftOf[band]=shift;assert(shiftOf[band]==shift);}
  for(sx=0;sx<320;sx+=sx==312?7:8){
   int ax=sx+camX,bx=sx-lineScroll[BG_B][line];
   assert(bx>=0&&bx<W*8);
   cell("plano A",frame,planeCell(PLANE_A,ax,row),frontCells[(row>>3)*W+(ax>>3)],frontIds[(row>>3)*W+(ax>>3)]);
   cell("plano B",frame,planeCell(PLANE_B,bx,row),backCells[(row>>3)*W+(bx>>3)],backIds[(row>>3)*W+(bx>>3)]);
  }
 }
}
/* Distância andada (módulo 40) desde o último quadro. */
static int last[2]={-999,-999};static long travelled[2];
static void motion(int maxStep){int i;for(i=0;i<2;i++){if(shiftOf[i]==-999){last[i]=-999;continue;}if(last[i]!=-999){int step=((shiftOf[i]-last[i])%40+40)%40;assert(step<=maxStep);travelled[i]+=step;}last[i]=shiftOf[i];}}
static void host(int x,int y){
 /* Como o jogo: o scroll só quando a câmera muda; o tick em todo quadro, depois dele. */
 assert(!queueSize);
 if(x!=bridge.cameraX||y!=bridge.cameraY)assert(retroWorldSgdkScroll(&bridge,(s16)x,(s16)y)==RETRO_WORLD_SGDK_OK);
 retroScenerySgdkTick(&bridge);
 assert(queueBytes<=lake.dmaBytes+4u*224&&queueSize<=lake.dmaEntries+2u);
 SYS_doVBlankProcess();
}
static void simulate(const char *label,int frames,int hz){
 int f,x=bridge.cameraX,y=bridge.cameraY,maxX=W*8-320,maxY=H*8-224,still=0;
 travelled[0]=travelled[1]=0;last[0]=last[1]=-999;
 for(f=0;f<frames;f++){
  unsigned roll=rnd(300);
  if(roll<120){}                                         /* câmera parada: só o tick anima */
  else{int speed=1+(int)rnd(16);x+=(f/240)%2?speed:-speed;y+=(int)rnd(7)-3;}
  if(x<0)x=0;if(y<0)y=0;if(x>maxX)x=maxX;if(y>maxY)y=maxY;
  if(x==bridge.cameraX&&y==bridge.cameraY)still++;
  host(x,y);x=bridge.cameraX;y=bridge.cameraY;
  screen(f);motion(1);
 }
 printf("%s (%d Hz): %d quadros, %d com a câmera parada; faixas andaram %ld e %ld px\n",label,hz,frames,still,travelled[0],travelled[1]);
}
int main(void){
 unsigned i;
 for(i=0;i<TILES*8;i++)patterns[i]=((u32)(i/8+1)<<16)|(i/8+1);
 for(i=0;i<W*H;i++){unsigned cx=i%W,cy=i/W,zone=(cx/16+cy/16*3)%(TILES/25);
  frontCells[i]=(u16)((rnd(2)<<15)|(rnd(4)<<13)|(rnd(4)<<11));frontIds[i]=rnd(3)?RETRO_SCENERY_EMPTY:(u16)(zone*12+rnd(12));
  backCells[i]=(u16)((rnd(4)<<13)|(rnd(4)<<11));backIds[i]=(u16)((zone*12+rnd(12)+1200)%TILES);}
 {u8 status=retroWorldSgdkInit(&bridge,&world,&definition,bindings,1,0,0,0);if(status!=RETRO_WORLD_OK||bridge.lastError||!display){printf("início: mundo %u ponte %u\n",status,bridge.lastError);return 1;}}
 screen(0);
 /* Câmera parada por 10 s em NTSC: as faixas andam 160 e 240 px, sem chamada de scroll. */
 {int f;travelled[0]=travelled[1]=0;last[0]=last[1]=-999;
  {int y=176-100;assert(retroWorldSgdkScroll(&bridge,bridge.cameraX,(s16)y)==RETRO_WORLD_SGDK_OK);SYS_doVBlankProcess();screen(0);}
  for(f=0;f<600;f++){host(bridge.cameraX,bridge.cameraY);screen(f);motion(1);}
  printf("NTSC, câmera parada 10 s em y=%d: faixas andaram %ld e %ld px (esperado 160 e 240)\n",bridge.cameraY,travelled[0],travelled[1]);
  assert(labs(travelled[0]-160)<=1&&labs(travelled[1]-240)<=1);}
 simulate("NTSC, câmera de até 16 px por quadro",3000,60);
 /* Salto de câmera (redesenho bloqueante): a fase continua de onde estava. */
 {int before[2];screen(0);before[0]=shiftOf[0];before[1]=shiftOf[1];(void)before;
  assert(retroWorldSgdkScroll(&bridge,2000,150)==RETRO_WORLD_SGDK_OK);SYS_doVBlankProcess();screen(0);
  {int band;for(band=0;band<2;band++)if(before[band]!=-999&&shiftOf[band]!=-999){int step=((shiftOf[band]-before[band])%40+40)%40;assert(step<=2);}}
  printf("salto de câmera: redesenho com a fase mantida\n");}
 /* PAL: a sala é preparada de novo (troca de sistema só acontece ao ligar; aqui, reentrar). */
 {pal=1;assert(retroWorldSgdkFree(&bridge)==RETRO_WORLD_OK&&!allocations&&hmode==HSCROLL_PLANE);
  assert(retroWorldSgdkInit(&bridge,&world,&definition,bindings,1,0,0,0)==RETRO_WORLD_OK&&!bridge.lastError);
  assert(retroWorldSgdkScroll(&bridge,bridge.cameraX,90)==RETRO_WORLD_SGDK_OK);SYS_doVBlankProcess();
  {int f;travelled[0]=travelled[1]=0;last[0]=last[1]=-999;for(f=0;f<500;f++){host(bridge.cameraX,bridge.cameraY);screen(f);motion(1);}
   printf("PAL, câmera parada 10 s: faixas andaram %ld e %ld px (esperado 160 e 240)\n",travelled[0],travelled[1]);assert(labs(travelled[0]-160)<=1&&labs(travelled[1]-240)<=1);}
  simulate("PAL, câmera de até 16 px por quadro",2500,50);pal=0;}
 printf("pico por quadro: %u bytes e %u entradas de DMA (mapa %u/%u + tabelas %u)\n",peakBytes,peakEntries,lake.dmaBytes,lake.dmaEntries,4u*224);
 /* Recusas: margem menor que o período pede, faixa invertida, panorama junto, transferência curta. */
 {static RetroScenerySgdkRoom wrong;static RetroWorldSgdkRoom table[1];static const RetroSceneryDrift wide[]={{176,200,256,48}},upside[]={{200,176,256,40}};
  memcpy(table,bindings,sizeof table);table[0].rendererData=&wrong;assert(retroWorldSgdkFree(&bridge)==RETRO_WORLD_OK&&!allocations);
  wrong=lake;wrong.drifts=wide;wrong.driftCount=1;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
  wrong=lake;wrong.drifts=upside;wrong.driftCount=1;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
  wrong=lake;wrong.marginX=11;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
  wrong=lake;wrong.driftCount=0;wrong.drifts=0;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
  wrong=lake;wrong.back=0;wrong.backPatterns=0;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_INVALID);
  wrong=lake;wrong.dmaBytes=6400;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_QUEUE);
  wrong=lake;wrong.minimumSlots=BUDGET+1;assert(retroWorldSgdkInit(&bridge,&world,&definition,table,1,0,0,0)!=RETRO_WORLD_OK&&bridge.lastError==RETRO_WORLD_SGDK_VRAM);
  assert(!allocations);
 }
 printf("recusados: período maior que a margem, faixa invertida, margem que não cabe no plano, margem sem faixas, faixas sem segundo plano, transferência por quadro curta, VRAM\n");
 return 0;
}
`)
  process.stdout.write(run(build('adapter', [adapter, path.join(lib, 'world/retro_world.c'), path.join(lib, 'world/retro_world_sgdk.c'), path.join(lib, 'scenery/retro_scenery.c'), path.join(lib, 'scenery/retro_scenery_sgdk.c')],
    [temporary, path.join(lib, 'core'), path.join(lib, 'world'), path.join(lib, 'scenery')])))
  console.log('Scenery drift bands: v3 without bands = v2, margin window, line tables, PAL/NTSC timing and the SGDK adapter passed.')
} finally { fs.rmSync(temporary, {recursive: true, force: true}) }
