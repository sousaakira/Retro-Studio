#ifndef RETRO_STUDIO_CUTSCENE_HOST_H
#define RETRO_STUDIO_CUTSCENE_HOST_H
/* Reference host for the Retro Studio cutscene runner: connects actors,
 * animations, camera, dialogue, music and flags to the shared modules.
 * Pure C99. Needs the cutscene runtime installed (src/retrostudio/).
 * Games with their own CutsceneHost keep working and do not need this module. */
#if defined(__has_include) && !__has_include("retrostudio/cutscene_runner.h")
/* Cutscene runtime not installed: the module is inert. */
#else
#define RETRO_CUTSCENE_HOST_AVAILABLE 1
#include "retro_camera.h"
#include "retro_audio.h"
#include "retro_progress.h"
#include "retrostudio/cutscene_runner.h"
#define RETRO_RUNTIME_CUTSCENE_HOST_VERSION 1
/* x: horizontal centre, y: feet, in room pixels. animation RETRO_ID_NONE =
 * automatic (the game picks idle/walk from moving). changed: set by the scene,
 * cleared by the game after it applied the actor to its sprite/body. */
typedef struct {int16_t x,y;uint16_t animation;uint8_t facingLeft,visible,moving,changed;} RetroCutsceneActor;
enum {RETRO_CUTSCENE_CONTROL_PLAYER=0,RETRO_CUTSCENE_CONTROL_SCENE=1};
/* Optional game callbacks for what no shared module owns. */
typedef struct {
 void (*ability)(void *context,int ability);
 void (*event)(void *context,int event,int argument);
 void (*finished)(void *context,int script);
 void *context;
} RetroCutsceneHooks;
typedef struct {uint16_t cutsceneFlag,progressFlag;} RetroCutsceneFlagLink;
typedef struct {uint16_t room;const CutsceneTrigger *triggers;uint16_t count;} RetroCutsceneRoomTriggers;
typedef struct {
 CutsceneRunner runner;CutsceneHost host;
 RetroCutsceneActor *actors;RetroCamera *camera;RetroAudio *audio;RetroCutsceneHooks hooks;
 CutsceneDialogue dialogue;CutsceneChoice choice;
 unsigned int inside;        /* touch areas the player is already in */
 int16_t cameraX;            /* without a RetroCamera: the game writes its camera X here on player frames */
 uint16_t fadeFrames,script; /* script: last started scene */
 uint8_t actorCount,ready,control,release,entered;
 uint8_t dialogueVisible,choiceVisible,textChanged; /* presentation state */
 uint8_t dark,fadeChanged;                          /* dark: screen faded out */
 uint8_t cameraFollow;
} RetroCutsceneHost;
/* camera, audio and hooks may be null. actors must outlive the host. */
uint8_t retroCutsceneHostInit(RetroCutsceneHost *host,const CutsceneLibrary *library,
 RetroCutsceneActor *actors,uint8_t actorCount,RetroCamera *camera,RetroAudio *audio,
 const RetroCutsceneHooks *hooks,int16_t viewWidth);
/* New room: touch areas are re-armed and "enter" triggers may fire once. */
void retroCutsceneHostRoom(RetroCutsceneHost *host);
/* Starts a scene by number. Fails while another one runs; it may be called
 * from the finished hook to chain scenes. Never call cutsceneStart directly. */
uint8_t retroCutsceneHostStart(RetroCutsceneHost *host,uint16_t script);
/* Once per frame. input: CUTSCENE_INPUT_* of new presses; interact: the player
 * pressed the interaction button this frame; x/y: player feet.
 * Returns who owns the player this frame:
 *  - RETRO_CUTSCENE_CONTROL_SCENE: do not apply player input or physics. This
 *    includes the frame a scene starts and the frame after it ends, so the
 *    press that closed a dialogue never leaks into the game.
 *  - RETRO_CUTSCENE_CONTROL_PLAYER: normal game frame.
 * While the scene owns the player, triggers are not evaluated. */
uint8_t retroCutsceneHostUpdate(RetroCutsceneHost *host,const CutsceneTrigger *triggers,uint16_t count,
 int16_t x,int16_t y,unsigned int input,uint8_t interact);
/* Triggers of a room in the exported table (count 0 when it has none). */
const CutsceneTrigger *retroCutsceneRoomTriggers(const RetroCutsceneRoomTriggers *rooms,uint16_t roomCount,
 uint16_t room,uint16_t *count);
/* Scene flags <-> progress flags by the exported links; played: optional data
 * field (offset, bytes) that keeps which scenes already ran ("once" triggers).
 * Store before saving, load after continuing; a new game calls
 * cutsceneResetProgress(&host->runner). Both fail while a scene runs. */
uint8_t retroCutsceneHostStore(const RetroCutsceneHost *host,RetroProgress *progress,const RetroProgressConfig *config,
 const RetroCutsceneFlagLink *links,uint16_t linkCount,uint16_t playedOffset,uint8_t playedBytes);
uint8_t retroCutsceneHostLoad(RetroCutsceneHost *host,const RetroProgress *progress,const RetroProgressConfig *config,
 const RetroCutsceneFlagLink *links,uint16_t linkCount,uint16_t playedOffset,uint8_t playedBytes);
#endif
#endif
