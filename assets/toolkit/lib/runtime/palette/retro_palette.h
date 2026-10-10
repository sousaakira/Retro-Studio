#ifndef RETRO_STUDIO_PALETTE_H
#define RETRO_STUDIO_PALETTE_H
#include "retro_core.h"
#define RETRO_RUNTIME_PALETTE_VERSION 1
#define RETRO_PALETTE_COLORS 64
#define RETRO_PALETTE_MAX_CYCLES 8
/* Colors are VDP words: 0000BBB0GGG0RRR0. Index = palette * 16 + color. */
/* Rotates count colors starting at global index first, one step every frames
 * frames. first and first+count-1 stay inside one palette; color 0 of a palette
 * (transparent in patterns) is never part of a cycle. */
typedef struct {uint8_t first,count,frames,backward;} RetroPaletteCycle;
/* mask: bit n = palette n. out 0 = from black to the palette, 1 = to black. */
typedef struct {uint8_t mask,frames,out;} RetroPaletteFade;
typedef struct {
 const RetroPaletteCycle *cycles;
 uint16_t logical[RETRO_PALETTE_COLORS]; /* base colors with cycles applied */
 uint16_t colors[RETRO_PALETTE_COLORS];  /* what the screen must show (fade applied) */
 uint16_t bright[4];                     /* 0 = black ... 256 = full, per palette */
 uint16_t fadeFrom[4];                   /* brightness when the running fade started */
 uint8_t levels[4][8];                   /* channel level 0-7 at the current brightness */
 uint8_t timers[RETRO_PALETTE_MAX_CYCLES];
 uint8_t cycleCount,active;              /* active: bit n = cycle n running */
 uint8_t fadeMask,fadeFrames,fadeFrame,fadeOut;
 uint8_t dirtyFirst,dirtyLast;           /* inclusive range to send; first > last = nothing */
 uint8_t ready;
} RetroPalette;
/* base: 64 colors. Cycles start stopped; palettes start at full brightness.
 * Returns 0 (and leaves the state not ready) for an invalid cycle table. */
uint8_t retroPaletteInit(RetroPalette *palette,const uint16_t *base,const RetroPaletteCycle *cycles,uint8_t cycleCount);
/* Replaces the base colors of one palette (room change, for example); cycle
 * positions of that palette restart. */
void retroPaletteSet(RetroPalette *palette,uint8_t index,const uint16_t *colors16);
void retroPaletteCycleEnable(RetroPalette *palette,uint8_t cycle,uint8_t on);
/* Sets brightness at once: 0 black, 256 full. */
void retroPaletteBrightness(RetroPalette *palette,uint8_t mask,uint16_t bright);
/* Starts a fade from the brightness each palette has now. A running fade is replaced:
 * palettes the new fade does not name stay at the brightness they had reached.
 * frames 0 applies the end at once. */
void retroPaletteFadeStart(RetroPalette *palette,const RetroPaletteFade *fade);
uint8_t retroPaletteFading(const RetroPalette *palette);
/* Once per frame. Returns 1 when colors changed: send colors[dirtyFirst..dirtyLast]
 * and call retroPaletteSent. */
uint8_t retroPaletteTick(RetroPalette *palette);
void retroPaletteSent(RetroPalette *palette);
#endif
