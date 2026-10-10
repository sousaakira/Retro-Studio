/* Projeto inicial do Retro Studio: um jogo de plataforma mínimo e completo.
 *
 * O que ele mostra, usando só os módulos de runtime distribuídos:
 *  - personagem com física (andar, pular) e colisão contra o terreno do mapa;
 *  - animação escolhida pelo controlador exportado do Charset Maker, com um
 *    evento por quadro (o som do passo no ciclo de andar);
 *  - duas salas ligadas: atravessar a borda troca de sala;
 *  - checkpoint (a lâmpada da caverna) e retorno com START;
 *  - câmera com os perfis exportados pelo editor de câmera;
 *  - música por sala e efeitos sonoros do catálogo de áudio.
 *
 * Controles: esquerda/direita andam, B ou C pulam, START volta ao último
 * checkpoint. (Baixo desce de plataformas atravessáveis; as deste exemplo são sólidas.)
 *
 * Tudo o que está em src/generated/ e src/retro_runtime/ é gerado ou instalado
 * pela IDE; edite os dados nos editores (Recursos → Runtime) e este arquivo. */
#include <genesis.h>
#include "resources.h"
#include "retro_runtime/retro_world_sgdk.h"
#include "retro_runtime/retro_movement.h"
#include "retro_runtime/retro_character_sprite.h"
#include "hero_animations.h"
#include "generated/world_config.h"
#include "generated/world_maps.h"
#include "generated/camera_config.h"
#include "generated/audio_sgdk.h"

/* Diagnóstico em jogo (Recursos → Runtime → Diagnóstico). Sem o header exportado,
 * ou com o diagnóstico desligado, nada deste bloco entra na ROM. */
#if defined(__has_include) && __has_include("generated/debug_config.h")
#include "generated/debug_config.h"
#endif
#ifndef RETRO_PROJECT_DEBUG
#define RETRO_PROJECT_DEBUG 0
#endif
#if RETRO_PROJECT_DEBUG
#include "retro_runtime/retro_debug_sgdk.h"
static RetroDebugPeaks debugPeaks;
static u32 debugFrame;
#endif

/* Tiles de VRAM reservados para os sprites (o herói usa poucos). */
#define SPRITE_TILE_RESERVE 128

static RetroWorld world={0};
static RetroWorldSgdk bridge={0};
static RetroInput input={0};
static RetroMovement movement={0};
static RetroMovementConfig physics;
static RetroCharacter character={0};
static RetroCharacterSprite characterSprite={0};
static RetroCamera camera;
static const RetroCameraConfig *framing;
static RetroAudio audio;
static const RetroWorldMapGeometry *geometry;
static Sprite *hero;
static u16 lastCheckpoint=RETRO_ID_NONE;

/* Condições das transições de animação: 1 = subindo, 2 = caindo. */
static u8 animationCondition(void *context,u16 predicate){
 (void)context;
 return predicate==1?movement.velocityY<0:predicate==2?movement.velocityY>=0:0;
}

/* Eventos por quadro da animação. O callback só anota o pedido; o som toca no
 * laço principal (callbacks não devem chamar de volta os módulos). */
static u8 stepRequested;
static void animationEvent(void *context,u16 state,const RetroCharacterEvent *event){
 (void)context;(void)state;
 if(event->type==RETRO_CHARACTER_SOUND&&event->argument==0)stepRequested=1;
}

static void fail(const char *message){
 VDP_drawText(message,1,1);
 while(TRUE)SYS_doVBlankProcess();
}

/* Chamado pela ponte do mundo sempre que uma sala fica ativa: no início, ao
 * atravessar uma saída e ao voltar para o checkpoint. */
static void roomActivated(void *context,const RetroWorld *value){
 u16 i;RetroBody body;const RetroCameraRegion *regions=0;u16 regionCount=0;
 (void)context;
 geometry=0;
 for(i=0;i<RETRO_WORLD_MAP_COUNT;i++)if(retroWorldMapGeometry[i].room==value->room->id){geometry=&retroWorldMapGeometry[i];break;}
 if(!geometry)return;
 /* O corpo nasce na entrada da sala, com a caixa de colisão exportada do mapa. */
 body.x=(RetroFixed)value->x*RETRO_FIXED_ONE;body.y=(RetroFixed)value->y*RETRO_FIXED_ONE;
 body.box=geometry->body;body.mask=0xFFFF;
 retroMovementInit(&movement,&body);
 movement.facing=movement.movementFacing=value->facing;
 retroCharacterSetState(&character,HERO_ANIM_IDLE);
 for(i=0;(s16)i<(s16)RETRO_PROJECT_CAMERA_ROOM_COUNT;i++)if(retroProjectCameraRooms[i].room==value->room->id){
  regions=retroProjectCameraRooms[i].regions;regionCount=retroProjectCameraRooms[i].count;break;}
 retroCameraEnterRoom(&camera,framing,(s16)value->room->width,(s16)value->room->height,regions,regionCount,
  body.x,body.y,(signed char)(value->facing?-1:1));
 /* Salas com a mesma música não reiniciam a faixa. */
 retroAudioRoomMusic(&audio,retroAudioRoomTrack(retroProjectAudioRooms,RETRO_PROJECT_AUDIO_ROOM_COUNT,value->room->id));
}

/* Este exemplo não tem portas trancadas: nenhuma saída exige condição. */
static u8 exitCondition(void *context,u16 id){(void)context;(void)id;return 0;}

static u8 inside(const RetroRect *area,s16 x,s16 y){
 return x>=area->x&&x<area->x+area->width&&y>=area->y&&y<area->y+area->height;
}

int main(bool hardReset){
 RetroCharacterHost animationHost={0,animationCondition,0,0,animationEvent};
 RetroAudioDriver driver;
 (void)hardReset;

 /* Vídeo: 320 de largura, um plano de 64×32 tiles com scroll por plano. */
 VDP_setScreenWidth320();VDP_setPlaneSize(64,32,TRUE);
 VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
 DMA_setBufferSize(8192);DMA_setMaxQueueSize(64);DMA_setMaxTransferSize(7200);DMA_setAutoFlush(TRUE);
 JOY_init();

 /* Áudio: registra os efeitos no driver XGM e cria o módulo de áudio. */
 driver=retroAudioSgdkDriver(&retroProjectAudioSgdk);
 if(!retroAudioInit(&audio,&driver,RETRO_PROJECT_AUDIO_MUSIC_COUNT,retroProjectAudioEffects,
  RETRO_PROJECT_AUDIO_EFFECT_COUNT,RETRO_PROJECT_AUDIO_CHANNELS))fail("AUDIO INIT FAILED");

 /* Física com o preset do runtime; câmera com o perfil do padrão de vídeo. */
 retroMovementPreset(&physics);
 framing=IS_PAL_SYSTEM?&retroProjectCameraPal:&retroProjectCameraNtsc;
 retroCameraInit(&camera,320,224);

 /* Personagem: sprite do SGDK + controlador de animação exportado. */
 SPR_initEx(SPRITE_TILE_RESERVE);PAL_setPalette(PAL1,HERO.palette->data,DMA);
 hero=SPR_addSprite(&HERO,0,0,TILE_ATTR(PAL1,TRUE,FALSE,FALSE));
 if(!hero)fail("NO SPRITE VRAM");
 if(!retroCharacterInit(&character,&hero_character_definition,HERO_ANIM_IDLE,&animationHost)||
    !retroCharacterSpriteAttach(&characterSprite,&character,hero))fail("CHARACTER INIT FAILED");
 retroCharacterSpritePriority(&characterSprite,TRUE);
 SPR_update();SYS_doVBlankProcess();

 /* Mundo: carrega a sala inicial e chama roomActivated. */
 if(retroWorldSgdkInit(&bridge,&world,&retroProjectWorld,retroWorldMapBindings,RETRO_WORLD_MAP_COUNT,
  roomActivated,exitCondition,0)!=RETRO_WORLD_OK)fail("WORLD INIT FAILED");

 while(TRUE){
  RetroMovementInput controls={0,0};RetroMovementResult result={0};RetroCameraResult view;
  s16 x,y;u16 i;u8 switched=0;

  retroInputUpdate(&input,JOY_readJoypad(JOY_1));
  retroAudioTick(&audio);

  /* Entrada → intenção de movimento. */
  controls.axis=retroInputAxis(&input,BUTTON_LEFT,BUTTON_RIGHT);
  if(input.held&(BUTTON_B|BUTTON_C))controls.buttons|=RETRO_MOVE_JUMP_HELD;
  if(input.pressed&(BUTTON_B|BUTTON_C))controls.buttons|=RETRO_MOVE_JUMP_PRESSED;
  if(input.held&BUTTON_DOWN)controls.buttons|=RETRO_MOVE_DROP_HELD;
  if(input.pressed&BUTTON_START)switched=retroWorldRespawn(&world)==RETRO_WORLD_OK;

  /* Física e colisão contra o terreno da sala. */
  if(!switched&&geometry){
   RetroFixed minimum=-(RetroFixed)geometry->body.x*RETRO_FIXED_ONE;
   RetroFixed maximum=((RetroFixed)world.room->width-geometry->body.x-geometry->body.width)*RETRO_FIXED_ONE;
   result=retroMovementTick(&movement,&physics,controls,geometry->colliders,geometry->colliderCount,geometry->slopes,geometry->slopeCount);
   if(movement.body.x<minimum){movement.body.x=minimum;movement.velocityX=0;}
   if(movement.body.x>maximum){movement.body.x=maximum;movement.velocityX=0;}
   if(result.jumped)retroAudioPlayEffect(&audio,RETRO_PROJECT_AUDIO_SFX_JUMP);
  }
  x=(s16)(movement.body.x/RETRO_FIXED_ONE);y=(s16)(movement.body.y/RETRO_FIXED_ONE);

  /* Checkpoints e saídas: áreas desenhadas no editor de salas. */
  for(i=0;i<RETRO_PROJECT_WORLD_CHECKPOINT_COUNT&&!switched;i++){
   const RetroWorldTrigger *t=&retroProjectWorldCheckpointAreas[i];
   if(t->room==world.room->id&&inside(&t->area,x,y)&&lastCheckpoint!=t->id&&
      retroWorldCheckpoint(&world,t->id)==RETRO_WORLD_OK){
    lastCheckpoint=t->id;retroAudioPlayEffect(&audio,RETRO_PROJECT_AUDIO_SFX_CHECKPOINT);
   }
  }
  for(i=0;i<RETRO_PROJECT_WORLD_EXIT_COUNT&&!switched;i++){
   const RetroWorldTrigger *t=&retroProjectWorldExitAreas[i];
   if(t->room==world.room->id&&inside(&t->area,x,y))switched=retroWorldExitThrough(&world,t->id)==RETRO_WORLD_OK;
  }
  if(switched){x=(s16)(movement.body.x/RETRO_FIXED_ONE);y=(s16)(movement.body.y/RETRO_FIXED_ONE);}

  /* Câmera → scroll do mapa → sprite do herói. */
  view=retroCameraTick(&camera,framing,movement.body.x,movement.body.y,(signed char)(movement.facing?-1:1));
  if(!view.invalid)retroWorldSgdkScroll(&bridge,view.x,view.y);
  retroCharacterSpriteFacing(&characterSprite,movement.facing,0);
  retroCharacterSpritePosition(&characterSprite,x,y,bridge.cameraX,bridge.cameraY);
  SPR_update();
#if RETRO_PROJECT_DEBUG
  {
   /* Medições deste quadro, antes de o VBlank esvaziar a fila de DMA. A VRAM do
    * motor de sprites não é mensurável no SGDK 1.81 e aparece como "--". */
   RetroDebugSample sample;RetroDebugSubject subject={0};
   retroDebugSgdkSample(&sample,0,TRUE);retroDebugPeaksUpdate(&debugPeaks,&sample);
   subject.state=subject.animation=retroCharacterStateId(&character);subject.frame=character.animation.frame;
   subject.x=x;subject.y=y;subject.velocityX=movement.velocityX;subject.velocityY=movement.velocityY;
   subject.contacts=(u16)result.conditions;
   if(!debugFrame){retroDebugSgdkBoxTile();retroDebugPeaksReset(&debugPeaks);}
   PAL_setColor(15,0x0EEE);
#if RETRO_PROJECT_DEBUG_PERFORMANCE || RETRO_PROJECT_DEBUG_SUBJECT
   retroDebugSgdkOverlay(RETRO_PROJECT_DEBUG_PERFORMANCE?&sample:0,&debugPeaks,RETRO_PROJECT_DEBUG_SUBJECT?&subject:0,RETRO_PROJECT_DEBUG_BUILD);
#endif
#if RETRO_PROJECT_DEBUG_BOXES
   if(geometry){
    /* Caixa de colisão do herói e as áreas de saída e checkpoint da sala. */
    RetroDebugBox boxes[RETRO_DEBUG_MAX_BOXES];u8 boxCount=1;
    boxes[0].rect.x=x+geometry->body.x;boxes[0].rect.y=y+geometry->body.y;
    boxes[0].rect.width=geometry->body.width;boxes[0].rect.height=geometry->body.height;boxes[0].kind=RETRO_DEBUG_BOX_BODY;
    for(i=0;i<RETRO_PROJECT_WORLD_EXIT_COUNT&&boxCount<RETRO_DEBUG_MAX_BOXES;i++)if(retroProjectWorldExitAreas[i].room==world.room->id){
     boxes[boxCount].rect=retroProjectWorldExitAreas[i].area;boxes[boxCount++].kind=RETRO_DEBUG_BOX_TRIGGER;}
    for(i=0;i<RETRO_PROJECT_WORLD_CHECKPOINT_COUNT&&boxCount<RETRO_DEBUG_MAX_BOXES;i++)if(retroProjectWorldCheckpointAreas[i].room==world.room->id){
     boxes[boxCount].rect=retroProjectWorldCheckpointAreas[i].area;boxes[boxCount++].kind=RETRO_DEBUG_BOX_TRIGGER;}
    retroDebugSgdkBoxes(boxes,boxCount,bridge.cameraX,bridge.cameraY,PAL0,TRUE);
   }
#endif
#if RETRO_PROJECT_DEBUG_KDEBUG
   if(!(debugFrame&31))retroDebugSgdkSend(RETRO_PROJECT_DEBUG_BUILD,debugFrame,&sample,&subject);
#endif
   debugFrame++;
  }
#endif
  SYS_doVBlankProcess();

  /* A animação avança depois do quadro, com as condições da física
   * (bit 1 = no chão, bit 2 = andando). */
  if(!switched&&!result.invalid){
   result.conditions=(result.conditions&~2UL)|(movement.velocityX?2UL:0UL);
   retroCharacterTick(&character,result.conditions);
   if(stepRequested){stepRequested=0;retroAudioPlayEffect(&audio,RETRO_PROJECT_AUDIO_SFX_STEP);}
  }
 }
 return 0;
}
