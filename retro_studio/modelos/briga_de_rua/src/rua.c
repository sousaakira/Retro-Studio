// Código da cena da rua: a vida dos dois jogadores e os pontos ficam no topo da tela.
#include "gerado/cena_rua.h"
#include "gerado/codigo_lutador.h"

void rua_atualizar(void) {
	if (quadro_do_jogo() % 10) {
		return;
	}
	char texto[41];
	Ator *j1 = primeiro_ator(GRUPO_JOGADOR);
	Ator *j2 = j1 ? proximo_ator(j1, GRUPO_JOGADOR) : NULL;
	sprintf(texto, "1P %d   2P %d   PONTOS %06lu ", j1 ? j1->vida : 0, j2 ? j2->vida : 0, pontos);
	VDP_drawText(texto, 1, 0);
}
