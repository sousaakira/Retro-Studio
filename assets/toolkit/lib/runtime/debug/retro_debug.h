#ifndef RETRO_STUDIO_DEBUG_H
#define RETRO_STUDIO_DEBUG_H
#include "retro_core.h"
#define RETRO_RUNTIME_DEBUG_VERSION 1
/* In-game diagnostics. Everything here is data and text formatting; reading
 * the hardware belongs to the host (retro_debug_sgdk.h). A value the host
 * could not measure stays unmeasured and is shown as "--": the module never
 * estimates. Production builds do not call this module at all (see the
 * RETRO_PROJECT_DEBUG switch of the generated debug_config.h). */
#define RETRO_DEBUG_LINE 40
#define RETRO_DEBUG_MAX_BOXES 8
enum {RETRO_DEBUG_CPU=1,RETRO_DEBUG_FPS=2,RETRO_DEBUG_DMA=4,RETRO_DEBUG_VRAM=8,RETRO_DEBUG_SPRITES=16};
typedef struct {
 uint16_t measured;                 /* RETRO_DEBUG_* bits actually measured this frame */
 uint16_t cpu,fps;                  /* percent of the frame as the host reports it, frames per second */
 uint16_t dmaQueue,dmaBytes;        /* queued transfers and bytes waiting for VBlank */
 uint16_t vramFree,vramLargest,vramTotal; /* tiles of the measured region */
 uint16_t sprites,vdpSprites;       /* engine sprites, and hardware sprites RESERVED for them (an upper bound) */
} RetroDebugSample;
/* What the game says about one character this frame. */
typedef struct {
 uint16_t state,animation,frame;
 int16_t x,y;                       /* pixels */
 RetroFixed velocityX,velocityY;    /* Q8 pixels per tick */
 uint16_t contacts;                 /* game-defined bits, shown in hexadecimal */
} RetroDebugSubject;
enum {RETRO_DEBUG_BOX_BODY=0,RETRO_DEBUG_BOX_HURT=1,RETRO_DEBUG_BOX_HIT=2,RETRO_DEBUG_BOX_TRIGGER=3};
typedef struct {RetroRect rect;uint8_t kind;} RetroDebugBox;
/* Peaks since the last reset: a spike is visible even if it lasted one frame. */
typedef struct {uint16_t cpu,dmaQueue,dmaBytes,sprites,vdpSprites,vramLowest,frames;} RetroDebugPeaks;
void retroDebugPeaksReset(RetroDebugPeaks *peaks);
void retroDebugPeaksUpdate(RetroDebugPeaks *peaks,const RetroDebugSample *sample);
/* Text lines (ASCII, at most RETRO_DEBUG_LINE-1 characters, always terminated).
 * A field that does not fit is left out whole and the line ends with '>'.
 * build: short identifier of the diagnostic build, shown so a capture can be
 * matched with the ROM that produced it. Return the number of characters. */
uint8_t retroDebugLinePerformance(char *line,const RetroDebugSample *sample,const RetroDebugPeaks *peaks);
uint8_t retroDebugLineMemory(char *line,const RetroDebugSample *sample,const char *build);
uint8_t retroDebugLineSubject(char *line,const RetroDebugSubject *subject);
uint8_t retroDebugLineMotion(char *line,const RetroDebugSubject *subject);
/* One machine-readable record for a debug transport (emulator debug console):
 * "RSD1 b=<build> f=<frame> cpu=.. dma=..,.. vram=..,..,.. spr=..,.. st=.. an=.. x=.. y=.. vx=.. vy=.. ct=..".
 * Unmeasured fields are omitted and the record ends with " ;". A record that
 * does not fit in size bytes is not produced at all (returns 0). */
uint8_t retroDebugRecord(char *line,uint8_t size,const char *build,uint32_t frame,
 const RetroDebugSample *sample,const RetroDebugSubject *subject);
#endif
