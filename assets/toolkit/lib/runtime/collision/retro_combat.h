#ifndef RETRO_STUDIO_COMBAT_H
#define RETRO_STUDIO_COMBAT_H
#include "retro_core.h"
/* Up to 32 stable victim slots per encounter. Host owns slot allocation.
 * A victim is hit at most once per attack instance; reset only with Begin. */
typedef struct {
 uint32_t victims;
 uint16_t age,start,end,mask;
 uint8_t running;
} RetroAttackState;
typedef struct {uint16_t health,invulnerable,group;} RetroCombatant;
enum {RETRO_DAMAGE_NONE=0,RETRO_DAMAGE_HIT=1,RETRO_DAMAGE_DEFEATED=2};
typedef void (*RetroDamageCallback)(void *context,uint8_t result,uint16_t damage,
                                   RetroFixed impulseX,RetroFixed impulseY);
uint8_t retroAttackBegin(RetroAttackState *attack,uint16_t start,uint16_t end,uint16_t mask);
void retroAttackTick(RetroAttackState *attack);
void retroCombatTick(RetroCombatant *actor);
/* Evaluate before Tick. Window [start,end); each tick is one video frame.
 * Failed hits do not claim a victim: invulnerability can expire within a window.
 * Independent world-space attack/hurt boxes; mirror/position them in the host.
 * Callback supplies gameplay reaction; no velocity/audio/sprite side effects here.
 */
uint8_t retroAttackApply(RetroAttackState *attack,const RetroRect *attackBox,
                        RetroCombatant *target,const RetroRect *hurtBox,
                        uint8_t victimSlot,uint16_t damage,uint16_t invulnerability,
                        RetroFixed impulseX,RetroFixed impulseY,
                        RetroDamageCallback callback,void *context);
#endif
