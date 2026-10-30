#!/usr/bin/env python3
# Monta as cenas do jogo padrão: titulo.tscn (cena principal, START começa), fase1.tscn e fase2.tscn
# (MDMapa de 960×224, herói, inimigos e a saída no fim) e fim.tscn (START volta ao título).
# Depois de criadas, as cenas são editadas no editor do Retro Studio.
# Uso: python3 tools/criar_cenas.py  (na pasta do jogo)
import struct
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Uma letra por tile de 16×16: G grama, T terra, B bloco, P pedra, . vazio. 60 colunas × 14 linhas.
FASE1 = [
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

FASE2 = [
	"............................................................",
	"............................................................",
	"............................................................",
	"............................................................",
	"............................................................",
	"............................................BBBB............",
	"............................................................",
	"....................BBB.............BBB.....................",
	"............................................................",
	"..............BB............................................",
	"..........................................P.................",
	"GGGGGGGGGGGG...GGGGGGGG...GGGGGGGGGG...GGGGGGGGGGGGGGGGGGGGG",
	"TTTTTTTTTTTT...TTTTTTTT...TTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTT",
	"TTTTTTTTTTTT...TTTTTTTT...TTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTT",
]
ATLAS = {"G": 0, "T": 1, "B": 2, "P": 3}

# Inimigos: nome, x, y (topo do sprite de 16×16) e distância da patrulha.
INIMIGOS1 = [
	("BesouroChao", 160, 160, 120),
	("BesouroPlataforma", 480, 64, 64),
	("BesouroPedras", 560, 160, 100),
]
INIMIGOS2 = [
	("BesouroInicio", 96, 160, 80),
	("BesouroMeio", 256, 160, 96),
	("BesouroPlataforma", 704, 64, 48),
	("BesouroFinal", 640, 160, 160),
]

FUNDO = '[ext_resource type="Texture2D" path="res://res/fundo.png" id="1_fundo"]'
HEROI = '[ext_resource type="Texture2D" path="res://res/heroi.png" id="2_heroi"]'


def dados_do_mapa(fase):
	# Formato do TileMapLayer: versão (u16) e, por célula, x, y, fonte, atlas x, atlas y e alternativa.
	assert all(len(linha) == 60 for linha in fase)
	dados = bytearray(struct.pack("<H", 0))
	for y, linha in enumerate(fase):
		for x, letra in enumerate(linha):
			if letra in ATLAS:
				dados += struct.pack("<hhHHHH", x, y, 0, ATLAS[letra], 0, 0)
	return ", ".join(str(b) for b in dados)


def texto(nome, x, y, conteudo, piscar=False):
	return f"""
[node name="{nome}" type="MDTexto" parent="."]
position = Vector2({x}, {y})
texto = "{conteudo}"
""" + ("piscar = true\n" if piscar else "")


def fase(nome, titulo, mapa, inimigos, destino):
	cena = f"""[gd_scene format=3]

{FUNDO}
{HEROI}
[ext_resource type="TileSet" path="res://tileset.tres" id="3_tiles"]
[ext_resource type="Texture2D" path="res://res/inimigo.png" id="4_inimigo"]

[node name="{nome}" type="MDCena"]
musica = "res://som/fase.vgm"

[node name="Fundo" type="MDFundo" parent="."]
texture = ExtResource("1_fundo")

[node name="Fase" type="MDMapa" parent="."]
tile_map_data = PackedByteArray({dados_do_mapa(mapa)})
tile_set = ExtResource("3_tiles")
{texto("Titulo", 8, 0, titulo)}
[node name="Heroi" type="MDJogador" parent="."]
position = Vector2(32, 140)
texture = ExtResource("2_heroi")
hframes = 2
vframes = 2
caixa_colisao = Rect2i(10, 4, 12, 27)
som_pulo = "res://som/pulo.wav"
som_morte = "res://som/dano.wav"
"""
	for inimigo, x, y, distancia in inimigos:
		cena += f"""
[node name="{inimigo}" type="MDInimigo" parent="."]
position = Vector2({x}, {y})
texture = ExtResource("4_inimigo")
hframes = 2
paleta = 3
caixa_colisao = Rect2i(2, 4, 12, 12)
distancia = {distancia}
"""
	# A saída fica no fim do chão, encostada na parede direita do mapa.
	cena += f"""
[node name="Saida" type="MDSaida" parent="."]
position = Vector2(928, 128)
tamanho = Vector2i(32, 48)
destino = "{destino}"
"""
	return cena


def tela(nome, textos, musica, destino, heroi):
	cena = f"""[gd_scene format=3]

{FUNDO}
{HEROI}

[node name="{nome}" type="MDCena"]
musica = "{musica}"
start_vai_para = "{destino}"

[node name="Fundo" type="MDFundo" parent="."]
texture = ExtResource("1_fundo")
"""
	for t in textos:
		cena += texto(*t)
	if heroi:
		cena += """
[node name="Heroi" type="MDSprite" parent="."]
position = Vector2(144, 120)
texture = ExtResource("2_heroi")
hframes = 2
vframes = 2
"""
	return cena


CENAS = {
	"titulo.tscn": tela("Titulo", [("Nome", 112, 48, "RETRO STUDIO"), ("Subtitulo", 120, 96, "JOGO PADRAO"), ("Start", 112, 176, "APERTE START", True)],
			"res://som/titulo.vgm", "res://fase1.tscn", True),
	"fase1.tscn": fase("Fase1", "FASE 1", FASE1, INIMIGOS1, "res://fase2.tscn"),
	"fase2.tscn": fase("Fase2", "FASE 2", FASE2, INIMIGOS2, "res://fim.tscn"),
	"fim.tscn": tela("Fim", [("Parabens", 128, 48, "PARABENS!"), ("Venceu", 96, 96, "VOCE CHEGOU AO FIM"), ("Start", 112, 176, "APERTE START", True)],
			"res://som/titulo.vgm", "res://titulo.tscn", False),
}

for arquivo, conteudo in CENAS.items():
	(RAIZ / arquivo).write_text(conteudo)
print("Cenas criadas:", ", ".join(CENAS))
