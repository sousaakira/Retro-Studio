// Capanga: vai atrás do jogador mais perto e, encostado, soca de vez em quando. Ao levar soco, é
// empurrado para trás; sem vida, some e dá pontos.
#include "gerado/codigo_capanga.h"

#define ESPERA v[0] // Quadros até o próximo soco.

enum { ANIM_PARADO, ANIM_ANDANDO, ANIM_SOCO };

static Ator *mais_perto(Ator *eu) {
	Ator *melhor = NULL;
	s16 menor = 32767;
	for (Ator *j = NULL; (j = proximo_ator(j, GRUPO_JOGADOR));) {
		const s16 d = abs(distancia_x(eu, j)) + abs(distancia_y(eu, j));
		if (d < menor) {
			menor = d;
			melhor = j;
		}
	}
	return melhor;
}

void capanga_pronto(Ator *eu) {
	eu->ESPERA = 60;
}

void capanga_quadro(Ator *eu) {
	if (eu->vida <= 0) {
		pontos += 200;
		remover_ator(eu);
		return;
	}
	// Recuo do soco que levou.
	if (eu->vx) {
		eu->x += eu->vx;
		eu->vx = eu->vx * 3 / 4;
		if (abs(eu->vx) < PX(1) / 4) {
			eu->vx = 0;
		}
		return;
	}
	Ator *alvo = mais_perto(eu);
	if (!alvo || !na_tela(eu)) {
		tocar_animacao(eu, ANIM_PARADO);
		return;
	}
	const s16 dx = distancia_x(eu, alvo), dy = distancia_y(eu, alvo);
	virar(eu, dx > 0 ? 1 : -1);
	if (abs(dx) > 22 || abs(dy) > 4) {
		eu->x += abs(dx) > 22 ? (dx > 0 ? PX(1) : -PX(1)) : 0;
		eu->y += abs(dy) > 4 ? (dy > 0 ? PX(1) / 2 : -PX(1) / 2) : 0;
		tocar_animacao(eu, ANIM_ANDANDO);
	} else if (eu->ESPERA) {
		eu->ESPERA--;
		tocar_animacao(eu, ANIM_PARADO);
	} else {
		reiniciar_animacao(eu, ANIM_SOCO);
		if (ferir(alvo, 1, 60)) {
			tocar_som(SOM_DANO);
		}
		eu->ESPERA = 70;
	}
	SPR_setDepth(eu->sprite, -PIXELS(eu->y));
}
