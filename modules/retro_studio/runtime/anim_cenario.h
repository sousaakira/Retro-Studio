// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Animação de cenário (MDAnimacaoCenario): troca dos padrões de 8×8 de plantas, tochas e máquinas dentro do
// streaming dos mapas. Cada grupo junta os padrões que mudam no mesmo ritmo (intervalo, sequência e fase); os
// quadros ficam na ROM na ordem das vagas, então vagas seguidas vão num DMA só, direto da ROM (o dado continua
// válido até o DMA rodar no vblank). Só vão para a VRAM os padrões que estão nela (o dono da vaga); os que
// entram com a câmera chegam pelo streaming já no quadro atual.
#pragma once

#include <genesis.h>

#define ANIM_CENARIO_GRUPOS 32 // Por cena, somando os mapas.
#define ANIM_CENARIO_MAPAS 4

typedef struct {
	const u32 *quadros; // [quadro da tira][variante]: 8 palavras de 32 bits por padrão, variantes na ordem das vagas.
	const u8 *sequencia; // Quadro da tira de cada passo.
	u16 primeiro; // Padrão + 1 da primeira variante (as do grupo são seguidas).
	u16 n; // Variantes (padrões diferentes) do grupo.
	u8 passos; // Tamanho da sequência.
	u8 intervalo; // Quadros de vídeo por passo.
	u8 passo0, espera0; // Fase: passo e espera no começo da cena.
} AnimCenarioGrupo;

struct MapaStream;

// Medidas do envio das animações (a depuração e os testes leem): bytes e envios (DMAs) deste quadro, os
// maiores desde o começo da cena, o total e as vezes em que a fila do DMA estava cheia (aí o envio vai na
// hora, sem perder nada).
extern u16 anim_cenario_bytes, anim_cenario_envios;
extern u16 anim_cenario_pico_bytes, anim_cenario_pico_envios;
extern u32 anim_cenario_total_bytes, anim_cenario_total_envios;
extern u16 anim_cenario_fila_cheia;

// Na iniciar da cena, depois do stream_preparar dos mapas e antes do primeiro stream_mover.
void anim_cenario_preparar(struct MapaStream *const *mapas, u8 quantos);
// Uma vez por quadro, antes do stream_mover: avança os passos e reenvia os padrões residentes que mudaram.
void anim_cenario_atualizar(void);
void anim_cenario_encerrar(void);
// Para o streaming: os dados do quadro atual do padrão animado (celula = padrão + 1, >= anim_primeiro).
const u32 *anim_cenario_padrao(const struct MapaStream *mapa, u16 celula);
