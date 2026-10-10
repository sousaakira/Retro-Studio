#include "retro_scenery_sgdk.h"
#define TABLE_ROWS 30
typedef struct {
 const RetroScenerySgdkRoom *room;
 RetroSceneryLayer layer;
 RetroSceneryStream stream;
 u16 firstTile,panoramaTiles,slots,rows;
 s16 scrollA[TABLE_ROWS],scrollB[TABLE_ROWS]; /* stay valid until the queued DMA runs */
 s16 shownX;
 u16 peakBytes,peakEntries,frameBytes,frameEntries,held;
 u8 drawn;
} State;
static u16 *sinkCells(void *context,u16 x,u16 y,u16 count,u8 vertical){
 (void)context;
 return DMA_allocateAndQueueDma(DMA_VRAM,VDP_getPlaneAddress(BG_A,x,y),count,vertical?(u16)(planeWidth*2):2);
}
static u8 sinkPattern(void *context,u16 tile,u16 vramTile){
 State *s=context;
 return DMA_queueDma(DMA_VRAM,(void*)(s->room->tiles->tiles+(u32)tile*8),(u16)(vramTile*32),16,2);
}
static u8 panoramaValid(const RetroSceneryPanorama *p,u16 rows){
 u16 i,next=0;
 if(!p->tiles||!p->tiles->tiles||!p->tiles->numTile||p->tiles->compression!=COMPRESSION_NONE||!p->cells||!p->cells->tilemap||
  p->cells->compression!=COMPRESSION_NONE||p->cells->w!=64||p->cells->h!=32||!p->bands||!p->bandCount||p->bandCount>8||
  (p->bandCount>1&&p->factorY))return 0;
 for(i=0;i<p->bandCount;i++){
  if(p->bands[i].firstRow!=next||!p->bands[i].rows)return 0;
  next=(u16)(next+p->bands[i].rows);
 }
 return next>=rows&&next<=32;
}
static u8 prepare(const void *data,const RetroWorldRoom *room,void **handle){
 const RetroScenerySgdkRoom *r=data;State *s;RetroSceneryBudget minimum;u16 first,end,limit,*memory;u32 budgetEnd;
 *handle=0;
 if(!r||!r->tiles||!r->tiles->tiles||!r->tiles->numTile||r->tiles->compression!=COMPRESSION_NONE||!r->cells||!r->cells->tilemap||
  r->cells->compression!=COMPRESSION_NONE||(u32)r->cells->w*8<room->width||(u32)r->cells->h*8<room->height||
  (r->panorama&&!panoramaValid(r->panorama,(u16)(screenHeight/8))))return RETRO_WORLD_SGDK_INVALID;
 limit=DMA_getMaxTransferSize();
 if(!(screenWidth==256||screenWidth==320)||!(screenHeight==224||screenHeight==240)||planeWidth!=64||planeHeight!=32||
  VDP_getVerticalScrollingMode()!=VSCROLL_PLANE||!DMA_getAutoFlush()||DMA_getBufferSize()<r->dmaBytes||
  DMA_getMaxQueueSize()<(u16)(r->dmaEntries+6)||(limit&&limit<r->dmaBytes))return RETRO_WORLD_SGDK_VDP;
 first=r->firstTile?r->firstTile:TILE_USER_INDEX;
 budgetEnd=r->tileBudget?(u32)first+r->tileBudget:(u32)TILE_SPRITE_INDEX;
 if(first<TILE_USER_INDEX||budgetEnd>(u32)TILE_SPRITE_INDEX||budgetEnd<=first)return RETRO_WORLD_SGDK_VRAM;
 end=(u16)budgetEnd;
 if(r->panorama&&(u32)first+r->panorama->tiles->numTile>=end)return RETRO_WORLD_SGDK_VRAM;
 s=MEM_alloc(sizeof *s);
 if(!s)return RETRO_WORLD_SGDK_MEMORY;
 *handle=s;*s=(State){0};s->room=r;s->firstTile=first;s->rows=(u16)(screenHeight/8);
 s->panoramaTiles=r->panorama?r->panorama->tiles->numTile:0;
 s->slots=(u16)(end-first-s->panoramaTiles);
 /* Known before the room appears: it would run out of tiles somewhere along the way. */
 if(s->slots<r->minimumSlots)return RETRO_WORLD_SGDK_VRAM;
 /* A slot is never needed for a pattern that does not exist. */
 if(s->slots>r->tiles->numTile)s->slots=r->tiles->numTile;
 s->layer.width=r->cells->w;s->layer.height=r->cells->h;s->layer.tileCount=r->tiles->numTile;s->layer.cells=r->cells->tilemap;
 memory=MEM_alloc((u32)2*(r->tiles->numTile+2u*s->slots));
 if(!memory)return RETRO_WORLD_SGDK_MEMORY;
 if(retroSceneryStreamInit(&s->stream,&s->layer,memory,memory+r->tiles->numTile,memory+r->tiles->numTile+s->slots,
  (u16)(first+s->panoramaTiles),s->slots,planeWidth,planeHeight,(u16)screenWidth,(u16)screenHeight)!=RETRO_SCENERY_OK){
  s->stream.slotOf=memory;return RETRO_WORLD_SGDK_INVALID;
 }
 minimum=retroSceneryStreamMinimumBudget(&s->stream);
 if(r->dmaBytes<minimum.bytes||r->dmaEntries<minimum.entries)return RETRO_WORLD_SGDK_QUEUE;
 return RETRO_WORLD_SGDK_OK;
}
static void applyScroll(State *s,s16 x,s16 y,u8 now){
 const RetroSceneryPanorama *p=s->room->panorama;u16 i,row;u8 changed=!s->drawn||x!=s->shownX;
 if(p&&p->bandCount>1){
  /* Tile scrolling: one value per 8-pixel row and plane. The bands need factorY 0,
   * so the rows of the screen and of the plane coincide. */
  if(changed){
   for(row=0;row<s->rows;row++)s->scrollA[row]=(s16)-x;
   for(i=0;i<p->bandCount;i++){
    s16 value=(s16)-retroSceneryPanoramaScroll(x,p->bands[i].factorX);
    for(row=p->bands[i].firstRow;row<p->bands[i].firstRow+p->bands[i].rows&&row<s->rows;row++)s->scrollB[row]=value;
   }
   VDP_setHorizontalScrollTile(BG_A,0,s->scrollA,s->rows,now?DMA:DMA_QUEUE);
   VDP_setHorizontalScrollTile(BG_B,0,s->scrollB,s->rows,now?DMA:DMA_QUEUE);
  }
 }else{
  s16 panorama=p?(s16)-retroSceneryPanoramaScroll(x,p->bands[0].factorX):0;
  if(now){VDP_setHorizontalScroll(BG_A,(s16)-x);VDP_setHorizontalScroll(BG_B,panorama);}
  else{VDP_setHorizontalScrollVSync(BG_A,(s16)-x);VDP_setHorizontalScrollVSync(BG_B,panorama);}
 }
 if(now){VDP_setVerticalScroll(BG_A,y);VDP_setVerticalScroll(BG_B,p?retroSceneryPanoramaScroll(y,p->factorY):0);}
 else{VDP_setVerticalScrollVSync(BG_A,y);VDP_setVerticalScrollVSync(BG_B,p?retroSceneryPanoramaScroll(y,p->factorY):0);}
 s->shownX=x;s->drawn=1;
}
/* Display disabled, planes clear, DMA queue empty. */
static u8 draw(void *handle,s16 *x,s16 *y){
 State *s=handle;const RetroSceneryPanorama *p=s->room->panorama;RetroSceneryBudget budget;RetroScenerySink sink={s,sinkCells,sinkPattern};RetroSceneryResult r;u16 guard=0;
 VDP_setScrollingMode(p&&p->bandCount>1?HSCROLL_TILE:HSCROLL_PLANE,VSCROLL_PLANE);
 if(p){
  VDP_loadTileSet(p->tiles,s->firstTile,DMA);
  VDP_setTileMapEx(BG_B,p->cells,TILE_ATTR_FULL(PAL0,FALSE,FALSE,FALSE,s->firstTile),0,0,0,0,64,32,DMA);
 }
 /* The whole window, a frame's worth at a time: the same path as scrolling. */
 budget.bytes=s->room->dmaBytes;budget.entries=s->room->dmaEntries;
 /* A full restart: also the way back after a refused transfer left the stream unusable. */
 if(retroSceneryStreamInit(&s->stream,&s->layer,s->stream.slotOf,s->stream.uses,s->stream.freeSlots,(u16)(s->firstTile+s->panoramaTiles),s->slots,
  planeWidth,planeHeight,(u16)screenWidth,(u16)screenHeight)!=RETRO_SCENERY_OK)return RETRO_WORLD_SGDK_INVALID;
 s->drawn=0;
 do{
  r=retroSceneryStreamAdvance(&s->stream,*x,*y,&budget,&sink);
  SYS_doVBlankProcess();
 }while(r.status==RETRO_SCENERY_OK&&!r.complete&&++guard<512);
 /* The camera of the result is only meaningful when the stream ran (OK or out of slots). */
 if(r.status!=RETRO_SCENERY_OK&&r.status!=RETRO_SCENERY_CAPACITY)return RETRO_WORLD_SGDK_INVALID;
 *x=r.x;*y=r.y;
 applyScroll(s,r.x,r.y,1);
 if(r.status==RETRO_SCENERY_CAPACITY)return RETRO_WORLD_SGDK_VRAM;
 return r.complete?RETRO_WORLD_SGDK_OK:RETRO_WORLD_SGDK_INVALID;
}
static u8 scroll(void *handle,s16 *x,s16 *y){
 State *s=handle;RetroSceneryBudget budget;RetroScenerySink sink={s,sinkCells,sinkPattern};RetroSceneryResult r;s16 wantX=*x,wantY=*y;
 budget.bytes=s->room->dmaBytes;budget.entries=s->room->dmaEntries;
 r=retroSceneryStreamAdvance(&s->stream,*x,*y,&budget,&sink);
 if(r.status!=RETRO_SCENERY_OK&&r.status!=RETRO_SCENERY_CAPACITY)return RETRO_WORLD_SGDK_INVALID;
 /* Out of slots part of the way: what was queued belongs to the camera reached, so the
  * scroll follows it and the screen stays consistent; the error tells the game it stopped. */
 *x=r.x;*y=r.y;applyScroll(s,r.x,r.y,0);
 if(r.status==RETRO_SCENERY_CAPACITY)return RETRO_WORLD_SGDK_VRAM;
 s->frameBytes=r.bytes;s->frameEntries=r.entries;
 if(r.bytes>s->peakBytes)s->peakBytes=r.bytes;
 if(r.entries>s->peakEntries)s->peakEntries=r.entries;
 if((r.x!=wantX||r.y!=wantY)&&s->held<0xFFFF)s->held++;
 return RETRO_WORLD_SGDK_OK;
}
static void release(void *handle){
 State *s=handle;
 if(!s)return;
 if(s->stream.slotOf)MEM_free(s->stream.slotOf);
 MEM_free(s);
}
const RetroWorldSgdkRenderer retroScenerySgdkRenderer={prepare,draw,scroll,release};
void retroScenerySgdkStats(const RetroWorldSgdk *bridge,RetroScenerySgdkStats *stats){
 const State *s;
 if(!stats)return;
 *stats=(RetroScenerySgdkStats){0};
 if(!bridge||!bridge->active||!bridge->active->binding||bridge->active->binding->renderer!=&retroScenerySgdkRenderer||!bridge->active->render)return;
 s=bridge->active->render;
 stats->slots=s->slots;stats->slotsUsed=(u16)(s->slots-s->stream.freeCount);stats->slotsPeak=s->stream.peak;
 stats->frameBytes=s->frameBytes;stats->frameEntries=s->frameEntries;stats->peakBytes=s->peakBytes;stats->peakEntries=s->peakEntries;stats->held=s->held;
}
