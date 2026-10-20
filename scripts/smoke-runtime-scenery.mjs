// #62: streaming de cenário no host. Um VDP de mentira (padrões por tile de VRAM e células do
// plano) recebe o que o runtime enfileira; a cada quadro, tudo o que a tela mostra precisa ser
// exatamente o mapa, sem estourar o orçamento nem escrever fora da faixa de VRAM.
// #90: salas com mais de 2048 padrões (número do padrão num vetor próprio), células vazias e
// dois planos que dividem a mesma faixa.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-scenery-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,String.raw`#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "retro_scenery.h"
#define FIRST 300
#define GUARD 16
static uint32_t seed=0x51CE7E;
static unsigned rnd(unsigned n){seed=seed*1664525u+1013904223u;return (unsigned)(((uint64_t)seed*n)>>32);}
/* VDP de mentira. */
static int vram[2048];            /* padrão (id do mapa) em cada tile de VRAM; -1 = nunca escrito por nós */
static uint16_t planeData[2][128*128];
static unsigned planeW,planeH,slots;
/* Transferências do quadro: só valem no "VBlank" (commit), como no hardware. */
typedef struct {unsigned plane,x,y,count,vertical;uint16_t data[200];} CellJob;
typedef struct {unsigned tile,to;} PatternJob;
static CellJob cellJobs[64];static PatternJob patternJobs[512];static unsigned cellCount,patternCount,refuseCells,refusePatterns;
static uint16_t *sinkCells(void *context,uint8_t plane,uint16_t x,uint16_t y,uint16_t count,uint8_t vertical){
 CellJob *job;(void)context;
 if(refuseCells)return 0;
 assert(cellCount<64&&count&&count<=200&&x<planeW&&y<planeH&&plane<2);
 assert(vertical?y+count<=planeH:x+count<=planeW); /* uma transferência não dá a volta no plano */
 job=&cellJobs[cellCount++];job->plane=plane;job->x=x;job->y=y;job->count=count;job->vertical=vertical;return job->data;
}
static uint8_t sinkPattern(void *context,uint16_t tile,uint16_t to){
 (void)context;
 if(refusePatterns)return 0;
 assert(patternCount<512);assert(to>=FIRST&&to<FIRST+slots); /* nunca fora da faixa */
 patternJobs[patternCount].tile=tile;patternJobs[patternCount++].to=to;return 1;
}
static void commit(void){
 unsigned i,k;
 for(i=0;i<patternCount;i++)vram[patternJobs[i].to]=(int)patternJobs[i].tile;
 for(i=0;i<cellCount;i++)for(k=0;k<cellJobs[i].count;k++)
  planeData[cellJobs[i].plane][(cellJobs[i].y+(cellJobs[i].vertical?k:0))*planeW+cellJobs[i].x+(cellJobs[i].vertical?0:k)]=cellJobs[i].data[k];
 cellCount=patternCount=0;
}
static const RetroScenerySink sink={0,sinkCells,sinkPattern};
/* O que a tela mostra com a câmera em (x,y) é o mapa? */
static void screenMatches(const RetroSceneryLayer *layer,int x,int y,unsigned viewW,unsigned viewH,const char *label){
 int cx,cy;unsigned p;
 /* Fora do mapa (mapa menor que a tela) o plano fica como o adaptador o limpou. */
 for(p=0;p<(layer->backCells?2u:1u);p++)
 for(cy=y>>3;cy<=(y+(int)viewH-1)>>3&&cy<layer->height;cy++)for(cx=x>>3;cx<=(x+(int)viewW-1)>>3&&cx<layer->width;cx++){
  unsigned index=(unsigned)(cy*layer->width+cx);
  const uint16_t *cells=p?layer->backCells:layer->cells,*ids=p?layer->backPatterns:layer->patterns;
  uint16_t want=cells[index],pattern=ids?ids[index]:(uint16_t)(want&0x7FF),got=planeData[p][((unsigned)cy&(planeH-1))*planeW+((unsigned)cx&(planeW-1))];
  /* Vazia: aponta para o tile 0 (em branco) da VRAM, mantendo os atributos. */
  int ok=pattern==RETRO_SCENERY_EMPTY?got==(want&0xF800):((got&0xF800)==(want&0xF800)&&vram[got&0x7FF]==(int)pattern);
  if(!ok){
   printf("%s: plano %u célula (%d,%d) câmera (%d,%d): quer padrão %u attr %04x, plano %04x → VRAM %d\n",label,p,cx,cy,x,y,pattern,want&0xF800,got,vram[got&0x7FF]);exit(1);
  }
 }
}
typedef struct {unsigned w,h,tiles,planeW,planeH,viewW,viewH,slots,bytes,entries,speed,frames,ids,back;} Case;
static void run(const Case *c,const char *label){
 RetroSceneryLayer layer;RetroSceneryStream stream;RetroSceneryBudget budget,minimum;RetroSceneryResult r;
 uint16_t *cells=malloc(c->w*c->h*2),*ids=malloc(c->w*c->h*2),*backCells=malloc(c->w*c->h*2),*backIds=malloc(c->w*c->h*2),*slotOf=malloc((c->tiles+GUARD)*2),*uses=malloc((c->slots+GUARD)*2),*freeSlots=malloc((c->slots+GUARD)*2),ww,wh;
 unsigned i,p,frame,peakBytes=0,peakEntries=0,totalPatterns=0,totalCells=0,stalls=0;int x=0,y=0,tx,ty,k;
 /* Mapa com regiões: perto, os tiles se repetem (como arte de verdade); longe, mudam. */
 for(p=0;p<2;p++)for(i=0;i<c->w*c->h;i++){
  unsigned cx=i%c->w,cy=i/c->w,zone=(cx/24+cy/16*7+p*3)%((c->tiles+47)/48),pattern=(zone*48+rnd(48))%c->tiles;
  uint16_t attributes=(uint16_t)((rnd(4)<<13)|(rnd(2)<<15)|(rnd(4)<<11));
  /* Com o vetor de números: padrões acima de 2047 e células vazias (céu, buracos da frente). */
  if(c->ids&&rnd(5)==0)pattern=RETRO_SCENERY_EMPTY;
  (p?backCells:cells)[i]=(uint16_t)(attributes|(c->ids?(rnd(2048)&0x7FF):pattern)); /* sem o vetor, os 11 bits são o número */
  (p?backIds:ids)[i]=(uint16_t)pattern;
 }
 layer.width=(uint16_t)c->w;layer.height=(uint16_t)c->h;layer.tileCount=(uint16_t)c->tiles;layer.cells=cells;
 layer.patterns=c->ids?ids:0;layer.backCells=c->back?backCells:0;layer.backPatterns=c->back&&c->ids?backIds:0;
 planeW=c->planeW;planeH=c->planeH;slots=c->slots;
 for(i=0;i<2048;i++)vram[i]=-1;memset(planeData,0xFF,sizeof planeData);
 for(i=0;i<GUARD;i++)slotOf[c->tiles+i]=uses[c->slots+i]=freeSlots[c->slots+i]=0xA5A5;
 assert(retroSceneryStreamInit(&stream,&layer,slotOf,uses,freeSlots,FIRST,(uint16_t)c->slots,(uint16_t)c->planeW,(uint16_t)c->planeH,(uint16_t)c->viewW,(uint16_t)c->viewH)==RETRO_SCENERY_OK);
 minimum=retroSceneryStreamMinimumBudget(&stream);retroSceneryStreamWindow(&stream,&ww,&wh);
 assert(ww<=c->planeW&&wh<=c->planeH);
 budget.bytes=(uint16_t)c->bytes;budget.entries=(uint16_t)c->entries;
 assert(budget.bytes>=minimum.bytes&&budget.entries>=minimum.entries);
 tx=(int)rnd(c->w*8);ty=(int)rnd(c->h*8);
 for(frame=0;frame<c->frames;frame++){
  int maxX=(int)(c->w*8>c->viewW?c->w*8-c->viewW:0),maxY=(int)(c->h*8>c->viewH?c->h*8-c->viewH:0),wantX,wantY,dx,dy;
  unsigned roll=rnd(400);
  if(roll==0){tx=(int)rnd((unsigned)maxX+1);ty=(int)rnd((unsigned)maxY+1);x=tx;y=ty;} /* salto: sala nova, teleporte */
  else if(roll<12){tx=(int)rnd((unsigned)maxX+1);ty=(int)rnd((unsigned)maxY+1);}        /* novo destino */
  else if(roll<20){tx=x+(int)rnd(5)-2;ty=y+(int)rnd(5)-2;}                           /* tremor na fronteira de uma célula */
  dx=tx-x;dy=ty-y;if(dx>(int)c->speed)dx=(int)c->speed;if(dx<-(int)c->speed)dx=-(int)c->speed;if(dy>(int)c->speed)dy=(int)c->speed;if(dy<-(int)c->speed)dy=-(int)c->speed;
  wantX=roll==0?x:x+dx;wantY=roll==0?y:y+dy;
  if(wantX<0)wantX=0;if(wantX>maxX)wantX=maxX;if(wantY<0)wantY=0;if(wantY>maxY)wantY=maxY;
  r=retroSceneryStreamAdvance(&stream,(int16_t)wantX,(int16_t)wantY,&budget,&sink);
  if(r.status!=RETRO_SCENERY_OK){printf("%s: status %u no quadro %u\n",label,r.status,frame);exit(1);}
  if(!stream.built||roll==0){
   /* Construção do zero: display desligado até completar; cada chamada respeita o orçamento. */
   unsigned calls=0;
   for(;;){assert(r.bytes<=budget.bytes&&r.entries<=budget.entries);commit();if(r.complete)break;assert(++calls<400);
    r=retroSceneryStreamAdvance(&stream,(int16_t)wantX,(int16_t)wantY,&budget,&sink);assert(r.status==RETRO_SCENERY_OK);}
   assert(r.x==wantX&&r.y==wantY);
  }else{
   unsigned bytes=0,entries=0;
   for(i=0;i<cellCount;i++){bytes+=cellJobs[i].count*2;entries++;}
   bytes+=patternCount*32;entries+=patternCount;
   assert(bytes==r.bytes&&entries==r.entries&&r.patterns==patternCount);        /* o que foi contado é o que foi enfileirado */
   assert(r.bytes<=budget.bytes&&r.entries<=budget.entries);                    /* orçamento do quadro */
   if(r.bytes>peakBytes)peakBytes=r.bytes;if(r.entries>peakEntries)peakEntries=r.entries;
   totalPatterns+=r.patterns;totalCells+=r.cells;
   /* A câmera devolvida fica entre a anterior e a pedida, em cada eixo. */
   assert((r.x>=x&&r.x<=wantX)||(r.x<=x&&r.x>=wantX));assert((r.y>=y&&r.y<=wantY)||(r.y<=y&&r.y>=wantY));
   if(r.x!=wantX||r.y!=wantY)stalls++;
   commit();
  }
  x=r.x;y=r.y;
  screenMatches(&layer,x,y,c->viewW,c->viewH,label);
  /* Contabilidade: usos = células da janela; livres + usados = faixa; nada vazou das tabelas. */
  {unsigned used=0,sum=0;for(i=0;i<c->slots;i++){if(uses[i])used++;sum+=uses[i];}
   {unsigned drawn=0;int cx,cy;for(p=0;p<(c->back?2u:1u);p++)for(cy=stream.y0;cy<stream.y1;cy++)for(cx=stream.x0;cx<stream.x1;cx++){
     const uint16_t *v=p?layer.backPatterns:layer.patterns,*w=p?layer.backCells:layer.cells;unsigned at=(unsigned)cy*c->w+(unsigned)cx;
     if((v?v[at]:(w[at]&0x7FF))!=RETRO_SCENERY_EMPTY)drawn++;}
    /* Linha em andamento: os planos já enviados contam usos. */
    for(p=0;p<stream.partialPlanes;p++)for(k=stream.partialFrom;k<stream.partialTo;k++){
     const uint16_t *v=p?layer.backPatterns:layer.patterns,*w=p?layer.backCells:layer.cells;
     unsigned at=stream.partialVertical?(unsigned)k*c->w+(unsigned)stream.partialAt:(unsigned)stream.partialAt*c->w+(unsigned)k;
     if((v?v[at]:(w[at]&0x7FF))!=RETRO_SCENERY_EMPTY)drawn++;}
    assert(used+stream.freeCount==c->slots);assert(sum==drawn);}
   assert((unsigned)(stream.x1-stream.x0)<=ww&&(unsigned)(stream.y1-stream.y0)<=wh);
   for(i=0;i<c->tiles;i++)if(slotOf[i]!=0xFFFF){assert(slotOf[i]<c->slots&&uses[slotOf[i]]&&vram[FIRST+slotOf[i]]==(int)i);}
   for(k=0;k<GUARD;k++)assert(slotOf[c->tiles+(unsigned)k]==0xA5A5&&uses[c->slots+(unsigned)k]==0xA5A5&&freeSlots[c->slots+(unsigned)k]==0xA5A5);}
 }
 for(i=0;i<2048;i++)if(i<FIRST||i>=FIRST+c->slots)assert(vram[i]==-1); /* VRAM dos outros intacta */
 printf("%s: %u quadros, pico %u bytes/%u entradas por quadro (orçamento %u/%u), %u padrões e %u células enviados, pico de %u/%u slots, câmera segurada em %u quadros\n",
  label,c->frames,peakBytes,peakEntries,c->bytes,c->entries,totalPatterns,totalCells,stream.peak,c->slots,stalls);
 free(cells);free(ids);free(backCells);free(backIds);free(slotOf);free(uses);free(freeSlots);
}
int main(void){
 /*            w   h  tiles pW  pH  vW  vH  slots bytes entr vel quadros */
 static const Case h40={200,120,1500,64,32,320,224,1300,1600,64,6,6000,0,0};
 static const Case h32={90,70,600,64,32,256,224,900,1400,48,3,4000,0,0};
 static const Case v30={64,64,400,64,32,320,240,1100,1700,64,4,3000,0,0};
 static const Case tight={160,40,1024,64,32,320,224,1440,1530,47,16,5000,0,0};   /* orçamento mínimo, câmera rápida */
 static const Case small={30,20,90,64,32,320,224,90,1600,64,5,800,0,0};          /* mapa menor que a tela */
 static const Case big={256,256,2048,128,64,320,224,1500,3000,128,9,4000,0,0};
 /* #90: fase larga com 6000 padrões (bem acima de 2048) e dois planos dividindo a faixa. */
 static const Case many={566,68,6000,64,32,320,224,1500,1600,64,6,6000,1,0};
 static const Case two={566,68,6000,64,32,320,224,1500,3200,128,6,6000,1,1};
 static const Case twoOld={120,60,1500,64,32,320,224,1400,3200,128,5,3000,0,1}; /* dois planos, números nos 11 bits */
 /* Dois planos no orçamento de um (1530 bytes, 47 transferências: a fila padrão de 64 do jogo):
  * cada linha vai um plano por vez e a câmera espera a linha inteira. */
 static const Case twoTight={566,68,6000,64,32,320,224,1500,1530,47,8,6000,1,1};
 RetroSceneryLayer layer;RetroSceneryStream s;RetroSceneryBudget b={4000,100},none={0,0};RetroSceneryResult r;
 static uint16_t cells[64*64],slotOf[64],uses[64],freeSlots[64];unsigned i;
 run(&h40,"H40");run(&h32,"H32");run(&v30,"V30");run(&tight,"orçamento mínimo");run(&small,"mapa pequeno");run(&big,"plano 128x64");
 run(&many,"6000 padrões");run(&two,"dois planos, 6000 padrões");run(&twoOld,"dois planos, formato antigo");run(&twoTight,"dois planos, orçamento de um");
 /* Configuração inválida. */
 memset(&layer,0,sizeof layer);layer.width=64;layer.height=64;layer.tileCount=64;layer.cells=cells;for(i=0;i<64*64;i++)cells[i]=(uint16_t)((i%64+i/64*7)%64); /* cada coluna tem mais de 20 padrões diferentes */
 assert(retroSceneryStreamInit(0,&layer,slotOf,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_INVALID);
 assert(retroSceneryStreamInit(&s,0,slotOf,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_INVALID);
 assert(retroSceneryStreamInit(&s,&layer,0,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_INVALID);
 assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,2000,64,64,32,320,224)==RETRO_SCENERY_INVALID); /* passaria do tile 2047 */
 assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,16,64,48,32,320,224)==RETRO_SCENERY_INVALID);   /* plano não é potência de 2 */
 {static uint16_t bigSlotOf[3000];RetroSceneryLayer wide=layer;wide.tileCount=3000;
  assert(retroSceneryStreamInit(&s,&wide,bigSlotOf,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_INVALID); /* 3000 padrões em 11 bits */
  wide.patterns=cells;assert(retroSceneryStreamInit(&s,&wide,bigSlotOf,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_OK);
  wide.backCells=cells;assert(retroSceneryStreamInit(&s,&wide,bigSlotOf,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_INVALID); /* o segundo plano também em 11 bits */
  wide.tileCount=RETRO_SCENERY_EMPTY;wide.backPatterns=cells;assert(retroSceneryStreamInit(&s,&wide,bigSlotOf,uses,freeSlots,16,64,64,32,320,224)==RETRO_SCENERY_INVALID);}
 assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,16,64,32,32,320,224)==RETRO_SCENERY_INVALID);   /* tela não cabe no plano */
 assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,16,64,64,32,321,224)==RETRO_SCENERY_INVALID);
 assert(!s.ready&&retroSceneryStreamAdvance(&s,0,0,&b,&sink).status==RETRO_SCENERY_INVALID);
 /* Faixa pequena demais: a janela precisa de 64 padrões diferentes e só há 20 slots. Nada é enviado pela metade. */
 planeW=64;planeH=32;slots=20;
 assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,FIRST,20,64,32,320,224)==RETRO_SCENERY_OK);
 r=retroSceneryStreamAdvance(&s,0,0,&b,&sink);assert(r.status==RETRO_SCENERY_CAPACITY&&!r.complete&&!patternCount&&!cellCount);
 for(i=0;i<64;i++)assert(slotOf[i]==0xFFFF);assert(s.freeCount==20);
 /* Orçamento zero: nada sai, nada quebra; depois continua. */
 slots=64;assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,FIRST,64,64,32,320,224)==RETRO_SCENERY_OK);
 r=retroSceneryStreamAdvance(&s,40,40,&none,&sink);assert(r.status==RETRO_SCENERY_OK&&!r.complete&&!r.bytes&&!cellCount&&!patternCount);
 /* Transferência recusada: o stream se declara inválido até ser reiniciado. */
 refuseCells=1;r=retroSceneryStreamAdvance(&s,40,40,&b,&sink);assert(r.status==RETRO_SCENERY_SINK&&!s.ready);refuseCells=0;
 assert(retroSceneryStreamAdvance(&s,40,40,&b,&sink).status==RETRO_SCENERY_INVALID);
 assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,FIRST,64,64,32,320,224)==RETRO_SCENERY_OK);
 refusePatterns=1;r=retroSceneryStreamAdvance(&s,40,40,&b,&sink);assert(r.status==RETRO_SCENERY_SINK&&!s.ready);refusePatterns=0;cellCount=patternCount=0;
 /* Célula com padrão fora da tabela. */
 cells[0]=64;assert(retroSceneryStreamInit(&s,&layer,slotOf,uses,freeSlots,FIRST,64,64,32,320,224)==RETRO_SCENERY_OK);
 r=retroSceneryStreamAdvance(&s,0,0,&b,&sink);assert(r.status==RETRO_SCENERY_INVALID&&!cellCount&&!patternCount);
 /* Panorama: 8.8, arredondando para baixo; 0 = fixo, 256 = junto com o mapa. */
 assert(retroSceneryPanoramaScroll(1000,0)==0&&retroSceneryPanoramaScroll(1000,256)==1000&&retroSceneryPanoramaScroll(1000,128)==500&&retroSceneryPanoramaScroll(7,64)==1&&retroSceneryPanoramaScroll(3,64)==0&&retroSceneryPanoramaScroll(1728,384)==2592&&retroSceneryPanoramaScroll(0,512)==0);
 printf("configurações inválidas, faixa insuficiente, orçamento zero, transferência recusada e panorama conferidos\n");
 return 0;
}
`)
 const build=spawnSync('gcc',['-std=c99','-O1','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-fsanitize=address,undefined','-fno-sanitize-recover=all','-I'+library+'core','-I'+library+'scenery',fixture,library+'scenery/retro_scenery.c','-o',binary],{encoding:'utf8'})
 assert.equal(build.status,0,build.stderr)
 const run=spawnSync(binary,{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr)
 process.stdout.write(run.stdout)
 console.log('Scenery runtime: streamed window matches the map on every frame, inside the VRAM range and the per-frame budget.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
