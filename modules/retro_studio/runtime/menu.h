// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Menus prontos (MDMenu): tela de título (Começar, Continuar, Senha, Opções) e pausa (Continuar, Opções,
// Salvar, Sair). As letras (com acentos) são tiles próprios, gerados no build. No título o menu fica no
// plano dos textos, com fundo transparente; na pausa, numa caixa no plano window, com a cena parada.
#pragma once

#include "jogo.h"

// Ações dos itens.
enum {
	MENU_COMECAR,
	MENU_CONTINUAR,
	MENU_SENHA,
	MENU_OPCOES,
	MENU_VOLTAR, // Pausa: volta ao jogo.
	MENU_SALVAR,
	MENU_SAIR, // Volta à cena principal (título).
};

// Textos que o menu usa (códigos: 0 = fim, n >= 2 = letra n - 2 da tabela da cena).
enum {
	MT_COMECAR,
	MT_CONTINUAR,
	MT_SENHA,
	MT_OPCOES,
	MT_VOLTAR,
	MT_SALVAR,
	MT_SAIR,
	MT_MUSICA,
	MT_EFEITOS,
	MT_CONTROLES,
	MT_LIGADO,
	MT_DESLIGADO,
	MT_CONTROLE_0,
	MT_CONTROLE_1,
	MT_CONTROLE_2,
	MT_APAGAR,
	MT_SLOT,
	MT_VAZIO,
	MT_SALVO,
	MT_PROGRESSO_SALVO,
	MT_CONFIRMA,
	MT_SIM,
	MT_NAO,
	MT_SENHA_ERRADA,
	MT_ALFABETO, // As 32 letras da senha.
	MT_CURSOR, // ">"
	MT_TOTAL
};

typedef struct {
	const u32 *tiles; // 8 palavras por tile: na pausa, 9 da moldura e depois as letras; no título, só as letras.
	u16 n_tiles;
	u16 base; // Primeiro tile na VRAM.
	bool pausa;
	u8 x, y; // Título: canto do menu no plano dos textos (tiles). Pausa: linha do window onde a caixa começa.
	u8 largura; // Colunas do menu (com o cursor).
	const u8 *const *textos; // MT_TOTAL textos.
	const u8 *itens; // Ações, na ordem.
	u8 n_itens;
	u16 cena_comecar;
	u8 slots; // 1 a JOGO_SLOTS.
	u8 som_cursor, som_escolha; // 0 = sem som.
	u16 cor_fundo, cor_borda, cor_texto; // Pausa: cores 13, 14 e 15 da PAL0 com o menu aberto.
} MenuCena;

void menu_preparar(const MenuCena *menu); // Na iniciar da cena. O título já abre o menu.
void menu_abrir(void);
bool menu_aberto(void);
void menu_atualizar(void); // Todo quadro com o menu aberto.
void menu_fechar(void);
