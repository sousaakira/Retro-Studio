// Inimigo: entra pela direita e atravessa a tela em zigue-zague; some ao sair pela esquerda.
#include "gerado/codigo_inimigo.h"

#define CENTRO v[0] // Altura do meio do zigue-zague.
#define PASSO v[1]

void inimigo_pronto(Ator *eu) {
	eu->CENTRO = PIXELS(eu->y);
	eu->PASSO = 0;
}

void inimigo_quadro(Ator *eu) {
	static const s8 onda[16] = { 0, 4, 8, 11, 12, 11, 8, 4, 0, -4, -8, -11, -12, -11, -8, -4 };
	eu->x -= PX(1) + PX(1) / 2;
	eu->PASSO++;
	eu->y = PX(eu->CENTRO + onda[(eu->PASSO >> 2) & 15] * 2);
	if (PIXELS(eu->x) < -16) {
		remover_ator(eu);
	}
}
