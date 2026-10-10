/* Diagnostic ROM for the palette module (#57): the four project palettes as color
 * bars, driven by the generated header. A: cycles on/off. B: first fade. C: second
 * fade. The counters are measured by this ROM: frames that sent colors and the
 * largest number of colors sent in one frame. */
#include <genesis.h>
#include "generated/palette_config.h"
#include "retro_runtime/retro_palette_sgdk.h"
static RetroPalette palette;
static void number(u16 value,u16 x,u16 y){char text[6];uintToStr(value,text,5);VDP_drawText(text,x,y);}
int main(bool hard){
 u16 held=0,sends=0,largest=0,color,row;u8 cycles=0,i;u32 tile[8];
 (void)hard;
 VDP_setTextPalette(PAL3);
 if(!retroPaletteInit(&palette,retroProjectPalettes,retroProjectCycles,RETRO_PROJECT_CYCLE_COUNT)){VDP_drawText("INVALID PALETTE TABLE",2,2);while(TRUE)SYS_doVBlankProcess();}
 retroPaletteSgdkLoad(&palette);
 VDP_setBackgroundColor(RETRO_PROJECT_BACKDROP);
 /* One solid tile per color index; each row uses another palette. */
 for(color=1;color<16;color++){for(i=0;i<8;i++)tile[i]=0x11111111UL*color;VDP_loadTileData(tile,TILE_USER_INDEX+color-1,1,CPU);}
 for(row=0;row<4;row++)for(color=1;color<16;color++)VDP_fillTileMapRect(BG_A,TILE_ATTR_FULL(row,FALSE,FALSE,FALSE,TILE_USER_INDEX+color-1),4+color*2,3+row*5,2,4);
 VDP_drawText("PAL0",0,4);VDP_drawText("PAL1",0,9);VDP_drawText("PAL2",0,14);VDP_drawText("PAL3",0,19);
 VDP_drawText("A CYCLES  B/C FADES",1,24);VDP_drawText("CYCLES OFF  SENDS       MAX",1,26);
 while(TRUE){
  u16 now=JOY_readJoypad(JOY_1),pressed=now&~held;u8 sent;
  held=now;
  if(pressed&BUTTON_A){cycles^=1;for(i=0;i<RETRO_PROJECT_CYCLE_COUNT;i++)retroPaletteCycleEnable(&palette,i,cycles);VDP_drawText(cycles?"ON ":"OFF",8,26);}
  if((pressed&BUTTON_B)&&RETRO_PROJECT_FADE_COUNT>0)retroPaletteFadeStart(&palette,&retroProjectFades[0]);
  if((pressed&BUTTON_C)&&RETRO_PROJECT_FADE_COUNT>1)retroPaletteFadeStart(&palette,&retroProjectFades[1]);
  sent=retroPaletteSgdkUpdate(&palette);
  if(sent){sends++;if(sent>largest)largest=sent;number(sends,19,26);number(largest,29,26);}
  SYS_doVBlankProcess();
 }
 return 0;
}
