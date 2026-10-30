#!/usr/bin/env python3
# Monta a main.tscn do jogo padrão: fundo, título, a fase (MDMapa de 960×224) e o herói.
# Depois de criada, a fase é editada no editor de TileMap do Retro Studio.
# Uso: python3 tools/criar_fase.py  (na pasta do jogo)
import struct
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Uma letra por tile de 16×16: G grama, T terra, B bloco, P pedra, . vazio. 60 colunas × 14 linhas.
FASE = [
	"............................................................",
	"............................................................",
	"............................................................",
	"............................................................",
	"............................................................",
	"..............................BBBBB.........................",
	"............................................................",
	"..........BBBB.......................BBB....................",
	"...................................................P........",
	"................................................P..P........",
	"...........................................P....P..P........",
	"GGGGGGGGGGGGGGGGGGGGGG...GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
	"TTTTTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
	"TTTTTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
]
ATLAS = {"G": 0, "T": 1, "B": 2, "P": 3}


def dados_do_mapa():
	# Formato do TileMapLayer: versão (u16) e, por célula, x, y, fonte, atlas x, atlas y e alternativa.
	dados = bytearray(struct.pack("<H", 0))
	for y, linha in enumerate(FASE):
		for x, letra in enumerate(linha):
			if letra in ATLAS:
				dados += struct.pack("<hhHHHH", x, y, 0, ATLAS[letra], 0, 0)
	return ", ".join(str(b) for b in dados)


CENA = f"""[gd_scene format=3]

[ext_resource type="Texture2D" path="res://res/fundo.png" id="1_fundo"]
[ext_resource type="Texture2D" path="res://res/heroi.png" id="2_heroi"]
[ext_resource type="TileSet" path="res://tileset.tres" id="3_tiles"]

[node name="Jogo" type="MDCena"]

[node name="Fundo" type="MDFundo" parent="."]
texture = ExtResource("1_fundo")

[node name="Fase" type="MDMapa" parent="."]
tile_map_data = PackedByteArray({dados_do_mapa()})
tile_set = ExtResource("3_tiles")

[node name="Titulo" type="MDTexto" parent="."]
position = Vector2(112, 16)
texto = "RETRO STUDIO"

[node name="Heroi" type="MDJogador" parent="."]
position = Vector2(32, 140)
texture = ExtResource("2_heroi")
hframes = 2
vframes = 2
caixa_colisao = Rect2i(10, 4, 12, 27)
"""

(RAIZ / "main.tscn").write_text(CENA)
print("main.tscn criada.")
