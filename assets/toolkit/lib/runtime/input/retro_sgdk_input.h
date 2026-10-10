#ifndef RETRO_STUDIO_SGDK_INPUT_H
#define RETRO_STUDIO_SGDK_INPUT_H
#include <genesis.h>
#include "retro_actions.h"
/* Poll once per frame after SGDK's normal VBlank joypad update.
 * Detection is JOY_init/reset based (SGDK 1.81), not an independent hotplug service.
 * Unknown/non-pad devices release held actions and clear pending buffers.
 */
static inline void retroSgdkActionsPoll(RetroActions *state, const RetroActionMap *map,
                                        uint16_t joy, uint16_t configuredMask) {
 uint8_t i,type=JOY_getJoypadType(joy);
 uint16_t supported=type==JOY_TYPE_PAD6?RETRO_PAD6_MASK:
                    type==JOY_TYPE_PAD3?RETRO_PAD3_MASK:0;
 supported=(uint16_t)(supported & configuredMask);
 retroActionsUpdate(state,map,supported?JOY_readJoypad(joy):0,supported);
 if(state && !supported){
  state->pending=0;
  for(i=0;i<RETRO_ACTION_COUNT;i++)state->buffered[i]=0;
 }
}
#endif
