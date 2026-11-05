// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Caixas de diálogo (MDDialogo).
//
// A caixa fica no plano window: embaixo da tela ou, quando os textos fixos da cena já usam o window no
// topo, logo abaixo deles. As letras (com os acentos do português) são tiles próprios, gerados no build
// só com as letras que os diálogos da cena usam, com fundo opaco (cores 13, 14 e 15 da PAL0, trocadas
// enquanto a caixa está aberta). Com a caixa aberta, a cena fica parada.
#pragma once

#include "jogo.h"

// Códigos das páginas: 0 = fim, 1 = nova linha, n >= 2 = letra n - 2 da tabela da cena.
#define DIALOGO_FIM 0
#define DIALOGO_LINHA 1

typedef struct {
	const u8 *const *paginas;
	u8 n_paginas;
	const u8 *const *opcoes; // Escolha depois da última página (NULL = nenhuma).
	u8 n_opcoes;
	s8 variavel; // jogo_var que recebe a escolha (1 = primeira opção); -1 = nenhuma.
	s16 proximo; // Diálogo aberto ao fechar este (-1 = nenhum).
	u8 velocidade; // Quadros por letra (0 = a página aparece inteira).
	const Image *retrato; // NULL = sem retrato.
	u8 paleta_retrato;
	u8 colunas_retrato; // Largura do retrato em tiles (o texto começa depois dele).
} Dialogo;

typedef struct {
	const Dialogo *dialogos;
	u16 n_dialogos;
	const u32 *tiles; // 8 palavras por tile: 9 da moldura e depois as letras.
	u16 n_tiles;
	u16 base; // Primeiro tile na VRAM (as letras e o retrato ficam logo depois da moldura).
	u8 linha_topo; // Linhas fixas no topo do window (0 = a caixa vai embaixo).
	u8 linhas; // Altura da caixa em tiles, com a moldura.
	u8 seta, cursor; // Códigos das letras "v" (página continua) e ">" (opção escolhida).
	u16 cor_fundo, cor_borda, cor_texto;
} DialogoCena;

extern s16 dialogo_escolha; // Última escolha (0 = primeira opção); -1 = nenhuma.

void dialogo_preparar(const DialogoCena *cena); // Na iniciar da cena.
void dialogo_abrir(u16 dialogo);
bool dialogo_aberto(void);
void dialogo_atualizar(void); // Todo quadro com a caixa aberta.
void dialogo_fechar(void);
