#ifndef RETRO_STUDIO_CHARACTER_SPRITE_H
#define RETRO_STUDIO_CHARACTER_SPRITE_H
#include <genesis.h>
#include "retro_character.h"
#define RETRO_RUNTIME_CHARACTER_SPRITE_VERSION 1
#define RETRO_CHARACTER_SPRITE_CAPACITY 80
/* Borrowed sprite/controller. The game owns allocation, palettes, VRAM and
 * SPR_update. Detach before releasing either object. Zero-initialize adapter. */
typedef struct {
    Sprite *sprite;
    RetroCharacter *controller;
    RetroCharacterHost originalHost;
    FrameChangeCallback *originalCallback;
    const RetroCharacterPose *pose;
    s16 x,y,cameraX,cameraY;
    u8 hFlip,vFlip,priority,active,busy;
} RetroCharacterSprite;
u8 retroCharacterSpriteAttach(RetroCharacterSprite *,RetroCharacter *,Sprite *);
/* Returns 0 without mutation while busy or if host was partially replaced.
 * Check success before releasing borrowed objects or the adapter itself. */
u8 retroCharacterSpriteDetach(RetroCharacterSprite *);
void retroCharacterSpritePosition(RetroCharacterSprite *,s16 feetX,s16 feetY,s16 cameraX,s16 cameraY);
void retroCharacterSpriteFacing(RetroCharacterSprite *,u8 hFlip,u8 vFlip);
void retroCharacterSpritePriority(RetroCharacterSprite *,u8 priority);
#endif
