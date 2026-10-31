// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Atores: nodes MDAtor comandados pelo próprio código C (res://src/<nome>.c), como um CharacterBody2D
// com GDScript. O código tem <nome>_pronto(Ator *eu), chamada quando o ator aparece, e
// <nome>_quadro(Ator *eu), chamada a cada quadro (60 por segundo; 50 num console PAL).
//
// Posições e velocidades em 1/256 de pixel: PX(10) são 10 pixels, PIXELS(eu->x) volta para pixels.
// A posição (x, y) é a dos pés do personagem; y cresce para baixo.
#pragma once

#include "jogo.h"

#define PX(n) ((s32)(n) * 256)
#define PIXELS(v) ((s16)((v) >> 8))

// Botões do controle 1 (podem ser somados: BOTAO_A | BOTAO_C).
#define BOTAO_A BUTTON_A
#define BOTAO_B BUTTON_B
#define BOTAO_C BUTTON_C
#define BOTAO_X BUTTON_X
#define BOTAO_Y BUTTON_Y
#define BOTAO_Z BUTTON_Z
#define BOTAO_START BUTTON_START
#define BOTAO_MODE BUTTON_MODE
#define BOTAO_CIMA BUTTON_UP
#define BOTAO_BAIXO BUTTON_DOWN
#define BOTAO_ESQUERDA BUTTON_LEFT
#define BOTAO_DIREITA BUTTON_RIGHT

// Tipos de célula da MDColisao (dado "tipo" do TileSet).
#define CELULA_VAZIA 0
#define CELULA_SOLIDA 1
#define CELULA_ATRAVESSAVEL 2 // Segura só por cima; com eu->descendo, deixa passar.
#define CELULA_ESPINHO 3
#define CELULA_AGUA 4

typedef struct Ator Ator;

// O que o build sabe de cada tipo de ator: o código, o desenho e as animações.
typedef struct {
	void (*pronto)(Ator *eu);
	void (*quadro)(Ator *eu);
	const SpriteDefinition *desenho; // NULL = ator sem desenho.
	u16 atributos; // Paleta e prioridade (TILE_ATTR).
	s16 apoio_x, apoio_y, celula_l; // Pés dentro da célula e largura da célula.
	s16 corpo_x, corpo_y, corpo_l, corpo_a; // Caixa do corpo, relativa aos pés, olhando para a direita.
	const u8 *const *tempos; // Tempo de cada quadro (1/60 s), por animação.
	const u8 *quadros; // Quadros de cada animação.
	const u8 *repete; // A animação volta ao começo?
	const u8 *const *sons; // Som de cada quadro (0 = nenhum), por animação; NULL se não há.
	u16 animacao; // Animação inicial.
	s16 vida;
	u16 grupos;
	bool fixo; // Fixo na tela (HUD): x e y são da tela, a câmera não o move.
} AtorTipo;

struct Ator {
	s32 x, y; // Pés, em 1/256 px.
	s32 vx, vy; // Velocidade em 1/256 px por quadro; mover_e_colidir aplica.
	s16 corpo_x, corpo_y, corpo_l, corpo_a; // Caixa do corpo (olhando para a direita); pode mudar (agachar).
	s8 direcao; // 1 = direita, -1 = esquerda (o desenho espelha em volta dos pés).
	bool no_chao, no_teto; // Atualizados por mover_e_colidir.
	s8 parede; // -1 = bateu numa parede à esquerda, 1 = à direita, 0 = nenhuma (no último mover_e_colidir).
	bool descendo; // Atravessa os tiles atravessáveis (descer de uma plataforma).
	bool visivel;
	bool fixo; // x e y são da tela (HUD), não do mundo.
	u16 grupos; // GRUPO_... do node (aba Grupos); pode mudar.
	s16 vida;
	u16 invencivel; // Quadros que faltam piscando; ferir() não acerta enquanto > 0.
	u16 animacao, quadro; // Animação (ANIM_...) e quadro mostrados.
	u8 tempo; // Quadros de vídeo que faltam no quadro da animação.
	bool animacao_acabou; // Animação sem repetição chegou ao fim do último quadro.
	s16 v[8]; // Variáveis livres do código (estado, contadores...).
	Sprite *sprite;
	const AtorTipo *tipo;
	bool ativo;
};

// ---- Controle 1 ----
bool botao(u16 botoes); // Algum destes botões está apertado.
bool apertou(u16 botoes); // Algum começou a ser apertado neste quadro.
bool soltou(u16 botoes); // Algum foi solto neste quadro.

// ---- Movimento e colisão ----
// Anda eu->vx e eu->vy, pixel a pixel, parando nas células sólidas; atualiza no_chao, no_teto e
// parede e zera a velocidade do eixo que bateu.
void mover_e_colidir(Ator *eu);
// Soma a gravidade a vy (1/256 px por quadro a cada quadro), até a velocidade máxima de queda.
void aplicar_gravidade(Ator *eu, s16 gravidade, s16 maxima);
u8 celula_em(s16 x, s16 y); // Tipo da célula de colisão no ponto (pixels do mundo).
bool area_solida(s16 x, s16 y, s16 largura, s16 altura); // Alguma célula sólida na área?
u8 celulas_no_corpo(Ator *eu); // Bits (1 << CELULA_...) das células que o corpo toca.
// Caixa do corpo no mundo (já espelhada pela direção), em pixels.
s16 corpo_esquerda(Ator *eu);
s16 corpo_topo(Ator *eu);
s16 centro_x(Ator *eu);
s16 centro_y(Ator *eu);
void virar(Ator *eu, s8 direcao);

// ---- Animação (ANIM_... do personagem, em gerado/codigo_<nome>.h) ----
void tocar_animacao(Ator *eu, u16 animacao); // Se já está tocando, continua de onde está.
void reiniciar_animacao(Ator *eu, u16 animacao); // Sempre do primeiro quadro.
bool animacao_acabou(Ator *eu);
u16 quadro_animacao(Ator *eu);
// Mostra um quadro parado (barras do HUD, contadores): a animação não avança.
void mostrar_quadro(Ator *eu, u16 animacao, u16 quadro);

// ---- Outros atores ----
Ator *criar_ator(const AtorTipo *tipo, s32 x, s32 y); // NULL se não há vaga (32 atores por cena).
void remover_ator(Ator *eu);
// Percorre os atores de um grupo: for (Ator *a = NULL; (a = proximo_ator(a, GRUPO_INIMIGO));) { ... }
Ator *proximo_ator(Ator *depois, u16 grupos);
Ator *primeiro_ator(u16 grupos);
bool tocando(Ator *a, Ator *b); // Os corpos se encostam.
// Ator de um dos grupos cujo corpo toca a área (relativa aos pés de eu, olhando para a direita;
// espelhada quando eu olha para a esquerda). Para achar o seguinte, passe o anterior em depois.
Ator *ator_na_area(Ator *eu, s16 x, s16 y, s16 largura, s16 altura, u16 grupos, Ator *depois);
// Tira vida do alvo e o deixa piscando por invencivel quadros. Falso se ele já estava invencível.
bool ferir(Ator *alvo, s16 dano, u16 invencivel);
s16 distancia_x(Ator *a, Ator *b); // Do centro de a ao centro de b (positivo = b à direita).
s16 distancia_y(Ator *a, Ator *b);

// ---- Impacto ----
// Congela os atores (código e animações) por alguns quadros: o "peso" de um golpe. Pedidos juntos
// não somam: vale o maior.
void parar_jogo(u16 quadros);
bool jogo_parado(void);
// Treme a tela (planos e sprites) por alguns quadros, até amplitude pixels.
void tremer_tela(u16 quadros, u8 amplitude);

// ---- Tela e som ----
extern Ator *ator_camera; // Ator que a câmera segue (camera_segue no Inspetor); pode trocar.
// Câmera pelo código: com TRUE, a câmera só vai aonde posicionar_camera mandar (presa ao mundo).
void camera_pelo_codigo(bool ligado);
void posicionar_camera(s16 x, s16 y); // Canto da tela no mundo.
s16 mundo_largura(void);
s16 mundo_altura(void);
bool na_tela(Ator *eu);
s16 tela_x(void); // Canto da câmera no mundo.
s16 tela_y(void);
void tocar_som(u8 som); // SOM_... de gerado/jogo.h.

// ---- Usado pelo jogo gerado ----
void atores_iniciar(u8 (*celula)(s16 x, s16 y), s16 largura, s16 altura);
bool atores_camera(s16 *x, s16 *y); // Câmera pelo código: devolve TRUE e a posição.
s16 atores_tremor_x(void);
s16 atores_tremor_y(void);
void atores_atualizar(void);
void atores_desenhar(s16 camera_x, s16 camera_y);
void atores_encerrar(void);
void ator_quadro_mudou(Sprite *sprite);
