// Código C da cena Titulo (titulo.tscn): o herói atravessa a tela andando, da esquerda para a direita.
// Os sprites da cena e o resto do jogo estão em gerado/cena_titulo.h, que o build refaz a partir da cena.


static s16 heroi_x;

// Uma vez, com a cena montada, antes de clarear a tela.
void titulo_iniciar(void) {
	heroi_x = -32;
	SPR_setAnim(titulo_heroi, 1); // Linha 1 da folha: andando.
}

// Todo quadro, depois do jogo gerado e antes de os sprites irem para a tela.
void titulo_atualizar(void) {
	if (++heroi_x > 320) {
		heroi_x = -32;
	}
	SPR_setPosition(titulo_heroi, heroi_x, 120);
}
