#include "retro_enemy.h"
/* Estado de cada instância da sala (spawnState). ARMED: pode ativar; some ao
 * desativar um inimigo vivo e volta quando o ponto de origem sai da área de
 * ativação, para o inimigo não reaparecer na frente do jogador. */
enum {SPAWN_IDLE=0,SPAWN_ACTIVE=1,SPAWN_DEFEATED=2,SPAWN_COUNTDOWN=3};
#define SPAWN_ARMED 0x80
#define SPAWN_STATE(value) ((uint8_t)((value)&0x7F))
/* Desativar mais longe do que ativar evita liga/desliga na borda da área. */
#define DEACTIVATE_SLACK 64
#define FALL_LIMIT 64
#define EDGE_PROBE 6
#define SLOPE_SNAP 4

static uint8_t validDefinition(const RetroEnemyDefinition *d) {
 uint16_t i;
 if(!d||d->behavior==RETRO_ENEMY_BEHAVIOR_NONE||d->behavior>=RETRO_ENEMY_BEHAVIOR_COUNT||!d->health||
  d->speed<0||d->gravity<0||d->maxFall<0||d->body.width<=0||d->body.height<=0||
  d->hurt.width<=0||d->hurt.height<=0)return 0;
 for(i=0;i<RETRO_ENEMY_ROLE_COUNT;i++) {
  const RetroEnemyAnimation *a=&d->animations[i];
  if(a->frameCount&&!a->durations)return 0;
  if(a->animation!=RETRO_ENEMY_NO_ANIMATION&&!a->frameCount)return 0;
 }
 return d->animations[RETRO_ENEMY_ROLE_IDLE].animation!=RETRO_ENEMY_NO_ANIMATION;
}

uint8_t retroEnemyInit(RetroEnemyPool *pool,const RetroEnemyDefinition *definitions,
 uint16_t definitionCount,uint8_t maxActive,uint8_t *defeated,uint16_t defeatedCount,
 RetroEnemyHooks hooks) {
 uint16_t i;
 if(!pool||(!definitions&&definitionCount)||!maxActive||(defeatedCount&&!defeated))return RETRO_ENEMY_INVALID;
 for(i=0;i<definitionCount;i++)if(!validDefinition(&definitions[i]))return RETRO_ENEMY_INVALID;
 {
  /* Zera sem memset: o runtime não depende da libc. */
  uint8_t *bytes=(uint8_t*)pool;uint32_t n;
  for(n=0;n<sizeof(*pool);n++)bytes[n]=0;
 }
 pool->definitions=definitions;pool->definitionCount=definitionCount;
 pool->maxActive=maxActive>RETRO_ENEMY_POOL_MAX?RETRO_ENEMY_POOL_MAX:maxActive;
 pool->defeated=defeated;pool->defeatedCount=defeatedCount;pool->hooks=hooks;
 retroEnemyResetDefeated(pool);
 return RETRO_ENEMY_OK;
}

void retroEnemyResetDefeated(RetroEnemyPool *pool) {
 uint16_t i;
 if(!pool||!pool->defeated)return;
 for(i=0;i<(pool->defeatedCount+7)/8;i++)pool->defeated[i]=0;
}

static void release(RetroEnemyPool *pool,RetroEnemy *enemy) {
 if(enemy->state==RETRO_ENEMY_FREE)return;
 if(pool->hooks.deactivate)pool->hooks.deactivate(pool->hooks.context,enemy);
 enemy->visual=0;enemy->state=RETRO_ENEMY_FREE;
 if(pool->activeCount)pool->activeCount--;
}

void retroEnemyClear(RetroEnemyPool *pool) {
 uint16_t i;
 if(!pool)return;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++)release(pool,&pool->actors[i]);
 pool->spawns=0;pool->spawnCount=0;pool->colliders=0;pool->colliderCount=0;
 pool->slopes=0;pool->slopeCount=0;pool->activeCount=0;pool->deferred=0;
}

static uint8_t defeatedBit(const RetroEnemyPool *pool,uint16_t uid) {
 return pool->defeated&&uid<pool->defeatedCount&&(pool->defeated[uid>>3]&(1<<(uid&7)));
}

uint8_t retroEnemyEnterRoom(RetroEnemyPool *pool,const RetroEnemySpawn *spawns,uint16_t count,
 const RetroCollider *colliders,uint16_t colliderCount,const RetroSlope *slopes,uint16_t slopeCount,
 int16_t roomWidth,int16_t roomHeight) {
 uint16_t i;
 if(!pool)return RETRO_ENEMY_INVALID;
 retroEnemyClear(pool);
 if(count>RETRO_ENEMY_ROOM_SPAWN_MAX)return RETRO_ENEMY_TOO_MANY;
 if((count&&!spawns)||(colliderCount&&!colliders)||(slopeCount&&!slopes)||roomWidth<=0||roomHeight<=0)return RETRO_ENEMY_INVALID;
 for(i=0;i<count;i++)if(spawns[i].definition>=pool->definitionCount||spawns[i].respawn>RETRO_ENEMY_RESPAWN_DELAY)
  return RETRO_ENEMY_INVALID;
 pool->spawns=spawns;pool->spawnCount=count;
 pool->colliders=colliders;pool->colliderCount=colliderCount;
 pool->slopes=slopes;pool->slopeCount=slopeCount;
 pool->roomWidth=roomWidth;pool->roomHeight=roomHeight;
 for(i=0;i<count;i++) {
  /* Entrar na sala arma tudo: quem já está à vista aparece no primeiro quadro. */
  pool->spawnState[i]=defeatedBit(pool,spawns[i].uid)?SPAWN_DEFEATED:(SPAWN_IDLE|SPAWN_ARMED);
  pool->spawnTimer[i]=0;
 }
 return RETRO_ENEMY_OK;
}

void retroEnemySetTarget(RetroEnemyPool *pool,const RetroRect *box,uint8_t enabled) {
 if(!pool)return;
 pool->targetEnabled=(uint8_t)(enabled&&box);
 if(box)pool->target=*box;
}

int16_t retroEnemyX(const RetroEnemy *e) {return (int16_t)(e->body.x>>8);}
int16_t retroEnemyY(const RetroEnemy *e) {return (int16_t)(e->body.y>>8);}

static uint8_t localRect(const RetroEnemy *e,const RetroRect *local,RetroRect *out) {
 return retroWorldRect(local,e->body.x,e->body.y,e->facingLeft,0,out);
}
/* A física usa a caixa já espelhada (body.box); as demais espelham na consulta. */
static void syncBody(RetroEnemy *e) {
 if(!e->facingLeft||!retroMirrorRect(&e->def->body,1,&e->body.box))e->body.box=e->def->body;
}
uint8_t retroEnemyBodyRect(const RetroEnemy *e,RetroRect *out) {
 if(!e||!out||e->state==RETRO_ENEMY_FREE)return 0;
 return retroWorldRect(&e->body.box,e->body.x,e->body.y,0,0,out);
}
uint8_t retroEnemyHurtRect(const RetroEnemy *e,RetroRect *out) {
 if(!e||!out||e->state==RETRO_ENEMY_FREE||e->state==RETRO_ENEMY_DYING)return 0;
 return localRect(e,&e->def->hurt,out);
}
uint8_t retroEnemyAttackRect(const RetroEnemy *e,RetroRect *out) {
 if(!e||!out||e->state!=RETRO_ENEMY_STRIKE||!(e->def->flags&RETRO_ENEMY_CAN_ATTACK)||
  e->def->attack.width<=0||e->def->attack.height<=0)return 0;
 return localRect(e,&e->def->attack,out);
}
uint16_t retroEnemyAnimation(const RetroEnemy *e) {
 if(!e||e->state==RETRO_ENEMY_FREE)return RETRO_ENEMY_NO_ANIMATION;
 return e->def->animations[e->role].animation;
}
uint16_t retroEnemyActiveCount(const RetroEnemyPool *pool) {return pool?pool->activeCount:0;}

/* Sempre recomeça a animação do papel; quem chama decide se o papel mudou. */
static void setRole(RetroEnemy *e,uint8_t role) {
 const RetroEnemyAnimation *a;
 e->role=role;e->roleChanged=1;e->frameChanged=1;
 a=&e->def->animations[role];
 retroAnimationStart(&e->animation,a->frameCount?a->durations[0]:1,a->loop);
}

static void spawnRect(const RetroEnemySpawn *s,int16_t camX,int16_t camY,int16_t w,int16_t h,int16_t extra,
 RetroRect *area) {
 int32_t margin=(int32_t)s->activation+extra;
 area->x=(int16_t)(camX-margin);area->y=(int16_t)(camY-margin);
 area->width=(int16_t)(w+2*margin);area->height=(int16_t)(h+2*margin);
}
static uint8_t pointInside(const RetroRect *r,int16_t x,int16_t y) {
 return x>=r->x&&x<r->x+r->width&&y>=r->y&&y<r->y+r->height;
}

static void defeat(RetroEnemyPool *pool,RetroEnemy *e) {
 const RetroEnemySpawn *s=e->spawn;uint16_t index=e->spawnIndex;
 if(index<pool->spawnCount) {
  if(s->respawn==RETRO_ENEMY_RESPAWN_DELAY) {
   pool->spawnState[index]=SPAWN_COUNTDOWN;pool->spawnTimer[index]=s->respawnDelay?s->respawnDelay:1;
  } else {
   pool->spawnState[index]=SPAWN_DEFEATED;
   if(s->respawn==RETRO_ENEMY_RESPAWN_NEVER&&pool->defeated&&s->uid<pool->defeatedCount)
    pool->defeated[s->uid>>3]|=(uint8_t)(1<<(s->uid&7));
  }
 }
 release(pool,e);
}

static uint8_t activate(RetroEnemyPool *pool,uint16_t index) {
 const RetroEnemySpawn *s=&pool->spawns[index];
 const RetroEnemyDefinition *d=&pool->definitions[s->definition];
 RetroEnemy *e=0;uint16_t i;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++)if(pool->actors[i].state==RETRO_ENEMY_FREE){e=&pool->actors[i];break;}
 if(!e)return 0;
 e->def=d;e->spawn=s;e->spawnIndex=index;
 e->body.x=(RetroFixed)s->x*RETRO_FIXED_ONE;e->body.y=(RetroFixed)s->y*RETRO_FIXED_ONE;
 e->body.box=d->body;e->body.mask=0xFFFF;
 e->velocityY=0;e->health=d->health;e->timer=0;e->invulnerable=0;e->lastHit=0;
 e->facingLeft=s->facingLeft;e->grounded=0;e->visual=0;syncBody(e);
 e->state=RETRO_ENEMY_PATROL;e->role=0xFF;e->roleChanged=0;e->animation.playing=0;
 setRole(e,RETRO_ENEMY_ROLE_IDLE);
 if(pool->hooks.activate&&!pool->hooks.activate(pool->hooks.context,e)) {
  e->state=RETRO_ENEMY_FREE;e->visual=0;return 0;
 }
 pool->activeCount++;pool->spawnState[index]=SPAWN_ACTIVE|SPAWN_ARMED;
 return 1;
}

/* Chão logo à frente: uma sonda de 1 pixel na quina do corpo desce alguns pixels. */
static uint8_t groundAhead(const RetroEnemyPool *pool,const RetroEnemy *e,RetroFixed dx) {
 RetroBody probe=e->body;
 const RetroRect *b=&e->body.box;
 /* Coluna logo depois da quina da frente do corpo, na altura dos pés. */
 probe.box.x=e->facingLeft?(int16_t)(b->x-1):(int16_t)(b->x+b->width);
 probe.box.y=-1;probe.box.width=1;probe.box.height=1;
 probe.x+=dx;
 return (retroMoveBodySlopes(&probe,0,(RetroFixed)EDGE_PROBE*RETRO_FIXED_ONE,pool->colliders,pool->colliderCount,
  pool->slopes,pool->slopeCount,0,0,0).contacts&RETRO_CONTACT_FLOOR)!=0;
}

static void turn(RetroEnemy *e) {
 e->facingLeft^=1;syncBody(e);
 if(e->def->pauseTicks){e->state=RETRO_ENEMY_PAUSE;e->timer=e->def->pauseTicks;}
}

static uint8_t sees(const RetroEnemyPool *pool,const RetroEnemy *e) {
 const RetroEnemyDefinition *d=e->def;
 RetroRect band;int32_t tx,x=retroEnemyX(e);
 if(!(d->flags&RETRO_ENEMY_CAN_ATTACK)||!d->detectionRange||!pool->targetEnabled)return 0;
 tx=(int32_t)pool->target.x+pool->target.width/2;
 if(e->facingLeft?(tx>x||tx<x-(int32_t)d->detectionRange):(tx<x||tx>x+(int32_t)d->detectionRange))return 0;
 if(!retroEnemyBodyRect(e,&band))return 0;
 band.y=(int16_t)(band.y-16);band.height=(int16_t)(band.height+32);
 return (int32_t)pool->target.y<(int32_t)band.y+band.height&&(int32_t)pool->target.y+pool->target.height>band.y;
}

/* Patrulheiro terrestre: anda até parede, borda ou limite e vira. */
static RetroFixed patrolTick(RetroEnemyPool *pool,RetroEnemy *e) {
 const RetroEnemyDefinition *d=e->def;
 const RetroEnemySpawn *s=e->spawn;
 RetroFixed dx;int16_t x=retroEnemyX(e);
 if(sees(pool,e)){e->state=RETRO_ENEMY_WINDUP;e->timer=d->windupTicks?d->windupTicks:1;return 0;}
 if(!e->grounded||!d->speed)return 0;
 if(s->patrolLeft<s->patrolRight) {
  if(e->facingLeft&&x<=s->patrolLeft){e->body.x=(RetroFixed)s->patrolLeft*RETRO_FIXED_ONE;turn(e);return 0;}
  if(!e->facingLeft&&x>=s->patrolRight){e->body.x=(RetroFixed)s->patrolRight*RETRO_FIXED_ONE;turn(e);return 0;}
 }
 dx=e->facingLeft?-d->speed:d->speed;
 if((d->flags&RETRO_ENEMY_TURN_AT_EDGES)&&!groundAhead(pool,e,dx)){turn(e);return 0;}
 return dx;
}

static void tickBehavior(RetroEnemyPool *pool,RetroEnemy *e) {
 const RetroEnemyDefinition *d=e->def;
 RetroFixed dx=0;RetroMoveResult moved;uint8_t role=RETRO_ENEMY_ROLE_IDLE;
 if(e->invulnerable)e->invulnerable--;
 switch(e->state) {
 case RETRO_ENEMY_PATROL:dx=patrolTick(pool,e);break;
 case RETRO_ENEMY_PAUSE:if(!e->timer||!--e->timer)e->state=RETRO_ENEMY_PATROL;break;
 case RETRO_ENEMY_WINDUP:if(!--e->timer){e->state=RETRO_ENEMY_STRIKE;e->timer=d->strikeTicks?d->strikeTicks:1;}break;
 case RETRO_ENEMY_STRIKE:if(!--e->timer){e->state=RETRO_ENEMY_RECOVER;e->timer=d->recoveryTicks?d->recoveryTicks:1;}break;
 case RETRO_ENEMY_RECOVER:if(!--e->timer)e->state=RETRO_ENEMY_PATROL;break;
 case RETRO_ENEMY_HURT:if(!e->timer||!--e->timer)e->state=RETRO_ENEMY_PATROL;break;
 case RETRO_ENEMY_DYING:if(!e->timer||!--e->timer){defeat(pool,e);return;}break;
 }
 e->velocityY+=d->gravity;
 if(e->velocityY>d->maxFall)e->velocityY=d->maxFall;
 moved=retroMoveBodySlopes(&e->body,dx,e->velocityY,pool->colliders,pool->colliderCount,
  pool->slopes,pool->slopeCount,SLOPE_SNAP,e->grounded,0);
 if(moved.invalid){defeat(pool,e);return;}
 e->grounded=(moved.contacts&RETRO_CONTACT_FLOOR)!=0;
 if(moved.contacts&(RETRO_CONTACT_FLOOR|RETRO_CONTACT_CEILING))e->velocityY=0;
 if(dx&&(moved.contacts&(e->facingLeft?RETRO_CONTACT_LEFT:RETRO_CONTACT_RIGHT))&&(d->flags&RETRO_ENEMY_TURN_AT_WALLS))turn(e);
 if(e->body.x<0){e->body.x=0;if(e->facingLeft&&e->state==RETRO_ENEMY_PATROL)turn(e);}
 if(e->body.x>(RetroFixed)pool->roomWidth*RETRO_FIXED_ONE){
  e->body.x=(RetroFixed)pool->roomWidth*RETRO_FIXED_ONE;if(!e->facingLeft&&e->state==RETRO_ENEMY_PATROL)turn(e);
 }
 /* Caiu para fora da sala: conta como derrotado, sem animação. */
 if(retroEnemyY(e)>pool->roomHeight+FALL_LIMIT){defeat(pool,e);return;}
 switch(e->state) {
 case RETRO_ENEMY_PATROL:role=moved.dx?RETRO_ENEMY_ROLE_WALK:RETRO_ENEMY_ROLE_IDLE;break;
 case RETRO_ENEMY_WINDUP:case RETRO_ENEMY_STRIKE:case RETRO_ENEMY_RECOVER:role=RETRO_ENEMY_ROLE_ATTACK;break;
 case RETRO_ENEMY_HURT:role=RETRO_ENEMY_ROLE_HURT;break;
 case RETRO_ENEMY_DYING:role=RETRO_ENEMY_ROLE_DEATH;break;
 default:role=RETRO_ENEMY_ROLE_IDLE;
 }
 if(role!=e->role)setRole(e,role);
 else {
  const RetroEnemyAnimation *a=&d->animations[role];
  if(retroAnimationTick(&e->animation,a->durations,a->frameCount)==RETRO_ANIM_FRAME)e->frameChanged=1;
 }
}

void retroEnemyUpdate(RetroEnemyPool *pool,int16_t cameraX,int16_t cameraY,int16_t screenWidth,int16_t screenHeight) {
 uint16_t i;
 if(!pool||!pool->definitions)return;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++){pool->actors[i].roleChanged=0;pool->actors[i].frameChanged=0;}
 /* Desativa quem saiu de perto: volta a ser só a instância da sala. */
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++) {
  RetroEnemy *e=&pool->actors[i];RetroRect area,body;
  if(e->state==RETRO_ENEMY_FREE)continue;
  spawnRect(e->spawn,cameraX,cameraY,screenWidth,screenHeight,DEACTIVATE_SLACK,&area);
  if(retroEnemyBodyRect(e,&body)&&retroRectsOverlap(&area,&body))continue;
  if(e->state==RETRO_ENEMY_DYING){defeat(pool,e);continue;}
  if(e->spawnIndex<pool->spawnCount)pool->spawnState[e->spawnIndex]=SPAWN_IDLE;
  release(pool,e);
 }
 /* Instâncias: rearmar fora da área, contar o respawn e ativar à vista. */
 pool->deferred=0;
 for(i=0;i<pool->spawnCount;i++) {
  const RetroEnemySpawn *s=&pool->spawns[i];
  uint8_t state=SPAWN_STATE(pool->spawnState[i]);RetroRect area;uint8_t inside;
  if(state==SPAWN_ACTIVE||state==SPAWN_DEFEATED)continue;
  spawnRect(s,cameraX,cameraY,screenWidth,screenHeight,0,&area);
  inside=pointInside(&area,s->x,s->y);
  if(state==SPAWN_COUNTDOWN) {
   if(pool->spawnTimer[i]&&--pool->spawnTimer[i])continue;
   /* Tempo cumprido: reaparece só depois que a origem sai de vista. */
   pool->spawnState[i]=SPAWN_IDLE;state=SPAWN_IDLE;
  }
  if(!inside){pool->spawnState[i]=SPAWN_IDLE|SPAWN_ARMED;continue;}
  if(!(pool->spawnState[i]&SPAWN_ARMED)||pool->deferred)continue;
  if(pool->activeCount>=pool->maxActive||!activate(pool,i))pool->deferred=1;
 }
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++)if(pool->actors[i].state!=RETRO_ENEMY_FREE)tickBehavior(pool,&pool->actors[i]);
}

uint8_t retroEnemyHit(RetroEnemyPool *pool,const RetroRect *box,uint16_t damage,uint16_t serial,uint8_t first) {
 uint16_t i;uint8_t result=0;
 if(!pool||!box)return 0;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++) {
  RetroEnemy *e=&pool->actors[i];RetroRect hurt;
  if(!retroEnemyHurtRect(e,&hurt)||!retroRectsOverlap(&hurt,box))continue;
  result|=RETRO_ENEMY_HIT_TOUCHED;
  if(e->invulnerable||(serial&&e->lastHit==serial)||!damage){if(first)return result;continue;}
  e->lastHit=serial;
  e->health=e->health>damage?(uint16_t)(e->health-damage):0;
  result|=RETRO_ENEMY_HIT_DAMAGED;
  if(!e->health) {
   result|=RETRO_ENEMY_HIT_DEFEATED;
   e->state=RETRO_ENEMY_DYING;e->timer=e->def->deathTicks;
   setRole(e,RETRO_ENEMY_ROLE_DEATH);
   if(!e->timer)defeat(pool,e);
  } else {
   e->state=RETRO_ENEMY_HURT;e->timer=e->def->hurtTicks;
   e->invulnerable=e->def->invulnerableTicks;
   setRole(e,RETRO_ENEMY_ROLE_HURT);
  }
  if(first)return result;
 }
 return result;
}

uint16_t retroEnemyTouch(const RetroEnemyPool *pool,const RetroRect *box) {
 uint16_t i,best=0;
 if(!pool||!box)return 0;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++) {
  const RetroEnemy *e=&pool->actors[i];RetroRect r;
  if(e->state==RETRO_ENEMY_FREE||e->state==RETRO_ENEMY_DYING)continue;
  if(e->def->contactDamage>best&&retroEnemyBodyRect(e,&r)&&retroRectsOverlap(&r,box))best=e->def->contactDamage;
  if(e->def->attackDamage>best&&retroEnemyAttackRect(e,&r)&&retroRectsOverlap(&r,box))best=e->def->attackDamage;
 }
 return best;
}
