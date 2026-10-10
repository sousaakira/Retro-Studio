#ifndef RETRO_STUDIO_CHARACTER_H
#define RETRO_STUDIO_CHARACTER_H
#include "retro_core.h"
#define RETRO_RUNTIME_CHARACTER_VERSION 1
#define RETRO_CHARACTER_MAX_STATES 128
#define RETRO_CHARACTER_MAX_TRANSITIONS 512
#define RETRO_CHARACTER_MAX_EVENTS 2048

typedef struct {
    uint16_t width, height;
    int16_t anchorX, anchorY;
    uint8_t flipH, flipV;
} RetroCharacterPose;
typedef struct {
    uint16_t frame, type, argument;
} RetroCharacterEvent;
enum { RETRO_CHARACTER_SOUND=1, RETRO_CHARACTER_ATTACK=2,
       RETRO_CHARACTER_PROJECTILE=3, RETRO_CHARACTER_TRANSFORM=4,
       RETRO_CHARACTER_CUSTOM=5 };
typedef struct {
    uint16_t id, animationId, frameCount;
    const uint16_t *durations;
    const RetroCharacterPose *poses;
    const RetroCharacterEvent *events;
    uint16_t eventCount;
    uint8_t loop, interruptible;
} RetroCharacterState;
typedef struct {
    uint16_t from, to;
    uint32_t requireAll, requireNone;
    uint16_t minimumTicks, predicate;
    int16_t priority;
    uint8_t requireFinished;
} RetroCharacterTransition;
typedef struct {
    const RetroCharacterState *states;
    uint16_t stateCount;
    const RetroCharacterTransition *transitions;
    uint16_t transitionCount;
} RetroCharacterDefinition;
typedef struct {
    void *context;
    uint8_t (*condition)(void *, uint16_t predicate);
    void (*enter)(void *, uint16_t previous, uint16_t current);
    void (*pose)(void *, uint16_t state, uint16_t animation, uint16_t frame,
                 const RetroCharacterPose *pose);
    void (*event)(void *, uint16_t state, const RetroCharacterEvent *event);
} RetroCharacterHost;
typedef struct {
    const RetroCharacterDefinition *definition;
    RetroCharacterHost host;
    RetroAnimation animation;
    uint16_t stateIndex, elapsed;
    uint8_t ready, busy;
} RetroCharacter;
uint8_t retroCharacterValidate(const RetroCharacterDefinition *definition);
/* Zero the instance before first init. Definitions remain immutable while used. */
uint8_t retroCharacterInit(RetroCharacter *, const RetroCharacterDefinition *,
                           uint16_t initialState, const RetroCharacterHost *);
/* Explicit override for custom game controllers; restarts even the same state. */
uint8_t retroCharacterSetState(RetroCharacter *, uint16_t state);
/* Call once after drawing the current pose. At most one transition per tick. */
uint8_t retroCharacterTick(RetroCharacter *, uint32_t conditions);
uint16_t retroCharacterStateId(const RetroCharacter *);
#endif
