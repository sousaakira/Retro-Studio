#ifndef RETRO_STUDIO_ACTIONS_H
#define RETRO_STUDIO_ACTIONS_H
#include "retro_core.h"
#define RETRO_RUNTIME_INPUT_VERSION 1
/* Physical masks match SGDK joy.h; no SGDK dependency in this module. */
enum {
 RETRO_BUTTON_UP=1, RETRO_BUTTON_DOWN=2, RETRO_BUTTON_LEFT=4, RETRO_BUTTON_RIGHT=8,
 RETRO_BUTTON_B=16, RETRO_BUTTON_C=32, RETRO_BUTTON_A=64, RETRO_BUTTON_START=128,
 RETRO_BUTTON_Z=256, RETRO_BUTTON_Y=512, RETRO_BUTTON_X=1024, RETRO_BUTTON_MODE=2048,
 RETRO_PAD3_MASK=255, RETRO_PAD6_MASK=4095
};
enum {
 RETRO_ACTION_LEFT, RETRO_ACTION_RIGHT, RETRO_ACTION_UP, RETRO_ACTION_DOWN,
 RETRO_ACTION_JUMP, RETRO_ACTION_ATTACK, RETRO_ACTION_DASH, RETRO_ACTION_TRANSFORM,
 RETRO_ACTION_INTERACT, RETRO_ACTION_MENU, RETRO_ACTION_COUNT
};
typedef struct {
 uint16_t primary, alternate, exclude;
 uint8_t bufferFrames;
} RetroActionBinding;
typedef struct { RetroActionBinding bindings[RETRO_ACTION_COUNT]; } RetroActionMap;
typedef struct {
 uint16_t held, pressed, released, pending;
 uint8_t buffered[RETRO_ACTION_COUNT];
} RetroActions;
/* Zero-initialize each player's state. Update exactly once per video frame.
 * Each nonzero mask is an all-buttons combination; primary OR alternate.
 * A supported, fully held exclude combination suppresses this action.
 * Unsupported combinations never degrade into a smaller combination.
 * bufferFrames includes the press frame; zero still permits consumption this frame.
 */
void retroActionPreset(RetroActionMap *map, uint8_t sixButtons);
void retroActionsUpdate(RetroActions *state, const RetroActionMap *map,
                        uint16_t buttons, uint16_t supportedButtons);
uint8_t retroActionHeld(const RetroActions *state, uint8_t action);
uint8_t retroActionPressed(const RetroActions *state, uint8_t action);
uint8_t retroActionReleased(const RetroActions *state, uint8_t action);
uint8_t retroActionConsume(RetroActions *state, uint8_t action);
signed char retroActionAxis(const RetroActions *state, uint8_t negative, uint8_t positive);
/* Action bits whose nonzero bindings require unsupported buttons. */
uint16_t retroActionUnsupported(const RetroActionMap *map, uint16_t supportedButtons);
#endif
