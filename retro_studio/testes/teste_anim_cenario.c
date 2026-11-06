// Teste da animação de cenário (MDAnimacaoCenario) no computador: o streaming do jogo.c gerado
// (stream_part.c) e o runtime anim_cenario.c rodam com os dados de uma cena de verdade (dados.c, feito pelo
// anim_cenario_dados.py) e uma VRAM de mentira com a fila do DMA. A câmera para, anda nas duas direções,
// volta, salta e a cena recomeça; a cada quadro o teste confere:
// - toda célula da janela carregada aponta para uma vaga com o desenho certo (o quadro atual da animação ou
//   o padrão parado), com a paleta, a prioridade e os espelhos das palavras prontas;
// - a animação só manda bytes no quadro em que algum grupo troca de desenho, e só dos padrões que estão na
//   VRAM (nem um a mais, nem um a menos): rolar a câmera não reenvia nada;
// - com a fila do DMA cheia o envio vai na hora (nada se perde).
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "jogo.h"

// ---- VRAM e fila do DMA de mentira ----
static uint8_t vram_tiles[65536]; // Desenhos (endereço em bytes).
static u16 vram_planos[32768]; // Palavras dos planos (endereço / 2).
typedef struct {
	const void *origem;
	u16 destino, palavras, passo;
	int plano;
} Envio;
static Envio fila[256];
static int fila_n, fila_max = 80, fila_cheia_vezes, envios_na_hora;

static void escrever(const Envio *e) {
	if (e->plano) {
		const u16 *p = e->origem;
		for (u16 i = 0; i < e->palavras; i++) {
			vram_planos[((u32)e->destino + (u32)i * e->passo) / 2 & 32767] = p[i];
		}
	} else {
		memcpy(vram_tiles + e->destino, e->origem, e->palavras * 2u);
	}
}

static bool enfileirar(const void *origem, u16 destino, u16 palavras, u16 passo, int plano) {
	if (fila_n >= fila_max) {
		fila_cheia_vezes++;
		return FALSE;
	}
	fila[fila_n++] = (Envio){ origem, destino, palavras, passo, plano };
	return TRUE;
}

bool DMA_queueDma(u8 local, void *origem, u16 destino, u16 palavras, u16 passo) {
	(void)local;
	return enfileirar(origem, destino, palavras, passo, 0);
}
bool DMA_queueDmaFast(u8 local, void *origem, u32 destino, u16 palavras, u16 passo) {
	(void)local;
	return enfileirar(origem, (u16)destino, palavras, passo, 1);
}
void DMA_doDmaFast(u8 local, void *origem, u32 destino, u16 palavras, s16 passo) {
	(void)local;
	const Envio e = { origem, (u16)destino, palavras, (u16)passo, 1 };
	escrever(&e);
}
void VDP_loadTileData(const u32 *dados, u16 tile, u16 quantos, u8 modo) {
	(void)modo;
	const Envio e = { dados, (u16)(tile << 5), (u16)(quantos * 16), 2, 0 };
	envios_na_hora++;
	escrever(&e);
}
static void vblank(void) {
	for (int i = 0; i < fila_n; i++) {
		escrever(&fila[i]);
	}
	fila_n = 0;
}

void DMA_flushQueue(void) {
	vblank(); // No console, a fila vai na hora (com a tela ligada).
}

#include "stream_part.c"
#include "anim_cenario.c"
#include "dados.c"

static int falhas, quadros_conferidos;
#define FALHA(...) \
	do { \
		if (falhas++ < 12) { \
			printf(__VA_ARGS__); \
		} \
	} while (0)

// ---- Modelo independente do tempo da animação ----
static u32 chamadas; // anim_cenario_atualizar desde o preparar.
static int passo_no_tempo(const AnimCenarioGrupo *a, u32 t) {
	const u32 decorrido = (u32)a->passo0 * a->intervalo + (a->intervalo - a->espera0) + t;
	return (int)((decorrido / a->intervalo) % a->passos);
}
static const AnimCenarioGrupo *grupo_do_padrao(const MapaStream *m, u16 celula) {
	if (!m->anim_primeiro || celula < m->anim_primeiro) {
		return NULL;
	}
	for (u8 g = 0; g < m->n_anim; g++) {
		if (celula < m->anim[g].primeiro + m->anim[g].n) {
			return &m->anim[g];
		}
	}
	return NULL;
}
// Quadro que o grupo deve mostrar: no modo Sempre, pelo tempo (modelo independente); com gatilho, o estado da
// instância (a regra do estado é conferida no teste_anim_gatilho.c; aqui, que a VRAM mostra esse quadro).
static int quadro_esperado(const MapaStream *m, const AnimCenarioGrupo *a) {
	return a->gatilho ? quadro[m->anim_estado + (a - m->anim)] : a->sequencia[passo_no_tempo(a, chamadas)];
}
static const u32 *desenho_esperado(const MapaStream *m, u16 celula) {
	const AnimCenarioGrupo *a = grupo_do_padrao(m, celula);
	if (!a) {
		return m->padroes + (celula - 1) * 8;
	}
	return a->quadros + ((u32)quadro_esperado(m, a) * a->n + (celula - a->primeiro)) * 8;
}

static void conferir_janela(const MapaStream *m, const char *etapa, int quadro) {
	quadros_conferidos++;
	for (s16 y = m->linha; y < m->linha + JANELA_LINHAS; y++) {
		if (y < 0 || y >= m->altura) {
			continue;
		}
		for (s16 x = m->coluna; x < m->coluna + JANELA_COLUNAS; x++) {
			if (x < 0 || x >= m->largura) {
				continue;
			}
			const u16 celula = m->celulas[y * m->largura + x] & 0x0FFF;
			if (!celula) {
				continue;
			}
			const u16 palavra = vram_planos[stream_endereco(m, x, y) / 2];
			if (palavra != m->linhas[y * m->largura + x]) {
				FALHA("%s, quadro %d: célula %d,%d com a palavra %04X no plano (esperada %04X)\n", etapa, quadro, x, y, palavra, m->linhas[y * m->largura + x]);
				continue;
			}
			const u16 tile = palavra & 0x07FF;
			if (memcmp(vram_tiles + tile * 32u, desenho_esperado(m, celula), 32)) {
				FALHA("%s, quadro %d: célula %d,%d (padrão %d%s) com o desenho errado na vaga %d\n", etapa, quadro, x, y, celula - 1, grupo_do_padrao(m, celula) ? ", animado" : "", tile);
			}
		}
	}
}

// Bytes que a animação deve mandar agora: as variantes residentes dos grupos que trocam de desenho. Com gatilho,
// a troca é a do estado (quadro antes e depois de anim_cenario_atualizar); a residência é a de antes.
static u8 quadro_antes[ANIM_CENARIO_GRUPOS];
static u32 bytes_esperados(const MapaStream *m) {
	u32 bytes = 0;
	for (u8 g = 0; g < m->n_anim; g++) {
		const AnimCenarioGrupo *a = &m->anim[g];
		if (a->gatilho ? quadro_antes[g] == quadro[m->anim_estado + g] : a->sequencia[passo_no_tempo(a, chamadas)] == a->sequencia[passo_no_tempo(a, chamadas + 1)]) {
			continue;
		}
		for (u16 v = 0; v < a->n; v++) {
			if (m->dono[m->vagas[a->primeiro - 1 + v] - m->base] == a->primeiro + v) {
				bytes += 32;
			}
		}
	}
	return bytes;
}

static s16 limite(s32 v, s32 maior) {
	return (s16)(v < 0 ? 0 : v > maior ? maior : v);
}

static u32 bytes_rolando, bytes_parado, quadros_rolando, quadros_parado;

// Um quadro do jogo: anim_cenario_atualizar, stream_mover, vblank; depois confere.
static u32 sorteio = 1;
static int ativacoes; // Instâncias com gatilho que animaram em algum quadro.
static void um_quadro(MapaStream *m, s32 cx, s32 cy, const char *etapa, int n, bool rolando) {
	const s16 x = limite(cx, m->largura * 8 - 320), y = limite(cy, m->altura * 8 - 224);
	// Um jogador anda com a câmera, com os pés na base do primeiro sensor (passa pelas plantas com contato).
	for (u8 g = 0; g < m->n_anim; g++) {
		const AnimCenarioGatilho *s = m->anim[g].gatilho;
		if (s && s->modo != ANIM_CODIGO) {
			anim_cenario_corpo(ANIM_CORPO_JOGADOR, 0xFF, (s32)(x + 160) << 8, (s32)s->y1 << 8, -6, -16, 12, 16);
			break;
		}
	}
	// Comandos sorteados para as instâncias por código.
	for (u8 g = 0; g < m->n_anim; g++) {
		const AnimCenarioGatilho *s = m->anim[g].gatilho;
		sorteio = sorteio * 1103515245u + 12345u;
		const u8 r = (u8)(sorteio >> 16);
		const u8 k = m->anim_estado + g;
		if (!s || s->modo != ANIM_CODIGO || r > 12) {
			continue;
		}
		if (r < 4) {
			anim_cenario_ativar(k, 1 + r);
		} else if (r < 6) {
			anim_cenario_sustentar(k, r == 4);
		} else if (r < 8) {
			anim_cenario_parar(k);
		} else if (r == 8) {
			anim_cenario_parar_agora(k); // Vale na hora: manda o repouso já (conta nos bytes deste quadro).
		}
	}
	for (u8 g = 0; g < m->n_anim; g++) {
		quadro_antes[g] = quadro[m->anim_estado + g];
	}
	const u32 antes_bytes = anim_cenario_bytes; // parar_agora já mandou.
	anim_cenario_atualizar();
	const u32 esperado = ANIM_CENARIO_LIGADO ? bytes_esperados(m) : 0;
	(void)antes_bytes;
	chamadas++;
	for (u8 g = 0; g < m->n_anim; g++) {
		ativacoes += m->anim[g].gatilho && anim_cenario_animando(m->anim_estado + g) && quadro_antes[g] != quadro[m->anim_estado + g];
	}
	if (anim_cenario_bytes != esperado) {
		FALHA("%s, quadro %d: a animação mandou %u bytes (esperados %u)\n", etapa, n, anim_cenario_bytes, esperado);
	}
	if (rolando) {
		bytes_rolando += anim_cenario_bytes;
		quadros_rolando++;
	} else {
		bytes_parado += anim_cenario_bytes;
		quadros_parado++;
	}
	stream_mover(m, x, y);
	vblank();
	conferir_janela(m, etapa, n);
}

static void comecar_cena(MapaStream *m) {
	// Cena nova ou de volta: a VRAM fica com o lixo da anterior.
	for (u32 i = 0; i < sizeof(vram_tiles); i++) {
		vram_tiles[i] = (uint8_t)(i * 37 + 11);
	}
	memset(vram_planos, 0xA5, sizeof(vram_planos));
	stream_preparar(m);
	MapaStream *lista[1] = { m };
	anim_cenario_preparar(lista, 1);
	chamadas = 0;
}

static void percurso(MapaStream *m, const char *nome) {
	const s32 fim_x = m->largura * 8 - 320, fim_y = m->altura * 8 - 224;
	comecar_cena(m);
	int n = 0;
	for (int i = 0; i < 120; i++) {
		um_quadro(m, 0, 0, "parada", n++, FALSE);
	}
	for (s32 x = 0; x <= fim_x + 8; x += 2) {
		um_quadro(m, x, x * fim_y / (fim_x ? fim_x : 1), "andando para a direita (2 px)", n++, TRUE);
	}
	for (s32 x = fim_x; x >= -8; x -= 3) {
		um_quadro(m, x, fim_y - x * fim_y / (fim_x ? fim_x : 1), "voltando (3 px)", n++, TRUE);
	}
	for (int i = 0; i < 60; i++) {
		um_quadro(m, 0, 0, "parada de novo", n++, FALSE);
	}
	for (s32 x = 0; x <= fim_x; x += 8) {
		um_quadro(m, x, fim_y, "8 px por quadro, embaixo", n++, TRUE);
	}
	for (s32 y = fim_y; y >= 0; y -= 4) {
		um_quadro(m, fim_x / 2, y, "subindo", n++, TRUE);
	}
	for (int i = 0; i < 6; i++) {
		um_quadro(m, i & 1 ? fim_x : 0, 0, "saltos grandes", n++, TRUE);
		um_quadro(m, i & 1 ? fim_x : 0, 0, "depois do salto", n++, FALSE);
	}
	for (int i = 0; i < 200; i++) {
		um_quadro(m, fim_x / 2 + (i % 40 < 20 ? i % 20 : 20 - i % 20) * 7, 0, "vai e vem", n++, TRUE);
	}
	comecar_cena(m); // Troca de cena e volta.
	for (int i = 0; i < 40; i++) {
		um_quadro(m, fim_x, fim_y, "cena de volta", n++, FALSE);
	}
	for (s32 x = fim_x; x >= 0; x -= 5) {
		um_quadro(m, x, 0, "cena de volta, voltando", n++, TRUE);
	}
	printf("%s: %d quadros\n", nome, n);
}

int main(void) {
	for (int k = 0; k < TESTE_MAPAS; k++) {
		MapaStream *m = teste_mapas[k];
		fila_max = 80;
		percurso(m, teste_nomes[k]);
		fila_max = 1; // Fila quase sempre cheia: os envios vão na hora.
		fila_cheia_vezes = envios_na_hora = 0;
		percurso(m, "fila do DMA pequena");
		if (!fila_cheia_vezes || !anim_cenario_fila_cheia) {
			FALHA("a fila pequena não encheu (o caminho do envio na hora não foi testado)\n");
		}
	}
	printf("%d quadros conferidos; animação: %.1f bytes por quadro com a câmera parada, %.1f rolando\n", quadros_conferidos,
			quadros_parado ? (double)bytes_parado / quadros_parado : 0.0, quadros_rolando ? (double)bytes_rolando / quadros_rolando : 0.0);
	bool tem_gatilho = FALSE;
	for (int k = 0; k < TESTE_MAPAS; k++) {
		for (u8 g = 0; g < teste_mapas[k]->n_anim; g++) {
			tem_gatilho = tem_gatilho || teste_mapas[k]->anim[g].gatilho;
		}
	}
	printf("trocas de quadro de instâncias com gatilho: %d\n", ativacoes);
	if (tem_gatilho && !ativacoes) {
		FALHA("as instâncias com gatilho nunca animaram (o teste não exercitou os gatilhos)\n");
	}
	if (falhas) {
		printf("FALHOU: %d problemas\n", falhas);
		return 1;
	}
	printf("ok: animação de cenário\n");
	return 0;
}
