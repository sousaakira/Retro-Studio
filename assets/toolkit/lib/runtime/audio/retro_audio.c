#include "retro_audio.h"
static uint8_t track(const RetroAudio *a,uint16_t value){return (uint8_t)(value==RETRO_ID_NONE||value<a->musicCount);}
uint8_t retroAudioInit(RetroAudio *audio,const RetroAudioDriver *driver,uint16_t musicCount,
 const RetroAudioEffect *effects,uint16_t effectCount,uint8_t channels){
 RetroAudio fresh={0};uint16_t i;
 if(!audio||!driver||!driver->music||!driver->effect||!channels||channels>RETRO_AUDIO_MAX_CHANNELS||
  (effectCount&&!effects)||musicCount==RETRO_ID_NONE||effectCount==RETRO_ID_NONE)return 0;
 for(i=0;i<effectCount;i++)if(effects[i].priority>15||effects[i].channel>channels)return 0;
 fresh.driver=*driver;fresh.effects=effects;fresh.effectCount=effectCount;fresh.musicCount=musicCount;
 fresh.channels=channels;fresh.room=fresh.scripted=fresh.playing=RETRO_ID_NONE;
 for(i=0;i<RETRO_AUDIO_MAX_CHANNELS;i++)fresh.voices[i].effect=RETRO_ID_NONE;
 fresh.ready=1;*audio=fresh;return 1;
}
/* While paused nothing starts: the wanted track begins on resume. */
static void apply(RetroAudio *a){
 uint16_t wanted=a->overridden?a->scripted:a->room;
 if(a->paused||wanted==a->playing)return;
 a->playing=wanted;a->driver.music(a->driver.context,wanted);
}
uint8_t retroAudioRoomMusic(RetroAudio *a,uint16_t value){
 if(!a||!a->ready||!track(a,value))return 0;
 a->room=value;apply(a);return 1;
}
uint8_t retroAudioScriptMusic(RetroAudio *a,uint16_t value){
 if(!a||!a->ready||!track(a,value))return 0;
 a->scripted=value;a->overridden=1;apply(a);return 1;
}
uint8_t retroAudioRestoreMusic(RetroAudio *a){
 if(!a||!a->ready)return 0;
 a->overridden=0;a->scripted=RETRO_ID_NONE;apply(a);return 1;
}
uint8_t retroAudioPause(RetroAudio *a,uint8_t paused){
 if(!a||!a->ready)return 0;
 paused=(uint8_t)(paused?1:0);
 if(paused==a->paused)return 1;
 a->paused=paused;
 /* Starting the track chosen during the pause also ends the pause in the driver. */
 if(!paused&&(a->overridden?a->scripted:a->room)!=a->playing)apply(a);
 else if(a->driver.pause)a->driver.pause(a->driver.context,paused);
 return 1;
}
#define PENDING_TICKS 2
void retroAudioTick(RetroAudio *a){
 uint8_t i;
 if(!a||!a->ready)return;
 for(i=0;i<a->channels;i++)if(a->voices[i].pending)a->voices[i].pending--;
}
static uint8_t busy(const RetroAudio *a,uint8_t index){
 if(a->voices[index].effect==RETRO_ID_NONE)return 0;
 if(a->voices[index].pending)return 1;
 return (uint8_t)(a->driver.busy?a->driver.busy(a->driver.context,(uint8_t)(index+1))!=0:1);
}
RetroAudioPlay retroAudioPlayEffect(RetroAudio *a,uint16_t effect){
 RetroAudioPlay result={0,RETRO_ID_NONE};const RetroAudioEffect *e;uint8_t i,chosen=RETRO_AUDIO_MAX_CHANNELS,occupied=1;
 if(!a||!a->ready||effect>=a->effectCount)return result;
 e=&a->effects[effect];
 /* The driver is asked once per channel at most: each query stops the sound CPU briefly. */
 if(e->channel!=RETRO_AUDIO_CHANNEL_AUTO){chosen=(uint8_t)(e->channel-1);occupied=busy(a,chosen);}
 else{
  for(i=0;i<a->channels&&chosen==RETRO_AUDIO_MAX_CHANNELS;i++)if(!busy(a,i)){chosen=i;occupied=0;}
  if(chosen==RETRO_AUDIO_MAX_CHANNELS)for(chosen=0,i=1;i<a->channels;i++)
   if(a->voices[i].priority<a->voices[chosen].priority||
    (a->voices[i].priority==a->voices[chosen].priority&&a->voices[i].order<a->voices[chosen].order))chosen=i;
 }
 if(occupied&&e->priority<a->voices[chosen].priority)return result;
 if(occupied)result.interrupted=a->voices[chosen].effect;
 a->voices[chosen].effect=effect;a->voices[chosen].priority=e->priority;a->voices[chosen].order=++a->order;
 a->voices[chosen].pending=PENDING_TICKS;
 result.channel=(uint8_t)(chosen+1);
 a->driver.effect(a->driver.context,effect,result.channel,e->priority);
 return result;
}
uint16_t retroAudioRoomTrack(const RetroAudioRoomMusic *rooms,uint16_t count,uint16_t room){
 uint16_t i;
 if(rooms)for(i=0;i<count;i++)if(rooms[i].room==room)return rooms[i].track;
 return RETRO_ID_NONE;
}
void retroAudioCutsceneSound(void *context,int cue){
 if(cue>=0&&cue<0xFFFF)retroAudioPlayEffect((RetroAudio *)context,(uint16_t)cue);
}
void retroAudioCutsceneMusic(void *context,int value){
 if(value<0)retroAudioRestoreMusic((RetroAudio *)context);
 else if(value<0xFFFF)retroAudioScriptMusic((RetroAudio *)context,(uint16_t)value);
}
