#ifndef RETRO_STUDIO_PROGRESS_SGDK_H
#define RETRO_STUDIO_PROGRESS_SGDK_H
#include <genesis.h>
#include "retro_progress.h"
/* SGDK 1.81 SRAM: 8-bit, odd addresses from 0x200001. The ROM header must
 * declare it ("RA", 0xF820, start, end), as SGDK's default rom_head.c does.
 * SRAM is mapped only inside each call, with interrupts disabled, because it
 * replaces the ROM above 2 MiB while mapped: an interrupt handler reading ROM
 * there would read SRAM. Music or samples the Z80 driver fetches from above
 * 2 MiB can still glitch during a save; keep them below or save in silence.
 * Do not call from an interrupt handler. */
static uint8_t retroProgressSgdkRead(void *context,uint16_t offset,uint8_t *bytes,uint16_t count){
 (void)context;SYS_disableInts();SRAM_enableRO();
 while(count--)*bytes++=SRAM_readByte(offset++);
 SRAM_disable();SYS_enableInts();return 1;
}
static uint8_t retroProgressSgdkWrite(void *context,uint16_t offset,const uint8_t *bytes,uint16_t count){
 (void)context;SYS_disableInts();SRAM_enable();
 while(count--)SRAM_writeByte(offset++,*bytes++);
 SRAM_disable();SYS_enableInts();return 1;
}
/* size: SRAM bytes of the cartridge (for example 8192 for a 64 kbit chip). */
static inline RetroProgressStorage retroProgressSgdkStorage(uint16_t size){
 RetroProgressStorage storage={retroProgressSgdkRead,retroProgressSgdkWrite,0,size};
 return storage;
}
#endif
