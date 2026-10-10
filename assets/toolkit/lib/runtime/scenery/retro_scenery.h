#ifndef RETRO_STUDIO_SCENERY_H
#define RETRO_STUDIO_SCENERY_H
#include "retro_core.h"
#define RETRO_RUNTIME_SCENERY_VERSION 1
/* Scenery streaming for one VDP plane, in portable C (no SGDK): which map cells
 * and which tile patterns must be sent as the camera moves, inside a fixed VRAM
 * range and a per-frame transfer budget. The adapter (retro_scenery_sgdk.h)
 * turns the two callbacks into DMA transfers.
 *
 * Cells and patterns are separate work: a cell is one word in the plane's name
 * table; a pattern is the 32 bytes of an 8x8 tile. A pattern is uploaded only
 * while some cell inside the drawn window uses it, into a slot of the range
 * [firstTile, firstTile+slotCount). Nothing outside that range is ever written. */
#define RETRO_SCENERY_TILE_MASK 0x07FFu
#define RETRO_SCENERY_PATTERN_BYTES 32u
enum {RETRO_SCENERY_OK=0,RETRO_SCENERY_INVALID=1,
 RETRO_SCENERY_CAPACITY=2, /* the window needs more patterns than the range holds */
 RETRO_SCENERY_SINK=3};    /* a callback refused; the stream must be reset */
typedef struct {
 uint16_t width,height;   /* in 8x8 cells */
 uint16_t tileCount;      /* patterns in ROM; cells use ids 0..tileCount-1 */
 const uint16_t *cells;   /* row-major VDP words: priority/palette/flip + pattern id (bits 0-10) */
} RetroSceneryLayer;
typedef struct {
 void *context;
 /* Reserve a transfer of count words starting at plane cell (x,y): to the right
  * (vertical 0) or downwards (vertical 1). Returns the buffer to fill, or 0. */
 uint16_t *(*cells)(void *context,uint16_t x,uint16_t y,uint16_t count,uint8_t vertical);
 /* Send pattern id `tile` of the layer to VRAM tile index `vramTile`. 0 = refused. */
 uint8_t (*pattern)(void *context,uint16_t tile,uint16_t vramTile);
} RetroScenerySink;
/* Transfer allowance for one call (normally one frame). */
typedef struct {uint16_t bytes,entries;} RetroSceneryBudget;
typedef struct {
 const RetroSceneryLayer *layer;
 uint16_t *slotOf;     /* tileCount words: slot of a loaded pattern */
 uint16_t *uses;       /* slotCount words: cells of the window using the slot */
 uint16_t *freeSlots;  /* slotCount words */
 uint16_t firstTile,slotCount,freeCount,peak;
 uint16_t planeWidth,planeHeight; /* cells, powers of two */
 uint16_t viewWidth,viewHeight;   /* pixels */
 uint8_t leadX,keepX,leadY,keepY; /* cells drawn ahead / kept behind the screen */
 int16_t x0,y0,x1,y1;             /* drawn window, in cells: [x0,x1) x [y0,y1) */
 int16_t cameraX,cameraY;         /* camera the window was drawn for */
 uint8_t ready,built;
} RetroSceneryStream;
typedef struct {
 int16_t x,y;            /* camera the screen may use now (<= requested movement) */
 uint16_t bytes,entries; /* queued by this call */
 uint16_t patterns,cells;
 uint8_t status;
 uint8_t complete;       /* the requested camera was reached and its lead is drawn */
} RetroSceneryResult;
/* RAM owned by the caller: slotOf[tileCount], uses[slotCount], freeSlots[slotCount].
 * view: screen size in pixels. plane: 32/64/128 cells per side. */
uint8_t retroSceneryStreamInit(RetroSceneryStream *stream,const RetroSceneryLayer *layer,
 uint16_t *slotOf,uint16_t *uses,uint16_t *freeSlots,uint16_t firstTile,uint16_t slotCount,
 uint16_t planeWidth,uint16_t planeHeight,uint16_t viewWidth,uint16_t viewHeight);
/* Smallest budget that always lets one row or column through. */
RetroSceneryBudget retroSceneryStreamMinimumBudget(const RetroSceneryStream *stream);
/* Largest window the stream may hold, in cells (for capacity planning). */
void retroSceneryStreamWindow(const RetroSceneryStream *stream,uint16_t *width,uint16_t *height);
/* Forget the drawn window (room change, camera jump). Queues nothing: the caller
 * hides the display and advances until `complete`. */
void retroSceneryStreamReset(RetroSceneryStream *stream);
/* Moves the window towards the camera (pixels, clamped to the layer) spending at
 * most `budget`. Rows/columns that do not fit wait for the next call and the
 * returned camera stops at the edge of what is drawn, so the screen never shows
 * a cell that was not sent. */
RetroSceneryResult retroSceneryStreamAdvance(RetroSceneryStream *stream,int16_t cameraX,int16_t cameraY,
 const RetroSceneryBudget *budget,const RetroScenerySink *sink);
/* Panorama scroll for a camera position: factor is 8.8 fixed point
 * (0 = fixed on screen, 256 = moves with the map). */
int16_t retroSceneryPanoramaScroll(int16_t camera,uint16_t factor);
#endif
