// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
#include "particulas.h"

typedef struct {
	s32 x, y; // No mundo, 12 bits de fração.
	s32 vx, vy;
	u8 vida, total; // 0 = livre.
	Sprite *sprite;
} Particula;

typedef struct {
	const ParticulasConfig *c;
	Particula p[PARTICULAS_MAX];
	s16 x, y; // Canto da área (pode mudar pelo código).
	u16 tile; // Primeiro tile dos desenhos na VRAM.
	u16 acumulado, espera; // Contínuo: tempo × 16; rajada: quadros.
	u16 sorteio;
	bool ligado;
} Emissor;

static Emissor emissores[PARTICULAS_EMISSORES];

// Sprite que só aponta para os tiles do emissor (sem VRAM nem envio de tiles do motor de sprites). O SGDK do
// MarsDev pede o índice do sprite na tabela do VDP (ignorado com a alocação automática); o mais novo, não.
static Sprite *novo_sprite(const ParticulasConfig *c, u16 tile) {
	const u16 atributo = TILE_ATTR_FULL(c->paleta, c->prioridade, FALSE, FALSE, tile);
#ifdef SPR_FLAG_DISABLE_ANIMATION_LOOP
	return SPR_addSpriteEx(c->sprite, -16, -16, atributo, SPR_FLAG_AUTO_VISIBILITY);
#else
	return SPR_addSpriteEx(c->sprite, -16, -16, atributo, 0, SPR_FLAG_AUTO_VISIBILITY);
#endif
}
static u8 total_emissores;

// Xorshift de 16 bits: rápido no 68000 e nunca zera.
static u16 sortear(Emissor *e) {
	u16 r = e->sorteio;
	r ^= r << 7;
	r ^= r >> 9;
	r ^= r << 8;
	e->sorteio = r;
	return r;
}

// Número de 0 a n - 1 (n até 65535); 0 com n = 0.
static u16 ate(Emissor *e, u16 n) {
	return n ? (u16)(((u32)sortear(e) * n) >> 16) : 0;
}

static s32 entre(Emissor *e, s32 menor, s32 maior) {
	if (maior <= menor) {
		return menor;
	}
	const u32 faixa = (u32)(maior - menor);
	// Faixas grandes (velocidades em ponto fixo): sorteia em passos de 1/16 px.
	return faixa > 65535 ? menor + ((s32)ate(e, (u16)((faixa >> 8) > 65535 ? 65535 : (faixa >> 8))) << 8) : menor + ate(e, (u16)faixa);
}

static u16 espera_sorteada(Emissor *e, u16 base) {
	const u16 faixa = (u16)(((u32)base * e->c->variacao) / 100);
	if (!faixa) {
		return base ? base : 1;
	}
	const s32 espera = (s32)base - faixa / 2 + ate(e, faixa + 1);
	return espera < 1 ? 1 : (u16)espera;
}

static void soltar(Emissor *e) {
	const ParticulasConfig *c = e->c;
	for (u8 i = 0; i < c->maximo; i++) {
		Particula *p = &e->p[i];
		if (p->vida) {
			continue;
		}
		p->x = (s32)(e->x + ate(e, c->l)) << 12;
		p->y = (s32)(e->y + ate(e, c->a)) << 12;
		p->vx = entre(e, c->vx_min, c->vx_max);
		p->vy = entre(e, c->vy_min, c->vy_max);
		p->total = p->vida = (u8)entre(e, c->vida_min ? c->vida_min : 1, c->vida_max);
		if (!p->vida) {
			p->total = p->vida = 1;
		}
		SPR_setVisibility(p->sprite, AUTO_FAST);
		return;
	}
}

void particulas_preparar(const ParticulasConfig *configs, u8 quantos, u16 *tile) {
	total_emissores = quantos > PARTICULAS_EMISSORES ? PARTICULAS_EMISSORES : quantos;
	for (u8 n = 0; n < total_emissores; n++) {
		Emissor *e = &emissores[n];
		const ParticulasConfig *c = &configs[n];
		e->c = c;
		e->x = c->x;
		e->y = c->y;
		e->tile = *tile;
		VDP_loadTileSet(c->tiles, *tile, DMA);
		*tile += c->tiles->numTile;
		e->sorteio = c->semente ? c->semente : (u16)(vtimer * 40503u + n * 7919u + 1u);
		if (!e->sorteio) {
			e->sorteio = 0xACE1;
		}
		e->ligado = c->ligado;
		e->acumulado = 0;
		e->espera = c->modo == PARTICULAS_CONTINUO ? espera_sorteada(e, c->espera) : (c->espera ? espera_sorteada(e, c->espera) : 0);
		for (u8 i = 0; i < PARTICULAS_MAX; i++) {
			Particula *p = &e->p[i];
			p->vida = 0;
			p->sprite = i < c->maximo ? novo_sprite(c, e->tile) : NULL;
			if (p->sprite) {
				SPR_setVisibility(p->sprite, HIDDEN);
			}
		}
	}
}

void particulas_atualizar(s16 camera_x, s16 camera_y) {
	for (u8 n = 0; n < total_emissores; n++) {
		Emissor *e = &emissores[n];
		const ParticulasConfig *c = e->c;
		if (e->ligado) {
			if (c->modo == PARTICULAS_CONTINUO) {
				e->acumulado += 16;
				while (e->acumulado >= e->espera) {
					e->acumulado -= e->espera;
					e->espera = espera_sorteada(e, c->espera);
					soltar(e);
				}
			} else if (e->espera && !--e->espera) {
				particulas_rajada(n);
				e->espera = espera_sorteada(e, c->espera);
			}
		}
		for (u8 i = 0; i < c->maximo; i++) {
			Particula *p = &e->p[i];
			if (!p->vida || !p->sprite) {
				continue;
			}
			if (!--p->vida) {
				SPR_setVisibility(p->sprite, HIDDEN);
				continue;
			}
			p->vx += c->gx;
			p->vy += c->gy;
			p->x += p->vx;
			p->y += p->vy;
			// Desenho pela idade: do primeiro (nasceu) ao último (vai sumir).
			const u16 idade = p->total - p->vida;
			const u16 quadro = c->quadros > 1 ? (u16)((idade * c->quadros) / p->total) : 0;
			SPR_setVRAMTileIndex(p->sprite, e->tile + (quadro < c->quadros ? quadro : c->quadros - 1));
			SPR_setPosition(p->sprite, (s16)(p->x >> 12) - 4 - camera_x, (s16)(p->y >> 12) - 4 - camera_y);
		}
	}
}

void particulas_encerrar(void) {
	total_emissores = 0; // Os sprites vão embora com o SPR_end da cena.
}

void particulas_rajada(u8 emissor) {
	if (emissor >= total_emissores) {
		return;
	}
	Emissor *e = &emissores[emissor];
	const u8 quantas = e->c->modo == PARTICULAS_RAJADA ? e->c->rajada : 1;
	for (u8 i = 0; i < quantas; i++) {
		soltar(e);
	}
}

void particulas_ligar(u8 emissor, bool ligado) {
	if (emissor < total_emissores) {
		emissores[emissor].ligado = ligado;
	}
}

void particulas_mover(u8 emissor, s16 x, s16 y) {
	if (emissor < total_emissores) {
		emissores[emissor].x = x;
		emissores[emissor].y = y;
	}
}
