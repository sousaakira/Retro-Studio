#ifndef RETRO_STUDIO_MOVEMENT_H
#define RETRO_STUDIO_MOVEMENT_H
#include "retro_slopes.h"
#define RETRO_RUNTIME_MOVEMENT_VERSION 1
/* Q8 pixels/video tick; accelerations Q8 pixels/tick^2. No implicit PAL scaling.
 * All speeds <=32px/tick. Timers include the press/start tick. */
typedef struct {
 RetroFixed walkSpeed,acceleration,deceleration,airAcceleration;
 RetroFixed gravity,jumpSpeed,maxFallSpeed,jumpCutSpeed;
 RetroFixed dashSpeed,wallSlideSpeed,wallJumpX,wallJumpY;
 uint16_t dashTicks,dashCooldownTicks,wallLockTicks,coyoteTicks,jumpBufferTicks;
 int16_t slopeSnap;
 uint8_t airDash;
} RetroMovementConfig;
enum {RETRO_MOVE_JUMP_HELD=1,RETRO_MOVE_JUMP_PRESSED=2,
      RETRO_MOVE_DASH_PRESSED=4,RETRO_MOVE_DROP_HELD=8};
typedef struct {signed char axis;uint8_t buttons;} RetroMovementInput;
typedef struct {
 RetroBody body;
 RetroFixed velocityX,velocityY;
 uint16_t dashRemaining,dashCooldown,wallLock,coyote,jumpBuffer;
 uint8_t grounded,facing,movementFacing,sliding,ready;
 signed char wall,dashDirection;
} RetroMovement;
typedef struct {
 RetroFixed dx,dy;
 uint32_t conditions; /* #54 GROUND=1 MOVING=2 JUMP=4 WALL=16; host adds others. */
 uint8_t contacts,jumped,dashStarted,landed,invalid;
} RetroMovementResult;
/* Original reference defaults, not a recovered game's physics. */
void retroMovementPreset(RetroMovementConfig *config);
uint8_t retroMovementValidate(const RetroMovementConfig *config);
/* Initialization does not depenetrate a spawn. Caller owns immutable terrain.
 * Invalid initialization/tick preserves the entire instance. Zero before init. */
uint8_t retroMovementInit(RetroMovement *state,const RetroBody *body);
/* One tick per video frame. When slopes exist, uses <=1px substeps for their
 * heightfield sampler. Flat terrain uses the swept solver in one step.
 * No allocation/callbacks/SGDK dependency. Jump/dash edges come from the host.
 * DROP ignores platforms/ramps while held; solids stay solid. Wall slide needs
 * falling + input toward wall, and faces away only while sliding. */
RetroMovementResult retroMovementTick(RetroMovement *state,const RetroMovementConfig *config,
 RetroMovementInput input,const RetroCollider *colliders,uint16_t colliderCount,
 const RetroSlope *slopes,uint16_t slopeCount);
#endif
