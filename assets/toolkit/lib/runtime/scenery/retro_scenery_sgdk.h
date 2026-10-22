#ifndef RETRO_STUDIO_SCENERY_SGDK_H
#define RETRO_STUDIO_SCENERY_SGDK_H
#include <genesis.h>
#include "retro_scenery.h"
#include "retro_world_sgdk.h"
#define RETRO_RUNTIME_SCENERY_SGDK_VERSION 3
/* Room renderer for the world bridge: one map layer streamed on BG_A (cells and
 * tile patterns sent as the camera moves) and, on BG_B, an optional panorama or
 * (version 2) a second streamed layer that scrolls with the map.
 *
 * VRAM: the room owns the tiles [firstTile, firstTile+tileBudget). The panorama
 * patterns stay loaded at the start of the range; the rest are streaming slots.
 * Nothing outside the range is written, and the range must end at or before
 * TILE_SPRITE_INDEX (sprites) — prepare refuses the room otherwise.
 * DMA: each frame queues at most dmaBytes/dmaEntries for the map, plus the
 * horizontal scroll table when a panorama has more than one band.
 *
 * Version 3: drift bands on the second layer (water currents). The room switches to line
 * scrolling: BG_A and the rest of BG_B follow the map, the lines of each band slide at the
 * band's speed. BG_B gets `marginX` extra columns on each side of the window, only in the
 * rows of the bands, so the shifted lines never show undrawn cells (the rest of the window,
 * and its VRAM, is as without bands). The animation runs on the frame counter: call
 * retroScenerySgdkTick every frame (also when the camera does not move). */
typedef struct {
 u16 factorX;        /* 8.8: 0 = fixed on screen, 256 = moves with the map */
 u16 firstRow,rows;  /* band of the screen, in 8-pixel rows */
} RetroSceneryBand;
typedef struct {
 const TileSet *tiles;   /* uncompressed */
 const TileMap *cells;   /* exactly 64x32: the whole plane, already repeated */
 const RetroSceneryBand *bands; /* top to bottom, covering every screen row once */
 u16 bandCount;          /* 1..8; more than one requires factorY 0 */
 u16 factorY;            /* 8.8, whole plane */
} RetroSceneryPanorama;
typedef struct {
 const TileSet *tiles;   /* uncompressed: patterns are sent straight from ROM */
 const TileMap *cells;   /* the whole room (BG_A), one word per 8x8 cell */
 const RetroSceneryPanorama *panorama; /* or NULL */
 u16 firstTile;          /* 0 = TILE_USER_INDEX */
 u16 tileBudget;         /* 0 = everything up to TILE_SPRITE_INDEX */
 u16 minimumSlots;       /* most patterns a drawn window of this room holds (from the exporter) */
 u16 dmaBytes,dmaEntries;/* per-frame allowance for the map */
 /* Version 2, at the end so tables generated before still compile. */
 const u16 *patterns;    /* NULL, or the pattern of each cell of `cells` (no 2048 limit; see
                          * RETRO_SCENERY_EMPTY); the pattern bits of `cells` are then ignored */
 const TileMap *back;    /* NULL, or a second layer on BG_B, same size; not with a panorama */
 const u16 *backPatterns;/* its patterns, as `patterns` */
 /* Version 3, at the end. */
 const RetroSceneryDrift *drifts; /* NULL, or bands of `back` (world rows), top to bottom */
 u16 driftCount;                  /* 0..8 */
 u16 marginX;                     /* BG_B columns drawn beyond each side, in the band rows: at least
                                   * retroSceneryDriftMargin(period) of every band */
} RetroScenerySgdkRoom;
/* Put &retroScenerySgdkRenderer and a RetroScenerySgdkRoom in the room binding.
 * Host configuration is the bridge's (64x32 planes, DMA auto-flush); the
 * renderer switches the horizontal scrolling mode itself. */
extern const RetroWorldSgdkRenderer retroScenerySgdkRenderer;
/* Counters of the room on screen, for the diagnostic HUD (0 when there is none). */
typedef struct {u16 slots,slotsUsed,slotsPeak,frameBytes,frameEntries,peakBytes,peakEntries,held;} RetroScenerySgdkStats;
void retroScenerySgdkStats(const RetroWorldSgdk *bridge,RetroScenerySgdkStats *stats);
/* Version 3: advances the drift bands of the room on screen and queues their line scroll.
 * Call once per frame AFTER retroWorldSgdkScroll (the bridge wants an empty DMA queue) and
 * before SYS_doVBlankProcess, including frames where the camera did not move. A frame already
 * handled by the scroll costs nothing; rooms without bands, other renderers and a busy world
 * are ignored. Same pixels per second at 50 and 60 Hz. */
void retroScenerySgdkTick(RetroWorldSgdk *bridge);
#endif
