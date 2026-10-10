#ifndef RETRO_STUDIO_WORLD_SGDK_H
#define RETRO_STUDIO_WORLD_SGDK_H
#include <genesis.h>
#include "retro_world.h"
#define RETRO_RUNTIME_WORLD_SGDK_VERSION 3
typedef struct {
 /* Optional host content staged together with map resources. prepare must not
  * alter visible state, queue DMA or flush sprites; newly allocated sprites
  * must stay hidden until activate. A non-null handle is owned even on failure.
  * activate must not fail or allocate. release frees only its handle, including
  * a failed destination, and must never reset the sprite engine/current room.
  * All callbacks run with world busy and must not reenter its mutation API. */
 u8 (*prepare)(void *context,const RetroWorldRoom *room,void **handle);
 void (*activate)(void *context,const RetroWorldRoom *room,void *handle);
 void (*release)(void *context,const RetroWorldRoom *room,void *handle);
 void *context;
} RetroWorldSgdkContentHooks;
/* Optional replacement for the built-in room drawing (resident tileset + SGDK
 * MAP on BG_B/BG_A). A room that names a renderer hands it both planes; the
 * bridge keeps palettes, hooks, camera clamping and room changes.
 * Every function returns a RETRO_WORLD_SGDK_* status. */
typedef struct {
 /* Allocate what the room needs. No visible change, no DMA. A non-null state
  * is owned by the bridge even on failure and goes to release. */
 u8 (*prepare)(const void *data,const RetroWorldRoom *room,void **state);
 /* Display disabled, both planes clear, DMA queue empty: load and draw for the
  * camera. Calls SYS_doVBlankProcess to flush its transfers (with the display
  * off SGDK does not wait for the real VBlank). Writes back the camera shown. */
 u8 (*draw)(void *state,s16 *x,s16 *y);
 /* Once per frame, first DMA producer. May move less than asked (transfer
  * budget): writes back the camera actually shown. */
 u8 (*scroll)(void *state,s16 *x,s16 *y);
 void (*release)(void *state);
} RetroWorldSgdkRenderer;
/* Compiled resources are immutable and live as long as the bridge.
 * BG_B is scenery, BG_A is foreground. Map attributes keep priority/palette.
 * NULL palette slots are owned by the host (e.g. PAL1 for the character). */
typedef struct {
 const Palette *resource;
 u16 offset; /* 0/16/32/48 colors into a compiled palette, or NULL/0 */
} RetroWorldSgdkPalette;
typedef struct {
 u16 room;
 const TileSet *backgroundTiles;
 const MapDefinition *background;
 const TileSet *foregroundTiles;
 const MapDefinition *foreground; /* both foreground pointers NULL => no layer */
 RetroWorldSgdkPalette palettes[4]; /* slot index is its CRAM palette */
 /* Since version 3, at the end so older generated tables still compile: when
  * renderer is set the four map pointers above must be NULL. */
 const RetroWorldSgdkRenderer *renderer;
 const void *rendererData;
} RetroWorldSgdkRoom;
typedef struct {
 const RetroWorldSgdkRoom *binding;
 Map *background,*foreground;
 const TileSet *backgroundTiles,*foregroundTiles;
 TileSet *ownedBackground,*ownedForeground;
 void *content;
 void *render; /* renderer state */
 u8 used;
} RetroWorldSgdkSlot;
typedef struct RetroWorldSgdk {
 RetroWorld *world;
 const RetroWorldSgdkRoom *rooms;u16 roomCount;
 RetroWorldSgdkSlot slots[2],*active;
 s16 cameraX,cameraY;
 /* Infalible callback: apply world pixel feet/facing to host player/camera.
  * Called with world busy; do not call its mutation API from this callback. */
 void (*onActivate)(void *context,const RetroWorld *world);
 u8 (*allow)(void *context,u16 condition);
 void *context;
 RetroWorldSgdkContentHooks contentHooks;
 u8 initialized,lastError;
} RetroWorldSgdk;
enum {RETRO_WORLD_SGDK_OK=0,RETRO_WORLD_SGDK_INVALID=1,
 RETRO_WORLD_SGDK_VRAM=2,RETRO_WORLD_SGDK_MEMORY=3,
 RETRO_WORLD_SGDK_VDP=4,RETRO_WORLD_SGDK_QUEUE=5,RETRO_WORLD_SGDK_BUSY=6,
 RETRO_WORLD_SGDK_CONTENT=7};
/* Zero-initialize bridge and world. Init/transition return RetroWorld statuses;
 * lastError distinguishes VDP/VRAM/memory preparation failures.
 * Host first configures H32/H40, 64x32 planes, plane scrolling, DMA auto-flush,
 * >=32 queue entries, >=4096-byte DMA buffer and >=4096 transfer limit (or 0).
 * Host owns SPR_init/update and reservations; bridge never resets sprites.
 * Activation blocks for VBlanks while display is disabled; not for interrupts.
 * VBlank callbacks/interrupt DMA producers must skip their work while
 * world->busy is true, so owned redraws have an empty queue/temp buffer.
 * No main.c, game manager or exporter is replaced by installing this module. */
u8 retroWorldSgdkInit(RetroWorldSgdk *bridge,RetroWorld *world,
 const RetroWorldDefinition *definition,const RetroWorldSgdkRoom *rooms,u16 count,
 void (*onActivate)(void*,const RetroWorld*),u8 (*allow)(void*,u16),void *context);
/* Same initialization with optional content hooks, copied by value. If supplied,
 * all three callbacks are required. onActivate runs after content activation,
 * before releasing the previous room. Null content preserves the original API. */
u8 retroWorldSgdkInitWithContent(RetroWorldSgdk *bridge,RetroWorld *world,
 const RetroWorldDefinition *definition,const RetroWorldSgdkRoom *rooms,u16 count,
 const RetroWorldSgdkContentHooks *content,
 void (*onActivate)(void*,const RetroWorld*),u8 (*allow)(void*,u16),void *context);
/* Call once per video tick BEFORE SPR_update/other DMA producers, with an empty
 * queue; host then calls SYS_doVBlankProcess before the next call.
 * Camera clamps to room bounds. Adjacent metatiles use SGDK ring streaming;
 * jumps >1 metatile use blocking full redraw, like room activation.
 * World mutations and bridge calls are guarded during blocking VBlanks.
 * Returns a RetroWorldSgdk status. Built-in rooms: failures leave camera/maps
 * unchanged. Renderer rooms: RETRO_WORLD_SGDK_VRAM means the renderer stopped
 * part of the way and cameraX/Y hold the position on screen; a failed jump
 * redraw leaves what could be drawn and its status in lastError. */
u8 retroWorldSgdkScroll(RetroWorldSgdk *bridge,s16 x,s16 y);
/* Core retroWorldFree also releases this bridge's handles and deactivates it. */
u8 retroWorldSgdkFree(RetroWorldSgdk *bridge);
#endif
