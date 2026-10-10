#ifndef RETRO_STUDIO_DEBUG_SGDK_H
#define RETRO_STUDIO_DEBUG_SGDK_H
#include <genesis.h>
#include "retro_debug.h"
/* SGDK 1.81 host for the diagnostics module. Include and call it only inside
 * #if RETRO_PROJECT_DEBUG blocks so production ROMs carry none of it.
 * What SGDK 1.81 lets a game measure:
 *  - CPU load and FPS (SYS_getCPULoad, SYS_getFPS). SGDK's load is its own
 *    figure: an average over 8 frames taken from the scanline where the game
 *    starts waiting for VBlank (256 lines = 100%, each lost frame adds 100).
 *    Both need a warm-up, so they are reported as unmeasured for the first
 *    frames. Do not call SYS_getFPS elsewhere: it counts its own calls;
 *  - DMA queue length and bytes (before SYS_doVBlankProcess flushes it);
 *  - sprite engine sprites, and how many hardware sprites the engine RESERVES
 *    for them (a maximum, not what is on screen);
 *  - VRAM only for a VRAMRegion the game owns. The sprite engine keeps its own
 *    region private, so its free space is NOT measurable and stays "--". */
#define RETRO_DEBUG_SGDK_ROWS 4
/* region: a VRAMRegion owned by the game, or NULL. spriteEngine: the game uses SPR_*. */
static inline void retroDebugSgdkSample(RetroDebugSample *sample,VRAMRegion *region,u8 spriteEngine){
 static u8 warm;u32 fps=SYS_getFPS();
 sample->measured=RETRO_DEBUG_DMA;
 sample->cpu=SYS_getCPULoad();sample->fps=(u16)(fps>999?999:fps);
 /* Neither figure means anything before SGDK filled its windows. */
 if(warm<32)warm++;else sample->measured|=RETRO_DEBUG_CPU|RETRO_DEBUG_FPS;
 sample->dmaQueue=DMA_getQueueSize();sample->dmaBytes=DMA_getQueueTransferSize();
 sample->vramFree=sample->vramLargest=sample->vramTotal=sample->sprites=sample->vdpSprites=0;
 if(region){
  sample->measured|=RETRO_DEBUG_VRAM;
  sample->vramFree=VRAM_getFree(region);sample->vramLargest=VRAM_getLargestFreeBlock(region);
  sample->vramTotal=(u16)(sample->vramFree+VRAM_getAllocated(region));
 }
 if(spriteEngine){
  sample->measured|=RETRO_DEBUG_SPRITES;
  sample->sprites=SPR_getNumActiveSprite();sample->vdpSprites=SPR_getUsedVDPSprite();
 }
}
/* Four text rows on the WINDOW plane, at the top of the screen. Drawing text is
 * expensive on this CPU, so each call redraws ONE row (a full refresh takes
 * four frames). The overlay still costs CPU time: the load it reports includes
 * itself, and a game close to its frame budget can drop frames only because
 * the overlay is on. Null sample or subject leaves those rows blank. Call it
 * from one source file only (the row counter lives in this function). */
static inline void retroDebugSgdkOverlay(const RetroDebugSample *sample,const RetroDebugPeaks *peaks,
 const RetroDebugSubject *subject,const char *build){
 static u8 row;char line[RETRO_DEBUG_LINE];u8 used;
 VDP_setWindowVPos(FALSE,RETRO_DEBUG_SGDK_ROWS);
 used=row==0?retroDebugLinePerformance(line,sample,peaks):row==1?retroDebugLineMemory(line,sample,build):
  row==2?retroDebugLineSubject(line,subject):retroDebugLineMotion(line,subject);
 VDP_drawTextBG(WINDOW,line,0,row);
 if(used<40)VDP_clearTextBG(WINDOW,used,row,40-used);
 row=(u8)((row+1)&3);
}
static inline void retroDebugSgdkOverlayHide(void){VDP_setWindowVPos(FALSE,0);}
/* Box marker: an L-shaped corner written over the unused DEL glyph of the SGDK
 * font, so it needs no VRAM of its own. Call once after the font is loaded. */
#define RETRO_DEBUG_SGDK_MARKER (TILE_FONT_INDEX+95)
static inline void retroDebugSgdkBoxTile(void){
 static const u32 corner[8]={0xFFFFFFFF,0xF0000000,0xF0000000,0xF0000000,0xF0000000,0xF0000000,0xF0000000,0xF0000000};
 VDP_loadTileData(corner,RETRO_DEBUG_SGDK_MARKER,1,DMA);
}
/* Draws each box as four corner brackets just OUTSIDE its edges (one pixel
 * around the box), so a sprite covering the box does not hide them. Call it
 * after SPR_update() (or with spriteEngine 0 when the game does not use the
 * engine) and before SYS_doVBlankProcess(). Boxes are in room pixels;
 * cameraX/Y is the scroll. Colour 15 of `palette` is used. At most
 * RETRO_DEBUG_MAX_BOXES boxes; brackets outside the screen are skipped.
 * The brackets are sprites placed after the engine's own, so engine sprites
 * are drawn over them. Hardware limits still apply (80 sprites per frame and
 * 20 per scanline in H40): being last in the chain, the brackets are the
 * first to disappear on a crowded line. Limits assume the 320-pixel mode.
 * Loading another font or resetting the screen erases the marker tile: call
 * retroDebugSgdkBoxTile() again afterwards. */
static inline void retroDebugSgdkBoxes(const RetroDebugBox *boxes,u8 count,s16 cameraX,s16 cameraY,u16 palette,u8 spriteEngine){
 u16 base=0,index,i,corner,guard;
 /* The engine links only the sprites it really drew this frame. Follow the
  * chain from sprite 0 to its true end (SPR_getUsedVDPSprite is a reserved
  * maximum and would skip or overwrite entries). */
 if(spriteEngine){for(guard=0;vdpSpriteCache[base].link&&guard<80;guard++)base=vdpSpriteCache[base].link;base++;}
 index=base;
 if(count>RETRO_DEBUG_MAX_BOXES)count=RETRO_DEBUG_MAX_BOXES;
 for(i=0;i<count&&base<80;i++){
  s16 left=boxes[i].rect.x-cameraX,top=boxes[i].rect.y-cameraY;
  if(boxes[i].rect.width<1||boxes[i].rect.height<1)continue;
  for(corner=0;corner<4&&index<80;corner++){
   s16 x=(corner&1)?left+boxes[i].rect.width:left-8,y=(corner&2)?top+boxes[i].rect.height:top-8;
   if(x<=-8||y<=-8||x>=320||y>=240)continue;
   VDP_setSpriteFull(index,x,y,SPRITE_SIZE(1,1),TILE_ATTR_FULL(palette,1,!(corner&2),!(corner&1),RETRO_DEBUG_SGDK_MARKER),(u8)(index+1));
   index++;
  }
 }
 if(index==base){
  /* Nothing to draw: make sure brackets of an earlier frame are unlinked. */
  if(!spriteEngine)VDP_setSpriteFull(0,-32,-32,SPRITE_SIZE(1,1),0,0);
  else vdpSpriteCache[base-1].link=0;
  VDP_updateSprites(base?base:1,DMA_QUEUE);return;
 }
 vdpSpriteCache[index-1].link=0;
 if(base)vdpSpriteCache[base-1].link=(u8)base;
 VDP_updateSprites(index,DMA_QUEUE);
}
/* Debug transport: one record per call to the emulator's debug console
 * (KDebug). Only emulators that implement KDebug show it; on hardware and on
 * other emulators the write is ignored. */
static inline void retroDebugSgdkSend(const char *build,u32 frame,const RetroDebugSample *sample,const RetroDebugSubject *subject){
 char line[200];
 if(retroDebugRecord(line,sizeof(line),build,frame,sample,subject))KDebug_Alert(line);
}
#endif
