#!/usr/bin/env python3
# Monta as cenas do jogo padrão: titulo.tscn (cena principal, START começa), fase1.tscn e fase2.tscn
# (MDMapa de 960×224, herói, inimigos, moedas, plataformas que se movem, um ponto de retorno e a saída no fim)
# e fim.tscn (START volta ao título), com uma cena animada no AnimationPlayer: o herói entra e comemora.
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

# Moedas (x, y do topo do sprite de 16×16): em cima das plataformas e sobre os buracos.
MOEDAS1 = [(168, 92), (184, 92), (200, 92), (368, 120), (488, 60), (504, 60), (520, 60), (536, 60), (608, 96), (624, 96)]
MOEDAS2 = [(200, 120), (328, 88), (344, 88), (392, 120), (584, 88), (600, 88), (712, 60), (728, 60), (744, 60), (592, 120)]

# Plataformas que se movem: nome, x, y e deslocamento (até onde vão e voltam).
PLATAFORMAS1 = [("PlataformaBuraco", 320, 152, (64, 0))]
PLATAFORMAS2 = [("Elevador", 648, 144, (0, -56))]

# Ponto de retorno no meio de cada fase (x, y do canto da área de 16×32, com o fundo no chão).
RETORNO1 = (448, 144)
RETORNO2 = (512, 144)

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


def fase(nome, titulo, mapa, inimigos, moedas, plataformas, retorno, destino):
	cena = f"""[gd_scene format=3]

{FUNDO}
{HEROI}
[ext_resource type="TileSet" path="res://tileset.tres" id="3_tiles"]
[ext_resource type="Texture2D" path="res://res/inimigo.png" id="4_inimigo"]
[ext_resource type="Texture2D" path="res://res/moeda.png" id="5_moeda"]
[ext_resource type="Texture2D" path="res://res/plataforma.png" id="6_plataforma"]

[node name="{nome}" type="MDCena"]
musica = "res://som/fase.vgm"

[node name="Fundo" type="MDFundo" parent="."]
texture = ExtResource("1_fundo")
rolagem = 25

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
som_derrota = "res://som/pisao.wav"
"""
	for plataforma, x, y, (dx, dy) in plataformas:
		cena += f"""
[node name="{plataforma}" type="MDPlataforma" parent="."]
position = Vector2({x}, {y})
texture = ExtResource("6_plataforma")
paleta = 2
caixa_colisao = Rect2i(0, 0, 48, 10)
deslocamento = Vector2i({dx}, {dy})
"""
	for i, (x, y) in enumerate(moedas, 1):
		cena += f"""
[node name="Moeda{i}" type="MDItem" parent="."]
position = Vector2({x}, {y})
texture = ExtResource("5_moeda")
hframes = 4
paleta = 3
velocidade_animacao = 8
caixa_colisao = Rect2i(3, 1, 10, 14)
som = "res://som/moeda.wav"
"""
	cena += f"""
[node name="Retorno" type="MDRetorno" parent="."]
position = Vector2{retorno}
som = "res://som/retorno.wav"
"""
	# A saída fica no fim do chão, encostada na parede direita do mapa.
	cena += f"""
[node name="Saida" type="MDSaida" parent="."]
position = Vector2(928, 128)
tamanho = Vector2i(32, 48)
destino = "{destino}"
"""
	return cena


def festa():
	# Animação da tela final (4 s, repete): o herói entra andando até o meio e dá dois pulinhos.
	posicoes = [(0, (-32, 136)), (2.0, (144, 136)), (2.25, (144, 104)), (2.5, (144, 136)), (2.9, (144, 136)), (3.15, (144, 104)), (3.4, (144, 136)), (4.0, (144, 136))]
	# Quadro da folha: 2 e 3 (linha andando) alternando até chegar; depois 0 (parado).
	quadros = [(i * 0.25, 2 + i % 2) for i in range(8)] + [(2.0, 0)]
	def chaves(lista, valor, update):
		return ('{\n"times": PackedFloat32Array(' + ", ".join(str(t) for t, _ in lista) + '),\n"transitions": PackedFloat32Array(' + ", ".join("1" for _ in lista)
				+ f'),\n"update": {update},\n"values": [' + ", ".join(valor(v) for _, v in lista) + "]\n}")
	return f"""
[sub_resource type="Animation" id="Animation_festa"]
resource_name = "festa"
length = 4.0
loop_mode = 1
tracks/0/type = "value"
tracks/0/imported = false
tracks/0/enabled = true
tracks/0/path = NodePath("Heroi:position")
tracks/0/interp = 1
tracks/0/loop_wrap = true
tracks/0/keys = {chaves(posicoes, lambda v: f"Vector2{v}", 0)}
tracks/1/type = "value"
tracks/1/imported = false
tracks/1/enabled = true
tracks/1/path = NodePath("Heroi:frame")
tracks/1/interp = 0
tracks/1/loop_wrap = true
tracks/1/keys = {chaves(quadros, str, 1)}

[sub_resource type="AnimationLibrary" id="AnimationLibrary_fim"]
_data = {{
&"festa": SubResource("Animation_festa")
}}
"""


ANIMACAO_NODE = """
[node name="Animacao" type="AnimationPlayer" parent="."]
libraries = {
&"": SubResource("AnimationLibrary_fim")
}
autoplay = &"festa"
"""


def tela(nome, textos, musica, destino, heroi, animada=False):
	cena = f"""[gd_scene format=3]

{FUNDO}
{HEROI}
""" + (festa() if animada else "") + f"""
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
	if animada:
		cena += """
[node name="Heroi" type="MDSprite" parent="."]
position = Vector2(-32, 136)
texture = ExtResource("2_heroi")
hframes = 2
vframes = 2
""" + ANIMACAO_NODE
	return cena


CENAS = {
	"titulo.tscn": tela("Titulo", [("Nome", 112, 48, "RETRO STUDIO"), ("Subtitulo", 120, 96, "JOGO PADRAO"), ("Start", 112, 176, "APERTE START", True)],
			"res://som/titulo.vgm", "res://fase1.tscn", True),
	"fase1.tscn": fase("Fase1", "FASE 1", FASE1, INIMIGOS1, MOEDAS1, PLATAFORMAS1, RETORNO1, "res://fase2.tscn"),
	"fase2.tscn": fase("Fase2", "FASE 2", FASE2, INIMIGOS2, MOEDAS2, PLATAFORMAS2, RETORNO2, "res://fim.tscn"),
	"fim.tscn": tela("Fim", [("Parabens", 128, 48, "PARABENS!"), ("Venceu", 96, 96, "VOCE CHEGOU AO FIM"), ("Start", 112, 176, "APERTE START", True)],
			"res://som/titulo.vgm", "res://titulo.tscn", False, animada=True),
}

for arquivo, conteudo in CENAS.items():
	(RAIZ / arquivo).write_text(conteudo)
print("Cenas criadas:", ", ".join(CENAS))
