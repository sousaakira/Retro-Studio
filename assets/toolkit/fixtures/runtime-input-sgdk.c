/* Issue #44/#53: original diagnostic scene; no recovered ROM assets.
 * One row per action and player: H while held, then how many times the action
 * was pressed and released, and how many buffered jumps were consumed. Counts
 * make one-frame events visible in a screenshot. */
#include <genesis.h>
#include "generated/input_map.h"
#include "retro_runtime/retro_sgdk_input.h"
static RetroActions players[2];
static u16 pressed[2][RETRO_ACTION_COUNT],released[2][RETRO_ACTION_COUNT],consumed[2];
static const char *const names[RETRO_ACTION_COUNT]={"LEFT","RIGHT","UP","DOWN","JUMP","ATTACK","DASH","TRANSF","INTER","MENU"};
int main(void) {
 VDP_drawText("RETRO STUDIO INPUT CHECK",2,1);
 VDP_drawText("ACTION  P1 H PR RL   P2 H PR RL",2,3);
 while(TRUE){
  unsigned i,action;char line[16];
  SYS_doVBlankProcess();
  for(i=0;i<2;i++){
   retroSgdkActionsPoll(&players[i],&retroProjectInputMaps[i],
                       i?JOY_2:JOY_1,retroProjectInputMasks[i]);
   for(action=0;action<RETRO_ACTION_COUNT;action++){
    if(retroActionPressed(&players[i],(u8)action))pressed[i][action]++;
    if(retroActionReleased(&players[i],(u8)action))released[i][action]++;
    sprintf(line,"%c %2u %2u",retroActionHeld(&players[i],(u8)action)?'H':'-',pressed[i][action]%100,released[i][action]%100);
    VDP_drawText(line,(u16)(13+i*13),(u16)(5+action));
    if(!i)VDP_drawText(names[action],2,(u16)(5+action));
   }
   /* Buffered jump: consumed once per press, even if read frames later. */
   if(retroActionConsume(&players[i],RETRO_ACTION_JUMP))consumed[i]++;
   sprintf(line,"%2u",consumed[i]%100);VDP_drawText(line,(u16)(15+i*13),16);
  }
  VDP_drawText("JUMP USED",2,16);
 }
 return 0;
}
