// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
#include "jogo.h"
#if ANIM_CENARIO_ATORES
#include "ator.h"
#endif

u16 anim_cenario_bytes, anim_cenario_envios;
u16 anim_cenario_pico_bytes, anim_cenario_pico_envios;
u32 anim_cenario_total_bytes, anim_cenario_total_envios;
u16 anim_cenario_fila_cheia;
u8 anim_cenario_ativas;

#define REPOUSO 0
#define ATIVO 1
#define F_CODIGO 1 // O código sustenta (anim_cenario_sustentar).
#define F_SEM_SENSOR 2 // Sensor desligado pelo código.
#define F_NO_SENSOR 4 // Algum ator válido no sensor neste quadro (os corpos marcam antes de anim_cenario_atualizar).
#define F_TINHA 8 // Havia ator no sensor no último quadro (para anim_cenario_tem_ator).

static MapaStream *mapas[ANIM_CENARIO_MAPAS];
static u8 total_mapas, total_grupos;
// Estado de cada grupo (índice = anim_estado do mapa + o grupo no mapa = ANIM_CENARIO_<NOME>).
static u8 passo[ANIM_CENARIO_GRUPOS], espera[ANIM_CENARIO_GRUPOS], quadro[ANIM_CENARIO_GRUPOS];
static u8 estado[ANIM_CENARIO_GRUPOS], restantes[ANIM_CENARIO_GRUPOS], pedidos[ANIM_CENARIO_GRUPOS], flags[ANIM_CENARIO_GRUPOS];
static const AnimCenarioGrupo *grupo_de[ANIM_CENARIO_GRUPOS];
static MapaStream *mapa_de[ANIM_CENARIO_GRUPOS];
static u16 grupos_sensores; // GRUPO_ que algum sensor procura.
static u8 internos_sensores;
static bool tem_sensor;

// Corpos: pés do quadro anterior (1/256 px), para o caminho e a velocidade.
static s32 corpo_x[ANIM_CENARIO_CORPOS], corpo_y[ANIM_CENARIO_CORPOS];
static const void *corpo_dono[ANIM_CENARIO_CORPOS]; // Quem ocupa o lugar (um ator novo no mesmo lugar não traça caminho).
static u8 corpo_visto[ANIM_CENARIO_CORPOS]; // 2 = visto neste quadro, 1 = no anterior, 0 = não estava.

void anim_cenario_preparar(struct MapaStream *const *lista, u8 quantos) {
	total_mapas = 0;
	u8 k = 0;
	grupos_sensores = 0;
	internos_sensores = 0;
	tem_sensor = FALSE;
	for (u8 i = 0; i < quantos && total_mapas < ANIM_CENARIO_MAPAS; i++) {
		MapaStream *m = lista[i];
		m->anim_estado = k;
		for (u8 g = 0; g < m->n_anim && k < ANIM_CENARIO_GRUPOS; g++, k++) {
			const AnimCenarioGrupo *a = &m->anim[g];
			grupo_de[k] = a;
			mapa_de[k] = m;
			restantes[k] = pedidos[k] = flags[k] = 0;
			estado[k] = REPOUSO;
			if (a->gatilho) {
				// Com gatilho: repouso até ativar.
				passo[k] = 0;
				espera[k] = a->intervalo;
				quadro[k] = a->gatilho->repouso;
				if (a->gatilho->modo != ANIM_CODIGO) {
					grupos_sensores |= a->gatilho->grupos;
					internos_sensores |= a->gatilho->internos;
					tem_sensor = TRUE;
				}
			} else {
				passo[k] = a->passo0;
				espera[k] = a->espera0;
				quadro[k] = a->sequencia[a->passo0];
			}
		}
		mapas[total_mapas++] = m;
	}
	total_grupos = k;
	memset(corpo_visto, 0, sizeof(corpo_visto));
	anim_cenario_bytes = anim_cenario_envios = 0;
	anim_cenario_pico_bytes = anim_cenario_pico_envios = 0;
	anim_cenario_total_bytes = anim_cenario_total_envios = 0;
	anim_cenario_fila_cheia = 0;
	anim_cenario_ativas = 0;
}

void anim_cenario_encerrar(void) {
	total_mapas = total_grupos = 0;
	tem_sensor = FALSE;
}

const u32 *anim_cenario_padrao(const struct MapaStream *m, u16 celula) {
	const AnimCenarioGrupo *a = m->anim;
	u8 k = m->anim_estado;
	while (celula >= a->primeiro + a->n) {
		a++;
		k++;
	}
	return a->quadros + ((u32)quadro[k] * a->n + (celula - a->primeiro)) * 8;
}

// Reenvia o quadro novo das variantes do grupo que estão na VRAM, juntando vagas seguidas num DMA.
static void enviar(const MapaStream *m, const AnimCenarioGrupo *a, u8 q) {
	const u16 *vagas = m->vagas + a->primeiro - 1;
	const u16 *dono = m->dono - m->base;
	const u32 *dados = a->quadros + (u32)q * a->n * 8;
	u16 v = 0;
	while (v < a->n) {
		const u16 vaga = vagas[v];
		if (dono[vaga] != a->primeiro + v) {
			v++;
			continue;
		}
		u16 fim = v + 1;
		while (fim < a->n && vagas[fim] == vaga + (fim - v) && dono[vagas[fim]] == a->primeiro + fim) {
			fim++;
		}
		const u16 tiles = fim - v;
		if (!DMA_queueDma(DMA_VRAM, (void *)(dados + v * 8), vaga << 5, tiles * 16, 2)) {
			DMA_flushQueue(); // O que já está na fila vai antes, para a ordem dos envios não mudar.
			VDP_loadTileData(dados + v * 8, vaga, tiles, DMA);
			anim_cenario_fila_cheia++;
		}
		anim_cenario_bytes += tiles * 32;
		anim_cenario_envios++;
		v = fim;
	}
}

// Mostra o quadro q no grupo k (só manda para a VRAM se o desenho mudou).
static void mostrar(u8 k, u8 q) {
	if (quadro[k] == q) {
		return;
	}
	quadro[k] = q;
#if ANIM_CENARIO_LIGADO
	enviar(mapa_de[k], grupo_de[k], q);
#endif
}

// ---- Sensores ----

// Intervalo de tempo (frações num/den, den > 0) em que [a0 + t·d, a1 + t·d) cruza [s0, s1); d ≠ 0.
static void cruza(s16 a0, s16 a1, s16 d, s16 s0, s16 s1, s32 *lo_n, s32 *hi_n, s32 *den) {
	if (d > 0) {
		*lo_n = s0 - a1; // a1 + t·d > s0
		*hi_n = s1 - a0; // a0 + t·d < s1
		*den = d;
	} else {
		*lo_n = a0 - s1; // a0 + t·d < s1, com d < 0
		*hi_n = a1 - s0;
		*den = -d;
	}
}

// A caixa (x, y, l, a) que andou (dx, dy) px no quadro (de x - dx a x) tocou o sensor em algum momento?
static bool varre(const AnimCenarioGatilho *s, s16 x, s16 y, s16 l, s16 a, s16 dx, s16 dy) {
	const s16 px = x - dx, py = y - dy; // Caixa no quadro anterior.
	// Caixa que cobre o caminho todo: se nem ela toca, não tocou.
	if (min(px, x) >= s->x1 || max(px, x) + l <= s->x0 || min(py, y) >= s->y1 || max(py, y) + a <= s->y0) {
		return FALSE;
	}
	if (!dx || !dy) {
		return TRUE; // Na reta de um eixo (ou parado), a caixa do caminho é o caminho.
	}
	// Na diagonal: os intervalos de tempo dos dois eixos precisam se cruzar dentro do quadro (0 a 1).
	s32 xl, xh, xd, yl, yh, yd;
	cruza(px, px + l, dx, s->x0, s->x1, &xl, &xh, &xd);
	cruza(py, py + a, dy, s->y0, s->y1, &yl, &yh, &yd);
	// lo = max(0, xl/xd, yl/yd); hi = min(1, xh/xd, yh/yd); tocou se lo < hi (a/b < c/d ⇔ a·d < c·b).
	s32 lo_n = 0, lo_d = 1, hi_n = 1, hi_d = 1;
	if (xl * lo_d > lo_n * xd) {
		lo_n = xl;
		lo_d = xd;
	}
	if (yl * lo_d > lo_n * yd) {
		lo_n = yl;
		lo_d = yd;
	}
	if (xh * hi_d < hi_n * xd) {
		hi_n = xh;
		hi_d = xd;
	}
	if (yh * hi_d < hi_n * yd) {
		hi_n = yh;
		hi_d = yd;
	}
	return lo_n * hi_d < hi_n * lo_d;
}

// Um corpo neste quadro: marca os sensores que ele ativa.
static void sentir(u8 c, const void *dono, u16 grupos, u8 internos, s32 x, s32 y, s16 cx, s16 cy, s16 cl, s16 ca) {
	s16 dx = 0, dy = 0;
	u16 andou = 0; // Maior deslocamento de um eixo, em 1/256 px.
	if (corpo_visto[c] && corpo_dono[c] == dono) {
		const s32 mx = x - corpo_x[c], my = y - corpo_y[c];
		const s32 ax = mx < 0 ? -mx : mx, ay = my < 0 ? -my : my;
		if (ax <= (s32)ANIM_TELEPORTE * 256 && ay <= (s32)ANIM_TELEPORTE * 256) {
			dx = (s16)((x >> 8) - (corpo_x[c] >> 8));
			dy = (s16)((y >> 8) - (corpo_y[c] >> 8));
			andou = (u16)(ax > ay ? ax : ay);
		}
	}
	corpo_x[c] = x;
	corpo_y[c] = y;
	corpo_dono[c] = dono;
	corpo_visto[c] = 2;
	const s16 bx = (s16)(x >> 8) + cx, by = (s16)(y >> 8) + cy;
	for (u8 k = 0; k < total_grupos; k++) {
		const AnimCenarioGatilho *s = grupo_de[k]->gatilho;
		if (!s || s->modo == ANIM_CODIGO || (flags[k] & (F_NO_SENSOR | F_SEM_SENSOR))) {
			continue;
		}
		if (!(s->grupos & grupos) && !(s->internos & internos)) {
			continue;
		}
		if (s->velocidade && andou < s->velocidade) {
			continue;
		}
		if (varre(s, bx, by, cl, ca, dx, dy)) {
			flags[k] |= F_NO_SENSOR;
		}
	}
}

void anim_cenario_corpo(u8 corpo, u8 internos, s32 x, s32 y, s16 cx, s16 cy, s16 cl, s16 ca) {
	if (tem_sensor && corpo < ANIM_CENARIO_CORPOS && (internos & internos_sensores)) {
		sentir(corpo, (const void *)(u32)(corpo + 1), 0, internos, x, y, cx, cy, cl, ca);
	}
}

// ---- Passos ----

// Uma instância com gatilho: a mesma regra de MDAnimacaoCenario::Gatilho::quadro (prévia do editor).
static void passo_gatilho(u8 k) {
	const AnimCenarioGrupo *a = grupo_de[k];
	const AnimCenarioGatilho *s = a->gatilho;
	const bool sustenta = (flags[k] & (F_NO_SENSOR | F_CODIGO)) != 0;
	if (estado[k] == REPOUSO) {
		if (!sustenta && !pedidos[k]) {
			return;
		}
		estado[k] = ATIVO;
		passo[k] = 0;
		espera[k] = a->intervalo;
		u8 r = sustenta ? s->ciclos_apos : 0;
		if (pedidos[k] && pedidos[k] - 1 > r) {
			r = pedidos[k] - 1;
		}
		restantes[k] = r;
		pedidos[k] = 0;
		mostrar(k, a->sequencia[0]);
		return;
	}
	if (sustenta && restantes[k] < s->ciclos_apos) {
		restantes[k] = s->ciclos_apos; // Voltou durante o balanço: a parada pendente é cancelada.
	}
	if (pedidos[k]) {
		if (pedidos[k] > restantes[k]) {
			restantes[k] = pedidos[k];
		}
		pedidos[k] = 0;
	}
	if (--espera[k]) {
		return;
	}
	espera[k] = a->intervalo;
	if (++passo[k] >= a->passos) {
		passo[k] = 0;
		if (!sustenta) {
			if (!restantes[k]) {
				estado[k] = REPOUSO;
				mostrar(k, s->repouso);
				return;
			}
			restantes[k]--;
		}
	}
	mostrar(k, a->sequencia[passo[k]]);
}

void anim_cenario_atualizar(void) {
	anim_cenario_bytes = anim_cenario_envios = 0;
	if (tem_sensor) {
#if ANIM_CENARIO_ATORES
		// MDAtor dos grupos que algum sensor procura (o jogador, os inimigos ou o grupo do node).
		Ator *camera = (internos_sensores & ANIM_ALVO_CAMERA) ? ator_camera : NULL;
		if (grupos_sensores || camera) {
			for (Ator *a = NULL; (a = proximo_ator(a, 0xFFFF));) {
				if (a->fixo || (!(a->grupos & grupos_sensores) && a != camera)) {
					continue;
				}
				const s16 cx = corpo_esquerda(a) - PIXELS(a->x), cy = corpo_topo(a) - PIXELS(a->y);
				sentir(ator_indice(a), a->tipo, a->grupos, a == camera ? ANIM_ALVO_CAMERA : 0, a->x, a->y, cx, cy, a->corpo_l, a->corpo_a);
			}
		}
#endif
	}
	u8 ativas = 0;
	for (u8 i = 0; i < total_mapas; i++) {
		const MapaStream *m = mapas[i];
		u8 k = m->anim_estado;
		for (u8 g = 0; g < m->n_anim; g++, k++) {
			const AnimCenarioGrupo *a = m->anim + g;
			if (a->gatilho) {
				passo_gatilho(k);
				ativas += estado[k] == ATIVO;
				continue;
			}
			if (--espera[k]) {
				continue;
			}
			espera[k] = a->intervalo;
			if (++passo[k] >= a->passos) {
				passo[k] = 0;
			}
			mostrar(k, a->sequencia[passo[k]]);
		}
	}
	anim_cenario_ativas = ativas;
	if (tem_sensor) {
		// Pronto para o próximo quadro: os sensores esvaziam e quem não aparecer de novo perde o caminho.
		for (u8 k = 0; k < total_grupos; k++) {
			flags[k] = (flags[k] & F_NO_SENSOR) ? (flags[k] & ~F_NO_SENSOR) | F_TINHA : flags[k] & ~F_TINHA;
		}
		for (u8 c = 0; c < ANIM_CENARIO_CORPOS; c++) {
			if (corpo_visto[c]) {
				corpo_visto[c]--;
			}
		}
	}
	anim_cenario_total_bytes += anim_cenario_bytes;
	anim_cenario_total_envios += anim_cenario_envios;
	if (anim_cenario_bytes > anim_cenario_pico_bytes) {
		anim_cenario_pico_bytes = anim_cenario_bytes;
	}
	if (anim_cenario_envios > anim_cenario_pico_envios) {
		anim_cenario_pico_envios = anim_cenario_envios;
	}
}

// ---- API do código C ----

static bool valido(u8 id) {
	return id < total_grupos && grupo_de[id]->gatilho;
}

void anim_cenario_ativar(u8 id, u8 ciclos) {
	if (valido(id) && ciclos > pedidos[id]) {
		pedidos[id] = ciclos;
	}
}

void anim_cenario_sustentar(u8 id, bool ligado) {
	if (valido(id)) {
		flags[id] = ligado ? flags[id] | F_CODIGO : flags[id] & ~F_CODIGO;
	}
}

void anim_cenario_parar(u8 id) {
	if (valido(id)) {
		flags[id] &= ~F_CODIGO;
		pedidos[id] = restantes[id] = 0;
	}
}

void anim_cenario_parar_agora(u8 id) {
	if (valido(id)) {
		flags[id] &= ~F_CODIGO;
		pedidos[id] = restantes[id] = 0;
		estado[id] = REPOUSO;
		passo[id] = 0;
		mostrar(id, grupo_de[id]->gatilho->repouso);
	}
}

void anim_cenario_sensor(u8 id, bool ligado) {
	if (valido(id)) {
		flags[id] = ligado ? flags[id] & ~F_SEM_SENSOR : (flags[id] | F_SEM_SENSOR) & ~(F_NO_SENSOR | F_TINHA);
	}
}

bool anim_cenario_animando(u8 id) {
	return valido(id) && estado[id] == ATIVO;
}

bool anim_cenario_tem_ator(u8 id) {
	return valido(id) && (flags[id] & F_TINHA);
}
