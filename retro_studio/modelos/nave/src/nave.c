// Nave do jogador: anda nas 8 direções (presa à tela) e atira com A ou C. Encostar num inimigo tira
// uma vida (a nave pisca por 2 s); sem vidas, fim de jogo.
#include "gerado/codigo_nave.h"

#define VELOCIDADE PX(2)
#define TIROS_NA_TELA 4
#define INTERVALO 8 // Quadros entre dois tiros.
#define ESPERA v[0]

void nave_pronto(Ator *eu) {
	if (vidas == 0) {
		vidas = 3; // Jogo novo.
	}
	eu->ESPERA = 0;
}

void nave_quadro(Ator *eu) {
	eu->vx = botao(BOTAO_DIREITA) ? VELOCIDADE : botao(BOTAO_ESQUERDA) ? -VELOCIDADE : 0;
	eu->vy = botao(BOTAO_BAIXO) ? VELOCIDADE : botao(BOTAO_CIMA) ? -VELOCIDADE : 0;
	eu->x = clamp(eu->x + eu->vx, PX(0), PX(320 - 24));
	eu->y = clamp(eu->y + eu->vy, PX(16), PX(224 - 16));
	if (eu->ESPERA) {
		eu->ESPERA--;
	}
	if (botao(BOTAO_A | BOTAO_C) && !eu->ESPERA && contar_atores(&TIPO_TIRO) < TIROS_NA_TELA) {
		criar_ator(&TIPO_TIRO, eu->x + PX(20), eu->y + PX(4));
		tocar_som(SOM_PULO);
		eu->ESPERA = INTERVALO;
	}
	for (Ator *inimigo = NULL; (inimigo = proximo_ator(inimigo, GRUPO_INIMIGO));) {
		if (tocando(eu, inimigo) && ferir(eu, 1, 120)) {
			remover_ator(inimigo);
			tocar_som(SOM_DANO);
			tremer_tela(10, 2);
			if (vidas <= 1) {
				vidas = 0;
				jogo_perdeu();
			} else {
				vidas--;
			}
			break;
		}
	}
}
