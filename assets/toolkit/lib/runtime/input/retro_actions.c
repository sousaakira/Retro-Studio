#include "retro_actions.h"
static uint16_t actionBit(uint8_t action) {
 return action < RETRO_ACTION_COUNT ? (uint16_t)(1u << action) : 0;
}
static uint8_t combination(uint16_t mask, uint16_t buttons, uint16_t supported) {
 return (uint8_t)(mask && !(mask & (uint16_t)~supported) && (buttons & mask)==mask);
}
void retroActionPreset(RetroActionMap *map, uint8_t sixButtons) {
 uint8_t i;
 if(!map)return;
 for(i=0;i<RETRO_ACTION_COUNT;i++){
  map->bindings[i].primary=0;map->bindings[i].alternate=0;map->bindings[i].exclude=0;map->bindings[i].bufferFrames=0;
 }
 map->bindings[RETRO_ACTION_LEFT].primary=RETRO_BUTTON_LEFT;
 map->bindings[RETRO_ACTION_RIGHT].primary=RETRO_BUTTON_RIGHT;
 map->bindings[RETRO_ACTION_UP].primary=RETRO_BUTTON_UP;
 map->bindings[RETRO_ACTION_DOWN].primary=RETRO_BUTTON_DOWN;
 map->bindings[RETRO_ACTION_JUMP].primary=RETRO_BUTTON_B;
 map->bindings[RETRO_ACTION_JUMP].bufferFrames=4;
 map->bindings[RETRO_ACTION_ATTACK].primary=RETRO_BUTTON_A;
 map->bindings[RETRO_ACTION_DASH].primary=RETRO_BUTTON_C;
 if(!sixButtons)map->bindings[RETRO_ACTION_DASH].exclude=RETRO_BUTTON_DOWN;
 map->bindings[RETRO_ACTION_TRANSFORM].primary=sixButtons?RETRO_BUTTON_X:(RETRO_BUTTON_DOWN|RETRO_BUTTON_C);
 map->bindings[RETRO_ACTION_INTERACT].primary=sixButtons?RETRO_BUTTON_Y:RETRO_BUTTON_UP;
 map->bindings[RETRO_ACTION_MENU].primary=RETRO_BUTTON_START;
}
void retroActionsUpdate(RetroActions *state, const RetroActionMap *map,
                        uint16_t buttons, uint16_t supportedButtons) {
 uint8_t i;uint16_t held=0, previous;
 if(!state)return;
 previous=state->held;
 for(i=0;i<RETRO_ACTION_COUNT;i++){
  uint16_t bit=actionBit(i);
  if(state->buffered[i])state->buffered[i]--;
  if(!state->buffered[i])state->pending=(uint16_t)(state->pending & (uint16_t)~bit);
  if(map && !combination(map->bindings[i].exclude,buttons,supportedButtons) && (combination(map->bindings[i].primary,buttons,supportedButtons) ||
             combination(map->bindings[i].alternate,buttons,supportedButtons)))held|=bit;
 }
 state->held=held;
 state->pressed=(uint16_t)(held & (uint16_t)~previous);
 state->released=(uint16_t)(previous & (uint16_t)~held);
 for(i=0;i<RETRO_ACTION_COUNT;i++)if(state->pressed & actionBit(i)){
  state->pending|=actionBit(i);state->buffered[i]=map->bindings[i].bufferFrames;
 }
}
uint8_t retroActionHeld(const RetroActions *state,uint8_t action) {
 return (uint8_t)(state && (state->held & actionBit(action))!=0);
}
uint8_t retroActionPressed(const RetroActions *state,uint8_t action) {
 return (uint8_t)(state && (state->pressed & actionBit(action))!=0);
}
uint8_t retroActionReleased(const RetroActions *state,uint8_t action) {
 return (uint8_t)(state && (state->released & actionBit(action))!=0);
}
uint8_t retroActionConsume(RetroActions *state,uint8_t action) {
 uint16_t bit=actionBit(action);
 if(!state || !bit || !(state->pending & bit))return 0;
 state->pending=(uint16_t)(state->pending & (uint16_t)~bit);
 state->buffered[action]=0;return 1;
}
signed char retroActionAxis(const RetroActions *state,uint8_t negative,uint8_t positive) {
 return (signed char)(retroActionHeld(state,positive)-retroActionHeld(state,negative));
}
uint16_t retroActionUnsupported(const RetroActionMap *map,uint16_t supportedButtons) {
 uint8_t i;uint16_t result=0;
 if(!map)return 0;
 for(i=0;i<RETRO_ACTION_COUNT;i++)if(
  (map->bindings[i].primary & (uint16_t)~supportedButtons) ||
  (map->bindings[i].alternate & (uint16_t)~supportedButtons) ||
  (map->bindings[i].exclude & (uint16_t)~supportedButtons))result|=actionBit(i);
 return result;
}
