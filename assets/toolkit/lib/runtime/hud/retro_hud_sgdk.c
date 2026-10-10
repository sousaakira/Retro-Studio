#include "retro_hud_sgdk.h"
static VDPPlane planeOf(u8 plane){return plane==0?WINDOW:plane==1?BG_A:BG_B;}
static void band(RetroHudSgdk *h){
 const RetroHudDefinition *d=h->hud.definition;RetroHudBand b=d->hudBand;u16 total=(u16)(screenHeight/8),key;
 if(h->config.plane!=0)return;
 if(retroHudOverlayVisible(&h->hud)){
  /* Only the rows of the menu or dialogue on screen: from the top down to its last
   * row, or from its first row to the bottom, whichever hides less of plane A. */
  u16 top=(u16)(h->hud.overlayRow+h->hud.overlayRows),bottom=(u16)(total-h->hud.overlayRow);
  b.bottom=bottom<top;b.rows=(u8)(b.bottom?bottom:top);
 }
 key=(u16)(1+b.bottom*64+b.rows);
 if(h->band==key)return;
 /* A HUD made only of sprites never touches the window of the game. */
 if(!b.rows&&!h->band){h->band=key;return;}
 h->band=key;
 if(!b.rows)VDP_setWindowVPos(FALSE,0);
 else if(b.bottom)VDP_setWindowVPos(TRUE,(u16)(total-b.rows));
 else VDP_setWindowVPos(FALSE,b.rows);
}
static void sprites(RetroHudSgdk *h,u32 changed){
 const RetroHudDefinition *d=h->hud.definition;u16 i,next=0;u8 glyphs[40],k;
 for(i=0;i<d->elementCount&&next<h->spriteCount;i++){
  const RetroHudElement *e=&d->elements[i];
  if(!e->sprite)continue;
  if(!(changed&((u32)1<<i))){next=(u16)(next+e->width);continue;}
  retroHudElementGlyphs(&h->hud,i,glyphs);
  for(k=0;k<e->width&&next<h->spriteCount;k++,next++){
   Sprite *s=h->sprites[next];u8 frame=h->config.spriteFrames[glyphs[k]];
   /* Glyphs without pixels (the space) are not in the sheet. */
   if(frame==0xFF||frame>=h->config.sheet->animations[0]->numFrame){SPR_setVisibility(s,HIDDEN);continue;}
   SPR_setVisibility(s,VISIBLE);SPR_setAnimAndFrame(s,0,frame);
  }
 }
}
void retroHudSgdkColors(const RetroHudSgdk *h){
 u16 i;
 if(!h||!h->ready)return;
 /* Only the colours the font uses: the rest of the palette stays the game's. */
 if(h->config.fontTiles){for(i=1;i<16;i++)if(h->config.colorMask&(1u<<i))PAL_setColor((u16)(h->config.palette*16+i),h->config.colors[i]);}
 else PAL_setColor((u16)(h->config.palette*16+15),h->config.colors[1]);
}
u8 retroHudSgdkInit(RetroHudSgdk *h,const RetroHudDefinition *d,const RetroHudHost *host,u8 *cells,u8 *overlayCells,const RetroHudSgdkConfig *config){
 u16 i,count=0;u8 k;
 if(!h)return 0;
 h->ready=0;
 if(!config||config->plane>2||config->palette>3||!config->colors||!retroHudInit(&h->hud,d,host,cells,overlayCells)||config->glyphCount!=d->glyphCount)return 0;
 for(i=0;i<d->elementCount;i++)if(d->elements[i].sprite)count=(u16)(count+d->elements[i].width);
 if(count>RETRO_HUD_SGDK_MAX_SPRITES||(count&&(!config->sheet||!config->fontTiles||!config->spriteFrames||!config->sheet->numAnimation)))return 0;
 h->config=*config;h->band=0;h->spriteCount=0;
 if(!h->config.cellsPerFrame)h->config.cellsPerFrame=64;
 /* Sprites first: if they cannot be created nothing else has been touched. */
 for(i=0;i<d->elementCount;i++){
  const RetroHudElement *e=&d->elements[i];
  if(!e->sprite)continue;
  for(k=0;k<e->width;k++){
   Sprite *s=SPR_addSprite(config->sheet,(s16)(e->x+k*8),e->y,TILE_ATTR(config->palette,config->priority?TRUE:FALSE,FALSE,FALSE));
   if(!s){while(h->spriteCount)SPR_releaseSprite(h->sprites[--h->spriteCount]);return 0;}
   SPR_setDepth(s,SPR_MIN_DEPTH);SPR_setVisibility(s,HIDDEN);
   h->sprites[h->spriteCount++]=s;
  }
 }
 if(config->fontTiles)VDP_loadTileData(config->fontTiles,TILE_FONT_INDEX,config->glyphCount,DMA);
 h->attribute=TILE_ATTR_FULL(config->palette,config->priority?TRUE:FALSE,FALSE,FALSE,TILE_FONT_INDEX);
 /* On a scenery plane the cells around the elements belong to the game. */
 if(config->plane!=0)retroHudAssumeClear(&h->hud);
 h->ready=1;
 retroHudSgdkColors(h);
 return 1;
}
void retroHudSgdkUpdate(RetroHudSgdk *h){
 RetroHudWrite w;u16 written=0;VDPPlane plane;u32 changed;
 if(!h||!h->ready)return;
 plane=planeOf(h->config.plane);
 retroHudTick(&h->hud);
 changed=h->hud.changed;h->hud.changed=0;
 band(h);
 while(written<h->config.cellsPerFrame&&retroHudNext(&h->hud,&w)){
  VDP_setTileMapXY(plane,w.glyph==RETRO_HUD_CLEAR?0:(u16)(h->attribute+w.glyph),w.col,w.row);written++;
 }
 /* The band follows the overlay being closed only after its cells are erased. */
 band(h);
 if(h->spriteCount&&changed)sprites(h,changed);
}
void retroHudSgdkFree(RetroHudSgdk *h){
 if(!h||!h->ready)return;
 while(h->spriteCount)SPR_releaseSprite(h->sprites[--h->spriteCount]);
 if(h->config.plane==0&&h->band>1)VDP_setWindowVPos(FALSE,0);
 h->ready=0;
}
