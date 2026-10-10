/* #62: cenário de referência do runtime de cenário. Sala larga com mapa por streaming
 * (BG_A) e panorama em duas faixas (BG_B); sala pequena no caminho antigo (BG_B/BG_A).
 * A câmera percorre a sala sozinha; A troca de sala, START volta ao passeio, o direcional
 * move à mão. A janela no alto mostra os contadores e quatro tiles "sentinela" gravados
 * logo depois da faixa de VRAM da sala: se o streaming escrevesse fora dela, eles mudariam. */
#include <genesis.h>
#include "resources.h"
#include "retro_runtime/retro_world_sgdk.h"
#include "retro_runtime/retro_scenery_sgdk.h"
#include "generated/world_maps.h"
#include "fixture_ids.h"
#define SPRITE_TILE_RESERVE 128
static const RetroWorldSpawn hallEntries[]={{1,160,400,1}},caveEntries[]={{1,160,112,1}};
static const RetroWorldRoom rooms[]={
 {FIXTURE_HALL,FIXTURE_HALL_WIDTH,FIXTURE_HALL_HEIGHT,hallEntries,1,0,0,0,0},
 {FIXTURE_CAVE,FIXTURE_CAVE_WIDTH,FIXTURE_CAVE_HEIGHT,caveEntries,1,0,0,0,0}};
static const RetroWorldDefinition definition={rooms,2,FIXTURE_HALL,1};
static RetroWorld world={0};
static RetroWorldSgdk bridge={0};
static const u32 sentinel[8]={0xF0F0F0F0,0x0F0F0F0F,0xF0F0F0F0,0x0F0F0F0F,0xF0F0F0F0,0x0F0F0F0F,0xF0F0F0F0,0x0F0F0F0F};
static void number(u16 value,u16 x,u16 y,u16 digits){char text[8];uintToStr(value,text,digits);VDP_drawText(text,x,y);}
static void hud(s16 wantX,s16 wantY,u8 status){
 RetroScenerySgdkStats stats;retroScenerySgdkStats(&bridge,&stats);
 VDP_drawText(world.room->id==FIXTURE_HALL?"SALA 1 STREAM":"SALA 2 MAPA  ",0,0);
 VDP_drawText("X",14,0);number((u16)bridge.cameraX,15,0,4);VDP_drawText("Y",20,0);number((u16)bridge.cameraY,21,0,3);
 VDP_drawText(bridge.cameraX==wantX&&bridge.cameraY==wantY?"  ":"<<",25,0);VDP_drawText("ST",28,0);number(status,30,0,1);number(bridge.lastError,32,0,1);
 VDP_drawText("TILES",0,1);number(stats.slotsUsed,6,1,4);VDP_drawText("/",10,1);number(stats.slots,11,1,4);VDP_drawText("PICO",16,1);number(stats.slotsPeak,21,1,4);
 VDP_drawText("DMA",0,2);number(stats.frameBytes,4,2,4);VDP_drawText("PICO",9,2);number(stats.peakBytes,14,2,4);VDP_drawText("ENT",19,2);number(stats.peakEntries,23,2,3);VDP_drawText("SEG",27,2);number(stats.held,31,2,4);
}
int main(bool hardReset){
 s16 x=0,y=0,stepX=3,stepY=0;u16 pad,last=0;u8 tour=1,status=0;(void)hardReset;
 VDP_setScreenWidth320();VDP_setPlaneSize(64,32,TRUE);VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
 DMA_setBufferSize(8192);DMA_setMaxQueueSize(64);DMA_setMaxTransferSize(7200);DMA_setAutoFlush(TRUE);
 SPR_initEx(SPRITE_TILE_RESERVE);
 /* Janela fixa no alto para o texto: os dois planos são da sala. */
 VDP_setWindowVPos(FALSE,3);VDP_setTextPlane(WINDOW);VDP_setTextPalette(PAL1);
 PAL_setColor(16,0x000);PAL_setColor(31,0xEEE);PAL_setColor(17,0x00E);
 /* Sentinelas: logo depois da faixa da sala (FIXTURE_TILE_BUDGET tiles a partir de TILE_USER_INDEX). */
 VDP_loadTileData(sentinel,TILE_USER_INDEX+FIXTURE_TILE_BUDGET,1,DMA);VDP_loadTileData(sentinel,TILE_USER_INDEX+FIXTURE_TILE_BUDGET+1,1,DMA);
 VDP_setTileMapXY(WINDOW,TILE_ATTR_FULL(PAL1,TRUE,FALSE,FALSE,TILE_USER_INDEX+FIXTURE_TILE_BUDGET),37,0);
 VDP_setTileMapXY(WINDOW,TILE_ATTR_FULL(PAL1,TRUE,FALSE,FALSE,TILE_USER_INDEX+FIXTURE_TILE_BUDGET+1),38,0);
 if(retroWorldSgdkInit(&bridge,&world,&definition,retroWorldMapBindings,RETRO_WORLD_MAP_COUNT,0,0,0)!=RETRO_WORLD_OK){
  VDP_drawText("FALHA AO INICIAR",0,0);number(bridge.lastError,18,0,2);
  while(1)SYS_doVBlankProcess();
 }
 x=bridge.cameraX;y=bridge.cameraY;
 while(1){
  s16 maxX=(s16)(world.room->width>320?world.room->width-320:0),maxY=(s16)(world.room->height>224?world.room->height-224:0);
  pad=JOY_readJoypad(JOY_1);
  if((pad&BUTTON_A)&&!(last&BUTTON_A)){
   retroWorldEnter(&world,world.room->id==FIXTURE_HALL?FIXTURE_CAVE:FIXTURE_HALL,1);x=bridge.cameraX;y=bridge.cameraY;tour=world.room->id==FIXTURE_HALL;stepX=3;stepY=0;
  }
  if((pad&BUTTON_START)&&!(last&BUTTON_START))tour=1;
  if(pad&(BUTTON_LEFT|BUTTON_RIGHT|BUTTON_UP|BUTTON_DOWN)){
   tour=0;
   if(pad&BUTTON_LEFT)x-=pad&BUTTON_B?12:2;
   if(pad&BUTTON_RIGHT)x+=pad&BUTTON_B?12:2;
   if(pad&BUTTON_UP)y-=2;
   if(pad&BUTTON_DOWN)y+=2;
  }else if(tour){
   /* Passeio: direita até o fim, desce, esquerda até o início, sobe. */
   x+=stepX;y+=stepY;
   if(stepX>0&&x>=maxX){stepX=0;stepY=2;}
   else if(stepY>0&&y>=maxY){stepY=0;stepX=-4;}
   else if(stepX<0&&x<=0){stepX=0;stepY=-2;}
   else if(stepY<0&&y<=0){stepY=0;stepX=3;}
  }
  last=pad;
  if(x<0)x=0;
  if(x>maxX)x=maxX;
  if(y<0)y=0;
  if(y>maxY)y=maxY;
  status=retroWorldSgdkScroll(&bridge,x,y);
  hud(x,y,status);
  /* O orçamento pode segurar a câmera: o jogo segue de onde a tela está. */
  x=bridge.cameraX;y=bridge.cameraY;
  SPR_update();SYS_doVBlankProcess();
 }
 return 0;
}
