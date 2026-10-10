#ifndef RETRO_STUDIO_CORE_H
#define RETRO_STUDIO_CORE_H
/* SGDK 1.81 defines stdint names as macros; including stdint afterward
 * redeclares its s8 alias. Use those aliases when already supplied by SGDK. */
#if !defined(_TYPES_H_)
#include <stdint.h>
#endif
#define RETRO_RUNTIME_CORE_VERSION 1
#define RETRO_ID_NONE ((uint16_t)0xFFFF)
/* Q8 pixels: 256 units per pixel. Independent of SGDK fix16/fix32 formats. */
typedef int32_t RetroFixed;
#define RETRO_FIXED_ONE ((RetroFixed)256)
typedef struct { int16_t x, y, width, height; } RetroRect;
typedef struct { uint16_t held, pressed, released; } RetroInput;
typedef struct {
    uint16_t frame, remaining;
    uint8_t playing, loop;
} RetroAnimation;
enum { RETRO_ANIM_NONE=0, RETRO_ANIM_FRAME=1, RETRO_ANIM_FINISHED=2 };
void retroInputUpdate(RetroInput *input, uint16_t buttons);
uint8_t retroInputAction(const RetroInput *input, uint16_t mask, uint8_t pressed);
signed char retroInputAxis(const RetroInput *input, uint16_t negative, uint16_t positive);
uint8_t retroRectsOverlap(const RetroRect *a, const RetroRect *b);
void retroAnimationStart(RetroAnimation *state, uint16_t firstDuration, uint8_t loop);
uint8_t retroAnimationTick(RetroAnimation *state, const uint16_t *durations, uint16_t frameCount);
#endif
