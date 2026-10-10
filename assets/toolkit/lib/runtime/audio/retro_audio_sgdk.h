#ifndef RETRO_STUDIO_AUDIO_SGDK_H
#define RETRO_STUDIO_AUDIO_SGDK_H
#include <genesis.h>
#include "retro_audio.h"
/* SGDK 1.81 XGM driver. Music is an XGM resource; effects are WAV resources
 * converted for XGM (14 kHz PCM) and registered as samples 64.. (1-63 belong
 * to the music). firstChannel maps logical channel 1: use SOUND_PCM_CH2 to
 * keep PCM channel 1 for the music's own samples, SOUND_PCM_CH1 to use all 4. */
#define RETRO_AUDIO_SGDK_FIRST_SAMPLE 64
#define RETRO_AUDIO_SGDK_MAX_EFFECTS 192
typedef struct {const u8 *data;u32 length;} RetroAudioSgdkSample;
typedef struct {
 const u8 *const *music;const RetroAudioSgdkSample *samples;
 u16 musicCount,sampleCount,firstChannel;
} RetroAudioSgdk;
static void retroAudioSgdkMusic(void *context,uint16_t track){
 const RetroAudioSgdk *host=(const RetroAudioSgdk *)context;
 if(track<host->musicCount)XGM_startPlay(host->music[track]);
 else XGM_stopPlay();
}
static void retroAudioSgdkEffect(void *context,uint16_t effect,uint8_t channel,uint8_t priority){
 const RetroAudioSgdk *host=(const RetroAudioSgdk *)context;
 if(effect<host->sampleCount)XGM_startPlayPCM((u8)(RETRO_AUDIO_SGDK_FIRST_SAMPLE+effect),priority,(u16)(host->firstChannel+channel-1));
}
static void retroAudioSgdkPause(void *context,uint8_t paused){
 (void)context;if(paused)XGM_pausePlay();else XGM_resumePlay();
}
static uint8_t retroAudioSgdkBusy(void *context,uint8_t channel){
 const RetroAudioSgdk *host=(const RetroAudioSgdk *)context;
 return (uint8_t)(XGM_isPlayingPCM((u16)(1<<(host->firstChannel+channel-1)))!=0);
}
/* Registers every effect sample and returns the driver for retroAudioInit.
 * host must outlive the RetroAudio that uses the driver. */
static inline RetroAudioDriver retroAudioSgdkDriver(RetroAudioSgdk *host){
 RetroAudioDriver driver={retroAudioSgdkMusic,retroAudioSgdkEffect,retroAudioSgdkPause,retroAudioSgdkBusy,0};
 u16 i;
 if(host->sampleCount>RETRO_AUDIO_SGDK_MAX_EFFECTS)host->sampleCount=RETRO_AUDIO_SGDK_MAX_EFFECTS;
 for(i=0;i<host->sampleCount;i++)XGM_setPCM((u8)(RETRO_AUDIO_SGDK_FIRST_SAMPLE+i),host->samples[i].data,host->samples[i].length);
 driver.context=host;return driver;
}
#endif
