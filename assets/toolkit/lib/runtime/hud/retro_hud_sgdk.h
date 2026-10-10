#ifndef RETRO_STUDIO_HUD_SGDK_H
#define RETRO_STUDIO_HUD_SGDK_H
#include <genesis.h>
#include "retro_hud.h"
#define RETRO_RUNTIME_HUD_SGDK_VERSION 1
#define RETRO_HUD_SGDK_MAX_SPRITES 16
/* Draws the HUD of retro_hud.h with SGDK.
 * - Cells go to the configured plane (0 WINDOW, 1 BG_A, 2 BG_B) with the font at
 *   TILE_FONT_INDEX: an imported font replaces the SGDK font there, so no other
 *   VRAM is used. VDP_drawText then draws with the new glyphs in the order of the
 *   font map, NOT ASCII: use the HUD for every text the player reads.
 * - WINDOW: the HUD band, and the rows of an open menu/dialogue, are set with
 *   VDP_setWindowVPos; this module owns the window while it has something there.
 *   Do not combine with retroDebugSgdkOverlay or retroCutsceneSgdkPresent text.
 * - BG_A/BG_B: only the cells of the elements are written at start; closing a
 *   menu or dialogue erases its cells (tile 0) — the game redraws its scenery.
 * - Sprite elements: one SGDK sprite per character, in front of the game's
 *   sprites, from the glyph sheet (RETRO_HUD_GLYPHS in res/hud_resources.res);
 *   the host owns SPR_init/update.
 * - Colours: written at start; a room change or a fade that reloads the palette
 *   must be followed by retroHudSgdkColors. */
typedef struct {
 const u32 *fontTiles;      /* glyphCount tiles of 32 bytes, or NULL to keep the SGDK font */
 const u16 *colors;         /* 16 colours of the font */
 const u8 *spriteFrames;    /* glyph -> frame of the sheet (0xFF: nothing to draw), or NULL */
 const SpriteDefinition *sheet; /* glyph sheet for sprite elements, or NULL */
 u16 glyphCount,colorMask;  /* colorMask: bit n = colour n is used by the font */
 u8 plane,palette,priority;
 u16 cellsPerFrame;         /* most cells written per update (0 = 64) */
} RetroHudSgdkConfig;
typedef struct {
 RetroHud hud;
 RetroHudSgdkConfig config;
 Sprite *sprites[RETRO_HUD_SGDK_MAX_SPRITES];
 u16 attribute,band;
 u8 spriteCount,ready;
} RetroHudSgdk;
/* Returns 0 on invalid tables/plane or when the sprites could not be created
 * (nothing was changed on screen in that case). */
u8 retroHudSgdkInit(RetroHudSgdk *hud,const RetroHudDefinition *definition,const RetroHudHost *host,u8 *cells,u8 *overlayCells,const RetroHudSgdkConfig *config);
/* Once per frame, before SPR_update: reads the values, writes the changed cells
 * (CPU writes, no DMA queue), moves the window band and updates the sprites. */
void retroHudSgdkUpdate(RetroHudSgdk *hud);
/* Writes the font colours again (after the game reloaded or faded the palette). */
void retroHudSgdkColors(const RetroHudSgdk *hud);
/* Releases the sprites and gives the window back. */
void retroHudSgdkFree(RetroHudSgdk *hud);
/* With src/generated/hud_config.h included before this header.
 * sheet: &RETRO_HUD_GLYPHS (from hud_resources.h) when RETRO_PROJECT_HUD_SPRITES > 0, else 0. */
#ifdef RETRO_PROJECT_HUD_VERSION
static inline u8 retroHudSgdkInitProject(RetroHudSgdk *hud,const RetroHudHost *host,u8 *cells,u8 *overlayCells,const SpriteDefinition *sheet,u16 cellsPerFrame){
 const RetroHudSgdkConfig config={RETRO_PROJECT_HUD_FONT_TILES,retroProjectHudColors,RETRO_PROJECT_HUD_SPRITE_FRAMES,sheet,RETRO_PROJECT_HUD_GLYPHS,RETRO_PROJECT_HUD_COLOR_MASK,
  RETRO_PROJECT_HUD_PLANE,RETRO_PROJECT_HUD_PALETTE,RETRO_PROJECT_HUD_PRIORITY,cellsPerFrame};
 return retroHudSgdkInit(hud,&retroProjectHud,host,cells,overlayCells,&config);
}
#endif
#endif
