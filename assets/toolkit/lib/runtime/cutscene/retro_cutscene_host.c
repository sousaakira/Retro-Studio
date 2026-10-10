#include "retro_cutscene_host.h"
#ifdef RETRO_CUTSCENE_HOST_AVAILABLE
#define HOST ((RetroCutsceneHost *)context)
static RetroCutsceneActor *actor(void *context,int index){
 return index>=0&&index<HOST->actorCount?&HOST->actors[index]:0;
}
static int16_t pixel(int value){return (int16_t)(value<-32768?-32768:value>32767?32767:value);}
static void actorGet(void *context,int index,int *x,int *y){
 const RetroCutsceneActor *a=actor(context,index);
 *x=a?a->x:0;*y=a?a->y:0;
}
static void actorSet(void *context,int index,int x,int y,int moving){
 RetroCutsceneActor *a=actor(context,index);
 if(!a)return;
 a->x=pixel(x);a->y=pixel(y);a->moving=(uint8_t)(moving!=0);a->changed=1;
}
static void actorFace(void *context,int index,int left){
 RetroCutsceneActor *a=actor(context,index);
 if(a){a->facingLeft=(uint8_t)(left!=0);a->changed=1;}
}
static void actorAnimate(void *context,int index,int animation){
 RetroCutsceneActor *a=actor(context,index);
 if(a){a->animation=animation<0||animation>=CUTSCENE_NONE?RETRO_ID_NONE:(uint16_t)animation;a->changed=1;}
}
static void actorVisible(void *context,int index,int visible){
 RetroCutsceneActor *a=actor(context,index);
 if(a){a->visible=(uint8_t)(visible!=0);a->changed=1;}
}
/* The runner owns the structs it passes; copies keep them valid for drawing. */
static void dialogueShow(void *context,const CutsceneDialogue *dialogue){
 HOST->dialogue=*dialogue;HOST->dialogueVisible=1;HOST->choiceVisible=0;HOST->textChanged=1;
}
static void choiceShow(void *context,const CutsceneChoice *choice){
 HOST->choice=*choice;HOST->choiceVisible=1;HOST->dialogueVisible=0;HOST->textChanged=1;
}
static void dialogueHide(void *context){
 if(HOST->dialogueVisible||HOST->choiceVisible)HOST->textChanged=1;
 HOST->dialogueVisible=HOST->choiceVisible=0;
}
static int cameraGet(void *context){
 return HOST->camera?retroCameraCutsceneGet(HOST->camera):HOST->cameraX;
}
static void cameraSet(void *context,int follow,int x){
 HOST->cameraFollow=(uint8_t)(follow!=0);
 if(HOST->camera)retroCameraCutsceneSet(HOST->camera,follow,x);
 else if(!follow)HOST->cameraX=pixel(x);
}
static int cameraClamp(void *context,int x){
 return HOST->camera?retroCameraCutsceneClamp(HOST->camera,x):x;
}
static void fade(void *context,int out,int frames){
 HOST->dark=(uint8_t)(out!=0);HOST->fadeFrames=(uint16_t)(frames<0?0:frames>0xFFFF?0xFFFF:frames);HOST->fadeChanged=1;
}
static void sound(void *context,int cue){if(HOST->audio)retroAudioCutsceneSound(HOST->audio,cue);}
static void music(void *context,int track){if(HOST->audio)retroAudioCutsceneMusic(HOST->audio,track);}
static void ability(void *context,int value){if(HOST->hooks.ability)HOST->hooks.ability(HOST->hooks.context,value);}
static void event(void *context,int value,int argument){if(HOST->hooks.event)HOST->hooks.event(HOST->hooks.context,value,argument);}
/* End of every scene, played or skipped: the room music comes back, the
 * dialogue is gone and the player gets control on the next update. */
static void finished(void *context,int script){
 if(HOST->audio)retroAudioRestoreMusic(HOST->audio);
 HOST->dialogueVisible=HOST->choiceVisible=0;HOST->textChanged=1;HOST->cameraFollow=1;HOST->release=1;
 if(HOST->hooks.finished)HOST->hooks.finished(HOST->hooks.context,script);
}
uint8_t retroCutsceneHostInit(RetroCutsceneHost *host,const CutsceneLibrary *library,
 RetroCutsceneActor *actors,uint8_t actorCount,RetroCamera *camera,RetroAudio *audio,
 const RetroCutsceneHooks *hooks,int16_t viewWidth){
 uint8_t *bytes=(uint8_t *)host;uint16_t i;
 if(!host||!library||(actorCount&&!actors)||actorCount>CUTSCENE_MAX_ACTORS||viewWidth<8||viewWidth>320)return 0;
 for(i=0;i<sizeof(*host);i++)bytes[i]=0;
 host->actors=actors;host->actorCount=actorCount;host->camera=camera;host->audio=audio;
 if(hooks)host->hooks=*hooks;
 host->host.context=host;host->host.viewWidth=viewWidth;
 host->host.actorGet=actorGet;host->host.actorSet=actorSet;host->host.actorFace=actorFace;
 host->host.actorAnimate=actorAnimate;host->host.actorVisible=actorVisible;
 host->host.dialogueShow=dialogueShow;host->host.choiceShow=choiceShow;host->host.dialogueHide=dialogueHide;
 host->host.cameraGet=cameraGet;host->host.cameraSet=cameraSet;host->host.cameraClamp=cameraClamp;
 host->host.fade=fade;host->host.sound=sound;host->host.music=music;
 host->host.ability=ability;host->host.event=event;host->host.finished=finished;
 cutsceneInit(&host->runner,library);
 host->cameraFollow=1;host->script=RETRO_ID_NONE;host->ready=1;return 1;
}
void retroCutsceneHostRoom(RetroCutsceneHost *host){
 if(!host||!host->ready)return;
 host->inside=0;host->entered=1;
}
uint8_t retroCutsceneHostStart(RetroCutsceneHost *host,uint16_t script){
 /* Also allowed on the hand-back frame (for example from the finished hook): the scene keeps the player. */
 if(!host||!host->ready||(host->control!=RETRO_CUTSCENE_CONTROL_PLAYER&&!host->release)||
  !cutsceneStart(&host->runner,&host->host,script))return 0;
 host->script=script;host->control=RETRO_CUTSCENE_CONTROL_SCENE;host->release=0;return 1;
}
uint8_t retroCutsceneHostUpdate(RetroCutsceneHost *host,const CutsceneTrigger *triggers,uint16_t count,
 int16_t x,int16_t y,unsigned int input,uint8_t interact){
 int found,events;
 if(!host||!host->ready)return RETRO_CUTSCENE_CONTROL_PLAYER;
 if(host->control==RETRO_CUTSCENE_CONTROL_SCENE){
  /* The frame after the end still belongs to the scene; control returns on the next one. */
  if(host->release){host->release=0;host->control=RETRO_CUTSCENE_CONTROL_PLAYER;return RETRO_CUTSCENE_CONTROL_SCENE;}
  cutsceneStep(&host->runner,&host->host,input);
  return RETRO_CUTSCENE_CONTROL_SCENE;
 }
 events=CUTSCENE_EVENT_TOUCH|(interact?CUTSCENE_EVENT_INTERACT:0)|(host->entered?CUTSCENE_EVENT_ENTER:0);
 if(!triggers||!count){host->entered=0;return RETRO_CUTSCENE_CONTROL_PLAYER;}
 found=cutsceneTriggerFind(&host->runner,triggers,count>32?32:count,x,y,events,&host->inside);
 /* A touch or interact scene found first must not swallow the room's enter
  * trigger: it stays pending for the first player frame after that scene. */
 if(found<0||triggers[found].start==CUTSCENE_START_ENTER)host->entered=0;
 if(found>=0&&retroCutsceneHostStart(host,triggers[found].cutscene))return RETRO_CUTSCENE_CONTROL_SCENE;
 return RETRO_CUTSCENE_CONTROL_PLAYER;
}
const CutsceneTrigger *retroCutsceneRoomTriggers(const RetroCutsceneRoomTriggers *rooms,uint16_t roomCount,
 uint16_t room,uint16_t *count){
 uint16_t i;
 if(count)*count=0;
 if(rooms&&count)for(i=0;i<roomCount;i++)if(rooms[i].room==room){*count=rooms[i].count;return rooms[i].triggers;}
 return 0;
}
static uint8_t links(const RetroProgressConfig *config,const RetroCutsceneFlagLink *list,uint16_t count,
 uint16_t offset,uint8_t bytes){
 uint16_t i;
 if(!retroProgressValidate(config)||(count&&!list)||bytes>(CUTSCENE_MAX_SCRIPTS+7)/8||
  (bytes&&(uint32_t)offset+bytes>config->layout.dataSize))return 0;
 for(i=0;i<count;i++)if(list[i].cutsceneFlag>=CUTSCENE_MAX_FLAGS||list[i].progressFlag>=config->layout.flagCount)return 0;
 return 1;
}
uint8_t retroCutsceneHostStore(const RetroCutsceneHost *host,RetroProgress *progress,const RetroProgressConfig *config,
 const RetroCutsceneFlagLink *list,uint16_t count,uint16_t offset,uint8_t bytes){
 uint16_t i;
 if(!host||!host->ready||!progress||host->runner.active||!links(config,list,count,offset,bytes))return 0;
 for(i=0;i<count;i++)retroProgressSetFlag(progress,config,list[i].progressFlag,(uint8_t)cutsceneFlag(&host->runner,list[i].cutsceneFlag));
 for(i=0;i<bytes;i++)progress->data[offset+i]=host->runner.played[i];
 return 1;
}
uint8_t retroCutsceneHostLoad(RetroCutsceneHost *host,const RetroProgress *progress,const RetroProgressConfig *config,
 const RetroCutsceneFlagLink *list,uint16_t count,uint16_t offset,uint8_t bytes){
 uint16_t i;
 if(!host||!host->ready||!progress||host->runner.active||!links(config,list,count,offset,bytes))return 0;
 cutsceneResetProgress(&host->runner);
 for(i=0;i<count;i++)cutsceneSetFlag(&host->runner,list[i].cutsceneFlag,retroProgressFlag(progress,config,list[i].progressFlag));
 for(i=0;i<bytes;i++)host->runner.played[i]=progress->data[offset+i];
 host->inside=0;return 1;
}
#endif
