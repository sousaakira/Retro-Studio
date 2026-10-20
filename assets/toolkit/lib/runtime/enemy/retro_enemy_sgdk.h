#ifndef RETRO_STUDIO_ENEMY_SGDK_H
#define RETRO_STUDIO_ENEMY_SGDK_H
#include <genesis.h>
#include "retro_enemy.h"
#define RETRO_RUNTIME_ENEMY_SGDK_VERSION 1
/* Ponte SGDK do runtime de inimigos.
 *
 * Sprites: cada inimigo ativo reserva um Sprite (SPR_addSprite, VRAM automática)
 * na ativação e o libera ao desativar, morrer ou trocar de sala. Sem VRAM ou
 * sem sprites livres, a ativação é adiada e tentada de novo no próximo quadro;
 * nada é alocado por quadro. O SPR_initEx do jogo precisa reservar tiles para
 * maxActive inimigos (veja retroEnemySgdkTileBudget).
 *
 * Animação: manual (timer 0), avançada por retroEnemyUpdate. Com o jogo pausado
 * o host não chama Update/Draw e os inimigos ficam congelados, inclusive o
 * piscar de invulnerabilidade.
 *
 * Paleta: definition.palette é a linha usada no TILE_ATTR; carregar a paleta é
 * do host, que deve conferir que a linha está livre ou é compatível. */
uint8_t retroEnemySgdkInit(RetroEnemyPool *pool,const RetroEnemyDefinition *definitions,
 uint16_t definitionCount,uint8_t maxActive,uint8_t *defeated,uint16_t defeatedCount);
/* Posiciona, vira, anima e esconde (fora da tela ou piscando). Chamar depois
 * de retroEnemyUpdate e antes de SPR_update. */
void retroEnemySgdkDraw(RetroEnemyPool *pool,s16 cameraX,s16 cameraY);
/* Tiles de VRAM de sprite para maxActive cópias do maior inimigo. */
u16 retroEnemySgdkTileBudget(const RetroEnemyDefinition *definitions,uint16_t count,uint8_t maxActive);
#endif
