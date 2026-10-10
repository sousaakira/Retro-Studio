/* #59 diagnostic host: exported camera profiles/regions driving plane scroll.
 * Isolated fixture; it replaces main.c only inside a temporary project.
 * D-pad moves the target, A unlocks the arena, B/C pan as a script, START
 * returns the camera to the target. Room is one 512x448 plane (64x64 cells). */
#include <genesis.h>
#include "generated/camera_config.h"
#define ROOM_WIDTH 512
#define ROOM_HEIGHT 448
static const u32 solidTile[8]={0x11111111,0x12222221,0x12222221,0x12222221,0x12222221,0x12222221,0x12222221,0x11111111};
static const u32 targetTile[8]={0x33333333,0x33333333,0x33333333,0x33333333,0x33333333,0x33333333,0x33333333,0x33333333};
static RetroCamera camera;
static RetroInput input;
static void drawRoom(void){
 u16 x,y;char label[8];
 for(y=0;y<ROOM_HEIGHT/8;y++)for(x=0;x<ROOM_WIDTH/8;x++)
  if(!(x&7)||!(y&7))VDP_setTileMapXY(BG_B,TILE_ATTR_FULL(PAL0,0,0,0,TILE_USER_INDEX),x,y);
 for(y=0;y<ROOM_HEIGHT/64;y++)for(x=0;x<ROOM_WIDTH/64;x++){
  sprintf(label,"%u,%u",x*64,y*64);VDP_drawTextBG(BG_B,label,x*8+1,y*8+1);
 }
}
int main(void){
 const RetroCameraConfig *config=IS_PAL_SYSTEM?&retroProjectCameraPal:&retroProjectCameraNtsc;
 const RetroCameraRegion *regions=RETRO_PROJECT_CAMERA_ROOM_COUNT?retroProjectCameraRooms[0].regions:0;
 u16 count=RETRO_PROJECT_CAMERA_ROOM_COUNT?retroProjectCameraRooms[0].count:0;
 RetroFixed x=100*256,y=160*256;signed char direction=1;s16 script=0;
 VDP_setPlaneSize(64,64,TRUE);VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
 PAL_setColor(1,0x0444);PAL_setColor(2,0x0222);PAL_setColor(3,0x00EE);PAL_setColor(15,0x0EEE);
 VDP_loadTileData(solidTile,TILE_USER_INDEX,1,DMA);VDP_loadTileData(targetTile,TILE_USER_INDEX+1,1,DMA);
 VDP_setWindowVPos(FALSE,2);drawRoom();JOY_init();
 retroCameraInit(&camera,VDP_getScreenWidth(),VDP_getScreenHeight());
 if(!retroCameraEnterRoom(&camera,config,ROOM_WIDTH,ROOM_HEIGHT,regions,count,x,y,direction)){
  /* Regions exported for a larger room: keep the profile, drop the regions. */
  regions=0;count=0;retroCameraEnterRoom(&camera,config,ROOM_WIDTH,ROOM_HEIGHT,0,0,x,y,direction);
 }
 while(TRUE){
  RetroCameraResult result;char line[40];
  retroInputUpdate(&input,JOY_readJoypad(JOY_1));
  if(input.held&BUTTON_LEFT){x-=2*256;direction=-1;}
  if(input.held&BUTTON_RIGHT){x+=2*256;direction=1;}
  if(input.held&BUTTON_UP)y-=2*256;
  if(input.held&BUTTON_DOWN)y+=2*256;
  if(x<0)x=0;
  if(x>(ROOM_WIDTH-1)*256)x=(ROOM_WIDTH-1)*256;
  if(y<8*256)y=8*256;
  if(y>(ROOM_HEIGHT-1)*256)y=(ROOM_HEIGHT-1)*256;
  if(input.pressed&BUTTON_A)retroCameraUnlock(&camera);
  if(input.pressed&(BUTTON_B|BUTTON_C)){script=retroCameraCutsceneGet(&camera);}
  if(input.held&BUTTON_B){script-=2;retroCameraCutsceneSet(&camera,0,script=retroCameraCutsceneClamp(&camera,script));}
  if(input.held&BUTTON_C){script+=2;retroCameraCutsceneSet(&camera,0,script=retroCameraCutsceneClamp(&camera,script));}
  if(input.pressed&BUTTON_START)retroCameraCutsceneSet(&camera,1,0);
  result=retroCameraTick(&camera,config,x,y,direction);
  if(!result.invalid){
   VDP_setHorizontalScroll(BG_B,-result.x);VDP_setVerticalScroll(BG_B,result.y);
   VDP_setSpriteFull(0,(s16)(x/256)-result.x-4,(s16)(y/256)-result.y-8,SPRITE_SIZE(1,1),
    TILE_ATTR_FULL(PAL0,1,0,0,TILE_USER_INDEX+1),0);
   VDP_updateSprites(1,DMA_QUEUE);
  }
  sprintf(line,"CAM %4d,%3d REG %5u %c%c%c%c",result.x,result.y,result.region,
   result.invalid?'!':' ',(result.flags&RETRO_CAMERA_TRANSITION)?'T':' ',
   (result.flags&RETRO_CAMERA_LOCKED)?'L':' ',(result.flags&RETRO_CAMERA_SCRIPT)?'S':' ');
  VDP_drawTextBG(WINDOW,line,1,0);
  sprintf(line,"TGT %4d,%3d",(s16)(x/256),(s16)(y/256));VDP_drawTextBG(WINDOW,line,1,1);
  SYS_doVBlankProcess();
 }
 return 0;
}
