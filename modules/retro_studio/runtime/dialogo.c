// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Caixas de diálogo (MDDialogo).
#include "dialogo.h"

#define MOLDURA 9 // Tiles da moldura: cantos, lados e o fundo.
#define FUNDO 4
#define LARGURA 40 // Colunas da tela (H40).
#define BOTOES_AVANCAR (BUTTON_A | BUTTON_B | BUTTON_C | BUTTON_START)

s16 dialogo_escolha = -1;

static const DialogoCena *cena;
static s16 atual = -1;
static u8 pagina, opcao;
static u16 pos; // Próximo código da página.
static u8 linha, coluna; // Onde vai a próxima letra (dentro da área de texto).
static u8 espera; // Quadros até a próxima letra.
static u8 piscar;
static bool completa, escolhendo;
static u16 botoes_antes;
static u8 y0; // Linha da tela onde a caixa começa.
static u16 cores_salvas[3];
static u16 retrato_salvo[16];
static bool retrato_trocado;
static u8 paleta_trocada;

static inline u16 tile_da_letra(u8 codigo) {
	return TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, cena->base + MOLDURA + codigo - 2);
}

static inline u16 tile_da_moldura(u16 indice) {
	return TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, cena->base + indice);
}

static u8 texto_x(void) {
	const Dialogo *d = &cena->dialogos[atual];
	return d->retrato ? 2 + d->colunas_retrato : 1;
}

static void texto_limpar(void) {
	const u8 x = texto_x();
	for (u8 y = y0 + 1; y < y0 + cena->linhas - 1; y++) {
		for (u8 i = x; i < LARGURA - 1; i++) {
			VDP_setTileMapXY(WINDOW, tile_da_moldura(FUNDO), i, y);
		}
	}
}

static void caixa_desenhar(void) {
	const u8 y1 = y0 + cena->linhas - 1;
	for (u8 y = y0; y <= y1; y++) {
		const u16 fileira = y == y0 ? 0 : y == y1 ? 6 : 3;
		for (u8 x = 0; x < LARGURA; x++) {
			VDP_setTileMapXY(WINDOW, tile_da_moldura(fileira + (x == 0 ? 0 : x == LARGURA - 1 ? 2 : 1)), x, y);
		}
	}
}

static void pagina_comecar(void) {
	pos = 0;
	linha = 0;
	coluna = 0;
	espera = 0;
	completa = FALSE;
	texto_limpar();
}

// Escreve a próxima letra; FALSE quando a página acabou.
static bool letra_escrever(void) {
	const u8 *texto = cena->dialogos[atual].paginas[pagina];
	const u8 codigo = texto[pos];
	if (codigo == DIALOGO_FIM) {
		return FALSE;
	}
	pos++;
	if (codigo == DIALOGO_LINHA) {
		linha++;
		coluna = 0;
	} else {
		VDP_setTileMapXY(WINDOW, tile_da_letra(codigo), texto_x() + coluna, y0 + 1 + linha * 2); // Uma linha vazia entre as linhas: os acentos não encostam na linha de cima.
		coluna++;
	}
	return TRUE;
}

static void opcoes_desenhar(void) {
	const Dialogo *d = &cena->dialogos[atual];
	texto_limpar();
	const u8 x = texto_x();
	for (u8 i = 0; i < d->n_opcoes; i++) {
		const u8 y = y0 + 1 + i;
		VDP_setTileMapXY(WINDOW, i == opcao ? tile_da_letra(cena->cursor) : tile_da_moldura(FUNDO), x, y);
		const u8 *texto = d->opcoes[i];
		for (u8 k = 0; texto[k] != DIALOGO_FIM && x + 2 + k < LARGURA - 1; k++) {
			VDP_setTileMapXY(WINDOW, tile_da_letra(texto[k]), x + 2 + k, y);
		}
	}
}

static void seta_desenhar(bool visivel) {
	VDP_setTileMapXY(WINDOW, visivel ? tile_da_letra(cena->seta) : tile_da_moldura(FUNDO), LARGURA - 2, y0 + cena->linhas - 2);
}

void dialogo_preparar(const DialogoCena *p_cena) {
	cena = p_cena;
	atual = -1;
	retrato_trocado = FALSE;
	VDP_loadTileData(cena->tiles, cena->base, cena->n_tiles, DMA);
}

bool dialogo_aberto(void) {
	return atual >= 0;
}

void dialogo_abrir(u16 dialogo) {
	if (!cena || dialogo >= cena->n_dialogos) {
		return;
	}
	const bool ja_aberta = atual >= 0;
	if (retrato_trocado) {
		PAL_setColors(paleta_trocada * 16, retrato_salvo, 16, DMA);
		retrato_trocado = FALSE;
	}
	atual = dialogo;
	pagina = 0;
	escolhendo = FALSE;
	piscar = 0;
	botoes_antes = JOY_readJoypad(JOY_1); // O botão que abriu (ou fechou o anterior) não passa a página.
	if (!ja_aberta) {
		PAL_getColors(13, cores_salvas, 3);
		PAL_setColor(13, cena->cor_fundo);
		PAL_setColor(14, cena->cor_borda);
		PAL_setColor(15, cena->cor_texto);
		if (cena->linha_topo > 0) {
			y0 = cena->linha_topo;
			VDP_setWindowVPos(FALSE, cena->linha_topo + cena->linhas);
		} else {
			y0 = 28 - cena->linhas;
			VDP_setWindowVPos(TRUE, y0);
		}
	}
	caixa_desenhar();
	const Dialogo *d = &cena->dialogos[atual];
	if (d->retrato) {
		paleta_trocada = d->paleta_retrato;
		PAL_getColors(paleta_trocada * 16, retrato_salvo, 16);
		PAL_setColors(paleta_trocada * 16, d->retrato->palette->data, 16, DMA);
		retrato_trocado = TRUE;
		VDP_drawImageEx(WINDOW, d->retrato, TILE_ATTR_FULL(d->paleta_retrato, TRUE, FALSE, FALSE, cena->base + cena->n_tiles), 1, y0 + 1, FALSE, TRUE);
	}
	pagina_comecar();
}

void dialogo_fechar(void) {
	if (atual < 0) {
		return;
	}
	VDP_clearTileMapRect(WINDOW, 0, y0, LARGURA, cena->linhas);
	if (cena->linha_topo > 0) {
		VDP_setWindowVPos(FALSE, cena->linha_topo);
	} else {
		VDP_setWindowVPos(FALSE, 0);
	}
	PAL_setColors(13, cores_salvas, 3, DMA);
	if (retrato_trocado) {
		PAL_setColors(paleta_trocada * 16, retrato_salvo, 16, DMA);
		retrato_trocado = FALSE;
	}
	atual = -1;
}

void dialogo_atualizar(void) {
	if (atual < 0) {
		return;
	}
	const Dialogo *d = &cena->dialogos[atual];
	const u16 botoes = JOY_readJoypad(JOY_1);
	const u16 apertou = botoes & ~botoes_antes;
	botoes_antes = botoes;

	if (escolhendo) {
		if ((apertou & BUTTON_UP) && opcao > 0) {
			opcao--;
			opcoes_desenhar();
		} else if ((apertou & BUTTON_DOWN) && opcao + 1 < d->n_opcoes) {
			opcao++;
			opcoes_desenhar();
		} else if (apertou & BOTOES_AVANCAR) {
			dialogo_escolha = opcao;
			if (d->variavel >= 0 && d->variavel < JOGO_VARS) {
				jogo_var[(u8)d->variavel] = opcao + 1;
			}
			escolhendo = FALSE;
			if (d->proximo >= 0) {
				dialogo_abrir(d->proximo);
			} else {
				dialogo_fechar();
			}
		}
		return;
	}

	if (!completa) {
		if (apertou & BOTOES_AVANCAR) {
			while (letra_escrever()) {
			}
			completa = TRUE;
		} else if (espera > 0) {
			espera--;
		} else {
			// Velocidade 0: a página inteira de uma vez.
			do {
				if (!letra_escrever()) {
					completa = TRUE;
					break;
				}
			} while (d->velocidade == 0);
			espera = d->velocidade > 0 ? d->velocidade - 1 : 0;
		}
		return;
	}

	piscar++;
	seta_desenhar((piscar & 16) != 0 && (pagina + 1 < d->n_paginas || d->n_opcoes == 0));
	if (!(apertou & BOTOES_AVANCAR)) {
		return;
	}
	if (pagina + 1 < d->n_paginas) {
		pagina++;
		pagina_comecar();
	} else if (d->n_opcoes > 0) {
		escolhendo = TRUE;
		opcao = 0;
		opcoes_desenhar();
	} else if (d->proximo >= 0) {
		dialogo_abrir(d->proximo);
	} else {
		dialogo_escolha = -1;
		dialogo_fechar();
	}
}
