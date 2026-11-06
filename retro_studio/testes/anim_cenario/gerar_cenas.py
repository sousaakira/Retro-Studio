#!/usr/bin/env python3
"""Cenas de teste da animação de cenário (MDAnimacaoCenario), por cima de uma cópia do jogo padrão.

Uso: gerar_cenas.py <projeto>
- res/anim/planta.png, tocha.png, maquina.png: tiras de quadros nas cores de res/tiles.png;
- animacoes.tscn: a fase 1 com 6 plantas iguais (dividem os padrões), uma planta com outra fase, duas
  tochas e uma máquina; START vai para intervalo.tscn (e o START de lá volta), para testar a troca de cena;
- reuso.tscn: mapa de 300 × 48 células com 3000 padrões diferentes (as vagas da VRAM são reaproveitadas
  enquanto a câmera anda) e animações espalhadas, sem jogador (a câmera é movida pelo teste);
- a cena principal passa a ser animacoes.tscn.
"""
import math
import random
import struct
import sys
from pathlib import Path

from PIL import Image

projeto = Path(sys.argv[1])
pasta = projeto / 'res/anim'
pasta.mkdir(parents=True, exist_ok=True)
fonte = Image.open(projeto / 'res/tiles.png')
pal = fonte.getpalette()[:48]
VERDE, VERDE_E, MARROM, MARROM_E, LARANJA, TELHA, AMARELO, CINZA, AZUL_E, BRANCO = 2, 3, 4, 5, 6, 7, 8, 9, 10, 11


def tira(w, h, n):
    im = Image.new('P', (w * n, h), 0)
    im.putpalette(pal)
    return im


def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), c)


# Planta 16×16, 3 quadros: as folhas de cima balançam (parada, esquerda, direita).
p = tira(16, 16, 3)
for f, d in enumerate((0, -1, 1)):
    ox = f * 16
    for y in range(6, 16):
        px(p, ox + 7, y, VERDE_E)
        px(p, ox + 8, y, VERDE_E)
    for k, (cy, lado) in enumerate(((5, -1), (8, 1), (10, -1), (12, 1))):
        dd = d if k < 2 else 0
        for i in range(5):
            x = ox + 8 + lado * (1 + i) + dd
            y = cy - (i // 2) + (1 if i == 4 else 0)
            px(p, x, y, VERDE)
            px(p, x, y + 1, VERDE_E if i > 2 else VERDE)
    for x in range(5, 11):
        px(p, ox + x, 15, MARROM_E)
    for (x, y) in ((7, 2), (8, 2), (7, 3), (8, 3)):
        px(p, ox + x + d, y, VERDE)
p.save(pasta / 'planta.png', transparency=0)

# Tocha 8×16, 4 quadros: a chama muda de forma.
t = tira(8, 16, 4)
chamas = [
    [(3, 2), (4, 2), (2, 3), (3, 3), (4, 3), (5, 3), (2, 4), (3, 4), (4, 4), (5, 4), (3, 5), (4, 5)],
    [(4, 1), (3, 2), (4, 2), (5, 2), (2, 3), (3, 3), (4, 3), (5, 3), (3, 4), (4, 4), (5, 4), (3, 5), (4, 5)],
    [(3, 1), (2, 2), (3, 2), (4, 2), (2, 3), (3, 3), (4, 3), (5, 3), (2, 4), (3, 4), (4, 4), (3, 5), (4, 5)],
    [(3, 3), (4, 3), (2, 4), (3, 4), (4, 4), (5, 4), (3, 5), (4, 5), (4, 2)],
]
for f, ch in enumerate(chamas):
    ox = f * 8
    for (x, y) in ch:
        px(t, ox + x, y, AMARELO if 3 <= x <= 4 and y >= 3 else LARANJA)
    for y in range(6, 16):
        px(t, ox + 3, y, MARROM)
        px(t, ox + 4, y, MARROM_E)
    for x in range(2, 6):
        px(t, ox + x, 6, CINZA)
t.save(pasta / 'tocha.png', transparency=0)

# Máquina 24×16, 3 quadros: a engrenagem gira e a luz pisca.
m = tira(24, 16, 3)
for f in range(3):
    ox = f * 24
    for y in range(2, 16):
        for x in range(1, 23):
            px(m, ox + x, y, AZUL_E if (x in (1, 22) or y in (2, 15)) else CINZA)
    cx, cy = ox + 8, 9
    for yy in range(-4, 5):
        for xx in range(-4, 5):
            if xx * xx + yy * yy <= 16:
                px(m, cx + xx, cy + yy, MARROM)
    for k in range(4):
        ang = math.radians(k * 45 + f * 15)
        for s in range(-4, 5):
            px(m, round(cx + math.cos(ang) * s), round(cy + math.sin(ang) * s), MARROM_E)
    px(m, cx, cy, BRANCO)
    for y in range(5, 8):
        for x in range(16, 20):
            px(m, ox + x, y, (AMARELO, LARANJA, TELHA)[f])
    for x in range(15, 21):
        px(m, ox + x, 11 + (f % 2), BRANCO)
m.save(pasta / 'maquina.png', transparency=0)


def anim(nome, x, y, quadros, tamanho, intervalo, sequencia=None, fase=0, mapa='../Fase'):
    s = f'[node name="{nome}" type="MDAnimacaoCenario" parent="."]\nposition = Vector2({x}, {y})\nmapa = NodePath("{mapa}")\n'
    s += f'quadros = ExtResource("{quadros}")\ntamanho = Vector2i({tamanho[0]}, {tamanho[1]})\nintervalo = {intervalo}\n'
    if sequencia:
        s += f'sequencia = PackedInt32Array({", ".join(map(str, sequencia))})\n'
    if fase:
        s += f'fase = {fase}\n'
    return s + '\n'


EXT = ('[ext_resource type="Texture2D" path="res://res/anim/planta.png" id="a_planta"]\n'
       '[ext_resource type="Texture2D" path="res://res/anim/tocha.png" id="a_tocha"]\n'
       '[ext_resource type="Texture2D" path="res://res/anim/maquina.png" id="a_maquina"]\n')

# animacoes.tscn: a fase 1 com animações.
s = (projeto / 'fase1.tscn').read_text(encoding='utf-8')
s = s.replace('[node name="Fase1" type="MDCena"]', '[node name="Animacoes" type="MDCena"]\nstart_vai_para = "res://intervalo.tscn"', 1)
i = s.index('\n[node ')
s = s[:i] + '\n' + EXT + s[i:]
nos = ''.join(anim(f'Planta{k + 1}', x, 160, 'a_planta', (16, 16), 12, (0, 1, 0, 2)) for k, x in enumerate((48, 120, 264, 400, 656, 880)))
nos += anim('PlantaFora', 720, 160, 'a_planta', (16, 16), 12, (0, 1, 0, 2), fase=6)
nos += anim('Tocha1', 176, 160, 'a_tocha', (8, 16), 6) + anim('Tocha2', 600, 160, 'a_tocha', (8, 16), 6)
nos += anim('Maquina', 800, 160, 'a_maquina', (24, 16), 4)
i = s.index('[node name="Titulo" type="MDTexto"')
s = s[:i] + nos + s[i:]
(projeto / 'animacoes.tscn').write_text(s, encoding='utf-8')
(projeto / 'intervalo.tscn').write_text('[gd_scene format=3]\n\n[node name="Intervalo" type="MDCena"]\nstart_vai_para = "res://animacoes.tscn"\n\n'
                                        '[node name="Aviso" type="MDTexto" parent="."]\nposition = Vector2(64, 96)\ntexto = "INTERVALO - START VOLTA"\n', encoding='utf-8')

# reuso.tscn: 3000 padrões diferentes (ruído nas cores da paleta), um tileset próprio.
random.seed(7)
TILES, COLS = 3000, 64
linhas_atlas = (TILES + COLS - 1) // COLS
atlas = Image.new('P', (COLS * 8, linhas_atlas * 8), 0)
atlas.putpalette(pal)
for n in range(TILES):
    ox, oy = n % COLS * 8, n // COLS * 8
    base = 2 + n % 10
    for y in range(8):
        for x in range(8):
            atlas.putpixel((ox + x, oy + y), base if random.random() < 0.55 else 2 + random.randrange(10))
atlas.save(projeto / 'res/anim/ruido.png', transparency=0)
celulas = '\n'.join(f'{n % COLS}:{n // COLS}/0 = 0' for n in range(TILES))
(projeto / 'tileset_ruido.tres').write_text(f'''[gd_resource type="TileSet" format=3]

[ext_resource type="Texture2D" path="res://res/anim/ruido.png" id="1_ruido"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_ruido"]
texture = ExtResource("1_ruido")
texture_region_size = Vector2i(8, 8)
{celulas}

[resource]
tile_size = Vector2i(8, 8)
sources/0 = SubResource("TileSetAtlasSource_ruido")
''', encoding='utf-8')
W, H = 300, 48
dados = bytearray(struct.pack('<h', 0))
for y in range(H):
    for x in range(W):
        n = (x * 7 + y * 13) % TILES
        dados += struct.pack('<hhhhhh', x, y, 0, n % COLS, n // COLS, 0)
nos = ''
for k, x in enumerate(range(40, W * 8 - 40, 136)):
    nos += anim(f'Planta{k + 1}', x, 352, 'a_planta', (16, 16), 12, (0, 1, 0, 2), fase=(6 if k % 5 == 4 else 0))
for k, x in enumerate(range(96, W * 8 - 40, 304)):
    nos += anim(f'Tocha{k + 1}', x, 64 + (k % 3) * 96, 'a_tocha', (8, 16), 6)
for k, x in enumerate(range(200, W * 8 - 40, 600)):
    nos += anim(f'Maquina{k + 1}', x, 200, 'a_maquina', (24, 16), 4, fase=k)
(projeto / 'reuso.tscn').write_text(f'''[gd_scene format=3]

[ext_resource type="TileSet" path="res://tileset_ruido.tres" id="1_tiles"]
{EXT}
[node name="Reuso" type="MDCena"]

[node name="Fase" type="MDMapa" parent="."]
tile_map_data = PackedByteArray({", ".join(map(str, dados))})
tile_set = ExtResource("1_tiles")

{nos}''', encoding='utf-8')

p = (projeto / 'projeto.retro').read_text(encoding='utf-8')
p = p.replace('run/main_scene="res://titulo.tscn"', 'run/main_scene="res://animacoes.tscn"')
(projeto / 'projeto.retro').write_text(p, encoding='utf-8')
print('cenas de teste prontas')
