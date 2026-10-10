#ifndef RETRO_STUDIO_CAMERA_H
#define RETRO_STUDIO_CAMERA_H
#include "retro_core.h"
#define RETRO_RUNTIME_CAMERA_VERSION 1
/* Sizes/offsets in pixels; speeds in Q8 pixels/video tick. No implicit PAL
 * scaling: the host picks one explicit profile. Smoothing is a divisor shift
 * (0 none .. 6): each tick covers 1/2^n of the remaining distance, then the
 * step is limited by maxSpeed. Dead zone is centred on the screen centre plus
 * focus; the camera only moves once the focus point leaves it. */
typedef struct {
 RetroFixed maxSpeedX,maxSpeedY,lookAheadSpeed,scriptReturnSpeed;
 int16_t deadZoneWidth,deadZoneHeight,focusX,focusY,lookAheadX;
 uint8_t smoothingX,smoothingY,followX,followY;
} RetroCameraConfig;
enum {RETRO_CAMERA_REGION_LOCK=1};
/* While the target is inside area the camera is confined to limits (room
 * pixels). Highest priority wins; equal priorities resolve to the first row.
 * LOCK keeps the region after the target leaves, until retroCameraUnlock.
 * transitionSpeed applies when this region is entered or left; 0 cuts. */
typedef struct {
 uint16_t id;
 RetroRect area,limits;
 RetroFixed transitionSpeed;
 uint8_t priority,flags;
} RetroCameraRegion;
enum {RETRO_CAMERA_AXIS_X=1,RETRO_CAMERA_AXIS_Y=2};
typedef struct {
 RetroFixed x,y,look,transitionSpeed;
 const RetroCameraRegion *regions;
 uint16_t regionCount,region,released; /* row indexes or RETRO_ID_NONE */
 int16_t viewWidth,viewHeight,roomWidth,roomHeight;
 uint8_t ready,locked,transition,script,returning;
} RetroCamera;
enum {RETRO_CAMERA_MOVED=1,RETRO_CAMERA_TRANSITION=2,RETRO_CAMERA_LOCKED=4,
      RETRO_CAMERA_SCRIPT=8,RETRO_CAMERA_REGION_CHANGED=16};
typedef struct {
 int16_t x,y;      /* top-left pixel, ready for the scroll call */
 uint16_t region;  /* active region id or RETRO_ID_NONE */
 uint8_t flags,invalid;
} RetroCameraResult;
/* Original reference defaults, not a recovered game's framing. */
void retroCameraPreset(RetroCameraConfig *config);
uint8_t retroCameraValidate(const RetroCameraConfig *config);
/* Zero the instance first. View is the visible size (320/256 x 224/240). */
uint8_t retroCameraInit(RetroCamera *camera,int16_t viewWidth,int16_t viewHeight);
/* Cuts to the framing of a new room: regions are borrowed and must outlive the
 * room. Target is the focus point (usually feet) in Q8 room pixels; direction
 * is -1 left, 1 right (full look-ahead at once) or 0 (no look-ahead). Invalid
 * rooms/regions preserve the entire instance. Releases script ownership and
 * arena locks; a LOCK region containing the target locks immediately. */
uint8_t retroCameraEnterRoom(RetroCamera *camera,const RetroCameraConfig *config,
 int16_t roomWidth,int16_t roomHeight,const RetroCameraRegion *regions,uint16_t regionCount,
 RetroFixed targetX,RetroFixed targetY,signed char direction);
/* One tick per video frame, after the player moved. No allocation, callbacks
 * or SGDK dependency. Direction 0 keeps the current look-ahead. Invalid input
 * preserves the instance. */
RetroCameraResult retroCameraTick(RetroCamera *camera,const RetroCameraConfig *config,
 RetroFixed targetX,RetroFixed targetY,signed char direction);
/* Effective camera limits (active region or whole room), e.g. to keep the
 * player inside a locked arena. Returns 0 before a room is entered. */
uint8_t retroCameraBounds(const RetroCamera *camera,RetroRect *bounds);
/* Ends an arena lock. The region is ignored until the target leaves its area. */
uint8_t retroCameraUnlock(RetroCamera *camera);
/* Scripted ownership: owned axes stop following and keep the given pixel
 * position, clamped to the room (regions do not confine scripts). Release
 * returns to the player with scriptReturnSpeed; 0 cuts. Unowned axes follow. */
uint8_t retroCameraScriptSet(RetroCamera *camera,uint8_t axes,int32_t x,int32_t y);
void retroCameraScriptRelease(RetroCamera *camera);
/* Signature-compatible with CutsceneHost cameraGet/cameraSet/cameraClamp;
 * context is the RetroCamera. The cutscene owns X only while it is not in
 * follow mode, so the player controller never competes for the same axis. */
int retroCameraCutsceneGet(void *context);
void retroCameraCutsceneSet(void *context,int follow,int x);
int retroCameraCutsceneClamp(void *context,int x);
#endif
