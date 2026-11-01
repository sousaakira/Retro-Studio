// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Atores comandados pelo código C de cada MDAtor (veja ator.h).
#include "ator.h"

#define ATOR_MAX 32

static Ator atores[ATOR_MAX];
static u16 botoes_agora, botoes_antes;
static u32 quadros_cena;
static u16 botoes_guardados; // Apertados enquanto o jogo estava parado (valem no quadro em que ele volta).
static bool tremor_so_x;
static u8 (*celula_fn)(s16 x, s16 y);
static s16 camera_x, camera_y;
static s16 largura_mundo, altura_mundo;
static u16 parado; // Quadros congelados (parar_jogo).
static u16 tremor; // Quadros de tremor que faltam.
static u8 tremor_amplitude;
static s16 tremor_dx, tremor_dy;
static bool camera_codigo;
static s16 camera_codigo_x, camera_codigo_y;
Ator *ator_camera;

// ---- Controle ----

bool botao(u16 botoes) {
	return (botoes_agora & botoes) != 0;
}

bool apertou(u16 botoes) {
	return ((botoes_agora & ~botoes_antes) & botoes) != 0;
}

bool soltou(u16 botoes) {
	return (~botoes_agora & botoes_antes & botoes) != 0;
}

// ---- Colisão ----

u8 celula_em(s16 x, s16 y) {
	if (!celula_fn) {
		return CELULA_VAZIA;
	}
	return celula_fn(x, y);
}

// Testa a área nos cantos e a cada 8 pixels, para não pular células.
static u8 tipos_na_area(s16 x, s16 y, s16 l, s16 a) {
	u8 tipos = 0;
	if (l <= 0 || a <= 0) {
		return 0;
	}
	for (s16 cy = y;; cy += 8) {
		if (cy > y + a - 1) {
			cy = y + a - 1;
		}
		for (s16 cx = x;; cx += 8) {
			if (cx > x + l - 1) {
				cx = x + l - 1;
			}
			tipos |= 1 << celula_em(cx, cy);
			if (cx == x + l - 1) {
				break;
			}
		}
		if (cy == y + a - 1) {
			break;
		}
	}
	return tipos;
}

bool area_solida(s16 x, s16 y, s16 l, s16 a) {
	return (tipos_na_area(x, y, l, a) & (1 << CELULA_SOLIDA)) != 0;
}

s16 corpo_esquerda(Ator *eu) {
	return PIXELS(eu->x) + (eu->direcao < 0 ? -eu->corpo_x - eu->corpo_l : eu->corpo_x);
}

s16 corpo_topo(Ator *eu) {
	return PIXELS(eu->y) + eu->corpo_y;
}

s16 centro_x(Ator *eu) {
	return corpo_esquerda(eu) + eu->corpo_l / 2;
}

s16 centro_y(Ator *eu) {
	return corpo_topo(eu) + eu->corpo_a / 2;
}

u8 celulas_no_corpo(Ator *eu) {
	return tipos_na_area(corpo_esquerda(eu), corpo_topo(eu), eu->corpo_l, eu->corpo_a);
}

// A linha (topo de uma célula) tem um tile atravessável sob a largura dada?
static bool atravessavel_na_linha(s16 x, s16 linha, s16 l) {
	if (linha & 7) {
		return FALSE;
	}
	return (tipos_na_area(x, linha, l, 1) & (1 << CELULA_ATRAVESSAVEL)) != 0;
}

void mover_e_colidir(Ator *eu) {
	eu->parede = 0;
	eu->no_teto = FALSE;
	const s16 l = eu->corpo_l, a = eu->corpo_a;
	// Horizontal.
	s32 nx = eu->x + eu->vx;
	s16 px = PIXELS(eu->x);
	const s16 alvo_x = PIXELS(nx);
	const s16 dx = eu->direcao < 0 ? -eu->corpo_x - l : eu->corpo_x;
	const s16 topo = corpo_topo(eu);
	while (px != alvo_x) {
		const s16 passo = px < alvo_x ? 1 : -1;
		if (area_solida(px + passo + dx, topo, l, a)) {
			eu->parede = passo;
			eu->vx = 0;
			nx = PX(px) + (passo > 0 ? 255 : 0);
			break;
		}
		px += passo;
	}
	eu->x = nx;
	// Vertical.
	s32 ny = eu->y + eu->vy;
	s16 py = PIXELS(eu->y);
	const s16 alvo_y = PIXELS(ny);
	const s16 esquerda = corpo_esquerda(eu);
	bool pousou = FALSE;
	while (py != alvo_y) {
		const s16 passo = py < alvo_y ? 1 : -1;
		const s16 novo_topo = py + passo + eu->corpo_y;
		bool bate = area_solida(esquerda, novo_topo, l, a);
		// Descendo: os atravessáveis seguram quando o pé passa do topo deles.
		if (!bate && passo > 0 && !eu->descendo && atravessavel_na_linha(esquerda, novo_topo + a - 1, l)) {
			bate = TRUE;
		}
		if (bate) {
			if (passo > 0) {
				pousou = TRUE;
			} else {
				eu->no_teto = TRUE;
			}
			eu->vy = 0;
			ny = PX(py) + (passo > 0 ? 255 : 0);
			break;
		}
		py += passo;
	}
	eu->y = ny;
	// No chão: há o que pisar logo abaixo do corpo.
	const s16 pe = corpo_topo(eu) + a;
	eu->no_chao = pousou || (eu->vy >= 0 && (area_solida(esquerda, pe, l, 1) || (!eu->descendo && atravessavel_na_linha(esquerda, pe, l))));
}

void aplicar_gravidade(Ator *eu, s16 gravidade, s16 maxima) {
	eu->vy += gravidade;
	if (eu->vy > maxima) {
		eu->vy = maxima;
	}
}

void virar(Ator *eu, s8 direcao) {
	if (direcao) {
		eu->direcao = direcao > 0 ? 1 : -1;
	}
}

// ---- Animação ----

// Ator na VRAM da fonte: o SGDK não envia os tiles; cada quadro novo é copiado para lá.
static void enviar_quadro_fonte(Ator *eu) {
	const SpriteDefinition *d = eu->tipo->desenho;
	if (eu->tipo->na_fonte && d && eu->animacao < d->numAnimation && eu->quadro < d->animations[eu->animacao]->numFrame) {
		const TileSet *tiles = d->animations[eu->animacao]->frames[eu->quadro]->tileset;
		if (tiles && tiles->numTile <= 96) {
			VDP_loadTileSet(tiles, TILE_FONT_INDEX, DMA);
		}
	}
}

static bool caixas(s16 ax, s16 ay, s16 al, s16 aa, s16 bx, s16 by, s16 bl, s16 ba);

// dorme_longe: perto da tela (32 px de margem, como no Sota) o ator acorda.
static bool perto_da_tela(Ator *eu) {
	return caixas(corpo_esquerda(eu), corpo_topo(eu), eu->corpo_l, eu->corpo_a, camera_x - 32, camera_y - 32, 320 + 64, 224 + 64);
}

static void criar_sprite(Ator *eu) {
	const AtorTipo *tipo = eu->tipo;
	if (tipo->na_fonte) {
		// Sem alocação nem envio automáticos: os tiles vão para a área da fonte.
		eu->sprite = SPR_addSpriteEx(tipo->desenho, PIXELS(eu->x) - tipo->apoio_x, PIXELS(eu->y) - tipo->apoio_y, tipo->atributos | TILE_FONT_INDEX, 0, SPR_FLAG_AUTO_VISIBILITY);
	} else {
		eu->sprite = SPR_addSprite(tipo->desenho, PIXELS(eu->x) - tipo->apoio_x - camera_x, PIXELS(eu->y) - tipo->apoio_y - camera_y, tipo->atributos);
	}
	if (eu->sprite) {
		SPR_setVisibility(eu->sprite, AUTO_FAST);
		eu->sprite->onFrameChange = ator_quadro_mudou;
		SPR_setAnimAndFrame(eu->sprite, eu->animacao, eu->quadro);
	}
}

static void entrar_no_quadro(Ator *eu) {
	const AtorTipo *t = eu->tipo;
	eu->tempo = t->tempos ? t->tempos[eu->animacao][eu->quadro] : 0;
	if (eu->sprite) {
		SPR_setAnimAndFrame(eu->sprite, eu->animacao, eu->quadro);
		enviar_quadro_fonte(eu);
	}
	if (t->sons && t->sons[eu->animacao][eu->quadro]) {
		jogo_som(t->sons[eu->animacao][eu->quadro]);
	}
}

void reiniciar_animacao(Ator *eu, u16 animacao) {
	eu->animacao = animacao;
	eu->quadro = 0;
	eu->animacao_acabou = FALSE;
	eu->uma_vez = FALSE;
	entrar_no_quadro(eu);
}

void tocar_animacao(Ator *eu, u16 animacao) {
	if (animacao != eu->animacao) {
		reiniciar_animacao(eu, animacao);
	}
}

void mostrar_quadro(Ator *eu, u16 animacao, u16 quadro) {
	eu->animacao = animacao;
	eu->quadro = quadro;
	eu->animacao_acabou = TRUE; // Não avança.
	if (eu->sprite) {
		SPR_setAnimAndFrame(eu->sprite, animacao, quadro);
		enviar_quadro_fonte(eu);
	}
}

void tocar_uma_vez(Ator *eu, u16 animacao) {
	reiniciar_animacao(eu, animacao);
	eu->uma_vez = TRUE;
}

bool animacao_acabou(Ator *eu) {
	return eu->animacao_acabou;
}

u16 quadro_animacao(Ator *eu) {
	return eu->quadro;
}

static void animar(Ator *eu) {
	const AtorTipo *t = eu->tipo;
	if (!t->quadros || eu->animacao_acabou || !eu->tempo || --eu->tempo) {
		return;
	}
	if (eu->quadro + 1 < t->quadros[eu->animacao]) {
		eu->quadro++;
	} else if (t->repete[eu->animacao] && !eu->uma_vez) {
		eu->quadro = 0;
	} else {
		eu->animacao_acabou = TRUE;
		return;
	}
	entrar_no_quadro(eu);
}

// O SGDK não avança as animações dos atores: o tempo de cada quadro é contado aqui.
void ator_quadro_mudou(Sprite *sprite) {
	sprite->timer = 0;
}

// ---- Atores ----

Ator *criar_ator(const AtorTipo *tipo, s32 x, s32 y) {
	for (u16 i = 0; i < ATOR_MAX; i++) {
		Ator *eu = &atores[i];
		if (eu->ativo) {
			continue;
		}
		memset(eu, 0, sizeof(Ator));
		eu->ativo = TRUE;
		eu->tipo = tipo;
		eu->x = x;
		eu->y = y;
		eu->direcao = 1;
		eu->visivel = TRUE;
		eu->fixo = tipo->fixo;
		eu->corpo_x = tipo->corpo_x;
		eu->corpo_y = tipo->corpo_y;
		eu->corpo_l = tipo->corpo_l;
		eu->corpo_a = tipo->corpo_a;
		eu->vida = tipo->vida;
		eu->grupos = tipo->grupos;
		eu->animacao = tipo->animacao;
		// Quem dorme longe da tela só ganha o sprite ao acordar (a VRAM é para os que estão perto).
		eu->dormindo = tipo->dorme_longe && !perto_da_tela(eu);
		if (tipo->desenho && !eu->dormindo) {
			criar_sprite(eu);
		}
		reiniciar_animacao(eu, tipo->animacao);
		if (tipo->pronto) {
			tipo->pronto(eu);
		}
		return eu;
	}
	return NULL;
}

void remover_ator(Ator *eu) {
	if (!eu || !eu->ativo) {
		return;
	}
	eu->ativo = FALSE;
	if (eu->sprite) {
		SPR_releaseSprite(eu->sprite);
		eu->sprite = NULL;
	}
	if (ator_camera == eu) {
		ator_camera = NULL;
	}
}

Ator *proximo_ator(Ator *depois, u16 grupos) {
	for (Ator *a = depois ? depois + 1 : atores; a < atores + ATOR_MAX; a++) {
		if (a->ativo && (a->grupos & grupos)) {
			return a;
		}
	}
	return NULL;
}

Ator *primeiro_ator(u16 grupos) {
	return proximo_ator(NULL, grupos);
}

u16 contar_atores(const AtorTipo *tipo) {
	u16 n = 0;
	for (Ator *a = atores; a < atores + ATOR_MAX; a++) {
		n += a->ativo && a->tipo == tipo;
	}
	return n;
}

u16 ator_indice(Ator *eu) {
	return eu - atores;
}

u32 quadro_do_jogo(void) {
	return quadros_cena;
}

static bool caixas(s16 ax, s16 ay, s16 al, s16 aa, s16 bx, s16 by, s16 bl, s16 ba) {
	return ax < bx + bl && bx < ax + al && ay < by + ba && by < ay + aa;
}

bool tocando(Ator *a, Ator *b) {
	return a != b && caixas(corpo_esquerda(a), corpo_topo(a), a->corpo_l, a->corpo_a, corpo_esquerda(b), corpo_topo(b), b->corpo_l, b->corpo_a);
}

Ator *ator_na_area(Ator *eu, s16 x, s16 y, s16 l, s16 a, u16 grupos, Ator *depois) {
	const s16 ax = PIXELS(eu->x) + (eu->direcao < 0 ? -x - l : x), ay = PIXELS(eu->y) + y;
	for (Ator *o = depois; (o = proximo_ator(o, grupos));) {
		if (o != eu && caixas(ax, ay, l, a, corpo_esquerda(o), corpo_topo(o), o->corpo_l, o->corpo_a)) {
			return o;
		}
	}
	return NULL;
}

bool ferir(Ator *alvo, s16 dano, u16 invencivel) {
	if (!alvo || !alvo->ativo || alvo->invencivel) {
		return FALSE;
	}
	alvo->vida -= dano;
	alvo->invencivel = invencivel;
	return TRUE;
}

s16 distancia_x(Ator *a, Ator *b) {
	return centro_x(b) - centro_x(a);
}

s16 distancia_y(Ator *a, Ator *b) {
	return centro_y(b) - centro_y(a);
}

// ---- Tela e som ----

bool na_tela(Ator *eu) {
	if (eu->fixo) {
		return TRUE;
	}
	return caixas(corpo_esquerda(eu), corpo_topo(eu), eu->corpo_l, eu->corpo_a, camera_x, camera_y, 320, 224);
}

s16 tela_x(void) {
	return camera_x;
}

s16 tela_y(void) {
	return camera_y;
}

void parar_jogo(u16 quadros) {
	if (quadros > parado) {
		parado = quadros;
	}
}

bool jogo_parado(void) {
	return parado > 0;
}

void tremer_tela_x(u16 quadros, u8 amplitude) {
	tremer_tela(quadros, amplitude);
	tremor_so_x = TRUE;
}

void cancelar_impacto(void) {
	parado = tremor = 0;
	tremor_amplitude = 0;
	tremor_dx = tremor_dy = 0;
	tremor_so_x = FALSE;
}

void tremer_tela(u16 quadros, u8 amplitude) {
	tremor_so_x = FALSE;
	if (quadros > tremor) {
		tremor = quadros;
	}
	if (amplitude > tremor_amplitude || !tremor_amplitude) {
		tremor_amplitude = amplitude;
	}
}

void camera_pelo_codigo(bool ligado) {
	camera_codigo = ligado;
	camera_codigo_x = camera_x;
	camera_codigo_y = camera_y;
}

void posicionar_camera(s16 x, s16 y) {
	camera_codigo_x = x;
	camera_codigo_y = y;
}

s16 mundo_largura(void) {
	return largura_mundo;
}

s16 mundo_altura(void) {
	return altura_mundo;
}

bool atores_camera(s16 *x, s16 *y) {
	if (!camera_codigo) {
		return FALSE;
	}
	*x = clamp(camera_codigo_x, 0, max(largura_mundo - 320, 0));
	*y = clamp(camera_codigo_y, 0, max(altura_mundo - 224, 0));
	return TRUE;
}

s16 atores_tremor_x(void) {
	return tremor_dx;
}

s16 atores_tremor_y(void) {
	return tremor_dy;
}

void tocar_som(u8 som) {
	jogo_som(som);
}

// ---- Jogo gerado ----

void atores_iniciar(u8 (*celula)(s16 x, s16 y), s16 largura, s16 altura) {
	memset(atores, 0, sizeof(atores));
	celula_fn = celula;
	largura_mundo = largura;
	altura_mundo = altura;
	parado = tremor = 0;
	tremor_amplitude = 0;
	tremor_dx = tremor_dy = 0;
	camera_codigo = FALSE;
	quadros_cena = 0;
	ator_camera = NULL;
	camera_x = camera_y = 0;
	botoes_agora = botoes_antes = JOY_readJoypad(JOY_1);
}

void atores_atualizar(void) {
	const u16 lidos = JOY_readJoypad(JOY_1);
	if (parado) {
		// Congelado: guarda o que foi apertado para o primeiro quadro depois da parada (um toque
		// rápido no meio do golpe ainda encadeia o combo).
		botoes_guardados |= lidos & ~botoes_agora;
		botoes_agora = lidos;
	} else {
		botoes_antes = botoes_agora & ~botoes_guardados;
		botoes_agora = lidos | botoes_guardados;
		botoes_guardados = 0;
	}
	quadros_cena++;
	// Tremor: deslocamento que muda a cada quadro, como no Sota ({-1, 1, -1, 0, 1, 0} × amplitude).
	static const s8 passos[6] = { -1, 1, -1, 0, 1, 0 };
	if (tremor) {
		tremor--;
		tremor_dx = passos[tremor % 6] * tremor_amplitude;
		tremor_dy = tremor_so_x ? 0 : passos[(tremor + 2) % 6] * tremor_amplitude;
		if (!tremor) {
			tremor_amplitude = 0;
			tremor_dx = tremor_dy = 0;
		}
	}
	if (parado) {
		parado--;
		return; // Golpe pesado: tudo congela, inclusive as animações.
	}
	for (Ator *eu = atores; eu < atores + ATOR_MAX; eu++) {
		if (!eu->ativo) {
			continue;
		}
		if (eu->tipo->dorme_longe) {
			if (!perto_da_tela(eu)) {
				if (!eu->dormindo) {
					eu->dormindo = TRUE;
					if (eu->sprite) {
						SPR_releaseSprite(eu->sprite);
						eu->sprite = NULL;
					}
				}
				continue;
			}
			if (eu->dormindo && eu->tipo->desenho) {
				criar_sprite(eu);
				if (!eu->sprite) {
					continue; // Sem VRAM agora: tenta de novo no próximo quadro.
				}
			}
			eu->dormindo = FALSE;
		}
		if (eu->invencivel) {
			eu->invencivel--;
		}
		if (eu->tipo->quadro) {
			eu->tipo->quadro(eu);
		}
	}
}

void atores_desenhar(s16 cx, s16 cy) {
	camera_x = cx;
	camera_y = cy;
	for (Ator *eu = atores; eu < atores + ATOR_MAX; eu++) {
		if (!eu->ativo) {
			continue;
		}
		if (!parado) {
			animar(eu);
		}
		if (!eu->sprite) {
			continue;
		}
		const AtorTipo *t = eu->tipo;
		const s16 fx = PIXELS(eu->x) - (eu->direcao < 0 ? t->celula_l - t->apoio_x : t->apoio_x);
		SPR_setHFlip(eu->sprite, eu->direcao < 0);
		if (eu->fixo) {
			SPR_setPosition(eu->sprite, fx, PIXELS(eu->y) - t->apoio_y);
		} else {
			SPR_setPosition(eu->sprite, fx - cx - tremor_dx, PIXELS(eu->y) - t->apoio_y - cy - tremor_dy + eu->desenho_dy);
		}
		// Invencível: pisca a cada 4 quadros.
		SPR_setVisibility(eu->sprite, eu->visivel && !(eu->invencivel & 4) ? AUTO_FAST : HIDDEN);
	}
}

void atores_encerrar(void) {
	for (Ator *eu = atores; eu < atores + ATOR_MAX; eu++) {
		eu->ativo = FALSE;
		eu->sprite = NULL; // O SPR_end da cena devolve os sprites.
	}
	ator_camera = NULL;
}
