#ifndef RETRO_STUDIO_COLLISION_H
#define RETRO_STUDIO_COLLISION_H
#include "retro_core.h"
#define RETRO_RUNTIME_COLLISION_VERSION 1
enum {RETRO_COLLIDER_SOLID=1,RETRO_COLLIDER_PLATFORM=2};
/* Directional face mask matches TMX TOP=1 BOTTOM=2 LEFT=4 RIGHT=8.
 * kind = RETRO_COLLIDER_DIRECTIONAL | faces; legacy kinds stay unchanged.
 * Only RETRO_COLLIDER_PLATFORM allows dropPlatforms, including when a
 * directional collider exposes TOP alone. */
#define RETRO_COLLIDER_DIRECTIONAL 16
enum {RETRO_CONTACT_LEFT=1,RETRO_CONTACT_RIGHT=2,RETRO_CONTACT_FLOOR=4,RETRO_CONTACT_CEILING=8};
typedef struct {RetroRect box;uint16_t group;uint8_t kind;} RetroCollider;
typedef struct {RetroFixed x,y;RetroRect box;uint16_t mask;} RetroBody;
typedef struct {RetroFixed dx,dy;uint8_t contacts,invalid;} RetroMoveResult;
/* Inclusive zero-based animation frame window, independent of tick duration. */
typedef struct {RetroRect box;uint16_t firstFrame,lastFrame;uint8_t enabled;} RetroFrameBox;
/* Local feet-relative rectangle -> world pixels. Q8 origins round toward -inf.
 * Flips mirror around feet on each axis. Invalid/out-of-domain input leaves
 * result unchanged; aliased local/result is supported. No camera offset. */
uint8_t retroWorldRect(const RetroRect *local,RetroFixed feetX,RetroFixed feetY,
                       uint8_t flipH,uint8_t flipV,RetroRect *result);
/* Returns false outside the inclusive window or for disabled/invalid boxes;
 * result is unchanged on false. Call with current controller animation.frame. */
uint8_t retroFrameWorldRect(const RetroFrameBox *box,uint16_t frame,
                            RetroFixed feetX,RetroFixed feetY,
                            uint8_t flipH,uint8_t flipV,RetroRect *result);
/* Mirror a local body/attack/hurt rectangle around its origin, independently
 * from artwork dimensions. Returns false if mirrored coordinates cannot fit. */
uint8_t retroMirrorRect(const RetroRect *local,uint8_t flip,RetroRect *result);
/* Swept X, then swept Y; no allocation. Coordinates/displacements are Q8.
 * Supported origin domain [-32768,32767] pixels. Reject invalid/out-of-domain
 * bodies; clamp displacement to this domain. Rectangles have positive extents.
 * Does not depenetrate an overlapping spawn, handle ramps or moving platforms.
 * Floor contacts require downward movement/probe; dy=0 does not retain contacts.
 * Platform collision is downward-only, from above; dropPlatforms skips it.
 */
RetroMoveResult retroMoveBody(RetroBody *body,RetroFixed dx,RetroFixed dy,
                               const RetroCollider *colliders,uint16_t count,
                               uint8_t dropPlatforms);
#endif
