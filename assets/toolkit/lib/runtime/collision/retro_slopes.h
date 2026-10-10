#ifndef RETRO_STUDIO_SLOPES_H
#define RETRO_STUDIO_SLOPES_H
#include "retro_collision.h"
/* Floor heightfield in world pixels, relative to bounds.y. Positive Y is down.
 * No ceiling/side face: use separate solid colliders for those boundaries. */
typedef struct {
 RetroRect bounds;
 uint16_t group;
 uint16_t leftHeight,rightHeight;
} RetroSlope;
/* Samples [left,right), Q8 -> Q8, without mutating output on failure.
 * Endpoint heights must be <= bounds.height. No heap/floating point/int64. */
uint8_t retroSlopeSurface(const RetroSlope *slope,RetroFixed worldX,RetroFixed *surface);
/* Same X-then-Y sweep as retroMoveBody, then floor sampling at body center X.
 * grounded permits following a previously supported surface (or entering at
 * its endpoint height) and snapping down by snap pixels.
 * Pass the previous tick's ground support, not whether jump was just pressed.
 * dy<0 disables floor following. dropPlatforms also skips these floor ramps.
 * Invalid slope data/negative snap rejects the entire move without mutation.
 * A horizontal step that crosses a whole ramp cannot sample that ramp; split
 * such motion in the host. Floor ramps do not depenetrate arbitrary spawns.
 */
RetroMoveResult retroMoveBodySlopes(RetroBody *body,RetroFixed dx,RetroFixed dy,
 const RetroCollider *colliders,uint16_t colliderCount,
 const RetroSlope *slopes,uint16_t slopeCount,int16_t snap,
 uint8_t grounded,uint8_t dropPlatforms);
#endif
