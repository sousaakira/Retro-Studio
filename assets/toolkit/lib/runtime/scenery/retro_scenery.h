#ifndef RETRO_STUDIO_SCENERY_H
#define RETRO_STUDIO_SCENERY_H
#include "retro_core.h"
#define RETRO_RUNTIME_SCENERY_VERSION 3
/* Scenery streaming for one VDP plane, in portable C (no SGDK): which map cells
 * and which tile patterns must be sent as the camera moves, inside a fixed VRAM
 * range and a per-frame transfer budget. The adapter (retro_scenery_sgdk.h)
 * turns the two callbacks into DMA transfers.
 *
 * Cells and patterns are separate work: a cell is one word in the plane's name
 * table; a pattern is the 32 bytes of an 8x8 tile. A pattern is uploaded only
 * while some cell inside the drawn window uses it, into a slot of the range
 * [firstTile, firstTile+slotCount). Nothing outside that range is ever written.
 *
 * Version 2: the pattern of a cell may come from a separate 16-bit vector, so a
 * room is no longer limited to the 2048 patterns a VDP word addresses (only the
 * window on screen has to fit the VRAM range). A second plane may scroll with the
 * first one, sharing the same range: a pattern used by both is sent once.
 *
 * Version 3: a margin (retroSceneryStreamSetMargin) draws extra columns of the LAST plane on
 * both sides of the window, only in a range of rows, so those lines may be shifted sideways
 * (drift bands, below) without showing cells that were not sent. The rest of the window is
 * exactly as before: the margin costs only the patterns of those rows. Without a margin
 * nothing changes. */
#define RETRO_SCENERY_TILE_MASK 0x07FFu
/* Pattern id of a cell with nothing drawn: the cell points at VRAM tile 0 (blank). */
#define RETRO_SCENERY_EMPTY 0xFFFFu
#define RETRO_SCENERY_PATTERN_BYTES 32u
enum {RETRO_SCENERY_OK=0,RETRO_SCENERY_INVALID=1,
 RETRO_SCENERY_CAPACITY=2, /* the window needs more patterns than the range holds */
 RETRO_SCENERY_SINK=3};    /* a callback refused; the stream must be reset */
typedef struct {
 uint16_t width,height;   /* in 8x8 cells */
 uint16_t tileCount;      /* patterns in ROM; cells use ids 0..tileCount-1 */
 const uint16_t *cells;   /* row-major VDP words: priority/palette/flip + pattern id (bits 0-10) */
 /* Since version 2, at the end so older initializers still compile. */
 const uint16_t *patterns;     /* NULL, or the pattern id of each cell (bits 0-10 of cells are then
                                * ignored): any id below tileCount (up to 65535) or RETRO_SCENERY_EMPTY */
 const uint16_t *backCells;    /* NULL, or a second plane of the same size and scroll */
 const uint16_t *backPatterns; /* its ids, as patterns; NULL = bits 0-10 of backCells */
} RetroSceneryLayer;
typedef struct {
 void *context;
 /* Reserve a transfer of count words starting at plane cell (x,y): to the right
  * (vertical 0) or downwards (vertical 1). plane 0 = cells, 1 = backCells.
  * Returns the buffer to fill, or 0. */
 uint16_t *(*cells)(void *context,uint8_t plane,uint16_t x,uint16_t y,uint16_t count,uint8_t vertical);
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
 /* A line entering the window is drawn one plane at a time (one plane per transfer unit):
  * planes of the line already sent while the others wait for budget. */
 int16_t partialAt,partialFrom,partialTo;
 uint8_t partialVertical,partialPlanes;
 /* Since version 3, at the end. */
 uint8_t marginX;                 /* margin columns beyond each side of the screen */
 int16_t marginTop,marginBottom;  /* rows of the last plane that have the margin: [top,bottom) */
 /* Margin drawn outside the window, last plane only: left part columns [leftX,x0) and rows
  * [leftY0,leftY1); right part columns [x1,rightX) and rows [rightY0,rightY1). */
 int16_t leftX,leftY0,leftY1,rightX,rightY0,rightY1;
} RetroSceneryStream;
typedef struct {
 int16_t x,y;            /* camera the screen may use now (<= requested movement) */
 uint16_t bytes,entries; /* queued by this call */
 uint16_t patterns,cells;
 uint8_t status;
 uint8_t complete;       /* the requested camera was reached and its lead is drawn */
} RetroSceneryResult;
/* RAM owned by the caller: slotOf[tileCount], uses[slotCount], freeSlots[slotCount].
 * Without a patterns vector tileCount is at most 2048.
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
/* Version 3. Draws `cells` extra columns beyond each side of the screen on the last plane
 * (backCells when there are two), in cell rows [firstRow,endRow) only (call after Init, before
 * the first Advance; it resets the window). The screen, both margins and what is kept behind
 * must fit the plane: RETRO_SCENERY_INVALID otherwise. cells 0 = no margin. The screen does
 * not move until the margin of the next position is drawn, like the rest of the window. */
uint8_t retroSceneryStreamSetMargin(RetroSceneryStream *stream,uint8_t cells,uint16_t firstRow,uint16_t endRow);
/* Smallest margin, in cells, for lines shifted by up to period-1 pixels. */
uint8_t retroSceneryDriftMargin(uint16_t period);

/* Drift bands (version 3): lines of the back plane that slide sideways at their own speed,
 * like water currents, while the plane still moves with the map. A band is a range of WORLD
 * rows, so it follows the camera vertically at any position (not only multiples of 8). The
 * art must repeat every `period` pixels horizontally: the shift wraps there. */
typedef struct {
 uint16_t top,bottom; /* world pixels, [top,bottom) */
 int16_t speed;       /* pixels per second, 8.8 fixed point; positive moves right */
 uint16_t period;     /* 1..RETRO_SCENERY_DRIFT_MAX_PERIOD */
} RetroSceneryDrift;
#define RETRO_SCENERY_DRIFT_MAX_PERIOD 128u
/* Phase of a band: position inside the period in 1/(256*hz) pixel units, so the same pixels
 * per second come out at 50 and 60 Hz with no rounding drift. Start at 0. */
typedef uint32_t RetroSceneryDriftPhase;
/* Advances a phase by `frames` video frames at `hz` (50 or 60). */
RetroSceneryDriftPhase retroSceneryDriftAdvance(const RetroSceneryDrift *drift,RetroSceneryDriftPhase phase,uint16_t frames,uint8_t hz);
/* Horizontal shift of the band, in pixels, to add to the map scroll (-cameraX): the plane
 * shows world x - shift. The same visual shift (modulo the period) is given as a value >= 0
 * (needs cells left of the camera) or < 0 (cells to the right), whichever the room has at
 * this camera; |shift| < period. */
int16_t retroSceneryDriftShift(const RetroSceneryDrift *drift,RetroSceneryDriftPhase phase,uint8_t hz,int16_t cameraX);
/* Line scroll tables for `lines` screen lines: map = -cameraX on every line of both planes,
 * plus the shift of the first band containing the world row cameraY+line on the back plane.
 * map or back may be NULL (that table is not written). shifts[i] belongs to drifts[i]. */
void retroSceneryLineScroll(int16_t *map,int16_t *back,uint16_t lines,int16_t cameraX,int16_t cameraY,
 const RetroSceneryDrift *drifts,const int16_t *shifts,uint16_t count);
#endif
