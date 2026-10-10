#ifndef RETRO_STUDIO_WORLD_H
#define RETRO_STUDIO_WORLD_H
#include "retro_core.h"
#define RETRO_RUNTIME_WORLD_VERSION 1
#define RETRO_WORLD_MAX_ROOMS 64
#define RETRO_WORLD_MAX_ITEMS 128
#define RETRO_WORLD_MAX_REQUIREMENTS 16
/* Coordinates are pixel support/feet positions, not Q8 or tile coordinates. */
typedef struct {uint16_t id;int16_t x,y;uint8_t facing;} RetroWorldSpawn;
typedef struct {
 uint16_t id,targetRoom,targetEntry;
 const uint16_t *requirements;uint8_t requirementCount;
} RetroWorldExit;
typedef struct {
 uint16_t id,width,height;
 const RetroWorldSpawn *entries;uint16_t entryCount;
 const RetroWorldSpawn *checkpoints;uint16_t checkpointCount;
 const RetroWorldExit *exits;uint16_t exitCount;
} RetroWorldRoom;
typedef struct {
 const RetroWorldRoom *rooms;uint16_t roomCount,initialRoom,initialEntry;
} RetroWorldDefinition;
/* Host owns VDP, sprites and resources. prepare must not change the active room.
 * A non-null returned handle is owned by this world. Failed prepare is released.
 * activate cannot fail; release affects only the supplied room's owned handle.
 * Callbacks must not mutate the world struct; API reentry is rejected. */
typedef struct {
 uint8_t (*prepare)(void *context,const RetroWorldRoom *room,void **handle);
 void (*activate)(void *context,const RetroWorldRoom *room,void *handle);
 void (*release)(void *context,const RetroWorldRoom *room,void *handle);
 uint8_t (*allow)(void *context,uint16_t condition);
 void *context;
} RetroWorldHooks;
typedef struct {
 const RetroWorldDefinition *definition;RetroWorldHooks hooks;
 const RetroWorldRoom *room;void *handle;
 int16_t x,y;uint8_t facing,initialized,busy;
 uint16_t checkpointRoom,checkpoint;
} RetroWorld;
typedef struct {uint16_t version,room,checkpoint;} RetroWorldSave;
enum {RETRO_WORLD_OK=0,RETRO_WORLD_INVALID=1,RETRO_WORLD_BUSY=2,
 RETRO_WORLD_DENIED=3,RETRO_WORLD_LOAD_FAILED=4,RETRO_WORLD_NOT_FOUND=5};
uint8_t retroWorldValidate(const RetroWorldDefinition *definition);
/* Zero-initialize. A failed initial load or transition preserves prior state. */
uint8_t retroWorldInit(RetroWorld *world,const RetroWorldDefinition *definition,const RetroWorldHooks *hooks);
uint8_t retroWorldEnter(RetroWorld *world,uint16_t room,uint16_t entry);
uint8_t retroWorldExitThrough(RetroWorld *world,uint16_t exit);
/* Checkpoint IDs are scoped to a room; both IDs remain stable across reordering. */
uint8_t retroWorldCheckpoint(RetroWorld *world,uint16_t checkpoint);
uint8_t retroWorldRespawn(RetroWorld *world);
uint8_t retroWorldSnapshot(const RetroWorld *world,RetroWorldSave *save);
uint8_t retroWorldRestore(RetroWorld *world,const RetroWorldSave *save);
uint8_t retroWorldFree(RetroWorld *world);
#endif
