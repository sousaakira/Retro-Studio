// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
#include "jogo.h"

u16 anim_cenario_bytes, anim_cenario_envios;
u16 anim_cenario_pico_bytes, anim_cenario_pico_envios;
u32 anim_cenario_total_bytes, anim_cenario_total_envios;
u16 anim_cenario_fila_cheia;

static MapaStream *mapas[ANIM_CENARIO_MAPAS];
static u8 total_mapas;
static u8 passo[ANIM_CENARIO_GRUPOS], espera[ANIM_CENARIO_GRUPOS];

void anim_cenario_preparar(struct MapaStream *const *lista, u8 quantos) {
	total_mapas = 0;
	u8 estado = 0;
	for (u8 i = 0; i < quantos && total_mapas < ANIM_CENARIO_MAPAS; i++) {
		MapaStream *m = lista[i];
		m->anim_estado = estado;
		for (u8 g = 0; g < m->n_anim && estado < ANIM_CENARIO_GRUPOS; g++, estado++) {
			passo[estado] = m->anim[g].passo0;
			espera[estado] = m->anim[g].espera0;
		}
		mapas[total_mapas++] = m;
	}
	anim_cenario_bytes = anim_cenario_envios = 0;
	anim_cenario_pico_bytes = anim_cenario_pico_envios = 0;
	anim_cenario_total_bytes = anim_cenario_total_envios = 0;
	anim_cenario_fila_cheia = 0;
}

void anim_cenario_encerrar(void) {
	total_mapas = 0;
}

const u32 *anim_cenario_padrao(const struct MapaStream *m, u16 celula) {
	const AnimCenarioGrupo *a = m->anim;
	u8 k = m->anim_estado;
	while (celula >= a->primeiro + a->n) {
		a++;
		k++;
	}
	return a->quadros + ((u32)a->sequencia[passo[k]] * a->n + (celula - a->primeiro)) * 8;
}

#if ANIM_CENARIO_LIGADO
// Reenvia o quadro novo das variantes do grupo que estão na VRAM, juntando vagas seguidas num DMA.
static void enviar(const MapaStream *m, const AnimCenarioGrupo *a, u8 quadro) {
	const u16 *vagas = m->vagas + a->primeiro - 1;
	const u16 *dono = m->dono - m->base;
	const u32 *dados = a->quadros + (u32)quadro * a->n * 8;
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
#endif

void anim_cenario_atualizar(void) {
	anim_cenario_bytes = anim_cenario_envios = 0;
#if ANIM_CENARIO_LIGADO
	for (u8 i = 0; i < total_mapas; i++) {
		const MapaStream *m = mapas[i];
		u8 k = m->anim_estado;
		for (u8 g = 0; g < m->n_anim; g++, k++) {
			if (--espera[k]) {
				continue;
			}
			const AnimCenarioGrupo *a = m->anim + g;
			espera[k] = a->intervalo;
			const u8 antes = a->sequencia[passo[k]];
			if (++passo[k] >= a->passos) {
				passo[k] = 0;
			}
			const u8 quadro = a->sequencia[passo[k]];
			if (quadro != antes) {
				enviar(m, a, quadro);
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
#endif
}
