// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Menus prontos (MDMenu). Veja menu.h.
#include "menu.h"

#define MOLDURA 9
#define FUNDO 4
#define LARGURA_TELA 40
#define BOTOES_OK (BUTTON_A | BUTTON_C | BUTTON_START)

enum { TELA_PRINCIPAL, TELA_OPCOES, TELA_SLOTS, TELA_SENHA, TELA_CONFIRMA, TELA_MENSAGEM };
enum { OPCAO_MUSICA, OPCAO_EFEITOS, OPCAO_CONTROLES, OPCAO_APAGAR, OPCAO_VOLTAR };

static const MenuCena *menu;
static bool aberto;
static u8 tela, cursor, n_linhas;
static u8 acoes[8]; // Itens visíveis da tela principal.
static u8 opcoes[5];
static bool slots_continuar; // TELA_SLOTS: Continuar (TRUE) ou Começar.
static u8 senha_pos, senha_letras[JOGO_SENHA_LETRAS];
static u16 quadros, mensagem;
static u16 botoes_antes;
static u8 y0, altura; // Pausa: linha e altura da caixa (com a moldura).
static u8 area_linhas; // Linhas que a maior tela do menu ocupa (o título limpa todas ao trocar de tela).
static u16 cores_salvas[3];

static inline u16 tile_letra(u8 codigo) {
	return TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, menu->base + (menu->pausa ? MOLDURA : 0) + codigo - 2);
}

static inline u16 tile_vazio(void) {
	return menu->pausa ? TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, menu->base + FUNDO) : 0;
}

static inline VDPPlane plano(void) {
	return menu->pausa ? WINDOW : VDP_getTextPlane();
}

static u8 coluna0(void) {
	return menu->pausa ? (LARGURA_TELA - menu->largura) / 2 : menu->x;
}

static u8 linha0(void) {
	return menu->pausa ? y0 + 1 : menu->y;
}

static void area_limpar(void) {
	const u8 linhas = menu->pausa ? altura - 2 : area_linhas;
	for (u8 y = 0; y < linhas; y++) {
		for (u8 x = 0; x < menu->largura; x++) {
			VDP_setTileMapXY(plano(), tile_vazio(), coluna0() + x, linha0() + y);
		}
	}
}

// Escreve um texto a partir da coluna x da linha; devolve a coluna depois dele.
static u8 texto(const u8 *codigos, u8 x, u8 linha) {
	for (u8 i = 0; codigos[i] && x < menu->largura; i++, x++) {
		VDP_setTileMapXY(plano(), tile_letra(codigos[i]), coluna0() + x, linha0() + linha * 2);
	}
	return x;
}

static void cursor_desenhar(void) {
	for (u8 i = 0; i < n_linhas; i++) {
		VDP_setTileMapXY(plano(), i == cursor ? tile_letra(menu->textos[MT_CURSOR][0]) : tile_vazio(), coluna0(), linha0() + i * 2);
	}
}

static void som(u8 id) {
	if (id) {
		jogo_som(id);
	}
}

static void tela_desenhar(void) {
	area_limpar();
	const u8 *const *t = menu->textos;
	switch (tela) {
		case TELA_PRINCIPAL:
			for (u8 i = 0; i < n_linhas; i++) {
				static const u8 texto_da_acao[] = { MT_COMECAR, MT_CONTINUAR, MT_SENHA, MT_OPCOES, MT_VOLTAR, MT_SALVAR, MT_SAIR };
				texto(t[texto_da_acao[acoes[i]]], 2, i);
			}
			break;
		case TELA_OPCOES:
			for (u8 i = 0; i < n_linhas; i++) {
				u8 x;
				switch (opcoes[i]) {
					case OPCAO_MUSICA:
						x = texto(t[MT_MUSICA], 2, i);
						texto(t[jogo_musica_ligada ? MT_LIGADO : MT_DESLIGADO], x + 1, i);
						break;
					case OPCAO_EFEITOS:
						x = texto(t[MT_EFEITOS], 2, i);
						texto(t[jogo_efeitos_ligados ? MT_LIGADO : MT_DESLIGADO], x + 1, i);
						break;
					case OPCAO_CONTROLES:
						x = texto(t[MT_CONTROLES], 2, i);
						texto(t[MT_CONTROLE_0 + jogo_controles], x + 1, i);
						break;
					case OPCAO_APAGAR:
						texto(t[MT_APAGAR], 2, i);
						break;
					default:
						texto(t[MT_VOLTAR], 2, i);
						break;
				}
			}
			break;
		case TELA_SLOTS:
			for (u8 i = 0; i < n_linhas; i++) {
				if (i == menu->slots) {
					texto(t[MT_VOLTAR], 2, i);
					continue;
				}
				u8 x = texto(t[MT_SLOT], 2, i);
				const u8 digito[2] = { t[MT_CURSOR][1 + i], 0 }; // MT_CURSOR é ">123 ": os dígitos dos slots e o espaço.
				x = texto(digito, x + 1, i);
				texto(t[jogo_tem_save(i) ? MT_SALVO : MT_VAZIO], x + 1, i);
			}
			break;
		case TELA_SENHA:
			texto(t[MT_SENHA], 0, 0);
			for (u8 i = 0; i < JOGO_SENHA_LETRAS; i++) {
				const u8 letra[2] = { t[MT_ALFABETO][senha_letras[i]], 0 };
				texto(letra, 2 + i, 1);
			}
			break;
		case TELA_CONFIRMA:
			texto(t[MT_CONFIRMA], 0, 0);
			texto(t[MT_SIM], 2, 1);
			texto(t[MT_NAO], 2, 2);
			break;
		case TELA_MENSAGEM:
			texto(t[mensagem], 0, 0);
			break;
	}
	if (tela == TELA_PRINCIPAL || tela == TELA_OPCOES || tela == TELA_SLOTS) {
		cursor_desenhar();
	} else if (tela == TELA_CONFIRMA) {
		for (u8 i = 1; i <= 2; i++) {
			VDP_setTileMapXY(plano(), i == cursor + 1 ? tile_letra(menu->textos[MT_CURSOR][0]) : tile_vazio(), coluna0(), linha0() + i * 2);
		}
	}
}

static void tela_abrir(u8 nova) {
	tela = nova;
	cursor = 0;
	quadros = 0;
	n_linhas = 0;
	if (tela == TELA_PRINCIPAL) {
		for (u8 i = 0; i < menu->n_itens; i++) {
			bool mostra = TRUE;
			if (menu->itens[i] == MENU_CONTINUAR && !menu->pausa) {
				mostra = FALSE;
				for (u8 s = 0; s < menu->slots; s++) {
					mostra = mostra || jogo_tem_save(s);
				}
			}
			if (mostra) {
				acoes[n_linhas++] = menu->itens[i];
			}
		}
	} else if (tela == TELA_OPCOES) {
		opcoes[n_linhas++] = OPCAO_MUSICA;
		opcoes[n_linhas++] = OPCAO_EFEITOS;
		opcoes[n_linhas++] = OPCAO_CONTROLES;
		if (!menu->pausa) {
			opcoes[n_linhas++] = OPCAO_APAGAR;
		}
		opcoes[n_linhas++] = OPCAO_VOLTAR;
	} else if (tela == TELA_SLOTS) {
		n_linhas = menu->slots + 1;
	} else if (tela == TELA_SENHA) {
		n_linhas = 3;
		senha_pos = 0;
		memset(senha_letras, 0, sizeof(senha_letras));
	} else if (tela == TELA_CONFIRMA) {
		n_linhas = 3;
		cursor = 1; // Começa no NÃO.
	} else {
		n_linhas = 1;
	}
	tela_desenhar();
}

static void comecar(u8 slot) {
	jogo_slot = slot;
	vidas = 0;
	pontos = 0;
	memset(jogo_var, 0, sizeof(jogo_var));
	menu_fechar();
	jogo_trocar_cena(menu->cena_comecar);
}

static void escolher_principal(void) {
	switch (acoes[cursor]) {
		case MENU_COMECAR:
			if (menu->slots > 1) {
				slots_continuar = FALSE;
				tela_abrir(TELA_SLOTS);
			} else {
				comecar(0);
			}
			break;
		case MENU_CONTINUAR:
			if (menu->pausa) {
				menu_fechar();
			} else if (menu->slots > 1) {
				slots_continuar = TRUE;
				tela_abrir(TELA_SLOTS);
			} else if (jogo_carregar(0)) {
				menu_fechar();
			}
			break;
		case MENU_SENHA:
			tela_abrir(TELA_SENHA);
			break;
		case MENU_OPCOES:
			tela_abrir(TELA_OPCOES);
			break;
		case MENU_VOLTAR:
			menu_fechar();
			break;
		case MENU_SALVAR:
			jogo_salvar(jogo_slot);
			mensagem = MT_PROGRESSO_SALVO;
			tela_abrir(TELA_MENSAGEM);
			break;
		case MENU_SAIR:
			menu_fechar();
			jogo_trocar_cena(0);
			break;
	}
}

void menu_preparar(const MenuCena *p_menu) {
	menu = p_menu;
	aberto = FALSE;
	u8 maior = menu->n_itens;
	maior = maior > (menu->pausa ? 4 : 5) ? maior : (menu->pausa ? 4 : 5); // Opções: 4 na pausa, 5 no título.
	if (!menu->pausa && menu->slots + 1 > maior) {
		maior = menu->slots + 1;
	}
	area_linhas = maior * 2 - 1;
	VDP_loadTileData(menu->tiles, menu->base, menu->n_tiles, DMA);
	if (!menu->pausa) {
		menu_abrir();
	}
}

bool menu_aberto(void) {
	return aberto;
}

void menu_abrir(void) {
	if (!menu || aberto) {
		return;
	}
	aberto = TRUE;
	botoes_antes = jogo_ler(JOY_1); // O botão que abriu não escolhe.
	if (menu->pausa) {
		// Caixa no window com a maior tela do menu, uma linha vazia entre as linhas.
		altura = area_linhas + 2;
		y0 = menu->y;
		PAL_getColors(13, cores_salvas, 3);
		PAL_setColor(13, menu->cor_fundo);
		PAL_setColor(14, menu->cor_borda);
		PAL_setColor(15, menu->cor_texto);
		VDP_setWindowVPos(FALSE, y0 + altura);
		for (u8 y = 0; y < altura; y++) {
			const u16 fileira = y == 0 ? 0 : y == altura - 1 ? 6 : 3;
			for (u8 x = 0; x < LARGURA_TELA; x++) {
				VDP_setTileMapXY(WINDOW, TILE_ATTR_FULL(PAL0, TRUE, FALSE, FALSE, menu->base + fileira + (x == 0 ? 0 : x == LARGURA_TELA - 1 ? 2 : 1)), x, y0 + y);
			}
		}
	}
	tela_abrir(TELA_PRINCIPAL);
}

void menu_fechar(void) {
	if (!aberto) {
		return;
	}
	aberto = FALSE;
	if (menu->pausa) {
		VDP_clearTileMapRect(WINDOW, 0, y0, LARGURA_TELA, altura);
		VDP_setWindowVPos(FALSE, y0);
		PAL_setColors(13, cores_salvas, 3, DMA);
	} else {
		area_limpar();
	}
}

void menu_atualizar(void) {
	if (!aberto) {
		return;
	}
	const u16 botoes = jogo_ler(JOY_1);
	const u16 apertou = botoes & ~botoes_antes;
	botoes_antes = botoes;
	quadros++;

	if (tela == TELA_MENSAGEM) {
		if (quadros > 60 || (apertou & (BOTOES_OK | BUTTON_B))) {
			tela_abrir(TELA_PRINCIPAL);
		}
		return;
	}
	if (tela == TELA_SENHA) {
		const u8 *alfabeto = menu->textos[MT_ALFABETO];
		// A letra escolhida pisca.
		const u8 letra[2] = { (quadros & 8) ? menu->textos[MT_CURSOR][4] : alfabeto[senha_letras[senha_pos]], 0 };
		texto(letra, 2 + senha_pos, 1);
		if (mensagem && quadros > 90) {
			mensagem = 0;
			tela_desenhar();
		}
		if (apertou & (BUTTON_UP | BUTTON_DOWN)) {
			senha_letras[senha_pos] = (senha_letras[senha_pos] + ((apertou & BUTTON_UP) ? 1 : 31)) & 31;
			som(menu->som_cursor);
		} else if ((apertou & BUTTON_RIGHT) && senha_pos + 1 < JOGO_SENHA_LETRAS) {
			const u8 atual[2] = { alfabeto[senha_letras[senha_pos]], 0 };
			texto(atual, 2 + senha_pos, 1);
			senha_pos++;
		} else if ((apertou & BUTTON_LEFT) && senha_pos > 0) {
			const u8 atual[2] = { alfabeto[senha_letras[senha_pos]], 0 };
			texto(atual, 2 + senha_pos, 1);
			senha_pos--;
		} else if (apertou & BUTTON_B) {
			tela_abrir(TELA_PRINCIPAL);
		} else if (apertou & BOTOES_OK) {
			// Converte os códigos das letras de volta para o texto da senha.
			static const char letras[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
			char senha[JOGO_SENHA_LETRAS + 1];
			for (u8 i = 0; i < JOGO_SENHA_LETRAS; i++) {
				senha[i] = letras[senha_letras[i]];
			}
			senha[JOGO_SENHA_LETRAS] = 0;
			if (jogo_usar_senha(senha)) {
				som(menu->som_escolha);
				menu_fechar();
			} else {
				texto(menu->textos[MT_SENHA_ERRADA], 0, 2);
				mensagem = MT_SENHA_ERRADA;
				quadros = 0;
			}
		}
		return;
	}

	const u8 maximo = tela == TELA_CONFIRMA ? 1 : n_linhas - 1;
	if ((apertou & BUTTON_UP) && cursor > 0) {
		cursor--;
		som(menu->som_cursor);
		tela == TELA_CONFIRMA ? tela_desenhar() : cursor_desenhar();
		return;
	}
	if ((apertou & BUTTON_DOWN) && cursor < maximo) {
		cursor++;
		som(menu->som_cursor);
		tela == TELA_CONFIRMA ? tela_desenhar() : cursor_desenhar();
		return;
	}
	if (apertou & BUTTON_B) {
		if (tela == TELA_PRINCIPAL) {
			if (menu->pausa) {
				menu_fechar();
			}
		} else {
			if (tela == TELA_OPCOES) {
				jogo_config_salvar();
			}
			tela_abrir(tela == TELA_CONFIRMA ? TELA_OPCOES : TELA_PRINCIPAL);
		}
		return;
	}
	const bool lados = tela == TELA_OPCOES && (apertou & (BUTTON_LEFT | BUTTON_RIGHT));
	if (!(apertou & BOTOES_OK) && !lados) {
		return;
	}
	som(menu->som_escolha);
	switch (tela) {
		case TELA_PRINCIPAL:
			escolher_principal();
			break;
		case TELA_OPCOES: {
			const u8 escolhida = opcoes[cursor];
			if (escolhida == OPCAO_MUSICA) {
				jogo_musica_ligada = !jogo_musica_ligada;
				jogo_config_aplicar();
			} else if (escolhida == OPCAO_EFEITOS) {
				jogo_efeitos_ligados = !jogo_efeitos_ligados;
			} else if (escolhida == OPCAO_CONTROLES) {
				jogo_controles = (jogo_controles + ((apertou & BUTTON_LEFT) ? 2 : 1)) % 3;
			} else if (escolhida == OPCAO_APAGAR) {
				if (!lados) {
					tela_abrir(TELA_CONFIRMA);
				}
				return;
			} else if (!lados) {
				jogo_config_salvar();
				tela_abrir(TELA_PRINCIPAL);
				return;
			}
			const u8 c = cursor;
			tela_desenhar();
			cursor = c;
			cursor_desenhar();
			break;
		}
		case TELA_SLOTS:
			if (cursor == menu->slots) {
				tela_abrir(TELA_PRINCIPAL);
			} else if (!slots_continuar) {
				comecar(cursor);
			} else if (jogo_carregar(cursor)) {
				menu_fechar();
			}
			break;
		case TELA_CONFIRMA:
			if (cursor == 0) {
				for (u8 s = 0; s < JOGO_SLOTS; s++) {
					jogo_apagar_save(s);
				}
			}
			tela_abrir(TELA_OPCOES);
			break;
	}
}
