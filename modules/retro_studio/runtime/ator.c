// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Atores comandados pelo código C de cada MDAtor (veja ator.h).
#include "ator.h"

#define ATOR_MAX 32

static Ator atores[ATOR_MAX];
static u16 botoes_agora, botoes_antes;
static u8 (*celula_fn)(s16 x, s16 y);
static s16 camera_x, camera_y;
Ator *ator_camera;

// ---- Controle ----

bool botao(u16 botoes) {
	return (botoes_agora & botoes) != 0;
}

bool apertou(u16 botoes) {
	return (botoes_agora & ~botoes_antes & botoes) != 0;
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

static void entrar_no_quadro(Ator *eu) {
	const AtorTipo *t = eu->tipo;
	eu->tempo = t->tempos ? t->tempos[eu->animacao][eu->quadro] : 0;
	if (eu->sprite) {
		SPR_setAnimAndFrame(eu->sprite, eu->animacao, eu->quadro);
	}
	if (t->sons && t->sons[eu->animacao][eu->quadro]) {
		jogo_som(t->sons[eu->animacao][eu->quadro]);
	}
}

void reiniciar_animacao(Ator *eu, u16 animacao) {
	eu->animacao = animacao;
	eu->quadro = 0;
	eu->animacao_acabou = FALSE;
	entrar_no_quadro(eu);
}

void tocar_animacao(Ator *eu, u16 animacao) {
	if (animacao != eu->animacao) {
		reiniciar_animacao(eu, animacao);
	}
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
	} else if (t->repete[eu->animacao]) {
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
		eu->corpo_x = tipo->corpo_x;
		eu->corpo_y = tipo->corpo_y;
		eu->corpo_l = tipo->corpo_l;
		eu->corpo_a = tipo->corpo_a;
		eu->vida = tipo->vida;
		eu->grupos = tipo->grupos;
		if (tipo->desenho) {
			eu->sprite = SPR_addSprite(tipo->desenho, PIXELS(x) - tipo->apoio_x - camera_x, PIXELS(y) - tipo->apoio_y - camera_y, tipo->atributos);
			if (eu->sprite) {
				SPR_setVisibility(eu->sprite, AUTO_FAST);
				eu->sprite->onFrameChange = ator_quadro_mudou;
			}
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
	return caixas(corpo_esquerda(eu), corpo_topo(eu), eu->corpo_l, eu->corpo_a, camera_x, camera_y, 320, 224);
}

s16 tela_x(void) {
	return camera_x;
}

s16 tela_y(void) {
	return camera_y;
}

void tocar_som(u8 som) {
	jogo_som(som);
}

// ---- Jogo gerado ----

void atores_iniciar(u8 (*celula)(s16 x, s16 y)) {
	memset(atores, 0, sizeof(atores));
	celula_fn = celula;
	ator_camera = NULL;
	camera_x = camera_y = 0;
	botoes_agora = botoes_antes = JOY_readJoypad(JOY_1);
}

void atores_atualizar(void) {
	botoes_antes = botoes_agora;
	botoes_agora = JOY_readJoypad(JOY_1);
	for (Ator *eu = atores; eu < atores + ATOR_MAX; eu++) {
		if (!eu->ativo) {
			continue;
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
		animar(eu);
		if (!eu->sprite) {
			continue;
		}
		const AtorTipo *t = eu->tipo;
		const s16 fx = PIXELS(eu->x) - (eu->direcao < 0 ? t->celula_l - t->apoio_x : t->apoio_x);
		SPR_setHFlip(eu->sprite, eu->direcao < 0);
		SPR_setPosition(eu->sprite, fx - cx, PIXELS(eu->y) - t->apoio_y - cy);
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
