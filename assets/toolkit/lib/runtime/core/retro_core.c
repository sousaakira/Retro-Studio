#include "retro_core.h"
void retroInputUpdate(RetroInput *input, uint16_t buttons) {
    if (!input) return;
    input->pressed = (uint16_t)(buttons & (uint16_t)~input->held);
    input->released = (uint16_t)(input->held & (uint16_t)~buttons);
    input->held = buttons;
}
uint8_t retroInputAction(const RetroInput *input, uint16_t mask, uint8_t pressed) {
    if (!input || !mask || (input->held & mask) != mask) return 0;
    return (uint8_t)(!pressed || (input->pressed & mask) != 0);
}
signed char retroInputAxis(const RetroInput *input, uint16_t negative, uint16_t positive) {
    if (!input) return 0;
    return (signed char)(((input->held & positive) != 0) - ((input->held & negative) != 0));
}
uint8_t retroRectsOverlap(const RetroRect *a, const RetroRect *b) {
    if (!a || !b || a->width <= 0 || a->height <= 0 || b->width <= 0 || b->height <= 0) return 0;
    return (uint8_t)((int32_t)a->x < (int32_t)b->x + b->width &&
        (int32_t)a->x + a->width > b->x && (int32_t)a->y < (int32_t)b->y + b->height &&
        (int32_t)a->y + a->height > b->y);
}
void retroAnimationStart(RetroAnimation *state, uint16_t firstDuration, uint8_t loop) {
    if (!state) return;
    state->frame = 0; state->remaining = firstDuration ? firstDuration : 1;
    state->playing = 1; state->loop = (uint8_t)(loop != 0);
}
uint8_t retroAnimationTick(RetroAnimation *state, const uint16_t *durations, uint16_t frameCount) {
    if (!state || !state->playing) return RETRO_ANIM_NONE;
    if (!durations || !frameCount || state->frame >= frameCount) {
        state->playing = 0; return RETRO_ANIM_FINISHED;
    }
    if (state->remaining > 1) { state->remaining--; return RETRO_ANIM_NONE; }
    if ((uint32_t)state->frame + 1 >= frameCount) {
        if (!state->loop) { state->playing = 0; state->remaining = 0; return RETRO_ANIM_FINISHED; }
        state->frame = 0;
    } else state->frame++;
    state->remaining = durations[state->frame] ? durations[state->frame] : 1;
    return RETRO_ANIM_FRAME;
}
