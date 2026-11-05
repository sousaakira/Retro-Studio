// Os dois jogadores usam este código: o Jogador1 lê o controle 1 e o Jogador2, o controle 2. Andam
// pela rua (os lados e a profundidade, entre a calçada e o meio-fio) e socam com A: o soco acerta os
// capangas logo à frente. Sem vida, o lutador sai; sem nenhum, fim de jogo.
#include "gerado/codigo_lutador.h"

#define CONTROLE v[0]
#define SOCO v[1] // Quadros que faltam no soco.
#define VELOCIDADE PX(1) + PX(1) / 2
#define TOPO_DA_RUA 128 // Pés: da calçada...
#define FUNDO_DA_RUA 216 // ...até a parte de baixo da tela.

enum { ANIM_PARADO, ANIM_ANDANDO, ANIM_SOCO };

void lutador_pronto(Ator *eu) {
	// O primeiro lutador da cena é o controle 1; o segundo, o 2.
	eu->CONTROLE = primeiro_ator(GRUPO_JOGADOR) == eu ? 1 : 2;
	eu->SOCO = 0;
}

void lutador_quadro(Ator *eu) {
	const u8 c = eu->CONTROLE;
	if (eu->vida <= 0) {
		remover_ator(eu);
		if (!primeiro_ator(GRUPO_JOGADOR)) {
			jogo_perdeu();
		}
		return;
	}
	if (eu->SOCO) {
		if (--eu->SOCO == 8) {
			// O meio do soco acerta quem estiver na frente, na mesma faixa da rua.
			for (Ator *alvo = NULL; (alvo = ator_na_area(eu, 14, 16, 18, 16, GRUPO_CAPANGA, alvo));) {
				if (ferir(alvo, 1, 20)) {
					alvo->vx = eu->direcao * PX(3);
					parar_jogo(3);
					tocar_som(SOM_PISAO);
					pontos += 50;
				}
			}
		}
		return;
	}
	eu->vx = botao_de(c, BOTAO_DIREITA) ? VELOCIDADE : botao_de(c, BOTAO_ESQUERDA) ? -(VELOCIDADE) : 0;
	eu->vy = botao_de(c, BOTAO_BAIXO) ? PX(1) : botao_de(c, BOTAO_CIMA) ? -PX(1) : 0;
	if (eu->vx) {
		virar(eu, eu->vx > 0 ? 1 : -1);
	}
	eu->x = clamp(eu->x + eu->vx, tela_x() > 0 ? PX(tela_x()) : 0, PX(mundo_largura() - 24));
	eu->y = clamp(eu->y + eu->vy, PX(TOPO_DA_RUA - 32), PX(FUNDO_DA_RUA - 32));
	if (apertou_de(c, BOTAO_A)) {
		eu->SOCO = 16;
		reiniciar_animacao(eu, ANIM_SOCO);
		return;
	}
	tocar_animacao(eu, (eu->vx || eu->vy) ? ANIM_ANDANDO : ANIM_PARADO);
	SPR_setDepth(eu->sprite, -PIXELS(eu->y)); // Quem está mais embaixo passa na frente.
}
