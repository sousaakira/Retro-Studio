/* #55: two compiled rooms + persistent host sprite. Diagnostic, not game logic. */
#include <genesis.h>
#include "resources.h"
#include "retro_runtime/retro_world_sgdk.h"
#include "retro_runtime/retro_movement.h"
#include "retro_runtime/retro_character_sprite.h"
#include "worldhero_animations.h"
#include "generated/world_config.h"
#include "generated/camera_config.h"
#include "generated/world_fixture_assets.h"
static RetroWorld world={0};
static RetroWorldSgdk bridge={0};
static RetroInput input={0};
static Sprite *hero;
static RetroMovement movement={0};
static RetroMovementConfig physics;
static RetroCharacter character={0};
static RetroCharacterSprite characterSprite={0};
static u8 animationCondition(void *context,u16 predicate){
 (void)context;
 return predicate==1?movement.velocityY<0:predicate==2?movement.velocityY>=0:0;
}
static const RetroWorldMapGeometry *geometry;
#define HOST_SPRITE_TILE_RESERVE 128
#if RETRO_WORLD_SCENE_COUNT
typedef struct {RetroScene scene;RetroSceneObject objects[RETRO_SCENE_MAX_OBJECTS];const RetroWorldMapScene *binding;RetroSceneResourceBudget budget;u8 used;} RoomScene;
static RoomScene scenes[2],*activeScene;
static u8 prepareScene(void *context,const RetroWorldRoom *room,void **handle){
 u16 i;RoomScene *slot;u8 result;
 const RetroWorldMapScene *binding=retroWorldMapSceneFind(room->id);(void)context;
 const Palette *palettes[4]={0,WORLD_HERO.palette,0,0};
 RetroSceneResourceBudget budget;u32 tiles,sprites;
 if(!binding)return 0;
 if(retroSceneValidatePalettes(binding->objects,binding->count,palettes)!=RETRO_SCENE_OK||
    retroSceneMeasureResources(binding->objects,binding->count,&budget)!=RETRO_SCENE_OK)return 0;
 tiles=budget.tiles+WORLD_HERO.maxNumTile+(activeScene?activeScene->budget.tiles:0);
 sprites=budget.sprites+WORLD_HERO.maxNumSprite+(activeScene?activeScene->budget.sprites:0);
 /* Keep old and pending scenes alive until commit; SPR allocation remains the
  * final authority for fragmentation and software sprite capacity. */
 if(tiles>HOST_SPRITE_TILE_RESERVE||sprites>=(u32)(screenWidth>>2))return 0;
 for(i=0;i<2&&scenes[i].used;i++);
 if(i==2)return 0;
 slot=&scenes[i];slot->used=1;slot->binding=binding;slot->budget=budget;*handle=slot;
 result=retroSceneInit(&slot->scene,slot->objects,RETRO_SCENE_MAX_OBJECTS,binding->objects,binding->count);
 if(result!=RETRO_SCENE_OK)return 0;
 for(i=0;i<slot->scene.count;i++)SPR_setVisibility(slot->objects[i].sprite,HIDDEN);
 return 1;
}
static void activateScene(void *context,const RetroWorldRoom *room,void *handle){
 RoomScene *slot=handle;u16 i;(void)context;(void)room;
 if(activeScene&&activeScene!=slot)for(i=0;i<activeScene->scene.count;i++)SPR_setVisibility(activeScene->objects[i].sprite,HIDDEN);
 activeScene=slot;
 /* Fixture character and objects deliberately share one PAL1 palette. */
 if(slot->binding->palette)slot->binding->palette();
 retroScenePosition(&slot->scene,bridge.cameraX,bridge.cameraY);
}
static void releaseScene(void *context,const RetroWorldRoom *room,void *handle){
 RoomScene *slot=handle;(void)context;(void)room;
 retroSceneFree(&slot->scene);slot->used=0;slot->binding=0;slot->budget=(RetroSceneResourceBudget){0,0};
 if(activeScene==slot)activeScene=0;
}
#endif
static s16 playerX,playerY;
/* #59: exported framing drives the bridge scroll; UP releases a locked arena. */
static RetroCamera camera;
static const RetroCameraConfig *framing;
static RetroCameraResult view;
static u8 playerFacing,hasKey,status;
static void placeHero(void){
 if(!geometry)return;
 retroCharacterSpriteFacing(&characterSprite,playerFacing,0);
 retroCharacterSpritePosition(&characterSprite,playerX,playerY,bridge.cameraX,bridge.cameraY);
}
static void activated(void *context,const RetroWorld *value){
 u16 i;RetroBody body;
 (void)context;
 geometry=0;
 for(i=0;i<RETRO_WORLD_MAP_COUNT;i++)if(retroWorldMapGeometry[i].room==value->room->id){geometry=&retroWorldMapGeometry[i];break;}
 /* Every authored room has a matching geometry binding. */
 if(!geometry)return;
 body.x=(RetroFixed)value->x*RETRO_FIXED_ONE;body.y=(RetroFixed)value->y*RETRO_FIXED_ONE;
 body.box=geometry->body;body.mask=0xFFFF;
 retroMovementInit(&movement,&body);
 movement.facing=movement.movementFacing=value->facing;
 retroCharacterSetState(&character,WORLDHERO_ANIM_IDLE);
 playerX=value->x;playerY=value->y;playerFacing=value->facing;
 {const RetroCameraRegion *regions=0;u16 count=0;
  for(i=0;i<RETRO_PROJECT_CAMERA_ROOM_COUNT;i++)if(retroProjectCameraRooms[i].room==value->room->id){
   regions=retroProjectCameraRooms[i].regions;count=retroProjectCameraRooms[i].count;break;}
  if(!retroCameraEnterRoom(&camera,framing,(s16)value->room->width,(s16)value->room->height,regions,count,
   body.x,body.y,(signed char)(value->facing?-1:1)))status=RETRO_WORLD_INVALID;}
 /* Fixture art leaves PAL0 colour 15 unused; keep the HUD font readable. */
 PAL_setColor(15,0x0EEE);
 placeHero();SPR_update();
}
static u8 condition(void *context,u16 id){(void)context;return id==FIXTURE_KEY&&hasKey;}
static void hud(void){
 char codes[5]={'0'+status,'/','0'+bridge.lastError,0,0};
 char flags[4]={(view.flags&RETRO_CAMERA_LOCKED)?'L':' ',(view.flags&RETRO_CAMERA_TRANSITION)?'T':' ',view.invalid?'!':' ',0};
 VDP_drawText(flags,31,0);
 VDP_drawText(world.room->id==FIXTURE_HALL?"HALL":"CAVE",0,0);
 VDP_drawText("A EXIT B JUMP C KEY+CHECKPOINT",0,1);
 VDP_drawText("ARROWS MOVE / START RESPAWN",0,2);
 VDP_drawText(codes,35,0);
}
int main(bool hardReset){
 RetroCharacterHost animationHost={0,animationCondition,0,0,0};
#if RETRO_WORLD_SCENE_COUNT
 RetroWorldSgdkContentHooks content={prepareScene,activateScene,releaseScene,0};
#endif
 (void)hardReset;
 retroMovementPreset(&physics);
 framing=IS_PAL_SYSTEM?&retroProjectCameraPal:&retroProjectCameraNtsc;
 retroCameraInit(&camera,320,224);
 VDP_setScreenWidth320();VDP_setPlaneSize(64,32,TRUE);
 VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
 DMA_setBufferSize(8192);DMA_setMaxQueueSize(64);DMA_setMaxTransferSize(7200);DMA_setAutoFlush(TRUE);
 VDP_setWindowVPos(FALSE,3);VDP_setTextPlane(WINDOW);JOY_init();
 SPR_initEx(HOST_SPRITE_TILE_RESERVE);PAL_setPalette(PAL1,WORLD_HERO.palette->data,DMA);
 hero=SPR_addSprite(&WORLD_HERO,0,0,TILE_ATTR(PAL1,TRUE,FALSE,FALSE));
 if(!hero){VDP_drawText("NO CHARACTER VRAM",1,0);while(TRUE)SYS_doVBlankProcess();}
 if(!retroCharacterInit(&character,&worldhero_character_definition,WORLDHERO_ANIM_IDLE,&animationHost)||
    !retroCharacterSpriteAttach(&characterSprite,&character,hero)){
  VDP_drawText("CHARACTER CONTROLLER FAILED",1,0);while(TRUE)SYS_doVBlankProcess();
 }
 retroCharacterSpritePriority(&characterSprite,TRUE);
 SPR_update();SYS_doVBlankProcess();
#if RETRO_WORLD_SCENE_COUNT
 status=retroWorldSgdkInitWithContent(&bridge,&world,&retroProjectWorld,worldFixtureAssets,RETRO_WORLD_MAP_COUNT,&content,activated,condition,0);
#else
 status=retroWorldSgdkInit(&bridge,&world,&retroProjectWorld,worldFixtureAssets,RETRO_WORLD_MAP_COUNT,activated,condition,0);
#endif
 if(status!=RETRO_WORLD_OK){VDP_drawText("WORLD INIT FAILED",1,0);while(TRUE)SYS_doVBlankProcess();}
 hud();
 while(TRUE){
  RetroMovementInput controls={0,0};RetroMovementResult result={0};u8 switched=0;
  retroInputUpdate(&input,JOY_readJoypad(JOY_1));
  if(input.pressed&BUTTON_C){hasKey=1;status=retroWorldCheckpoint(&world,FIXTURE_CHECKPOINT);}
  if(input.pressed&BUTTON_A){status=retroWorldExitThrough(&world,world.room->id==FIXTURE_HALL?FIXTURE_NEXT:FIXTURE_BACK);switched=status==RETRO_WORLD_OK;}
  if(input.pressed&BUTTON_UP)retroCameraUnlock(&camera);
  if(input.pressed&BUTTON_START){status=retroWorldRespawn(&world);switched=status==RETRO_WORLD_OK;}
  controls.axis=retroInputAxis(&input,BUTTON_LEFT,BUTTON_RIGHT);
  if(input.held&BUTTON_B)controls.buttons|=RETRO_MOVE_JUMP_HELD;
  if(input.pressed&BUTTON_B)controls.buttons|=RETRO_MOVE_JUMP_PRESSED;
  if(input.held&BUTTON_DOWN)controls.buttons|=RETRO_MOVE_DROP_HELD;
  if(!switched&&geometry){
   result=retroMovementTick(&movement,&physics,controls,geometry->colliders,geometry->colliderCount,geometry->slopes,geometry->slopeCount);
   if(result.invalid)status=RETRO_WORLD_INVALID;
  }
  if(geometry){
   RetroFixed minimum=-(RetroFixed)geometry->body.x*RETRO_FIXED_ONE;
   RetroFixed maximum=((RetroFixed)world.room->width-geometry->body.x-geometry->body.width)*RETRO_FIXED_ONE;
   if(movement.body.x<minimum){movement.body.x=minimum;movement.velocityX=0;}
   if(movement.body.x>maximum){movement.body.x=maximum;movement.velocityX=0;}
   if(view.flags&RETRO_CAMERA_LOCKED){
    /* A locked arena keeps the body inside the camera limits. */
    RetroRect arena;
    if(retroCameraBounds(&camera,&arena)){
     minimum=((RetroFixed)arena.x-geometry->body.x)*RETRO_FIXED_ONE;
     maximum=((RetroFixed)arena.x+arena.width-geometry->body.x-geometry->body.width)*RETRO_FIXED_ONE;
     if(movement.body.x<minimum){movement.body.x=minimum;movement.velocityX=0;}
     if(movement.body.x>maximum){movement.body.x=maximum;movement.velocityX=0;}
    }
   }
  }
  playerX=movement.body.x/RETRO_FIXED_ONE;playerY=movement.body.y/RETRO_FIXED_ONE;playerFacing=movement.facing;
  /* A room boundary can stop X after the terrain solver produced its flags. */
  result.conditions=(result.conditions&~2UL)|(movement.velocityX?2UL:0UL);
  /* The bridge queues map edges first. The host queues sprite work afterward. */
  view=retroCameraTick(&camera,framing,movement.body.x,movement.body.y,(signed char)(playerFacing?-1:1));
  if(view.invalid)status=RETRO_WORLD_INVALID;
  else if(retroWorldSgdkScroll(&bridge,view.x,view.y)!=RETRO_WORLD_SGDK_OK)status=RETRO_WORLD_LOAD_FAILED;
  placeHero();
#if RETRO_WORLD_SCENE_COUNT
  retroScenePosition(&activeScene->scene,bridge.cameraX,bridge.cameraY);
#endif
  hud();SPR_update();SYS_doVBlankProcess();
  if(!switched&&!result.invalid)retroCharacterTick(&character,result.conditions);
#if RETRO_WORLD_SCENE_COUNT
  retroSceneTick(&activeScene->scene);
#endif
 }
 return 0;
}
