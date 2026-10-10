/* #58: shared room/controller/metrics on SGDK; no recovered/game assets.
 * BG_A owns 920 canvas tiles; BG_B owns the five HUD rows. No sprite engine.
 * Lab measurements are the same wrapper as the browser WASM. */
#include <genesis.h>
#include "generated/movement_config.h"
#include "retro_runtime/movement-lab.inc"
#define Q(n) ((RetroFixed)(n)*RETRO_FIXED_ONE)
#define CANVAS_COLUMNS 40
#define CANVAS_FIRST_ROW 5
#define CANVAS_ROWS 23
#define CANVAS_TILES (CANVAS_COLUMNS*CANVAS_ROWS)
#define TRAIL_LENGTH 512
static u32 canvas[CANVAS_TILES*8];
static u8 dirty[(CANVAS_TILES+7)/8];
static s16 trailX[TRAIL_LENGTH],trailY[TRAIL_LENGTH];
static u16 trailCount,trailNext;
static RetroInput input;
static RetroRect oldBody;
static u8 oldContacts,labFailed;
static void resetDiagnostic(void){
 u16 i;
 labConfig=IS_PAL_SYSTEM?retroProjectMovementPal:retroProjectMovementNtsc;
 labFailed=(u8)!movementLabReset();
 for(i=0;i<CANVAS_TILES*8;i++)canvas[i]=0;
 for(i=0;i<sizeof(dirty);i++)dirty[i]=255;
 trailCount=0;trailNext=0;oldBody=(RetroRect){0};oldContacts=0;
}
static void stepDiagnostic(u16 buttons){
 signed char axis;u8 movement;
 retroInputUpdate(&input,buttons);
 if(input.pressed&BUTTON_START){resetDiagnostic();return;}
 if(labFailed)return;
 axis=retroInputAxis(&input,BUTTON_LEFT,BUTTON_RIGHT);
 movement=(u8)(((input.held&BUTTON_B)?RETRO_MOVE_JUMP_HELD:0)|
              ((input.pressed&BUTTON_B)?RETRO_MOVE_JUMP_PRESSED:0)|
              ((input.pressed&BUTTON_C)?RETRO_MOVE_DASH_PRESSED:0)|
              ((input.held&BUTTON_DOWN)?RETRO_MOVE_DROP_HELD:0));
 labFailed=(u8)!movementLabTick(axis,movement);
}
static void point(s32 x,s32 y,u8 color){
 u16 tile,row,shift;
 u32 previous,next,mask;
 if(x<0||x>=320||y<CANVAS_FIRST_ROW*8||y>=224)return;
 tile=(u16)((y/8-CANVAS_FIRST_ROW)*CANVAS_COLUMNS+x/8);
 row=(u16)(tile*8+y%8);shift=(u16)(28-(x%8)*4);mask=(u32)15<<shift;
 previous=canvas[row];next=(previous&~mask)|((u32)(color&15)<<shift);
 if(previous!=next){canvas[row]=next;dirty[tile/8]|=(u8)(1<<(tile%8));}
}
static void outline(const RetroRect *r,u8 color){
 s32 x,y,left,right,top,bottom;
 if(!r || r->width<=0 || r->height<=0)return;
 left=r->x;right=left+r->width-1;top=r->y;bottom=top+r->height-1;
 for(x=left<0?0:left;x<=right&&x<320;x++){point(x,top,color);point(x,bottom,color);}
 for(y=top<40?40:top;y<=bottom&&y<224;y++){point(left,y,color);point(right,y,color);}
}
static void cross(s32 x,s32 y,u8 color){s16 d;for(d=-2;d<=2;d++){point(x+d,y,color);point(x,y+d,color);}}
static void drawContacts(const RetroRect *body,u8 mask,u8 color){
 s32 x=body->x,y=body->y,w=body->width,h=body->height;
 if(mask&RETRO_CONTACT_LEFT)cross(x,y+h/2,color);
 if(mask&RETRO_CONTACT_RIGHT)cross(x+w-1,y+h/2,color);
 if(mask&RETRO_CONTACT_FLOOR)cross(x+w/2,y+h-1,color);
 if(mask&RETRO_CONTACT_CEILING)cross(x+w/2,y,color);
}

static void renderDiagnostic(void){
 RetroRect body;RetroFixed surface;u16 i,j;
 outline(&oldBody,0);drawContacts(&oldBody,oldContacts,0);
 if(trailCount==TRAIL_LENGTH)point(trailX[trailNext],trailY[trailNext],0);
 trailX[trailNext]=(s16)(labPlayer.body.x/256);trailY[trailNext]=(s16)(labPlayer.body.y/256);
 trailNext=(u16)((trailNext+1)%TRAIL_LENGTH);if(trailCount<TRAIL_LENGTH)trailCount++;
 for(i=0;i<trailCount;i++)point(trailX[i],trailY[i],9);
 for(i=0;i<LAB_COLLIDER_COUNT;i++)outline(&labColliders[i].box,labColliders[i].kind==RETRO_COLLIDER_PLATFORM?8:1);
 for(i=0;i<LAB_SLOPE_COUNT;i++)for(j=0;j<(u16)labSlopes[i].bounds.width;j++){
  if(retroSlopeSurface(&labSlopes[i],Q(labSlopes[i].bounds.x+j),&surface))point(labSlopes[i].bounds.x+j,surface/256,7);
 }
 if(!retroWorldRect(&labPlayer.body.box,labPlayer.body.x,labPlayer.body.y,0,0,&body))return;
 outline(&body,2);drawContacts(&body,labResult.contacts,6);
 /* Facing marker is cleared with the body edge before the next pose. */
 point(labPlayer.facing?body.x:body.x+body.width-1,body.y+body.height/2,6);
 oldBody=body;oldContacts=labResult.contacts;
}
static void flushDirty(void){
 u16 tile,queued=0;
 for(tile=0;tile<CANVAS_TILES;tile++)if(dirty[tile/8]&(1<<(tile%8))){
  if(queued==64){SYS_doVBlankProcess();queued=0;}
  VDP_loadTileData(&canvas[tile*8],TILE_USER_INDEX+tile,1,DMA_QUEUE);queued++;
  dirty[tile/8]&=(u8)~(1<<(tile%8));
 }
 /* Main must finish VBlank before modifying canvas used by queued DMA. */
}

/* Fixed-width decimal output prevents stale digits and avoids printf/heap. */
static void number(s32 value,u8 fractional,char *out){
 u32 magnitude=value<0?(u32)(-(value+1))+1:(u32)value;
 u32 integer=fractional?magnitude/256:magnitude;u16 i=5;
 out[0]=value<0?'-':'+';
 do{out[i--]=(char)('0'+integer%10);integer/=10;}while(i>0);
 if(fractional){u16 fraction=(u16)((magnitude%256)*1000/256);out[6]='.';out[7]=(char)('0'+fraction/100);out[8]=(char)('0'+fraction/10%10);out[9]=(char)('0'+fraction%10);out[10]=0;}
 else out[6]=0;
}
static void drawHud(void){
 char value[11];
 VDP_drawTextBG(BG_B,IS_PAL_SYSTEM?"SHARED PHYSICS PAL 50HZ  ":"SHARED PHYSICS NTSC 60HZ ",1,0);
 VDP_drawTextBG(BG_B,"B JUMP C DASH DOWN DROP START RESET",1,1);
 VDP_drawTextBG(BG_B,"HEIGHT",1,2);number(movementLabRead(12),1,value);VDP_drawTextBG(BG_B,value,8,2);
 VDP_drawTextBG(BG_B,"DIST",20,2);number(movementLabRead(13),1,value);VDP_drawTextBG(BG_B,value,25,2);
 VDP_drawTextBG(BG_B,"VX",1,3);number(movementLabRead(2),1,value);VDP_drawTextBG(BG_B,value,8,3);
 VDP_drawTextBG(BG_B,"VY",20,3);number(movementLabRead(3),1,value);VDP_drawTextBG(BG_B,value,25,3);
 VDP_drawTextBG(BG_B,"FLIGHT",1,4);number(movementLabRead(14),0,value);VDP_drawTextBG(BG_B,value,8,4);
 VDP_drawTextBG(BG_B,labFailed?"RESET REQUIRED":labPlayer.sliding?"WALL SLIDING  ":labPlayer.dashRemaining?"DASH          ":labPlayer.grounded?"GROUND        ":"AIR           ",20,4);
}
int main(void){
 const u16 palette[16]={0,0x444,0x0E0,0,0,0,0xEEE,0x0EE,0xEE0,0xE80,0,0,0,0,0,0xEEE};
 u16 i;
 VDP_setScreenWidth320();VDP_setScreenHeight224();JOY_init();VDP_setEnable(FALSE);
 if(TILE_USER_INDEX+CANVAS_TILES>TILE_FONT_INDEX){VDP_setEnable(TRUE);VDP_drawText("Diagnostic VRAM limit",1,1);while(TRUE)SYS_doVBlankProcess();}
 PAL_setPalette(PAL0,palette,CPU);
 resetDiagnostic();renderDiagnostic();
 VDP_loadTileData(canvas,TILE_USER_INDEX,CANVAS_TILES,CPU);
 for(i=0;i<sizeof(dirty);i++)dirty[i]=0;
 VDP_fillTileMapRectInc(BG_A,TILE_ATTR_FULL(PAL0,1,0,0,TILE_USER_INDEX),0,CANVAS_FIRST_ROW,CANVAS_COLUMNS,CANVAS_ROWS);
 drawHud();VDP_setEnable(TRUE);
 while(TRUE){stepDiagnostic(JOY_readJoypad(JOY_1));renderDiagnostic();drawHud();flushDirty();SYS_doVBlankProcess();}
 return 0;
}
