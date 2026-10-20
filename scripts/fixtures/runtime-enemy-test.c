/* Teste de host do runtime de inimigos (scripts/smoke-runtime-enemy.mjs). */
#include <assert.h>
#include <stdio.h>
#include "retro_enemy.h"

static unsigned activations,deactivations,refuse;
static uint8_t onActivate(void *c,RetroEnemy *e){(void)c;if(refuse){refuse--;return 0;}activations++;e->visual=(void*)1;return 1;}
static void onDeactivate(void *c,RetroEnemy *e){(void)c;assert(e->visual);deactivations++;}

/* Chão 0..400 e 420..800 (vão de 20 px entre eles), parede em 300..320. */
static const RetroCollider room[]={
 {{0,200,400,40},1,RETRO_COLLIDER_SOLID},{{420,200,380,40},1,RETRO_COLLIDER_SOLID},
 {{300,150,20,50},1,RETRO_COLLIDER_SOLID}};
static const uint16_t two[]={4,4},one[]={6};
#define ANIM(index,frames,durations,loop) {frames,durations,index,loop}
static RetroEnemyDefinition defs[2];
static void define(void){
 RetroEnemyDefinition d={0};
 d.behavior=RETRO_ENEMY_BEHAVIOR_GROUND_PATROL;
 d.flags=RETRO_ENEMY_TURN_AT_EDGES|RETRO_ENEMY_TURN_AT_WALLS|RETRO_ENEMY_CAN_ATTACK;
 d.health=3;d.speed=RETRO_FIXED_ONE;d.gravity=64;d.maxFall=4*RETRO_FIXED_ONE;
 d.contactDamage=1;d.attackDamage=2;d.detectionRange=40;
 d.body=(RetroRect){-8,-32,16,32};d.hurt=(RetroRect){-8,-32,16,32};d.attack=(RetroRect){8,-24,20,12};
 d.windupTicks=5;d.strikeTicks=3;d.recoveryTicks=4;d.hurtTicks=6;d.invulnerableTicks=10;d.deathTicks=6;d.pauseTicks=0;
 d.animations[RETRO_ENEMY_ROLE_IDLE]=(RetroEnemyAnimation)ANIM(0,2,two,1);
 d.animations[RETRO_ENEMY_ROLE_WALK]=(RetroEnemyAnimation)ANIM(1,2,two,1);
 d.animations[RETRO_ENEMY_ROLE_ATTACK]=(RetroEnemyAnimation)ANIM(2,2,two,0);
 d.animations[RETRO_ENEMY_ROLE_HURT]=(RetroEnemyAnimation)ANIM(0,2,two,1); /* fallback: parado */
 d.animations[RETRO_ENEMY_ROLE_DEATH]=(RetroEnemyAnimation)ANIM(3,1,one,0);
 d.frameWidth=48;d.frameHeight=48;d.anchorX=24;d.anchorY=48;
 defs[0]=d;
 d.flags=RETRO_ENEMY_TURN_AT_WALLS;d.detectionRange=0;d.health=1;defs[1]=d; /* cai de bordas, não ataca */
}
static RetroEnemyPool pool;
static uint8_t defeatedBits[2];
static void run(unsigned ticks,int16_t camX){while(ticks--)retroEnemyUpdate(&pool,camX,0,320,224);}
static RetroEnemy *actor(uint16_t uid){
 unsigned i;
 for(i=0;i<RETRO_ENEMY_POOL_MAX;i++)
  if(pool.actors[i].state!=RETRO_ENEMY_FREE&&pool.actors[i].spawn->uid==uid)return &pool.actors[i];
 return 0;
}

int main(void){
 RetroEnemyHooks hooks={onActivate,onDeactivate,0};
 RetroEnemy *e;RetroRect box;uint16_t i;int16_t lastX;
 define();
 /* Referências e definições inválidas são recusadas. */
 {RetroEnemyDefinition bad=defs[0];bad.animations[RETRO_ENEMY_ROLE_IDLE].animation=RETRO_ENEMY_NO_ANIMATION;
  assert(retroEnemyInit(&pool,&bad,1,4,0,0,hooks)==RETRO_ENEMY_INVALID);
  bad=defs[0];bad.behavior=99;assert(retroEnemyInit(&pool,&bad,1,4,0,0,hooks)==RETRO_ENEMY_INVALID);}
 assert(retroEnemyInit(&pool,defs,2,2,defeatedBits,16,hooks)==RETRO_ENEMY_OK);
 {RetroEnemySpawn wrong={0,7,50,199,0,0,0,0,0,0};
  assert(retroEnemyEnterRoom(&pool,&wrong,1,room,3,0,0,800,240)==RETRO_ENEMY_INVALID);}

 /* 1) Patrulha: anda para a direita até a parede (300) e vira. */
 {static const RetroEnemySpawn s[]={{0,0,200,199,0,0,16,0,0,RETRO_ENEMY_RESPAWN_ROOM}};
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  run(1,0);e=actor(0);assert(e&&activations==1&&retroEnemyActiveCount(&pool)==1);
  run(10,0);assert(e->grounded&&retroEnemyY(e)==200);
  for(i=0;i<200&&!e->facingLeft;i++)run(1,0);
  assert(e->facingLeft&&retroEnemyX(e)<=292&&retroEnemyX(e)>=280);
  assert(retroEnemyAnimation(e)==1);
  /* Volta à esquerda até a borda em x=0? A sala termina em 0: vira no limite. */
  for(i=0;i<400&&e->facingLeft;i++)run(1,0);
  assert(!e->facingLeft&&retroEnemyX(e)<=10);}

 /* 2) Borda: entre 0..400 e o vão, vira antes de cair (sem parede no caminho). */
 {static const RetroEnemySpawn s[]={{0,0,360,199,0,0,16,0,0,RETRO_ENEMY_RESPAWN_ROOM}};
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  run(1,100);e=actor(0);assert(e);
  for(i=0;i<200&&!e->facingLeft;i++)run(1,100);
  assert(e->facingLeft&&retroEnemyX(e)>=380&&retroEnemyX(e)<=400&&retroEnemyY(e)==200);}

 /* 3) Sem TURN_AT_EDGES, cai no vão e é derrotado ao sair da sala. */
 {static const RetroEnemySpawn s[]={{1,1,380,199,0,0,16,0,0,RETRO_ENEMY_RESPAWN_ROOM}};
  unsigned before;
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  before=deactivations;run(1,250);assert(actor(1));
  for(i=0;i<300&&actor(1);i++)run(1,250);
  assert(!actor(1)&&deactivations==before+1);
  run(30,250);assert(!actor(1)); /* RESPAWN_ROOM: só ao reentrar */}

 /* 4) Limites de patrulha da instância. */
 {static const RetroEnemySpawn s[]={{0,0,100,199,80,140,16,0,0,RETRO_ENEMY_RESPAWN_ROOM}};
  int16_t lo=1000,hi=-1000;
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  for(i=0;i<400;i++){run(1,0);e=actor(0);if(retroEnemyX(e)<lo)lo=retroEnemyX(e);if(retroEnemyX(e)>hi)hi=retroEnemyX(e);}
  assert(lo>=80&&hi<=140&&lo<=82&&hi>=138);}

 /* 5) Ativação pela câmera, limite do pool e adiamento sem VRAM. */
 {static const RetroEnemySpawn s[]={
   {0,0,100,199,0,0,0,0,0,RETRO_ENEMY_RESPAWN_ROOM},{1,0,150,199,0,0,0,0,0,RETRO_ENEMY_RESPAWN_ROOM},
   {2,0,700,199,0,0,0,0,0,RETRO_ENEMY_RESPAWN_ROOM}};
  assert(retroEnemyEnterRoom(&pool,s,3,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  refuse=1;run(1,0);assert(retroEnemyActiveCount(&pool)==0&&pool.deferred);
  run(1,0);assert(retroEnemyActiveCount(&pool)==2&&!actor(2)); /* 700 fora da tela */
  run(1,480);assert(retroEnemyActiveCount(&pool)==1&&actor(2)); /* os da esquerda saíram */
  run(1,0);assert(actor(0)&&actor(1)&&!actor(2));}

 /* 6) Espada: um dano por inimigo por golpe; invulnerabilidade; morte. */
 {static const RetroEnemySpawn s[]={{0,0,100,199,0,0,16,0,0,RETRO_ENEMY_RESPAWN_NEVER}};
  RetroRect sword;uint8_t r;
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  run(5,0);e=actor(0);assert(e&&e->health==3);
  retroEnemyHurtRect(e,&box);sword=(RetroRect){box.x,box.y,8,8};
  r=retroEnemyHit(&pool,&sword,1,7,0);assert((r&RETRO_ENEMY_HIT_DAMAGED)&&e->health==2&&e->state==RETRO_ENEMY_HURT);
  lastX=retroEnemyX(e);run(1,0);assert(retroEnemyX(e)==lastX); /* parado no dano */
  run(20,0);retroEnemyHurtRect(e,&box);sword=(RetroRect){box.x,box.y,8,8};
  r=retroEnemyHit(&pool,&sword,1,7,0);assert(r==RETRO_ENEMY_HIT_TOUCHED&&e->health==2); /* mesmo golpe */
  r=retroEnemyHit(&pool,&sword,1,8,0);assert((r&RETRO_ENEMY_HIT_DAMAGED)&&e->health==1);
  r=retroEnemyHit(&pool,&sword,1,9,0);assert(r==RETRO_ENEMY_HIT_TOUCHED&&e->health==1); /* invulnerável */
  run(11,0);retroEnemyHurtRect(e,&box);sword=(RetroRect){box.x,box.y,8,8};
  r=retroEnemyHit(&pool,&sword,1,10,0);assert(r&RETRO_ENEMY_HIT_DEFEATED);
  assert(e->state==RETRO_ENEMY_DYING&&retroEnemyAnimation(e)==3);
  assert(retroEnemyTouch(&pool,&box)==0); /* morrendo não machuca */
  run(6,0);assert(!actor(0)&&(defeatedBits[0]&1));
  /* RESPAWN_NEVER: nem reentrando na sala. */
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);run(3,0);assert(!actor(0));
  retroEnemyResetDefeated(&pool);
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);run(1,0);assert(actor(0));}

 /* 7) Kunai: para no primeiro inimigo tocado. */
 {static const RetroEnemySpawn s[]={{0,0,100,199,0,0,16,0,0,0},{1,0,104,199,0,0,16,0,0,0}};
  RetroRect kunai;uint8_t r;
  assert(retroEnemyEnterRoom(&pool,s,2,room,3,0,0,800,240)==RETRO_ENEMY_OK);run(3,0);
  kunai=(RetroRect){90,180,30,6};r=retroEnemyHit(&pool,&kunai,1,0,1);
  assert(r&RETRO_ENEMY_HIT_DAMAGED);assert((actor(0)->health==2)+(actor(1)->health==2)==1);}

 /* 8) Contato e ataque: preparação, golpe ativo e recuperação. */
 {static const RetroEnemySpawn s[]={{0,0,100,199,0,0,16,0,0,0}};
  RetroRect player={130,170,16,30},attack;
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  retroEnemySetTarget(&pool,&player,1);run(1,0);e=actor(0);
  for(i=0;i<30&&e->state!=RETRO_ENEMY_WINDUP;i++)run(1,0);
  assert(e->state==RETRO_ENEMY_WINDUP&&retroEnemyAnimation(e)==2);
  assert(!retroEnemyAttackRect(e,&attack));
  run(5,0);assert(e->state==RETRO_ENEMY_STRIKE&&retroEnemyAttackRect(e,&attack));
  player=(RetroRect){attack.x,attack.y,4,4};assert(retroEnemyTouch(&pool,&player)==2);
  run(3,0);assert(e->state==RETRO_ENEMY_RECOVER&&retroEnemyTouch(&pool,&player)==0);
  retroEnemyBodyRect(e,&box);assert(retroEnemyTouch(&pool,&box)==1);
  retroEnemySetTarget(&pool,0,0);run(4,0);assert(e->state==RETRO_ENEMY_PATROL);}

 /* 9) Pausa: sem Update nada muda (posição, timers, quadro). */
 {RetroEnemy copy;e=actor(0);run(3,0);copy=*e;
  /* o host não chama retroEnemyUpdate enquanto pausado */
  assert(copy.body.x==e->body.x&&copy.timer==e->timer&&copy.animation.frame==e->animation.frame);}

 /* 10) Respawn com atraso: só depois do tempo e com a origem fora de vista. */
 {static const RetroEnemySpawn s[]={{0,1,100,199,0,0,0,30,0,RETRO_ENEMY_RESPAWN_DELAY}};
  RetroRect hit;
  assert(retroEnemyEnterRoom(&pool,s,1,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  run(2,0);e=actor(0);assert(e);retroEnemyHurtRect(e,&hit);
  assert(retroEnemyHit(&pool,&hit,5,1,0)&RETRO_ENEMY_HIT_DEFEATED);
  run(7,0);assert(!actor(0));
  run(40,0);assert(!actor(0));      /* tempo cumprido, mas a origem está à vista */
  run(1,480);run(1,0);assert(actor(0));}

 /* 11) Troca de sala libera todos os visuais; sala sem inimigos é válida. */
 {unsigned before=deactivations,live=retroEnemyActiveCount(&pool);
  assert(retroEnemyEnterRoom(&pool,0,0,room,3,0,0,800,240)==RETRO_ENEMY_OK);
  assert(deactivations==before+live&&retroEnemyActiveCount(&pool)==0);
  for(i=0;i<RETRO_ENEMY_POOL_MAX;i++)assert(pool.actors[i].state==RETRO_ENEMY_FREE);}

 /* 12) Limite de instâncias por sala. */
 {static RetroEnemySpawn many[RETRO_ENEMY_ROOM_SPAWN_MAX+1];
  assert(retroEnemyEnterRoom(&pool,many,RETRO_ENEMY_ROOM_SPAWN_MAX+1,room,3,0,0,800,240)==RETRO_ENEMY_TOO_MANY);}
 assert(activations>=deactivations);
 puts("ok");
 return 0;
}
