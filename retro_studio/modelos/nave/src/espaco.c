// Código da cena do espaço: as estrelas rolam, um inimigo nasce a cada meio segundo numa altura
// sorteada e os pontos e as vidas ficam no topo.
#include "gerado/cena_espaco.h"
#include "gerado/codigo_nave.h"

static s16 rolagem;
static u32 pontos_mostrados;
static u8 vidas_mostradas;

static void placar(void) {
	char texto[32];
	sprintf(texto, "PONTOS %06lu   VIDAS %u", pontos, vidas);
	VDP_drawText(texto, 1, 0);
	pontos_mostrados = pontos;
	vidas_mostradas = vidas;
}

void espaco_iniciar(void) {
	rolagem = 0;
	placar();
}

void espaco_atualizar(void) {
	rolagem -= 2;
	VDP_setHorizontalScroll(BG_B, rolagem);
	if (quadro_do_jogo() % 30 == 0) {
		criar_ator(&TIPO_INIMIGO, PX(320), PX(32 + random() % 160));
	}
	if (pontos != pontos_mostrados || vidas != vidas_mostradas) {
		placar();
	}
}
