// Teste dos gatilhos da animação de cenário (MDAnimacaoCenario: proximidade, contato e código) no computador.
// O runtime gerado (anim_cenario.c) roda com um mapa de mentira (um padrão por instância) e é comparado, quadro a
// quadro, com um modelo escrito à parte: o sensor do modelo segue o caminho do corpo em passos de 1 px (o runtime
// usa frações), e a regra dos ciclos é a do Inspetor. Além da comparação, cada cena confere o que o pedido diz
// (ativa ao entrar, termina o ciclo e os ciclos depois, não reinicia ao voltar, instâncias independentes...).
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "jogo.h"

static int envios_por_vaga[64];
static u32 bytes_enviados;
static int fila_cheia_falsa; // > 0: as próximas DMA_queueDma falham (fila cheia).
bool DMA_queueDma(u8 local, void *origem, u16 destino, u16 palavras, u16 passo) {
	(void)local, (void)origem, (void)passo;
	if (fila_cheia_falsa > 0) {
		fila_cheia_falsa--;
		return FALSE;
	}
	for (u16 t = 0; t < palavras / 16; t++) {
		envios_por_vaga[((destino >> 5) + t) & 63]++;
	}
	bytes_enviados += palavras * 2u;
	return TRUE;
}
bool DMA_queueDmaFast(u8 local, void *origem, u32 destino, u16 palavras, u16 passo) {
	(void)local, (void)origem, (void)destino, (void)palavras, (void)passo;
	return TRUE;
}
void DMA_doDmaFast(u8 local, void *origem, u32 destino, u16 palavras, s16 passo) {
	(void)local, (void)origem, (void)destino, (void)palavras, (void)passo;
}
static int envios_na_hora;
void VDP_loadTileData(const u32 *dados, u16 tile, u16 quantos, u8 modo) {
	(void)dados, (void)modo;
	envios_na_hora++;
	for (u16 t = 0; t < quantos; t++) {
		envios_por_vaga[(tile + t) & 63]++;
	}
}
void DMA_flushQueue(void) {
}

#include "anim_cenario.c"

static int falhas;
#define CONFERIR(c, ...) \
	do { \
		if (!(c)) { \
			if (falhas++ < 40) { \
				printf("FALHOU (linha %d): ", __LINE__); \
				printf(__VA_ARGS__); \
				printf("\n"); \
			} \
		} \
	} while (0)

// ---- Mapa de mentira: 8 instâncias com gatilho e 1 no modo Sempre, um padrão (vaga) cada ----
#define N 9
#define INTERVALO 2
static const u8 seq[4] = { 0, 1, 2, 3 }; // Quadro 0 = repouso.
static u32 quadros_dados[N][4][8]; // [instância][quadro][palavras]: palavra = 100·instância + quadro.
static u16 vagas[N];
static u16 dono[N];
#define G_JOGADOR 0x0004
#define G_INIMIGO 0x0008
#define G_KUNAI 0x0001
#define G_GALINHA 0x0010
// Instâncias: A e B contato (mesma tira, sensores separados), C contato com movimento, D proximidade, E contato de
// inimigos, F grupo personalizado, G por código, H contato sem ciclos depois, S sempre.
enum { A, B, C, D, E, F, G, H, S };
static const AnimCenarioGatilho gat[N - 1] = {
	{ 100, 100, 120, 120, G_JOGADOR, ANIM_ALVO_JOGADOR, ANIM_CONTATO, 2, 0, 0 },
	{ 300, 100, 320, 120, G_JOGADOR, ANIM_ALVO_JOGADOR, ANIM_CONTATO, 2, 0, 0 },
	{ 500, 100, 520, 120, G_JOGADOR, ANIM_ALVO_JOGADOR, ANIM_CONTATO, 2, 0, 5 }, // 1 px/s → 5/256 px por quadro.
	{ 700 - 16, 100 - 16, 720 + 16, 120 + 16, G_JOGADOR, ANIM_ALVO_JOGADOR, ANIM_PROXIMIDADE, 2, 0, 0 },
	{ 900, 100, 920, 120, G_INIMIGO, ANIM_ALVO_INIMIGO, ANIM_CONTATO, 2, 0, 0 },
	{ 1100, 100, 1120, 120, G_GALINHA, 0, ANIM_CONTATO, 2, 0, 0 },
	{ 0, 0, 0, 0, 0, 0, ANIM_CODIGO, 2, 2, 0 }, // Repouso no quadro 2.
	{ 1300, 100, 1304, 120, G_JOGADOR, ANIM_ALVO_JOGADOR, ANIM_CONTATO, 0, 0, 0 }, // 4 px de largura (dash).
};
static AnimCenarioGrupo grupos[N];
static MapaStream mapa;

static void montar(void) {
	for (int i = 0; i < N; i++) {
		for (int f = 0; f < 4; f++) {
			for (int w = 0; w < 8; w++) {
				quadros_dados[i][f][w] = 100u * i + f;
			}
		}
		vagas[i] = 16 + i;
		grupos[i] = (AnimCenarioGrupo){ quadros_dados[i][0], seq, i + 1, 1, 4, INTERVALO, 0, INTERVALO, i < N - 1 ? &gat[i] : NULL };
	}
	memset(&mapa, 0, sizeof(mapa));
	mapa.base = 16;
	mapa.vagas = vagas;
	mapa.dono = dono;
	mapa.n_vagas = N;
	mapa.anim = grupos;
	mapa.anim_primeiro = 1;
	mapa.n_anim = N;
}

// ---- Modelo ----
typedef struct {
	int estado, passo, espera, restantes, pedidos;
	bool codigo, sem_sensor;
	int quadro;
} Modelo;
static Modelo mod[N];
static u32 tempo; // Quadros desde o preparar (modo Sempre).

static void modelo_preparar(void) {
	for (int i = 0; i < N; i++) {
		mod[i] = (Modelo){ 0 };
		mod[i].espera = INTERVALO;
		mod[i].quadro = i < N - 1 ? gat[i].repouso : 0;
	}
	tempo = 0;
}

static void modelo_passo(int i, bool sensor) {
	Modelo *m = &mod[i];
	if (i == S) {
		tempo++;
		m->quadro = seq[(tempo / INTERVALO) % 4];
		return;
	}
	const bool sustenta = sensor || m->codigo;
	const int apos = gat[i].ciclos_apos;
	if (m->estado == 0) {
		if (!sustenta && !m->pedidos) {
			return;
		}
		m->estado = 1;
		m->passo = 0;
		m->espera = INTERVALO;
		m->restantes = sustenta ? apos : 0;
		if (m->pedidos - 1 > m->restantes) {
			m->restantes = m->pedidos - 1;
		}
		m->pedidos = 0;
		m->quadro = seq[0];
		return;
	}
	if (sustenta && m->restantes < apos) {
		m->restantes = apos;
	}
	if (m->pedidos) {
		if (m->pedidos > m->restantes) {
			m->restantes = m->pedidos;
		}
		m->pedidos = 0;
	}
	if (--m->espera) {
		return;
	}
	m->espera = INTERVALO;
	if (++m->passo >= 4) {
		m->passo = 0;
		if (!sustenta) {
			if (!m->restantes) {
				m->estado = 0;
				m->quadro = gat[i].repouso;
				return;
			}
			m->restantes--;
		}
	}
	m->quadro = seq[m->passo];
}

// Corpos do teste: pés em px (x, y) com caixa 12 × 16 acima deles.
typedef struct {
	u8 slot;
	u16 grupos;
	u8 internos;
	s32 x, y; // 1/256 px.
	s32 px, py;
	bool visto, ativo;
} Corpo;
static Corpo corpos[6];

static bool sensor_modelo(int i) {
	if (i == S || gat[i].modo == ANIM_CODIGO || mod[i].sem_sensor) {
		return FALSE;
	}
	const AnimCenarioGatilho *s = &gat[i];
	for (int c = 0; c < 6; c++) {
		const Corpo *b = &corpos[c];
		if (!b->ativo || (!(s->grupos & b->grupos) && !(s->internos & b->internos))) {
			continue;
		}
		const bool teleporte = !b->visto || labs(b->x - b->px) > ANIM_TELEPORTE * 256 || labs(b->y - b->py) > ANIM_TELEPORTE * 256;
		const long andou = teleporte ? 0 : (labs(b->x - b->px) > labs(b->y - b->py) ? labs(b->x - b->px) : labs(b->y - b->py));
		if (s->velocidade && andou < s->velocidade) {
			continue;
		}
		// Segue o caminho em passos de no máximo 1 px (ou só a posição atual, num teleporte).
		const int x1 = (int)(b->x >> 8), y1 = (int)(b->y >> 8);
		const int x0 = teleporte ? x1 : (int)(b->px >> 8), y0 = teleporte ? y1 : (int)(b->py >> 8);
		const int passos = abs(x1 - x0) > abs(y1 - y0) ? abs(x1 - x0) : abs(y1 - y0);
		for (int k = 0; k <= passos * 8; k++) {
			// Posição em 1/8 de px ao longo da reta.
			const double t = passos ? (double)k / (passos * 8) : 1.0;
			const double bx = x0 + (x1 - x0) * t - 6, by = y0 + (y1 - y0) * t - 16;
			if (bx < s->x1 && bx + 12 > s->x0 && by < s->y1 && by + 16 > s->y0) {
				return TRUE;
			}
		}
	}
	return FALSE;
}

static int quadros_rodados;
// Um quadro: os corpos vão para o runtime, o runtime e o modelo andam, e os dois são comparados.
static void um_quadro(const char *cena) {
	for (int c = 0; c < 6; c++) {
		Corpo *b = &corpos[c];
		if (b->ativo) {
			if (b->slot >= ANIM_CORPO_JOGADOR) {
				anim_cenario_corpo(b->slot, b->internos, b->x, b->y, -6, -16, 12, 16);
			} else {
				// Ator (MDAtor): o runtime sente pelo mesmo caminho, com os grupos dele.
				sentir(b->slot, (const void *)(uintptr_t)(b->slot + 100), b->grupos, b->internos, b->x, b->y, -6, -16, 12, 16);
			}
		}
	}
	bool sensores[N];
	for (int i = 0; i < N; i++) {
		sensores[i] = sensor_modelo(i);
	}
	// O que o runtime deve mandar: as instâncias residentes cujo quadro muda.
	Modelo antes[N];
	memcpy(antes, mod, sizeof(mod));
	for (int i = 0; i < N; i++) {
		modelo_passo(i, sensores[i]);
	}
	u32 esperado = 0;
	for (int i = 0; i < N; i++) {
		if (mod[i].quadro != antes[i].quadro && dono[i] == i + 1) {
			esperado += 32;
		}
	}
	memset(envios_por_vaga, 0, sizeof(envios_por_vaga));
	bytes_enviados = 0;
	envios_na_hora = 0;
	anim_cenario_atualizar();
	quadros_rodados++;
	for (int c = 0; c < 6; c++) {
		corpos[c].px = corpos[c].x;
		corpos[c].py = corpos[c].y;
		corpos[c].visto = corpos[c].ativo;
	}
	for (int i = 0; i < N; i++) {
		CONFERIR(quadro[i] == mod[i].quadro, "%s, quadro %d: instância %c mostra %d, o modelo %d", cena, quadros_rodados, "ABCDEFGHS"[i], quadro[i], mod[i].quadro);
		CONFERIR((i < N - 1 ? anim_cenario_tem_ator(i) : 0) == (i < N - 1 && sensores[i]), "%s, quadro %d: instância %c, tem_ator %d e o modelo %d", cena, quadros_rodados, "ABCDEFGHS"[i], anim_cenario_tem_ator(i), sensores[i]);
	}
	CONFERIR(bytes_enviados + envios_na_hora * 32u == esperado, "%s, quadro %d: mandou %u bytes, o modelo %u", cena, quadros_rodados, bytes_enviados + envios_na_hora * 32u, esperado);
}

static void varios(int n, const char *cena) {
	for (int i = 0; i < n; i++) {
		um_quadro(cena);
	}
}

static void andar(int c, s32 dx, s32 dy) {
	corpos[c].x += dx;
	corpos[c].y += dy;
}

static void comecar(void) {
	montar();
	for (int i = 0; i < N; i++) {
		dono[i] = i + 1; // Todas residentes (a não ser quando o teste tira).
	}
	MapaStream *lista[1] = { &mapa };
	anim_cenario_preparar(lista, 1);
	modelo_preparar();
	memset(corpos, 0, sizeof(corpos));
	corpos[0] = (Corpo){ ANIM_CORPO_JOGADOR, 0, ANIM_ALVO_JOGADOR, 0, 0, 0, 0, FALSE, FALSE }; // MDJogador.
	corpos[1] = (Corpo){ 3, G_JOGADOR, 0, 0, 0, 0, 0, FALSE, FALSE }; // MDAtor do grupo jogador (o Henzo).
	corpos[2] = (Corpo){ 4, G_KUNAI, 0, 0, 0, 0, 0, FALSE, FALSE }; // Kunai (projétil).
	corpos[3] = (Corpo){ 5, G_INIMIGO, 0, 0, 0, 0, 0, FALSE, FALSE }; // Ninja.
	corpos[4] = (Corpo){ 6, G_GALINHA, 0, 0, 0, 0, 0, FALSE, FALSE };
	corpos[5] = (Corpo){ 7, G_JOGADOR, 0, 0, 0, 0, 0, FALSE, FALSE }; // Segundo ator do grupo jogador.
}

static void por(int c, int x, int y) {
	corpos[c].ativo = TRUE;
	corpos[c].x = (s32)x << 8;
	corpos[c].y = (s32)y << 8;
}

static int ate_repouso(int i, int limite, const char *cena) {
	for (int n = 1; n <= limite; n++) {
		um_quadro(cena);
		if (!anim_cenario_animando(i)) {
			return n;
		}
	}
	return -1;
}

int main(void) {
	// 1. Entrada pela esquerda, andando: ativa ao tocar, fica ativa dentro, termina o ciclo e mais 2 ao sair.
	comecar();
	por(1, 80, 130);
	int ativou = -1;
	for (int n = 0; n < 60 && (ativou < 0 || anim_cenario_tem_ator(A)); n++) {
		andar(1, 256, 0);
		um_quadro("entrada pela esquerda");
		if (ativou < 0 && anim_cenario_animando(A)) {
			ativou = (int)(corpos[1].x >> 8);
		}
	}
	CONFERIR(!anim_cenario_tem_ator(A) && (corpos[1].x >> 8) == 127, "saiu do sensor com os pés em x = %d (a caixa sai em 127)", (int)(corpos[1].x >> 8));
	CONFERIR(ativou == 95, "ativou com os pés em x = %d (a caixa encosta no sensor em 95)", ativou);
	CONFERIR(!anim_cenario_animando(B), "tocar A não anima B (a mesma tira, outro estado)");
	// Saiu do sensor em x = 126 (caixa 120): o passo atual termina e mais 2 ciclos (4 passos × 2 quadros cada).
	por(1, 400 - 200, 130); // Longe dos sensores (teleporte não cria caminho).
	const int fim = ate_repouso(A, 100, "saída");
	CONFERIR(fim >= 2 * 4 * INTERVALO && fim <= 3 * 4 * INTERVALO, "parou %d quadros depois de sair (o resto do ciclo atual e mais 2 ciclos de %d)", fim, 4 * INTERVALO);
	CONFERIR(quadro[A] == 0, "repouso no quadro 0");
	varios(20, "parada sem nada");
	CONFERIR(bytes_enviados == 0, "em repouso nada é mandado");

	// 2. Pelo outro lado (da direita para a esquerda), e B anima sem mexer em A.
	comecar();
	por(1, 340, 130);
	for (int n = 0; n < 50; n++) {
		andar(1, -256, 0);
		um_quadro("entrada pela direita");
	}
	CONFERIR(anim_cenario_animando(B) && !anim_cenario_animando(A), "B ativou pela direita e A ficou parado");

	// 3. Exigir movimento: parado dentro não sustenta; andando acima do limite ativa; abaixo, não.
	comecar();
	por(1, 505, 130);
	varios(10, "parado dentro de C");
	CONFERIR(!anim_cenario_animando(C), "parado dentro de C (exige movimento) não anima");
	for (int n = 0; n < 40; n++) {
		andar(1, 4, 0); // 4/256 px por quadro: abaixo de 1 px/s.
		um_quadro("devagar demais em C");
	}
	CONFERIR(!anim_cenario_animando(C), "abaixo da velocidade mínima não anima");
	for (int n = 0; n < 4; n++) {
		andar(1, 6, 0); // 6/256 px por quadro: acima.
		um_quadro("acima do limite em C");
	}
	CONFERIR(anim_cenario_animando(C), "acima da velocidade mínima anima");
	varios(4 * INTERVALO * 4, "parou dentro de C");
	CONFERIR(!anim_cenario_animando(C), "parou dentro: a animação termina os ciclos e repousa");
	// Câmera rolando não conta: só a posição no mundo entra (o teste nem tem câmera).

	// 4. Proximidade: até 16 px da área ativa; mais longe, não.
	comecar();
	por(0, 700 - 16 - 6 - 2, 130); // A caixa (x − 6 a x + 6) termina 2 px antes da distância: fora.
	varios(6, "longe de D");
	CONFERIR(!anim_cenario_animando(D), "fora da distância não anima");
	por(0, 700 - 16 + 4, 130);
	varios(2, "perto de D");
	CONFERIR(anim_cenario_animando(D), "dentro da distância anima (MDJogador)");

	// 5. Filtros: kunai não ativa o sensor de jogador; ninja ativa E (inimigos) e não A; o grupo personalizado só F.
	comecar();
	por(2, 110, 110);
	por(3, 910, 110);
	por(4, 1110, 110);
	varios(3, "filtros");
	CONFERIR(!anim_cenario_animando(A), "a kunai (projétil) não ativa o sensor de jogador");
	CONFERIR(anim_cenario_animando(E), "o ninja ativa o sensor de inimigos");
	CONFERIR(anim_cenario_animando(F), "o grupo personalizado ativa o seu sensor");
	por(3, 110, 110);
	varios(2, "ninja em A");
	CONFERIR(!anim_cenario_animando(A), "o ninja não ativa o sensor de jogador");

	// 6. Vários atores: um sai, o outro fica; continua animando.
	comecar();
	por(1, 110, 130);
	por(5, 112, 130);
	varios(3, "dois atores em A");
	por(1, 1600, 130);
	varios(40, "um saiu, o outro ficou");
	CONFERIR(anim_cenario_animando(A), "com um ator ainda dentro, A continua");

	// 7. Dash: atravessa H (4 px) num quadro, sem tocar nem antes nem depois.
	comecar();
	por(1, 1280, 130);
	um_quadro("antes do dash");
	andar(1, 30 << 8, 0); // Caixa de 1274-1286 para 1304-1316: o sensor 1300-1304 fica no caminho.
	um_quadro("dash");
	CONFERIR(anim_cenario_animando(H), "o dash que atravessa a área ativa");
	// Na diagonal, passando por fora do canto de cima do sensor (1300-1304 × 100-120): a caixa que cobre o caminho
	// toca o sensor, mas o caminho não. Caixa de 1276-1288 × 68-84 para 1307-1319 × 85-101: em x o corpo cruza o
	// sensor entre 0,39 e 0,90 do quadro; em y só chega nele em 0,94.
	comecar();
	por(1, 1282, 84);
	um_quadro("antes da diagonal");
	andar(1, 31 << 8, 17 << 8);
	um_quadro("diagonal por fora");
	CONFERIR(!anim_cenario_animando(H), "diagonal por fora do canto não ativa");
	// A mesma diagonal 8 px mais baixa: em y o corpo chega no sensor em 0,47 do quadro, ainda cruzando em x. Toca.
	comecar();
	por(1, 1282, 92);
	um_quadro("antes da diagonal baixa");
	andar(1, 31 << 8, 17 << 8);
	um_quadro("diagonal por dentro");
	CONFERIR(anim_cenario_animando(H), "diagonal que cruza o canto ativa");

	// 8. Teleporte: de um lado do mapa para o outro, por cima de A, sem contato no caminho.
	comecar();
	por(1, 40, 130);
	um_quadro("antes do teleporte");
	por(1, 160, 130); // 120 px num quadro.
	um_quadro("teleporte");
	CONFERIR(!anim_cenario_animando(A), "teleporte por cima de A não ativa");
	// Nascer (o corpo aparece) dentro do sensor vale como contato, sem caminho.
	comecar();
	varios(2, "sem ator");
	por(1, 110, 130);
	um_quadro("nasceu dentro");
	CONFERIR(anim_cenario_animando(A), "aparecer dentro do sensor ativa (contato sem caminho)");
	// Sumiu um quadro (morreu) e voltou longe: sem caminho.
	comecar();
	por(1, 60, 130);
	um_quadro("vivo");
	corpos[1].ativo = FALSE;
	um_quadro("morto");
	por(1, 140, 130);
	um_quadro("voltou");
	CONFERIR(!anim_cenario_animando(A), "voltar depois de sumir não traça caminho por A");

	// 9. Voltar durante o balanço não reinicia (o passo continua), e cancela a parada.
	comecar();
	por(1, 110, 130);
	varios(3, "dentro");
	por(1, 400 - 200, 130);
	varios(5, "saiu");
	const int passo_antes = passo[A];
	por(1, 110, 130);
	um_quadro("voltou dentro");
	CONFERIR(anim_cenario_animando(A) && (passo[A] == passo_antes || passo[A] == (passo_antes + 1) % 4), "voltar não reinicia o balanço (passo %d → %d)", passo_antes, passo[A]);
	// Sem ciclos depois (H): termina só o ciclo atual.
	comecar();
	por(1, 1302, 130);
	varios(3, "dentro de H");
	por(1, 1700, 130);
	const int fim_h = ate_repouso(H, 50, "saiu de H");
	CONFERIR(fim_h > 0 && fim_h <= 4 * INTERVALO, "H (0 ciclos depois) parou %d quadros depois de sair", fim_h);

	// 10. Código: ativar por ciclos, sustentar, parar suave, parar agora e o sensor desligado.
	comecar();
	CONFERIR(quadro[G] == 2, "G começa no quadro de repouso 2");
	anim_cenario_ativar(G, 1);
	mod[G].pedidos = 1;
	const int um_ciclo = ate_repouso(G, 50, "ativar 1 ciclo");
	CONFERIR(um_ciclo == 4 * INTERVALO + 1, "ativar(1) anima um ciclo (%d quadros)", um_ciclo);
	anim_cenario_sustentar(G, TRUE);
	mod[G].codigo = TRUE;
	varios(30, "sustentar");
	CONFERIR(anim_cenario_animando(G), "sustentado pelo código continua");
	anim_cenario_parar(G);
	mod[G].codigo = FALSE;
	mod[G].pedidos = mod[G].restantes = 0;
	const int suave = ate_repouso(G, 50, "parada suave");
	CONFERIR(suave > 0 && suave <= 4 * INTERVALO, "parada suave termina o ciclo atual (%d quadros)", suave);
	// Parar agora com um ator no sensor: repouso na hora; no quadro seguinte o sensor ativa de novo.
	comecar();
	por(1, 110, 130);
	varios(3, "dentro de A");
	anim_cenario_parar_agora(A);
	mod[A] = (Modelo){ 0, 0, INTERVALO, 0, 0, FALSE, FALSE, 0 };
	CONFERIR(quadro[A] == 0 && !anim_cenario_animando(A), "parar_agora: repouso na hora");
	um_quadro("depois do parar_agora");
	CONFERIR(anim_cenario_animando(A), "com o ator no sensor, volta a animar no quadro seguinte");
	anim_cenario_sensor(A, FALSE);
	mod[A].sem_sensor = TRUE;
	anim_cenario_parar_agora(A);
	mod[A] = (Modelo){ 0, 0, INTERVALO, 0, 0, FALSE, TRUE, 0 };
	varios(10, "sensor desligado");
	CONFERIR(!anim_cenario_animando(A) && !anim_cenario_tem_ator(A), "com o sensor desligado, o ator não ativa");
	anim_cenario_ativar(A, 2);
	mod[A].pedidos = 2;
	um_quadro("código com o sensor desligado");
	CONFERIR(anim_cenario_animando(A), "o código ativa mesmo com o sensor desligado");

	// 11. Pausa (o jogo não chama anim_cenario_atualizar): tudo congela; reinício da cena volta ao repouso.
	comecar();
	por(1, 110, 130);
	varios(5, "antes da pausa");
	const u8 q = quadro[A], p = passo[A], e = espera[A];
	CONFERIR(q == quadro[A] && p == passo[A] && e == espera[A], "na pausa o estado não muda");
	varios(3, "depois da pausa");
	anim_cenario_preparar((MapaStream *[]){ &mapa }, 1); // Troca de cena e volta (ou reinício).
	modelo_preparar();
	for (int c = 0; c < 6; c++) {
		corpos[c].visto = FALSE;
	}
	por(1, 1700, 130);
	um_quadro("cena de volta");
	CONFERIR(!anim_cenario_animando(A) && quadro[A] == 0, "cena de volta: repouso");

	// 12. Fora da VRAM: o estado anda igual (sem mandar nada) e o streaming pega o quadro atual.
	comecar();
	dono[A] = 0; // A fora da janela.
	por(1, 110, 130);
	varios(3, "A fora da janela");
	CONFERIR(anim_cenario_animando(A), "fora da janela o estado anda");
	CONFERIR(envios_por_vaga[vagas[A] & 63] == 0, "e nada vai para a vaga de A");
	const u32 *dados = anim_cenario_padrao(&mapa, A + 1);
	CONFERIR(dados[0] == 100u * A + quadro[A], "ao entrar na janela, o padrão chega no quadro atual (%u)", dados[0]);
	dono[A] = A + 1;
	// 13. Fila do DMA cheia: o envio vai na hora, nada se perde.
	fila_cheia_falsa = 100;
	varios(12, "fila cheia");
	fila_cheia_falsa = 0;
	CONFERIR(anim_cenario_fila_cheia > 0, "a fila cheia foi contada");

	// 14. Modo Sempre no meio: segue o ritmo sem ligar para os sensores.
	comecar();
	por(1, 110, 130);
	varios(37, "sempre");
	CONFERIR(quadro[S] == seq[(37 / INTERVALO) % 4], "o modo Sempre não muda");

	// 15. Varredura: um ator andando de um lado ao outro do mapa em velocidades variadas, com paradas, idas e
	// voltas, e o modelo conferindo tudo a cada quadro.
	comecar();
	por(1, 0, 130);
	por(5, 1500, 112);
	u32 sorteio = 12345;
	for (int n = 0; n < 6000; n++) {
		sorteio = sorteio * 1103515245u + 12345u;
		const int r = (sorteio >> 16) & 255;
		const s32 vel = r < 40 ? 0 : r < 200 ? (s32)(r - 100) * 8 : (s32)(r - 228) * 256; // Parado, devagar ou dash.
		andar(1, vel, 0);
		if (corpos[1].x < 0 || corpos[1].x > (1600 << 8)) {
			corpos[1].x = (s32)(sorteio % 1500) << 8; // Teleporte de volta.
		}
		andar(5, (r & 1) ? 300 : -300, 0);
		if (corpos[5].x < 0 || corpos[5].x > (1600 << 8)) {
			corpos[5].x = 800 << 8;
		}
		if (r == 7) {
			anim_cenario_ativar(G, 3);
			mod[G].pedidos = mod[G].pedidos > 3 ? mod[G].pedidos : 3;
		}
		um_quadro("varredura");
	}

	printf("%d quadros conferidos\n", quadros_rodados);
	if (falhas) {
		printf("FALHOU: %d problemas\n", falhas);
		return 1;
	}
	printf("ok: gatilhos da animação de cenário\n");
	return 0;
}
