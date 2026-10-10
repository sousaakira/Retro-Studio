/* #63 example host: the cutscene runner behind the reference adapter, with the
 * shared camera, audio and progress modules. Isolated fixture; it replaces
 * main.c only inside a temporary project.
 * LEFT/RIGHT walk. B interacts. During a scene: A/C confirm, UP/DOWN choose,
 * START skips. Progress (flags and played scenes) is saved when a scene ends. */
#include <genesis.h>
#include "generated/camera_config.h"
#include "generated/audio_sgdk.h"
#include "generated/progress_config.h"
#include "retro_runtime/retro_progress_sgdk.h"
#include "retro_runtime/retro_cutscene_sgdk.h"
#include "cutscene_data.h"
#include "generated/cutscene_adapter.h"
#define ROOM_WIDTH 512
#define ROOM_HEIGHT 224
#define FLOOR 160
static const u32 gridTile[8]={0x11111111,0x12222221,0x12222221,0x12222221,0x12222221,0x12222221,0x12222221,0x11111111};
static const u32 heroTile[8]={0x00333300,0x03333330,0x33333333,0x33333333,0x33333333,0x33333333,0x03333330,0x03300330};
static const u32 catTile[8]={0x40000004,0x44000044,0x44444444,0x44444444,0x44444444,0x04444440,0x04444440,0x04400440};
static const u16 colours[5]={0x0000,0x0444,0x0222,0x00EE,0x0E4E};
static u16 palette[64];
static RetroCutsceneActor actors[2];
static RetroCamera camera;
static RetroAudio audio;
static RetroCutsceneHost host;
static RetroProgress progress;
static RetroProgressStorage storage;
static RetroInput input;
static u8 saveStatus=0xFF,loadStatus;
static void sceneFinished(void *context,int script){
 (void)context;(void)script;
 retroCutsceneHostStore(&host,&progress,&retroProjectProgress,retroProjectCutsceneFlags,RETRO_PROJECT_CUTSCENE_FLAG_COUNT,
  RETRO_PROJECT_CUTSCENE_PLAYED_OFFSET,RETRO_PROJECT_CUTSCENE_PLAYED_BYTES);
 saveStatus=retroProgressSave(&progress,&retroProjectProgress,&storage,0);
}
static void drawRoom(void){
 u16 x,y;char label[8];
 for(y=0;y<ROOM_HEIGHT/8;y++)for(x=0;x<ROOM_WIDTH/8;x++)
  if(!(x&7)||y==FLOOR/8)VDP_setTileMapXY(BG_B,TILE_ATTR_FULL(PAL0,0,0,0,TILE_USER_INDEX),x,y);
 for(x=0;x<ROOM_WIDTH/64;x++){sprintf(label,"%u",x*64);VDP_drawTextBG(BG_B,label,x*8+1,FLOOR/8+1);}
}
int main(void){
 const RetroCameraConfig *config=IS_PAL_SYSTEM?&retroProjectCameraPal:&retroProjectCameraNtsc;
 RetroCutsceneHooks hooks={0,0,sceneFinished,0};RetroAudioDriver driver;const CutsceneTrigger *triggers;u16 triggerCount,i;
 s16 x=40;signed char direction=1;char line[40];
 VDP_setPlaneSize(64,32,TRUE);VDP_setScrollingMode(HSCROLL_PLANE,VSCROLL_PLANE);
 for(i=0;i<64;i++)palette[i]=PAL_getColor(i);
 for(i=0;i<5;i++)palette[i]=colours[i];
 palette[15]=0x0EEE;PAL_setColors(0,palette,64,DMA);
 VDP_loadTileData(gridTile,TILE_USER_INDEX,1,DMA);VDP_loadTileData(heroTile,TILE_USER_INDEX+1,1,DMA);VDP_loadTileData(catTile,TILE_USER_INDEX+2,1,DMA);
 drawRoom();JOY_init();
 actors[0].x=x;actors[0].y=FLOOR;actors[0].visible=1;actors[0].animation=RETRO_ID_NONE;
 actors[1].x=300;actors[1].y=FLOOR;actors[1].visible=1;actors[1].animation=RETRO_ID_NONE;
 retroCameraInit(&camera,VDP_getScreenWidth(),VDP_getScreenHeight());
 retroCameraEnterRoom(&camera,config,ROOM_WIDTH,ROOM_HEIGHT,0,0,(RetroFixed)x*256,(RetroFixed)FLOOR*256,direction);
 driver=retroAudioSgdkDriver(&retroProjectAudioSgdk);
 retroAudioInit(&audio,&driver,RETRO_PROJECT_AUDIO_MUSIC_COUNT,retroProjectAudioEffects,RETRO_PROJECT_AUDIO_EFFECT_COUNT,RETRO_PROJECT_AUDIO_CHANNELS);
 retroCutsceneHostInit(&host,&cutsceneLibrary,actors,2,&camera,&audio,&hooks,VDP_getScreenWidth());
 /* Continue: scene flags and the played history come back from the save. */
 storage=retroProgressSgdkStorage(RETRO_PROJECT_PROGRESS_SRAM_BYTES);
 retroProgressNew(&progress,&retroProjectProgress);
 loadStatus=retroProgressLoad(&progress,&retroProjectProgress,&storage,0,0);
 if(loadStatus==RETRO_PROGRESS_OK)retroCutsceneHostLoad(&host,&progress,&retroProjectProgress,retroProjectCutsceneFlags,
  RETRO_PROJECT_CUTSCENE_FLAG_COUNT,RETRO_PROJECT_CUTSCENE_PLAYED_OFFSET,RETRO_PROJECT_CUTSCENE_PLAYED_BYTES);
 triggers=retroCutsceneRoomTriggers(retroProjectCutsceneRooms,RETRO_PROJECT_CUTSCENE_ROOM_COUNT,retroProjectCutsceneRooms[0].room,&triggerCount);
 retroAudioRoomMusic(&audio,RETRO_PROJECT_AUDIO_ROOM_COUNT?retroProjectAudioRooms[0].track:RETRO_ID_NONE);
 retroCutsceneHostRoom(&host);
 while(TRUE){
  RetroCameraResult view;u8 control;
  retroInputUpdate(&input,JOY_readJoypad(JOY_1));retroAudioTick(&audio);
  control=retroCutsceneHostUpdate(&host,triggers,triggerCount,x,FLOOR,retroCutsceneSgdkInput(&input),(input.pressed&BUTTON_B)!=0);
  if(control==RETRO_CUTSCENE_CONTROL_PLAYER){
   /* The player owns the hero: input moves it and the actor mirrors the result. */
   if(input.held&BUTTON_LEFT){x-=2;direction=-1;}
   if(input.held&BUTTON_RIGHT){x+=2;direction=1;}
   if(x<8)x=8;
   if(x>ROOM_WIDTH-8)x=ROOM_WIDTH-8;
   actors[0].x=x;actors[0].facingLeft=direction<0;
  }else{
   /* The scene owns the hero: the game follows the actor and ignores input. */
   x=actors[0].x;direction=actors[0].facingLeft?-1:1;
  }
  view=retroCameraTick(&camera,config,(RetroFixed)x*256,(RetroFixed)FLOOR*256,direction);
  VDP_setHorizontalScroll(BG_B,-view.x);
  for(i=0;i<2;i++){
   VDP_setSpriteFull(i,actors[i].visible?actors[i].x-view.x-4:-32,actors[i].y-8,SPRITE_SIZE(1,1),
    TILE_ATTR_FULL(PAL0,1,0,actors[i].facingLeft,TILE_USER_INDEX+1+i),i==1?0:1);
   actors[i].changed=0;
  }
  VDP_updateSprites(2,DMA_QUEUE);
  retroCutsceneSgdkPresent(&host,palette);
  sprintf(line,"CTRL %c SCENE %5u CAM %3d %c",control==RETRO_CUTSCENE_CONTROL_SCENE?'S':'P',host.script,view.x,(view.flags&RETRO_CAMERA_SCRIPT)?'S':' ');VDP_drawText(line,1,1);
  sprintf(line,"HERO %3d CAT %3d V%u L%u DARK %u",actors[0].x,actors[1].x,actors[1].visible,actors[1].facingLeft,host.dark);VDP_drawText(line,1,2);
  sprintf(line,"MET %u DOOR %u PLAYED %u%u MUSIC %u%c",cutsceneFlag(&host.runner,CUTSCENE_FLAG_MET_CAT),cutsceneFlag(&host.runner,CUTSCENE_FLAG_DOOR_OPEN),
   cutscenePlayed(&host.runner,CUTSCENE_MEET),cutscenePlayed(&host.runner,CUTSCENE_AGAIN),audio.playing==RETRO_ID_NONE?9:audio.playing,audio.overridden?'S':' ');VDP_drawText(line,1,3);
  sprintf(line,"LOAD %u SAVE %3u",loadStatus,saveStatus);VDP_drawText(line,1,4);
  SYS_doVBlankProcess();
 }
 return 0;
}
