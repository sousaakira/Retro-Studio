#include "retro_enemy_sgdk.h"
static u16 clock;

/* O runtime decide o quadro; o motor de sprites do SGDK não avança sozinho. */
static void frameChanged(Sprite *sprite) {sprite->timer=0;}

static uint8_t activate(void *context,RetroEnemy *enemy) {
 const RetroEnemyDefinition *d=enemy->def;
 Sprite *sprite;u16 animation=retroEnemyAnimation(enemy);
 (void)context;
 if(!d->visual)return 0;
 sprite=SPR_addSprite((const SpriteDefinition*)d->visual,-128,-128,TILE_ATTR(d->palette,FALSE,FALSE,enemy->facingLeft));
 if(!sprite)return 0;
 SPR_setFrameChangeCallback(sprite,frameChanged);
 SPR_setVisibility(sprite,HIDDEN);
 if(animation!=RETRO_ENEMY_NO_ANIMATION){SPR_setAnimAndFrame(sprite,animation,0);sprite->timer=0;}
 enemy->visual=sprite;
 return 1;
}
static void deactivate(void *context,RetroEnemy *enemy) {
 (void)context;
 if(enemy->visual)SPR_releaseSprite((Sprite*)enemy->visual);
 enemy->visual=0;
}

uint8_t retroEnemySgdkInit(RetroEnemyPool *pool,const RetroEnemyDefinition *definitions,
 uint16_t definitionCount,uint8_t maxActive,uint8_t *defeated,uint16_t defeatedCount) {
 RetroEnemyHooks hooks={activate,deactivate,0};
 clock=0;
 return retroEnemyInit(pool,definitions,definitionCount,maxActive,defeated,defeatedCount,hooks);
}

void retroEnemySgdkDraw(RetroEnemyPool *pool,s16 cameraX,s16 cameraY) {
 u16 i;
 if(!pool)return;
 clock++;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++) {
  RetroEnemy *e=&pool->actors[i];Sprite *sprite=(Sprite*)e->visual;
  const RetroEnemyDefinition *d;u16 animation;s16 x,y;u8 blink;
  if(e->state==RETRO_ENEMY_FREE||!sprite)continue;
  d=e->def;animation=retroEnemyAnimation(e);
  /* Sem animação de morte: pisca até sumir. Invulnerável: pisca a cada 4 ticks. */
  blink=(e->invulnerable&&(clock&4))||(e->state==RETRO_ENEMY_DYING&&animation==RETRO_ENEMY_NO_ANIMATION&&(clock&2));
  if(animation==RETRO_ENEMY_NO_ANIMATION)animation=d->animations[RETRO_ENEMY_ROLE_IDLE].animation;
  if(e->roleChanged){SPR_setAnimAndFrame(sprite,animation,e->animation.frame);sprite->timer=0;}
  else if(e->frameChanged){SPR_setFrame(sprite,e->animation.frame);sprite->timer=0;}
  SPR_setHFlip(sprite,e->facingLeft);
  x=retroEnemyX(e)-cameraX-(e->facingLeft?d->frameWidth-d->anchorX:d->anchorX);
  y=retroEnemyY(e)-cameraY-d->anchorY;
  if(blink||x>=screenWidth||y>=screenHeight||x+d->frameWidth<=0||y+d->frameHeight<=0)
   SPR_setVisibility(sprite,HIDDEN);
  else {SPR_setVisibility(sprite,AUTO_FAST);SPR_setPosition(sprite,x,y);}
 }
}

u16 retroEnemySgdkTileBudget(const RetroEnemyDefinition *definitions,uint16_t count,uint8_t maxActive) {
 u16 i,largest=0;
 for(i=0;i<count;i++) {
  const SpriteDefinition *sprite=(const SpriteDefinition*)definitions[i].visual;
  if(sprite&&sprite->maxNumTile>largest)largest=sprite->maxNumTile;
 }
 return (u16)(largest*(u16)maxActive);
}
