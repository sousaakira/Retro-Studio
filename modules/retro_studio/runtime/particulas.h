// Gerado pelo Retro Studio. Não edite: o arquivo é refeito no build.
// Partículas (MDParticulas): grãos de areia caindo, pingos, faíscas, fumaça, pequenas explosões. O Mega Drive não
// tem partículas no hardware: cada uma é um sprite de 8×8 do motor de sprites do SGDK, e todas as de um emissor
// usam os mesmos tiles na VRAM (carregados uma vez). Posições em ponto fixo (12 bits de fração) e um sorteio
// próprio por emissor (xorshift de 16 bits).
#pragma once

#include <genesis.h>

#define PARTICULAS_MAX 16 // Por emissor.
#define PARTICULAS_EMISSORES 8 // Por cena.

#define PARTICULAS_CONTINUO 0 // Solta uma partícula de tempos em tempos.
#define PARTICULAS_RAJADA 1 // Solta várias de uma vez, de tempos em tempos ou pelo código.

typedef struct {
	s16 x, y, l, a; // Área de onde as partículas saem, no mundo (px).
	u8 maximo; // Vivas ao mesmo tempo (até PARTICULAS_MAX).
	u8 modo; // PARTICULAS_CONTINUO ou PARTICULAS_RAJADA.
	u16 espera; // Contínuo: quadros entre partículas × 16. Rajada: quadros entre rajadas (0 = só pelo código).
	u8 rajada; // Partículas de cada rajada.
	u8 variacao; // % de sorteio na espera.
	u8 vida_min, vida_max; // Quadros de vida.
	s32 vx_min, vx_max, vy_min, vy_max; // Velocidade inicial (px/quadro, 12 bits de fração).
	s16 gx, gy; // Gravidade e vento (px/quadro², 12 bits de fração).
	u8 quadros; // Desenhos da folha, do nascer ao morrer.
	u8 paleta;
	u8 prioridade;
	u8 ligado; // Começa soltando partículas.
	u16 semente; // Do sorteio (0 = muda a cada vez que a cena começa).
	const SpriteDefinition *sprite;
	const TileSet *tiles;
} ParticulasConfig;

// Na iniciar da cena, depois do SPR_initEx: carrega os tiles a partir de *tile (que avança) e cria os sprites.
void particulas_preparar(const ParticulasConfig *configs, u8 quantos, u16 *tile);
// Uma vez por quadro, antes do SPR_update: move, sorteia as novas e posiciona os sprites na tela.
void particulas_atualizar(s16 camera_x, s16 camera_y);
void particulas_encerrar(void);
// Para o código da cena (PARTICULAS_<NOME>):
void particulas_rajada(u8 emissor); // Solta uma rajada agora (em qualquer modo).
void particulas_ligar(u8 emissor, bool ligado); // Liga ou desliga a emissão automática (as vivas terminam a vida).
void particulas_mover(u8 emissor, s16 x, s16 y); // Muda o canto da área de emissão (no mundo).
