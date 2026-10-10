#ifndef RETRO_STUDIO_AUDIO_H
#define RETRO_STUDIO_AUDIO_H
#include "retro_core.h"
#define RETRO_RUNTIME_AUDIO_VERSION 1
#define RETRO_AUDIO_MAX_CHANNELS 4
#define RETRO_AUDIO_CHANNEL_AUTO 0
/* Music and effects are numbers from the exported catalog; the module knows no
 * game names and no sound driver. channel: RETRO_AUDIO_CHANNEL_AUTO or 1..channels. */
typedef struct {uint8_t priority,channel;} RetroAudioEffect;
typedef struct {uint16_t room,track;} RetroAudioRoomMusic;
/* Driver supplied by the host (SGDK adapter, test double...). busy is optional;
 * without it a started voice never frees its channel: only an effect of equal
 * or higher priority can replace it, so supply busy whenever priorities differ. */
typedef struct {
 void (*music)(void *context,uint16_t track); /* RETRO_ID_NONE = silence */
 void (*effect)(void *context,uint16_t effect,uint8_t channel,uint8_t priority);
 void (*pause)(void *context,uint8_t paused);
 uint8_t (*busy)(void *context,uint8_t channel);
 void *context;
} RetroAudioDriver;
/* pending: ticks a started voice still counts as busy while the driver catches up. */
typedef struct {uint16_t effect;uint32_t order;uint8_t priority,pending;} RetroAudioVoice;
typedef struct {
 RetroAudioDriver driver;const RetroAudioEffect *effects;
 uint16_t effectCount,musicCount,room,scripted,playing;
 uint32_t order;uint8_t channels,ready,overridden,paused;
 RetroAudioVoice voices[RETRO_AUDIO_MAX_CHANNELS];
} RetroAudio;
/* channel 0: the effect was dropped. interrupted: effect cut short, or RETRO_ID_NONE. */
typedef struct {uint8_t channel;uint16_t interrupted;} RetroAudioPlay;
uint8_t retroAudioInit(RetroAudio *audio,const RetroAudioDriver *driver,uint16_t musicCount,
 const RetroAudioEffect *effects,uint16_t effectCount,uint8_t channels);
/* Room music: the same track keeps playing across rooms. RETRO_ID_NONE = silence. */
uint8_t retroAudioRoomMusic(RetroAudio *audio,uint16_t track);
/* Scripted music (cutscene) hides the room music until retroAudioRestoreMusic. */
uint8_t retroAudioScriptMusic(RetroAudio *audio,uint16_t track);
uint8_t retroAudioRestoreMusic(RetroAudio *audio);
/* While paused, music changes are remembered and start on resume. */
uint8_t retroAudioPause(RetroAudio *audio,uint8_t paused);
/* Call once per video frame. Sound drivers report a channel as busy only after
 * they process the command, so effects started in the same frame would all
 * pick the same free channel without this short reservation. */
void retroAudioTick(RetroAudio *audio);
/* Free channel first; otherwise the oldest voice of the lowest priority is
 * interrupted when the new priority is equal or higher; otherwise dropped. */
RetroAudioPlay retroAudioPlayEffect(RetroAudio *audio,uint16_t effect);
/* Track of a room in the exported table, or RETRO_ID_NONE when it has none. */
uint16_t retroAudioRoomTrack(const RetroAudioRoomMusic *rooms,uint16_t count,uint16_t room);
/* CutsceneHost glue: context is the RetroAudio. track < 0 returns to the room music. */
void retroAudioCutsceneSound(void *context,int cue);
void retroAudioCutsceneMusic(void *context,int track);
#endif
