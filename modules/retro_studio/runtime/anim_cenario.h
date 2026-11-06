// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Animação de cenário (MDAnimacaoCenario): troca dos padrões de 8×8 de plantas, tochas e máquinas dentro do
// streaming dos mapas. Cada grupo junta os padrões que mudam juntos: no modo Sempre, os nodes com o mesmo ritmo
// (intervalo, sequência e fase); com gatilho (proximidade, contato ou código), cada node é um grupo, com estado
// próprio. Os quadros ficam na ROM na ordem das vagas, então vagas seguidas vão num DMA só, direto da ROM (o
// dado continua válido até o DMA rodar no vblank). Só vão para a VRAM os padrões que estão nela (o dono da vaga)
// e só quando o desenho muda; os que entram com a câmera chegam pelo streaming já no quadro atual.
#pragma once

#include <genesis.h>

#define ANIM_CENARIO_GRUPOS 64 // Por cena, somando os mapas.
#define ANIM_CENARIO_MAPAS 4
#define ANIM_CENARIO_CORPOS 48 // Atores (0 a 31) e os corpos do jogo gerado (32 em diante).
#define ANIM_CORPO_JOGADOR 32 // MDJogador.
#define ANIM_CORPO_INIMIGO 33 // MDInimigo: 33 + o número do inimigo na cena.
#define ANIM_TELEPORTE 32 // Mais que isto (px) num quadro é teleporte: não traça o caminho.

// Modos (MDAnimacaoCenario.ativacao).
#define ANIM_SEMPRE 0
#define ANIM_PROXIMIDADE 1
#define ANIM_CONTATO 2
#define ANIM_CODIGO 3

// Corpos do jogo gerado que ativam (AnimCenarioGatilho.internos).
#define ANIM_ALVO_JOGADOR 1 // MDJogador.
#define ANIM_ALVO_INIMIGO 2 // MDInimigo.
#define ANIM_ALVO_CAMERA 4 // Sem jogador identificado: o ator que a câmera segue.

typedef struct {
	s16 x0, y0, x1, y1; // Sensor no mundo (px), já com a distância da proximidade; x1 e y1 ficam fora.
	u16 grupos; // GRUPO_... dos MDAtor que ativam.
	u8 internos; // ANIM_ALVO_...
	u8 modo; // ANIM_PROXIMIDADE, ANIM_CONTATO ou ANIM_CODIGO.
	u8 ciclos_apos; // Ciclos completos depois do atual quando a ativação acaba.
	u8 repouso; // Quadro da tira mostrado em repouso.
	u16 velocidade; // Movimento mínimo para valer, em 1/256 px por quadro (0 = parado também vale).
} AnimCenarioGatilho;

typedef struct {
	const u32 *quadros; // [quadro da tira][variante]: 8 palavras de 32 bits por padrão, variantes na ordem das vagas.
	const u8 *sequencia; // Quadro da tira de cada passo.
	u16 primeiro; // Padrão + 1 da primeira variante (as do grupo são seguidas).
	u16 n; // Variantes (padrões diferentes) do grupo.
	u8 passos; // Tamanho da sequência.
	u8 intervalo; // Quadros de vídeo por passo.
	u8 passo0, espera0; // Modo Sempre: fase (passo e espera no começo da cena).
	const AnimCenarioGatilho *gatilho; // NULL = modo Sempre.
} AnimCenarioGrupo;

struct MapaStream;

// Medidas do envio das animações (a depuração e os testes leem): bytes e envios (DMAs) deste quadro, os
// maiores desde o começo da cena, o total e as vezes em que a fila do DMA estava cheia (aí a fila é esvaziada
// e o envio vai na hora, sem perder nada).
extern u16 anim_cenario_bytes, anim_cenario_envios;
extern u16 anim_cenario_pico_bytes, anim_cenario_pico_envios;
extern u32 anim_cenario_total_bytes, anim_cenario_total_envios;
extern u16 anim_cenario_fila_cheia;
extern u8 anim_cenario_ativas; // Instâncias com gatilho animando agora.

// ---- Para o código C da cena (ANIM_CENARIO_<NOME> de gerado/cena_<cena>.h, só nos nodes com gatilho) ----
// Os pedidos valem a partir do próximo quadro da animação (parar_agora vale na hora).
void anim_cenario_ativar(u8 id, u8 ciclos); // Anima ciclos ciclos completos (em repouso, conta o que começa).
void anim_cenario_sustentar(u8 id, bool ligado); // Como um ator no sensor, até soltar.
void anim_cenario_parar(u8 id); // Parada suave: solta o código e termina o ciclo atual (um sensor ocupado continua).
void anim_cenario_parar_agora(u8 id); // Repouso na hora; com o sensor ocupado, volta a animar no quadro seguinte.
void anim_cenario_sensor(u8 id, bool ligado); // Liga ou desliga o sensor (desligado, só o código ativa).
bool anim_cenario_animando(u8 id);
bool anim_cenario_tem_ator(u8 id); // Algum ator válido no sensor (no último quadro).

// ---- Usado pelo jogo gerado ----
// Na iniciar da cena, depois do stream_preparar dos mapas e antes do primeiro stream_mover.
void anim_cenario_preparar(struct MapaStream *const *mapas, u8 quantos);
// Corpo de um ator do jogo gerado neste quadro (antes de anim_cenario_atualizar): pés (ou canto do sprite) em
// 1/256 px e a caixa do corpo relativa a eles, em px.
void anim_cenario_corpo(u8 corpo, u8 internos, s32 x, s32 y, s16 cx, s16 cy, s16 cl, s16 ca);
// Uma vez por quadro, antes do stream_mover: sensores, passos e o reenvio dos padrões residentes que mudaram.
void anim_cenario_atualizar(void);
void anim_cenario_encerrar(void);
// Para o streaming: os dados do quadro atual do padrão animado (celula = padrão + 1, >= anim_primeiro).
const u32 *anim_cenario_padrao(const struct MapaStream *mapa, u16 celula);
