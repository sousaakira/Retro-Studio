#ifndef RETRO_STUDIO_SCENE_H
#define RETRO_STUDIO_SCENE_H
#include <genesis.h>
#define RETRO_RUNTIME_SCENE_VERSION 2
#define RETRO_SCENE_MAX_OBJECTS 80
/* Pixel coordinates, support measured from the unflipped cell's top-left.
 * The host owns SPR_init/update and palettes; this module never resets them. */
typedef struct {
    u16 id;
    const SpriteDefinition *resource;
    s16 x, y, supportX, supportY;
    u16 animation;
    u8 palette, priority, hFlip, vFlip, loop;
    const u16 *durations; /* NULL: use compiled frame timers */
    u16 durationCount;
} RetroSceneObjectDefinition;
typedef struct {
    const RetroSceneObjectDefinition *definition;
    Sprite *sprite;
    s16 x, y;
    u16 frame, remaining;
    u8 playing;
} RetroSceneObject;
typedef struct {
    RetroSceneObject *objects;
    u16 count;
    u8 initialized;
} RetroScene;
enum { RETRO_SCENE_OK=0, RETRO_SCENE_INVALID=1, RETRO_SCENE_ALLOCATION=2,
       RETRO_SCENE_PALETTE=3 };
typedef struct {u32 tiles,sprites;} RetroSceneResourceBudget;
/* Read-only preflight, no allocation/DMA/CRAM read. Slots describe palettes the
 * host will install. All 15 opaque indices must match, excluding transparent
 * index zero. Unused colors are checked conservatively; no remapping occurs.
 * Empty scenes succeed with NULL definitions/slots. Init remains opt-in and
 * does not call this check implicitly (host may use custom palette effects). */
u8 retroSceneValidatePalettes(const RetroSceneObjectDefinition *definitions,
    u16 count,const Palette *const palettes[4]);
/* Sum maxNumTile/maxNumSprite per instance, even for shared resources. Does not
 * prove VRAM contiguity, SAT/scanline capacity or DMA cost. Output unchanged on
 * invalid input. Host adds active/pending scenes and persistent sprite budgets. */
u8 retroSceneMeasureResources(const RetroSceneObjectDefinition *definitions,
    u16 count,RetroSceneResourceBudget *result);
/* Zero-initialize scene; storage capacity >= count. Failure releases all
 * allocations made here; unrelated game sprites remain intact. */
u8 retroSceneInit(RetroScene *scene, RetroSceneObject *storage, u16 capacity,
    const RetroSceneObjectDefinition *definitions, u16 count);
void retroSceneFree(RetroScene *scene);
RetroSceneObject *retroSceneFind(RetroScene *scene, u16 id);
/* Call once per video frame AFTER drawing the initial frame. No SPR_update. */
void retroSceneTick(RetroScene *scene);
void retroScenePosition(RetroScene *scene, s16 cameraX, s16 cameraY);
#endif
