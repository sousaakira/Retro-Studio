// Jogo padrão do Retro Studio: um fundo e um herói que anda (← →) e pula (A, B ou C).
// Serve de projeto de teste enquanto as ferramentas de cenas são criadas.
#include <genesis.h>

#include "resources.h"

#define CHAO 144 // y do herói (topo do sprite de 32×32) quando está no chão
#define VELOCIDADE 2
#define PULO (-7 * 16) // velocidade vertical em 1/16 de pixel por quadro
#define GRAVIDADE 6

enum { ANIM_PARADO, ANIM_ANDANDO };

int main(bool hard) {
	(void)hard;
	VDP_setScreenWidth320();
	PAL_setPalette(PAL0, img_fundo.palette->data, DMA);
	PAL_setPalette(PAL1, spr_heroi.palette->data, DMA);
	VDP_drawImageEx(BG_B, &img_fundo, TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX), 0, 0, FALSE, TRUE);
	VDP_drawText("RETRO STUDIO", 14, 2);

	SPR_init();
	s16 x = 144;
	s16 y16 = CHAO * 16, vy16 = 0; // posição e velocidade vertical em 1/16 de pixel
	bool no_chao = TRUE;
	Sprite *heroi = SPR_addSprite(&spr_heroi, x, CHAO, TILE_ATTR(PAL1, TRUE, FALSE, FALSE));

	while (TRUE) {
		const u16 botoes = JOY_readJoypad(JOY_1);
		bool andando = FALSE;
		if (botoes & BUTTON_LEFT) {
			x -= VELOCIDADE;
			SPR_setHFlip(heroi, TRUE);
			andando = TRUE;
		} else if (botoes & BUTTON_RIGHT) {
			x += VELOCIDADE;
			SPR_setHFlip(heroi, FALSE);
			andando = TRUE;
		}
		x = clamp(x, 0, 320 - 32);

		if (no_chao && (botoes & (BUTTON_A | BUTTON_B | BUTTON_C))) {
			vy16 = PULO;
			no_chao = FALSE;
		}
		if (!no_chao) {
			vy16 += GRAVIDADE;
			y16 += vy16;
			if (y16 >= CHAO * 16) {
				y16 = CHAO * 16;
				vy16 = 0;
				no_chao = TRUE;
			}
		}

		SPR_setAnim(heroi, andando && no_chao ? ANIM_ANDANDO : ANIM_PARADO);
		SPR_setPosition(heroi, x, y16 / 16);
		SPR_update();
		SYS_doVBlankProcess();
	}
	return 0;
}
