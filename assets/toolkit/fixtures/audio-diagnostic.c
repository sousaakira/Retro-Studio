/* #50 diagnostic host: exported audio catalog through the shared module and
 * the SGDK XGM adapter. Isolated fixture; it replaces main.c only inside a
 * temporary project. A/B/C play effects 0/1/2. START alternates the room
 * music. UP starts a scripted (cutscene) track different from the room's, DOWN returns to the room
 * music. LEFT pauses/resumes. RIGHT plays effect 2 four times in one frame. */
#include <genesis.h>
#include "generated/audio_sgdk.h"
static RetroAudio audio;
static RetroInput input;
static RetroAudioPlay last;
static u16 lastEffect=RETRO_ID_NONE,dropped,interrupted;
static void play(u16 effect){
 lastEffect=effect;last=retroAudioPlayEffect(&audio,effect);
 if(!last.channel)dropped++;
 else if(last.interrupted!=RETRO_ID_NONE)interrupted++;
}
int main(void){
 RetroAudioDriver driver;u16 room=0,i;char line[40];
 PAL_setColor(15,0x0EEE);JOY_init();
 driver=retroAudioSgdkDriver(&retroProjectAudioSgdk);
 if(!retroAudioInit(&audio,&driver,RETRO_PROJECT_AUDIO_MUSIC_COUNT,retroProjectAudioEffects,RETRO_PROJECT_AUDIO_EFFECT_COUNT,RETRO_PROJECT_AUDIO_CHANNELS)){
  VDP_drawText("AUDIO INIT FAILED",1,1);while(TRUE)SYS_doVBlankProcess();
 }
 VDP_drawText("A B C EFFECTS  START ROOM MUSIC",1,20);
 VDP_drawText("UP SCRIPT  DOWN RESTORE  LEFT PAUSE",1,22);
 VDP_drawText("RIGHT 4X EFFECT 2",1,24);
 while(TRUE){
  retroInputUpdate(&input,JOY_readJoypad(JOY_1));retroAudioTick(&audio);
  if(input.pressed&BUTTON_A)play(0);
  if(input.pressed&BUTTON_B)play(1);
  if(input.pressed&BUTTON_C)play(2);
  if(input.pressed&BUTTON_RIGHT)for(i=0;i<4;i++)play(2);
  if(input.pressed&BUTTON_START){retroAudioRoomMusic(&audio,room);room=(u16)((room+1)%RETRO_PROJECT_AUDIO_MUSIC_COUNT);}
  if(input.pressed&BUTTON_UP)retroAudioCutsceneMusic(&audio,audio.room==0&&RETRO_PROJECT_AUDIO_MUSIC_COUNT>1?1:0);
  if(input.pressed&BUTTON_DOWN)retroAudioCutsceneMusic(&audio,-1);
  if(input.pressed&BUTTON_LEFT)retroAudioPause(&audio,!audio.paused);
  sprintf(line,"AUDIO MUSIC %u SFX %u CH %u",RETRO_PROJECT_AUDIO_MUSIC_COUNT,RETRO_PROJECT_AUDIO_EFFECT_COUNT,RETRO_PROJECT_AUDIO_CHANNELS);VDP_drawText(line,1,1);
  sprintf(line,"ROOM %5u SCRIPT %5u PLAY %5u ",audio.room,audio.scripted,audio.playing);VDP_drawText(line,1,4);
  sprintf(line,"XGM %u OVERRIDE %u PAUSED %u ",XGM_isPlaying()?1:0,audio.overridden,audio.paused);VDP_drawText(line,1,6);
  for(i=0;i<RETRO_PROJECT_AUDIO_CHANNELS;i++){
   sprintf(line,"CH%u SFX %5u PRI %2u BUSY %u ",i+1,audio.voices[i].effect,audio.voices[i].priority,retroAudioSgdkBusy(&retroProjectAudioSgdk,(u8)(i+1)));
   VDP_drawText(line,1,9+i);
  }
  sprintf(line,"LAST %5u -> CH %u CUT %5u ",lastEffect,last.channel,last.interrupted);VDP_drawText(line,1,14);
  sprintf(line,"DROPPED %3u INTERRUPTED %3u ",dropped,interrupted);VDP_drawText(line,1,16);
  SYS_doVBlankProcess();
 }
 return 0;
}
