#include <genesis.h>
#include "resources.h"
#include "generated/map_data.h"
#include "generated/map_objects.h"

int main() {
#if GAME_MAP_ENABLED
	Map *gameMap;
	Map *foregroundMap;
	Map *collisionMap;
	bool showCollisions = FALSE;
	u16 previousKeys = 0;
    VDP_setPlaneSize(64, 32, TRUE);
#if GAME_MAP_OBJECT_COUNT
    RetroScene objectScene = {0};
    RetroSceneObject objectStorage[GAME_MAP_OBJECT_COUNT];
    u32 objectTiles = gameMapObjectTileBudget();
    if (!objectTiles || objectTiles > (u32)TILE_FONT_INDEX - TILE_USER_INDEX) {
        VDP_drawText("Objetos excedem a reserva de VRAM.", 1, 10);
        while (TRUE) SYS_doVBlankProcess();
    }
    SPR_initEx((u16)objectTiles);
#endif
	/* MAP_scrollTo wraps/streams map cells through these planes; the
	 * full map dimensions do not need to fit in the hardware plane. */

	/* When adding sprites, call SPR_initEx(spriteTileBudget) before this
	 * check and before loading scenery. Budget the sum of maxNumTile for
	 * all simultaneous sprite instances; animation frames reuse that space.
	 * SPR_init() reserves 420 tiles even for a single small character.
	 * Do not pass zero to SPR_initEx: zero also selects the default 420. */
	if ((u32) TILE_USER_INDEX + GAME_MAP_TILES.numTile + (GAME_MAP_FG_TILES.numTile > GAME_MAP_COLLISION_TILES.numTile ? GAME_MAP_FG_TILES.numTile : GAME_MAP_COLLISION_TILES.numTile)
	    > (u32) TILE_SPRITE_INDEX)
	{
		VDP_drawText("Mapa excede a VRAM disponivel.", 2, 10);
		VDP_drawText("Reduza os tiles unicos de BG/FG", 2, 12);
		VDP_drawText("ou a reserva de sprites.", 2, 13);
		while (TRUE) SYS_doVBlankProcess();
	}
	VDP_loadTileSet(&GAME_MAP_TILES, TILE_USER_INDEX, DMA);
	PAL_setPalette(PAL0, GAME_MAP_PALETTE.data, DMA);
	PAL_setPalette(PAL2, GAME_MAP_PALETTE.data + 32, DMA);
	PAL_setPalette(PAL3, GAME_MAP_PALETTE.data + 48, DMA);
	gameMap = MAP_create(&GAME_MAP, BG_B,
	                     TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX));
	if (gameMap == NULL) while (TRUE) SYS_doVBlankProcess();
	MAP_scrollTo(gameMap, 0, 0);
	SYS_doVBlankProcess();
	VDP_loadTileSet(&GAME_MAP_FG_TILES, TILE_USER_INDEX + GAME_MAP_TILES.numTile, DMA);
	foregroundMap = MAP_create(&GAME_MAP_FG, BG_A,
	    TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX + GAME_MAP_TILES.numTile));
	if (foregroundMap == NULL) while (TRUE) SYS_doVBlankProcess();
	MAP_scrollTo(foregroundMap, 0, 0);
	SYS_doVBlankProcess();
    collisionMap = MAP_create(&GAME_MAP_COLLISION, BG_A,
        TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX + GAME_MAP_TILES.numTile));
    if (collisionMap == NULL) while (TRUE) SYS_doVBlankProcess();
#if GAME_MAP_OBJECT_COUNT
    gameMapObjectPalette();
    if (retroSceneInit(&objectScene, objectStorage, GAME_MAP_OBJECT_COUNT,
                      gameMapObjectDefinitions, GAME_MAP_OBJECT_COUNT) != RETRO_SCENE_OK) {
        VDP_drawText("Falha nos dados/alocacao de objetos", 1, 10);
        while (TRUE) SYS_doVBlankProcess();
    }
#endif
#else
	VDP_drawText("Hello World!", 4, 4);
	// From the moon example
	PAL_setPalette(PAL1, moon.palette->data, DMA);
	VDP_drawImageEx(BG_A, &moon, TILE_ATTR_FULL(PAL1, 0, 0, 0, 1), 12, 12, 0, CPU);
#endif
	while(TRUE) {
#if GAME_MAP_ENABLED
        u16 keys = JOY_readJoypad(JOY_1);
        if ((keys & BUTTON_A) && !(previousKeys & BUTTON_A)) {
            showCollisions = !showCollisions;
            PAL_setColor(15, showCollisions ? 0x0EEE : GAME_MAP_PALETTE.data[15]);
            VDP_loadTileSet(showCollisions ? &GAME_MAP_COLLISION_TILES : &GAME_MAP_FG_TILES,
                           TILE_USER_INDEX + GAME_MAP_TILES.numTile, DMA);
            MAP_scrollToEx(showCollisions ? collisionMap : foregroundMap, 0, 0, TRUE);
        }
        previousKeys = keys;
#endif
#if GAME_MAP_ENABLED && GAME_MAP_OBJECT_COUNT
        retroScenePosition(&objectScene, 0, 0);
        SPR_update();
#endif
        SYS_doVBlankProcess();
#if GAME_MAP_ENABLED && GAME_MAP_OBJECT_COUNT
        retroSceneTick(&objectScene);
#endif
    }
	return 0;
}
