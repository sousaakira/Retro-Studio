#include "retro_combat.h"
uint8_t retroAttackBegin(RetroAttackState *attack,uint16_t start,uint16_t end,uint16_t mask){
 if(!attack)return 0;
 attack->victims=0;attack->age=0;attack->start=start;attack->end=end;attack->mask=mask;
 attack->running=(uint8_t)(end>start && mask!=0);
 return attack->running;
}
void retroAttackTick(RetroAttackState *attack){
 if(!attack||!attack->running)return;
 if(attack->age<65535)attack->age++;
 if(attack->age>=attack->end)attack->running=0;
}
void retroCombatTick(RetroCombatant *actor){
 if(actor&&actor->invulnerable)actor->invulnerable--;
}
uint8_t retroAttackApply(RetroAttackState *attack,const RetroRect *attackBox,
                        RetroCombatant *target,const RetroRect *hurtBox,
                        uint8_t victimSlot,uint16_t damage,uint16_t invulnerability,
                        RetroFixed impulseX,RetroFixed impulseY,
                        RetroDamageCallback callback,void *context){
 uint32_t bit;uint8_t result;
 if(!attack||!target||!damage||!target->health||target->invulnerable||
    !attack->running||attack->age<attack->start||attack->age>=attack->end||
    victimSlot>=32||!(attack->mask&target->group)||
    !retroRectsOverlap(attackBox,hurtBox))return RETRO_DAMAGE_NONE;
 bit=((uint32_t)1)<<victimSlot;
 if(attack->victims&bit)return RETRO_DAMAGE_NONE;
 attack->victims|=bit;
 target->health=target->health>damage?(uint16_t)(target->health-damage):0;
 target->invulnerable=invulnerability;
 result=target->health?RETRO_DAMAGE_HIT:RETRO_DAMAGE_DEFEATED;
 if(callback)callback(context,result,damage,impulseX,impulseY);
 return result;
}
