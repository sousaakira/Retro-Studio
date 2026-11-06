#!/usr/bin/env python3
"""Prepara o teste_anim_cenario.c com os arquivos gerados de um projeto (depois do --retro-build).

Uso: anim_cenario_dados.py <projeto> <cena> <pasta-de-trabalho>
Grava na pasta: genesis.h (tipos e funções de mentira), jogo.h (o MapaStream do jogo.h gerado),
anim_cenario.h/.c (o runtime gerado), stream_part.c (o streaming do jogo.c) e dados.c (os mapas da cena
que têm animação, com os .bin de res/gerado em arrays).
"""
import re
import sys
from pathlib import Path

projeto, cena, pasta = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
pasta.mkdir(parents=True, exist_ok=True)
gerado = projeto / 'src/gerado'
jogo_c = (gerado / 'jogo.c').read_text(encoding='utf-8')
jogo_h = (gerado / 'jogo.h').read_text(encoding='utf-8')
fonte = (gerado / f'cena_{cena}.c').read_text(encoding='utf-8')

(pasta / 'genesis.h').write_text('''#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int8_t s8;
typedef int16_t s16;
typedef int32_t s32;
typedef int bool;
#define TRUE 1
#define FALSE 0
typedef enum { BG_B, BG_A } VDPPlane;
#define VDP_BG_A 0xC000
#define VDP_BG_B 0xE000
#define DMA_VRAM 0
#define DMA 1
#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
bool DMA_queueDma(u8 local, void *origem, u16 destino, u16 palavras, u16 passo);
bool DMA_queueDmaFast(u8 local, void *origem, u32 destino, u16 palavras, u16 passo);
void DMA_doDmaFast(u8 local, void *origem, u32 destino, u16 palavras, s16 passo);
void VDP_loadTileData(const u32 *dados, u16 tile, u16 quantos, u8 modo);
void DMA_flushQueue(void);
''', encoding='utf-8')

ligado = re.search(r'#define ANIM_CENARIO_LIGADO (\d)', jogo_h)
if not ligado:
    sys.exit('o jogo.h não tem animação de cenário (o projeto usa MDAnimacaoCenario?)')
struct = re.search(r'typedef struct MapaStream \{.*?\} MapaStream;', jogo_h, re.S).group(0)
(pasta / 'jogo.h').write_text(f'#pragma once\n#include <genesis.h>\n#define ANIM_CENARIO_LIGADO {ligado.group(1)}\n#include "anim_cenario.h"\n{struct}\n'
                              'void stream_preparar(MapaStream *mapa);\nvoid stream_mover(MapaStream *mapa, s16 camera_x, s16 camera_y);\n', encoding='utf-8')
for nome in ('anim_cenario.h', 'anim_cenario.c'):
    (pasta / nome).write_text((gerado / nome).read_text(encoding='utf-8'), encoding='utf-8')
inicio = jogo_c.index('#define JANELA_COLUNAS')
fim = jogo_c.index('\n}\n', jogo_c.index('void stream_mover(')) + 3
(pasta / 'stream_part.c').write_text(jogo_c[inicio:fim].replace('(u32)origem;', '(u32)(uintptr_t)origem;'), encoding='utf-8')

# Mapas da cena com animação: as tabelas e o MapaStream como estão no cena_<cena>.c.
mapas = re.findall(r'^static MapaStream (\w+) = \{(.*?)\}; // (.*)$', fonte, re.M)
mapas = [m for m in mapas if '_anim,' in m[1]]
if not mapas:
    sys.exit(f'a cena {cena} não tem mapa com animação de cenário')
saida = ['// Gerado pelo anim_cenario_dados.py.']
simbolos = set()
for var, corpo, nome in mapas:
    simbolos.update(re.findall(r'\(const u(?:16|32) \*\)(\w+)', corpo))
    tabela = re.search(rf'^static const AnimCenarioGrupo {var}_anim\[\] = \{{.*?^\}};', fonte, re.M | re.S).group(0)
    simbolos.update(re.findall(r'\(const u32 \*\)(\w+)', tabela))
cabeca = []
for simbolo in sorted(simbolos):
    dados = (projeto / 'res/gerado' / f'{simbolo}.bin').read_bytes()
    if simbolo.endswith(('_padroes',)) or re.search(r'_anim\d+$', simbolo):
        valores = ', '.join(str(b) for b in dados)
        cabeca.append(f'static const uint8_t {simbolo}[] __attribute__((aligned(4))) = {{ {valores} }};')
    else:
        valores = ', '.join(str(dados[i] << 8 | dados[i + 1]) for i in range(0, len(dados), 2))
        cabeca.append(f'static const u16 {simbolo}[] = {{ {valores} }};')
saida += cabeca
for var, corpo, nome in mapas:
    for linha in re.findall(rf'^static const u8 {var}_seq\d+\[\] = .*$', fonte, re.M):
        saida.append(linha)
    saida.append(re.search(rf'^static const AnimCenarioGrupo {var}_anim\[\] = \{{.*?^\}};', fonte, re.M | re.S).group(0))
    saida.append(re.search(rf'^static u16 {var}_dono\[\d+\];.*$', fonte, re.M).group(0))
    saida.append(f'static MapaStream {var} = {{{corpo}}}; // {nome}')
saida.append(f'#define TESTE_MAPAS {len(mapas)}')
saida.append('static MapaStream *const teste_mapas[] = { ' + ', '.join('&' + m[0] for m in mapas) + ' };')
saida.append('static const char *const teste_nomes[] = { ' + ', '.join(f'"{cena}: {m[2]}"' for m in mapas) + ' };')
(pasta / 'dados.c').write_text('\n'.join(saida) + '\n', encoding='utf-8')
print(f'{len(mapas)} mapa(s) com animação em {cena}')
