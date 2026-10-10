/* #44/#49: original collision diagnostic, no game/recovered assets.
 * Isolated reference motion, not the production controller of issue #58.
 * Pixel canvas owns BG_A and 920 tiles; HUD owns BG_B. No sprite engine. */
#include <genesis.h>
#include "retro_runtime/retro_slopes.h"
#include "retro_runtime/retro_combat.h"
#define Q(n) ((RetroFixed)(n)*RETRO_FIXED_ONE)
#define CANVAS_COLUMNS 40
#define CANVAS_FIRST_ROW 5
#define CANVAS_ROWS 23
#define CANVAS_TILES (CANVAS_COLUMNS*CANVAS_ROWS)
static u32 canvas[CANVAS_TILES*8];
static u8 dirty[(CANVAS_TILES+7)/8];
static RetroBody player;
static RetroInput input;
static RetroFixed velocityY;
static u8 grounded,contacts,facing,lastDamage,damageCalls;
static RetroAttackState attack;
static RetroCombatant target;
static const RetroRect hurtLocal={-6,-28,12,28};
static const RetroRect attackLocal={8,-28,24,16};
static const RetroRect targetBox={224,128,20,32};
static RetroRect oldBody,oldHurt,oldAttack;
static u8 oldContacts;
static const RetroCollider terrain[]={
 {{16,160,284,4},1,RETRO_COLLIDER_SOLID},
 {{16,40,4,120},1,RETRO_COLLIDER_SOLID},
 {{296,40,4,120},1,RETRO_COLLIDER_SOLID},
 {{96,92,48,4},1,RETRO_COLLIDER_SOLID},
 {{64,120,32,3},1,RETRO_COLLIDER_PLATFORM}
};
static const RetroSlope slopes[]={{{128,144,32,16},1,16,0}};
static void resetDiagnostic(void){
 player=(RetroBody){Q(48),Q(160),{-8,-32,16,32},1};
 velocityY=0;grounded=1;contacts=0;facing=0;lastDamage=0;damageCalls=0;
 attack=(RetroAttackState){0};target=(RetroCombatant){9,0,1};
}
static void damage(void *context,uint8_t result,uint16_t amount,RetroFixed ix,RetroFixed iy){
 (void)context;(void)amount;(void)ix;(void)iy;lastDamage=result;damageCalls++;
}
static void stepDiagnostic(u16 buttons){
 RetroMoveResult motion;
 RetroRect attackWorld;
 RetroFixed dx;
 signed char axis;
 retroInputUpdate(&input,buttons);
 if(input.pressed&BUTTON_START){resetDiagnostic();return;}
 axis=retroInputAxis(&input,BUTTON_LEFT,BUTTON_RIGHT);
 dx=(RetroFixed)axis*((buttons&BUTTON_C)?Q(12):Q(2));
 if(axis)facing=(u8)(axis<0);
 if((input.pressed&BUTTON_B)&&grounded){velocityY=-Q(5);grounded=0;}
 else {velocityY+=64;if(velocityY>Q(7))velocityY=Q(7);}
 motion=retroMoveBodySlopes(&player,dx,velocityY,terrain,5,slopes,1,2,grounded,(buttons&BUTTON_DOWN)!=0);
 contacts=motion.contacts;grounded=(u8)((contacts&RETRO_CONTACT_FLOOR)!=0);
 if(contacts&(RETRO_CONTACT_FLOOR|RETRO_CONTACT_CEILING))velocityY=0;
 if(input.pressed&BUTTON_A)retroAttackBegin(&attack,0,6,1);
 if(attack.running && attack.age>=attack.start && attack.age<attack.end &&
    retroWorldRect(&attackLocal,player.x,player.y,facing,0,&attackWorld))
  retroAttackApply(&attack,&attackWorld,&target,&targetBox,0,3,30,Q(2),0,damage,0);
}
static void finishDiagnostic(void){retroAttackTick(&attack);retroCombatTick(&target);}
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
 RetroRect body,hurt,hit={0,0,0,0};RetroFixed surface;u16 i;
 outline(&oldBody,0);outline(&oldHurt,0);outline(&oldAttack,0);drawContacts(&oldBody,oldContacts,0);
 for(i=0;i<5;i++)outline(&terrain[i].box,terrain[i].kind==RETRO_COLLIDER_PLATFORM?8:1);
 for(i=0;i<32;i++)if(retroSlopeSurface(&slopes[0],Q(128+i),&surface))point(128+i,surface/RETRO_FIXED_ONE,7);
 outline(&targetBox,target.invulnerable&&(target.invulnerable&2)?6:5);
 if(!retroWorldRect(&player.box,player.x,player.y,0,0,&body) ||
    !retroWorldRect(&hurtLocal,player.x,player.y,facing,0,&hurt))return;
 outline(&body,2);outline(&hurt,3);
 if(attack.running&&attack.age>=attack.start&&attack.age<attack.end &&
    retroWorldRect(&attackLocal,player.x,player.y,facing,0,&hit))outline(&hit,4);
 drawContacts(&body,contacts,6);
 oldBody=body;oldHurt=hurt;oldAttack=hit;oldContacts=contacts;
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
static void drawHud(void){
 char health[]="TARGET HP: 9";
 char speed[]="VY:+0.00";
 RetroFixed magnitude=velocityY<0?-velocityY:velocityY;
 u16 fraction=(u16)((magnitude%256)*100/256);
 health[11]=(char)('0'+target.health);
 speed[3]=velocityY<0?'-':'+';speed[4]=(char)('0'+magnitude/256);
 speed[6]=(char)('0'+fraction/10);speed[7]=(char)('0'+fraction%10);
 VDP_drawTextBG(BG_B,health,26,0);VDP_drawTextBG(BG_B,speed,26,1);
 VDP_drawTextBG(BG_B,(contacts&RETRO_CONTACT_LEFT)?"L":"-",28,2);
 VDP_drawTextBG(BG_B,(contacts&RETRO_CONTACT_RIGHT)?"R":"-",30,2);
 VDP_drawTextBG(BG_B,(contacts&RETRO_CONTACT_FLOOR)?"F":"-",32,2);
 VDP_drawTextBG(BG_B,(contacts&RETRO_CONTACT_CEILING)?"C":"-",34,2);
 VDP_drawTextBG(BG_B,lastDamage==RETRO_DAMAGE_DEFEATED?"DEFEATED":lastDamage?"HIT     ":"        ",26,3);
}
int main(void){
 const u16 palette[16]={0,0x444,0x0E0,0xE0E,0x06E,0x00E,0xEEE,0x0EE,0xEE0,0,0,0,0,0,0,0xEEE};
 u16 i;
 VDP_setScreenWidth320();JOY_init();VDP_setEnable(FALSE);
 if(TILE_USER_INDEX+CANVAS_TILES>TILE_FONT_INDEX){VDP_setEnable(TRUE);VDP_drawText("Diagnostic VRAM limit",1,1);while(TRUE)SYS_doVBlankProcess();}
 PAL_setPalette(PAL0,palette,CPU);
 resetDiagnostic();renderDiagnostic();
 VDP_loadTileData(canvas,TILE_USER_INDEX,CANVAS_TILES,CPU);
 for(i=0;i<sizeof(dirty);i++)dirty[i]=0;
 VDP_fillTileMapRectInc(BG_A,TILE_ATTR_FULL(PAL0,1,0,0,TILE_USER_INDEX),0,CANVAS_FIRST_ROW,CANVAS_COLUMNS,CANVAS_ROWS);
 VDP_drawTextBG(BG_B,"A ATTACK B JUMP C FAST",1,0);
 VDP_drawTextBG(BG_B,"DPAD MOVE / DOWN DROP",1,1);
 VDP_drawTextBG(BG_B,"START RESET  CONTACTS",1,2);
 VDP_drawTextBG(BG_B,"BODY GREEN HURT PURPLE",1,3);
 VDP_drawTextBG(BG_B,"ATTACK ORANGE CONTACT WHITE",1,4);
 VDP_setEnable(TRUE);
 while(TRUE){stepDiagnostic(JOY_readJoypad(JOY_1));renderDiagnostic();drawHud();flushDirty();SYS_doVBlankProcess();finishDiagnostic();}
 return 0;
}
