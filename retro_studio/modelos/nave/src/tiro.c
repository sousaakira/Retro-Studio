// Tiro da nave: voa para a direita e some fora da tela; no primeiro inimigo que tocar, os dois somem
// e o jogador ganha 100 pontos.
#include "gerado/codigo_tiro.h"

void tiro_pronto(Ator *eu) {
	(void)eu;
}

void tiro_quadro(Ator *eu) {
	eu->x += PX(6);
	if (PIXELS(eu->x) > 320) {
		remover_ator(eu);
		return;
	}
	for (Ator *inimigo = NULL; (inimigo = proximo_ator(inimigo, GRUPO_INIMIGO));) {
		if (tocando(eu, inimigo)) {
			remover_ator(inimigo);
			remover_ator(eu);
			pontos += 100;
			tocar_som(SOM_PISAO);
			return;
		}
	}
}
