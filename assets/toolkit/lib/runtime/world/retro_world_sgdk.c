#include "retro_world_sgdk.h"
static const RetroWorldSgdkRoom *bindingFind(const RetroWorldSgdk *b,u16 id){
 u16 i;for(i=0;i<b->roomCount;i++)if(b->rooms[i].room==id)return &b->rooms[i];return 0;
}
/* anyScroll: a renderer room on screen may have changed the horizontal scrolling
 * mode; the next built-in room sets it back when it is drawn. */
static u8 hardwareValid(u8 anyScroll){
 u16 limit=DMA_getMaxTransferSize();
 return (screenWidth==256||screenWidth==320)&&(screenHeight==224||screenHeight==240)&&
  planeWidth==64&&planeHeight==32&&(anyScroll||VDP_getHorizontalScrollingMode()==HSCROLL_PLANE)&&
  VDP_getVerticalScrollingMode()==VSCROLL_PLANE&&DMA_getAutoFlush()&&
  DMA_getBufferSize()>=4096&&DMA_getMaxQueueSize()>=32&&(!limit||limit>=4096);
}
static u8 pairValid(const TileSet *tiles,const MapDefinition *map,const RetroWorldRoom *room){
 return tiles&&map&&tiles->numTile&&tiles->tiles&&map->w&&map->h&&map->hp&&map->hp<=map->h&&
  map->numMetaTile&&map->numBlock&&map->metaTiles&&map->blocks&&map->blockIndexes&&map->blockRowOffsets&&
  (u32)map->w*128>=room->width&&(u32)map->h*128>=room->height;
}
static u8 bindingValid(const RetroWorldSgdkRoom *binding,const RetroWorldRoom *room){
 u16 i;
 if(!binding)return 0;
 if(binding->renderer){
  if(!binding->renderer->prepare||!binding->renderer->draw||!binding->renderer->scroll||!binding->renderer->release||!binding->rendererData||
   binding->backgroundTiles||binding->background||binding->foregroundTiles||binding->foreground)return 0;
 }else if(!pairValid(binding->backgroundTiles,binding->background,room)||
  !((!binding->foregroundTiles&&!binding->foreground)||pairValid(binding->foregroundTiles,binding->foreground,room)))return 0;
 for(i=0;i<4;i++){
  const RetroWorldSgdkPalette *palette=&binding->palettes[i];
  if(!palette->resource){if(palette->offset)return 0;continue;}
  if(!palette->resource->data||(palette->offset&15)||palette->offset>48||
   palette->resource->length<(u32)palette->offset+16)return 0;
 }
 return 1;
}
static u8 vramValid(const RetroWorldSgdkRoom *binding){
 u32 end;
 if(binding->renderer)return 1; /* checked by the renderer against its own range */
 end=(u32)TILE_USER_INDEX+binding->backgroundTiles->numTile+
  (binding->foregroundTiles?binding->foregroundTiles->numTile:0);
 return end<=(u32)TILE_SPRITE_INDEX&&end<=2048;
}
static const TileSet *prepareTiles(const TileSet *source,TileSet **owned){
 if(source->compression==COMPRESSION_NONE)return source;
 *owned=unpackTileSet(source,0);return *owned;
}
static void release(void *context,const RetroWorldRoom *room,void *handle){
 RetroWorldSgdk *b=context;RetroWorldSgdkSlot *slot=handle;(void)room;
 if(b->active==slot){
  /* Drain pending map DMA before clearing owned planes or freeing map RAM. */
  SYS_doVBlankProcess();VDP_clearPlane(BG_A,TRUE);VDP_clearPlane(BG_B,TRUE);
  VDP_setHorizontalScroll(BG_A,0);VDP_setHorizontalScroll(BG_B,0);
  VDP_setVerticalScroll(BG_A,0);VDP_setVerticalScroll(BG_B,0);
  VDP_setHorizontalScrollVSync(BG_A,0);VDP_setHorizontalScrollVSync(BG_B,0);
  VDP_setVerticalScrollVSync(BG_A,0);VDP_setVerticalScrollVSync(BG_B,0);
  if(slot->binding&&slot->binding->renderer)VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
  b->active=0;b->initialized=0;
 }
 if(slot->content&&b->contentHooks.release)b->contentHooks.release(b->contentHooks.context,room,slot->content);
 if(slot->render)slot->binding->renderer->release(slot->render);
 if(slot->foreground)MAP_release(slot->foreground);
 if(slot->background)MAP_release(slot->background);
 if(slot->ownedForeground)MEM_free(slot->ownedForeground);
 if(slot->ownedBackground)MEM_free(slot->ownedBackground);
 *slot=(RetroWorldSgdkSlot){0};
}
static u8 prepare(void *context,const RetroWorldRoom *room,void **handle){
 RetroWorldSgdk *b=context;RetroWorldSgdkSlot *slot;u16 i;
 const RetroWorldSgdkRoom *binding=bindingFind(b,room->id);
 *handle=0;b->lastError=RETRO_WORLD_SGDK_INVALID;
 if(!bindingValid(binding,room))return 0;
 if(!binding->renderer&&!hardwareValid(b->active&&b->active->binding->renderer)){b->lastError=RETRO_WORLD_SGDK_VDP;return 0;}
 if(!vramValid(binding)){b->lastError=RETRO_WORLD_SGDK_VRAM;return 0;}
 for(i=0;i<2&&b->slots[i].used;i++);
 if(i==2){b->lastError=RETRO_WORLD_SGDK_MEMORY;return 0;}
 slot=&b->slots[i];*slot=(RetroWorldSgdkSlot){0};slot->used=1;slot->binding=binding;*handle=slot;
 if(binding->renderer){
  b->lastError=binding->renderer->prepare(binding->rendererData,room,&slot->render);
  if(b->lastError!=RETRO_WORLD_SGDK_OK)return 0;
  goto content;
 }
 b->lastError=RETRO_WORLD_SGDK_MEMORY;
 slot->backgroundTiles=prepareTiles(binding->backgroundTiles,&slot->ownedBackground);
 if(!slot->backgroundTiles)return 0;
 if(binding->foregroundTiles){
  slot->foregroundTiles=prepareTiles(binding->foregroundTiles,&slot->ownedForeground);
  if(!slot->foregroundTiles)return 0;
 }
 slot->background=MAP_create(binding->background,BG_B,TILE_ATTR_FULL(PAL0,FALSE,FALSE,FALSE,TILE_USER_INDEX));
 if(!slot->background)return 0;
 if(binding->foreground){
  slot->foreground=MAP_create(binding->foreground,BG_A,TILE_ATTR_FULL(PAL0,FALSE,FALSE,FALSE,TILE_USER_INDEX+binding->backgroundTiles->numTile));
  if(!slot->foreground)return 0;
 }
content:
 if(b->contentHooks.prepare){
  b->lastError=RETRO_WORLD_SGDK_CONTENT;
  u8 prepared=b->contentHooks.prepare(b->contentHooks.context,room,&slot->content);
  /* Reject borrowed active ownership without freeing the active content. */
  if(slot->content&&b->active&&slot->content==b->active->content){slot->content=0;return 0;}
  if(!prepared)return 0;
 }
 b->lastError=RETRO_WORLD_SGDK_OK;return 1;
}
static s16 worldCameraClamp(s16 value,u16 size,u16 screen){
 s32 maximum=size>screen?(s32)size-screen:0;
 if(value<0)return 0;
 if(value>maximum)return (s16)maximum;
 return value;
}
static void redraw(RetroWorldSgdk *b,RetroWorldSgdkSlot *slot,s16 x,s16 y){
 if(slot->render){
  /* A failed draw cannot be undone here (the previous room is already gone):
   * the status stays in lastError and the room shows what could be drawn. */
  b->lastError=slot->binding->renderer->draw(slot->render,&x,&y);b->cameraX=x;b->cameraY=y;return;
 }
 /* At most 32 entries / 4096 bytes per plane, flush before the next plane. */
 MAP_scrollToEx(slot->background,(u32)x,(u32)y,TRUE);SYS_doVBlankProcess();
 if(slot->foreground){MAP_scrollToEx(slot->foreground,(u32)x,(u32)y,TRUE);SYS_doVBlankProcess();}
 else{VDP_setHorizontalScroll(BG_A,-x);VDP_setVerticalScroll(BG_A,y);}
 b->cameraX=x;b->cameraY=y;
}
static void activate(void *context,const RetroWorldRoom *room,void *handle){
 RetroWorldSgdk *b=context;RetroWorldSgdkSlot *slot=handle;bool enabled;u16 i;
 s16 x=worldCameraClamp((s16)((s32)b->world->x-screenWidth/2),room->width,screenWidth);
 s16 y=worldCameraClamp((s16)((s32)b->world->y-screenHeight/2),room->height,screenHeight);
 SYS_doVBlankProcess();enabled=VDP_getEnable();VDP_setEnable(FALSE);
 if(b->active!=slot){
  /* Prepared tiles are uncompressed; these immediate transfers cannot allocate. */
  if(!slot->render){
   if(VDP_getHorizontalScrollingMode()!=HSCROLL_PLANE)VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
   VDP_loadTileSet(slot->backgroundTiles,TILE_USER_INDEX,DMA);
  }
  if(slot->foregroundTiles)VDP_loadTileSet(slot->foregroundTiles,TILE_USER_INDEX+slot->backgroundTiles->numTile,DMA);
  for(i=0;i<4;i++)if(slot->binding->palettes[i].resource)PAL_setPalette(i,slot->binding->palettes[i].resource->data+slot->binding->palettes[i].offset,DMA);
  VDP_clearPlane(BG_A,TRUE);VDP_clearPlane(BG_B,TRUE);
 }
 b->active=slot;b->lastError=RETRO_WORLD_SGDK_OK;redraw(b,slot,x,y);
 if(b->contentHooks.activate)b->contentHooks.activate(b->contentHooks.context,room,slot->content);
 if(b->onActivate)b->onActivate(b->context,b->world);
 SYS_doVBlankProcess();VDP_setEnable(enabled);
}
static u8 allow(void *context,u16 condition){
 RetroWorldSgdk *b=context;return b->allow?b->allow(b->context,condition):0;
}
u8 retroWorldSgdkInitWithContent(RetroWorldSgdk *b,RetroWorld *world,const RetroWorldDefinition *definition,
 const RetroWorldSgdkRoom *rooms,u16 count,const RetroWorldSgdkContentHooks *content,
 void (*onActivate)(void*,const RetroWorld*),u8 (*condition)(void*,u16),void *context){
 RetroWorldHooks hooks;u16 i,j;u8 result,error;
 if(!b||!world)return RETRO_WORLD_INVALID;
 if(world->busy)return RETRO_WORLD_BUSY;
 if(b->initialized||world->initialized||!rooms||!retroWorldValidate(definition)||count!=definition->roomCount)return RETRO_WORLD_INVALID;
 if(content&&(!content->prepare||!content->activate||!content->release))return RETRO_WORLD_INVALID;
 for(i=0;i<count;i++){
  const RetroWorldRoom *room=0;
  for(j=0;j<definition->roomCount;j++)if(definition->rooms[j].id==rooms[i].room){room=&definition->rooms[j];break;}
  if(!room||!bindingValid(&rooms[i],room))return RETRO_WORLD_INVALID;
  for(j=0;j<i;j++)if(rooms[j].room==rooms[i].room)return RETRO_WORLD_INVALID;
 }
 *b=(RetroWorldSgdk){0};b->world=world;b->rooms=rooms;b->roomCount=count;
 b->onActivate=onActivate;b->allow=condition;b->context=context;b->initialized=1;
 if(content)b->contentHooks=*content;
 hooks=(RetroWorldHooks){prepare,activate,release,allow,b};result=retroWorldInit(world,definition,&hooks);
 if(result!=RETRO_WORLD_OK){error=b->lastError;*b=(RetroWorldSgdk){0};b->lastError=error;}
 return result;
}
u8 retroWorldSgdkInit(RetroWorldSgdk *b,RetroWorld *world,const RetroWorldDefinition *definition,
 const RetroWorldSgdkRoom *rooms,u16 count,void (*onActivate)(void*,const RetroWorld*),u8 (*condition)(void*,u16),void *context){
 return retroWorldSgdkInitWithContent(b,world,definition,rooms,count,0,onActivate,condition,context);
}
u8 retroWorldSgdkScroll(RetroWorldSgdk *b,s16 x,s16 y){
 s16 oldX,oldY,newX,newY;bool enabled;
 if(!b||!b->initialized||!b->world||!b->world->initialized||!b->active)return RETRO_WORLD_SGDK_INVALID;
 if(b->world->busy)return RETRO_WORLD_SGDK_BUSY;
 if(!b->active->render&&!hardwareValid(0))return RETRO_WORLD_SGDK_VDP;
 if(!vramValid(b->active->binding))return RETRO_WORLD_SGDK_VRAM;
 if(DMA_getQueueSize())return RETRO_WORLD_SGDK_QUEUE;
 x=worldCameraClamp(x,b->world->room->width,screenWidth);y=worldCameraClamp(y,b->world->room->height,screenHeight);
 b->world->busy=1;
 oldX=b->cameraX>>4;oldY=b->cameraY>>4;newX=x>>4;newY=y>>4;
 if(newX-oldX>1||oldX-newX>1||newY-oldY>1||oldY-newY>1){
  enabled=VDP_getEnable();VDP_setEnable(FALSE);
  if(b->active->render){VDP_clearPlane(BG_A,TRUE);b->lastError=RETRO_WORLD_SGDK_OK;}
  redraw(b,b->active,x,y);VDP_setEnable(enabled);
  if(b->active->render&&b->lastError!=RETRO_WORLD_SGDK_OK){b->world->busy=0;return b->lastError;}
 }else if(b->active->render){
  u8 status=b->active->binding->renderer->scroll(b->active->render,&x,&y);
  /* A renderer that stopped part of the way (out of tiles) reports where the screen is. */
  if(status==RETRO_WORLD_SGDK_OK||status==RETRO_WORLD_SGDK_VRAM){b->cameraX=x;b->cameraY=y;}
  if(status!=RETRO_WORLD_SGDK_OK){b->world->busy=0;return status;}
 }else{
  MAP_scrollTo(b->active->background,(u32)x,(u32)y);
  if(b->active->foreground)MAP_scrollTo(b->active->foreground,(u32)x,(u32)y);
  b->cameraX=x;b->cameraY=y;
 }
 b->world->busy=0;
 return RETRO_WORLD_SGDK_OK;
}
u8 retroWorldSgdkFree(RetroWorldSgdk *b){
 u8 result;
 if(!b||!b->initialized||!b->world)return RETRO_WORLD_INVALID;
 if(b->world->busy)return RETRO_WORLD_BUSY;
 result=retroWorldFree(b->world);
 if(result==RETRO_WORLD_OK)*b=(RetroWorldSgdk){0};
 return result;
}
