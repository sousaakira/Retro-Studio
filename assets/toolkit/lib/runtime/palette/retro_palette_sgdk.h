#ifndef RETRO_STUDIO_PALETTE_SGDK_H
#define RETRO_STUDIO_PALETTE_SGDK_H
#include <genesis.h>
#include "retro_palette.h"
/* SGDK 1.81. Call once per frame before SYS_doVBlankProcess(): changed colors go
 * to CRAM through the DMA queue, flushed in the vertical blank. The colors array
 * belongs to the state, so it is still valid when the queue is sent.
 * A full DMA queue refuses the transfer; the colors then stay marked and are sent
 * on a later frame instead of being lost.
 * Do not use SGDK's own fades (PAL_fadeIn/Out...) on the same palettes: they keep a
 * copy of the colors and write it over these. Colors set directly with
 * PAL_setPalette/PAL_setColors are overwritten only when this module next changes
 * them; use retroPaletteSet to change a palette so that cycles and fades follow it. */
/* Returns the number of colors queued this frame (0 = nothing changed or queue full). */
static inline uint8_t retroPaletteSgdkUpdate(RetroPalette *palette){
 uint8_t count=0;
 if(retroPaletteTick(palette)){
  count=(uint8_t)(palette->dirtyLast-palette->dirtyFirst+1);
  if(DMA_queueDma(DMA_CRAM,(void*)&palette->colors[palette->dirtyFirst],(u16)(palette->dirtyFirst*2),count,2))retroPaletteSent(palette);
  else count=0;
 }
 return count;
}
/* First load (or after the screen was rebuilt): queues the 64 colors. Returns 0 when
 * the state is not ready or the queue is full (call again on the next frame). */
static inline uint8_t retroPaletteSgdkLoad(RetroPalette *palette){
 if(!palette->ready||!DMA_queueDma(DMA_CRAM,(void*)palette->colors,0,RETRO_PALETTE_COLORS,2))return 0;
 retroPaletteSent(palette);
 return 1;
}
#endif
