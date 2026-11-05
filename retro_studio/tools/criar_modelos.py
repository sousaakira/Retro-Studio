#!/usr/bin/env python3
# Gera os modelos de jogo do "Novo projeto" em retro_studio/modelos/: visto de cima, nave (tiro) e
# briga de rua (dois jogadores). O modelo de plataforma é o retro_studio/jogo_padrao.
# Cada modelo é um projeto completo sem o projeto.retro (o gerenciador cria o arquivo e aponta a cena
# principal pelo modelo.cfg). A arte é PNG indexado de até 16 cores (a cor 0 é a transparência).
# Uso: python3 retro_studio/tools/criar_modelos.py
import base64
import shutil
import struct
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
MODELOS = RAIZ / "modelos"
PADRAO = RAIZ / "jogo_padrao"

MAKEFILE = """# Jogo de Mega Drive feito no Retro Studio, compilado pelo SGDK.
# make        -> out/rom.bin
# make clean  -> apaga out/
# O editor passa o GDK; estes são os caminhos padrão para rodar o make num terminal.
ifeq ($(OS),Windows_NT)
GDK ?= $(subst \\,/,$(USERPROFILE))/.retrostudio/toolkit/sgdk
else
GDK ?= $(HOME)/.retrostudio/toolkit/marsdev/mars/m68k-elf
export PATH := $(GDK)/bin:$(PATH)
endif

include $(GDK)/makefile.gen
"""

GITIGNORE = """# Saída do build do SGDK e cache do editor.
out/
res/*.rs
res/resources.h
src/boot/
.retro-studio/
.godot/
*.import
# Gerados a partir das cenas no build.
res/cenas_gerado.*
src/gerado/
res/gerado/
"""


def paleta(cores):
	plana = []
	for r, g, b in cores:
		plana += [r * 36, g * 36, b * 36]
	return plana + [0] * (48 - len(plana))


def imagem(largura, altura, cores):
	img = Image.new("P", (largura, altura), 0)
	img.putpalette(paleta(cores))
	return img


def salvar(img, caminho):
	caminho.parent.mkdir(parents=True, exist_ok=True)
	img.save(caminho, transparency=0)


def mapa(celulas):
	# celulas: {(x, y): (atlas_x, atlas_y)} → PackedByteArray do TileMapLayer (formato 0).
	dados = bytearray(struct.pack("<H", 0))
	for (x, y), (ax, ay) in sorted(celulas.items(), key=lambda c: (c[0][1], c[0][0])):
		dados += struct.pack("<hhHHHH", x, y, 0, ax, ay, 0)
	return '"' + base64.b64encode(bytes(dados)).decode() + '"'


def tileset(caminho, textura, colunas, linhas, uid_textura="1_tiles"):
	tiles = "".join(f"{x}:{y}/0 = 0\n" for y in range(linhas) for x in range(colunas))
	caminho.write_text(f"""[gd_resource type="TileSet" format=3]

[ext_resource type="Texture2D" path="{textura}" id="{uid_textura}"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("{uid_textura}")
texture_region_size = Vector2i(8, 8)
{tiles}
[resource]
tile_size = Vector2i(8, 8)
sources/0 = SubResource("TileSetAtlasSource_1")
""", encoding="utf-8")


def titulo(pasta, nome, linhas, destino, cor_fundo="(0, 0, 0)"):
	textos = ""
	for i, (texto, x, y) in enumerate(linhas):
		textos += f"""
[node name="Texto{i + 1}" type="MDTexto" parent="."]
position = Vector2({x}, {y})
texto = "{texto}"
"""
	(pasta / "titulo.tscn").write_text(f"""[gd_scene format=3]

[node name="Titulo" type="MDCena"]
{textos}
[node name="Menu" type="MDMenu" parent="."]
position = Vector2(64, 136)
comecar_vai_para = "{destino}"
mostrar_senha = false
""", encoding="utf-8")


def base(pasta, principal, descricao):
	if pasta.exists():
		shutil.rmtree(pasta)
	(pasta / "res").mkdir(parents=True)
	(pasta / "src").mkdir()
	(pasta / "som").mkdir()
	(pasta / "Makefile").write_text(MAKEFILE, encoding="utf-8")
	(pasta / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
	# O gerenciador de projetos lê a cena principal e o nome mostrado na lista de modelos.
	(pasta / "modelo.cfg").write_text(f"principal=res://{principal}\ndescricao={descricao}\n", encoding="utf-8")
	for som in ("pulo.wav", "moeda.wav", "dano.wav", "pisao.wav"):
		shutil.copy(PADRAO / "som" / som, pasta / "som" / som)


# ---------------------------------------------------------------- visto de cima

def visto_de_cima():
	pasta = MODELOS / "visto_de_cima"
	base(pasta, "titulo.tscn", "Visto de cima: anda nas 4 direções, pega moedas e foge dos inimigos (estilo RPG/aventura).")
	# Tiles (PAL0): 0 grama, 1 grama com flor, 2 caminho, 3 pedra (parede), 4 arbusto (parede).
	cores = [(0, 0, 0), (1, 4, 1), (2, 5, 1), (5, 4, 2), (4, 3, 1), (3, 3, 3), (5, 5, 5), (1, 2, 1), (1, 3, 1), (7, 6, 1), (7, 2, 2), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (7, 7, 7)]
	img = imagem(40, 8, cores)
	d = ImageDraw.Draw(img)
	for t in range(5):
		x0 = t * 8
		if t in (0, 1):
			d.rectangle([x0, 0, x0 + 7, 7], fill=1)
			for px, py in ((1, 2), (5, 5), (3, 6)):
				img.putpixel((x0 + px, py), 2)
			if t == 1:
				img.putpixel((x0 + 4, 3), 9)
				img.putpixel((x0 + 2, 5), 10)
		elif t == 2:
			d.rectangle([x0, 0, x0 + 7, 7], fill=3)
			img.putpixel((x0 + 2, 2), 4)
			img.putpixel((x0 + 5, 6), 4)
		elif t == 3:
			d.rectangle([x0, 0, x0 + 7, 7], fill=5)
			d.line([x0, 7, x0 + 7, 7], fill=7)
			d.line([x0, 3, x0 + 7, 3], fill=6)
			img.putpixel((x0 + 3, 1), 6)
		else:
			d.rectangle([x0, 0, x0 + 7, 7], fill=1)
			d.ellipse([x0, 0, x0 + 7, 7], fill=8)
			img.putpixel((x0 + 2, 2), 2)
	salvar(img, pasta / "res" / "tiles.png")
	tileset(pasta / "tileset.tres", "res://res/tiles.png", 5, 1)

	# Herói visto de cima (PAL1): 2 colunas (passos) × 2 linhas (parado, andando), 16×16.
	cores = [(0, 0, 0), (1, 1, 1), (6, 4, 3), (2, 2, 6), (4, 4, 7), (6, 1, 1), (7, 7, 7), (3, 2, 1)]
	img = imagem(32, 32, cores)
	d = ImageDraw.Draw(img)
	for linha in range(2):
		for coluna in range(2):
			x0, y0 = coluna * 16, linha * 16
			passo = (coluna if linha else 0)
			d.ellipse([x0 + 3, y0 + 5, x0 + 12, y0 + 14], fill=3, outline=1)  # corpo
			d.ellipse([x0 + 4, y0 + 1, x0 + 11, y0 + 8], fill=2, outline=1)  # cabeça
			d.rectangle([x0 + 4, y0 + 1, x0 + 11, y0 + 3], fill=7)  # cabelo
			d.point([(x0 + 6, y0 + 5), (x0 + 9, y0 + 5)], fill=1)
			pe = 1 if passo else 0
			d.rectangle([x0 + 4, y0 + 13 + pe, x0 + 6, y0 + 15], fill=5)
			d.rectangle([x0 + 9, y0 + 14 - pe, x0 + 11, y0 + 15], fill=5)
	salvar(img, pasta / "res" / "heroi.png")

	# Gosma (PAL2): 2 quadros de 16×16.
	cores = [(0, 0, 0), (0, 2, 0), (2, 6, 2), (4, 7, 4), (7, 7, 7), (0, 0, 0)]
	img = imagem(32, 16, cores)
	d = ImageDraw.Draw(img)
	for q in range(2):
		x0 = q * 16
		topo = 4 if q == 0 else 6
		d.ellipse([x0 + 1, topo, x0 + 14, 15], fill=2, outline=1)
		d.ellipse([x0 + 4, topo + 2, x0 + 7, topo + 4], fill=3)
		d.point([(x0 + 5, topo + 6), (x0 + 10, topo + 6)], fill=1)
	salvar(img, pasta / "res" / "gosma.png")
	shutil.copy(PADRAO / "res" / "moeda.png", pasta / "res" / "moeda.png")

	# Mundo de 60×42 células (480×336 px): grama com flores, caminho em cruz, borda e pedras de parede.
	largura, altura = 60, 42
	chao, paredes = {}, {}
	for y in range(altura):
		for x in range(largura):
			chao[(x, y)] = (1, 0) if (x * 7 + y * 13) % 11 == 0 else (0, 0)
			if y in (20, 21) or x in (29, 30):
				chao[(x, y)] = (2, 0)
			if x in (0, largura - 1) or y in (0, altura - 1):
				paredes[(x, y)] = (3, 0)
	for bx, by, w, h in ((8, 6, 6, 2), (40, 8, 2, 7), (12, 28, 8, 2), (44, 30, 6, 3), (22, 12, 2, 4), (36, 26, 3, 3)):
		for y in range(by, by + h):
			for x in range(bx, bx + w):
				paredes[(x, y)] = (4, 0) if (x + y) % 2 else (3, 0)
	moedas = [(64, 80), (200, 40), (360, 64), (420, 180), (100, 200), (300, 280), (420, 300), (60, 300)]
	gosmas = [(120, 136, 64), (300, 100, 80), (180, 260, 96)]
	cena = """[gd_scene format=3]

[ext_resource type="TileSet" path="res://tileset.tres" id="1_tiles"]
[ext_resource type="Texture2D" path="res://res/heroi.png" id="2_heroi"]
[ext_resource type="Texture2D" path="res://res/gosma.png" id="3_gosma"]
[ext_resource type="Texture2D" path="res://res/moeda.png" id="4_moeda"]

[node name="Mundo" type="MDCena"]

[node name="Chao" type="MDMapa" parent="."]
plano = 0
tile_map_data = PackedByteArray(""" + mapa(chao) + """)
tile_set = ExtResource("1_tiles")
paleta = 0
solido = false

[node name="Paredes" type="MDMapa" parent="."]
tile_map_data = PackedByteArray(""" + mapa(paredes) + """)
tile_set = ExtResource("1_tiles")
paleta = 0
solido = true

[node name="Heroi" type="MDJogador" parent="."]
position = Vector2(232, 152)
texture = ExtResource("2_heroi")
hframes = 2
vframes = 2
paleta = 1
modo = 1
velocidade = 2
vidas = 3
caixa_colisao = Rect2i(3, 6, 10, 10)
som_morte = "res://som/dano.wav"
"""
	for i, (x, y) in enumerate(moedas):
		cena += f"""
[node name="Moeda{i + 1}" type="MDItem" parent="."]
position = Vector2({x}, {y})
texture = ExtResource("4_moeda")
hframes = 4
paleta = 3
pontos = 10
som = "res://som/moeda.wav"
"""
	for i, (x, y, distancia) in enumerate(gosmas):
		cena += f"""
[node name="Gosma{i + 1}" type="MDInimigo" parent="."]
position = Vector2({x}, {y})
texture = ExtResource("3_gosma")
hframes = 2
paleta = 2
caixa_colisao = Rect2i(2, 5, 12, 10)
distancia = {distancia}
velocidade = 1
"""
	(pasta / "mundo.tscn").write_text(cena, encoding="utf-8")
	titulo(pasta, "Titulo", [("VISTO DE CIMA", 104, 64), ("PEGUE AS 8 MOEDAS", 88, 88)], "res://mundo.tscn")
	(pasta / "src" / "LEIA-ME.txt").write_text("Código C escrito à mão. O Retro Studio gera src/gerado/ a partir das cenas a cada build; não edite essa pasta.\n", encoding="utf-8")


# ---------------------------------------------------------------- nave (tiro)

def nave():
	pasta = MODELOS / "nave"
	base(pasta, "titulo.tscn", "Nave (tiro): a nave anda em 8 direções e atira (A ou C) nos inimigos que chegam pela direita.")
	# Estrelas (PAL0, 512×224: o plano de 64 tiles emenda ao rolar).
	cores = [(0, 0, 0), (0, 0, 1), (2, 2, 3), (4, 4, 5), (7, 7, 7), (5, 5, 7), (6, 6, 3)] + [(0, 0, 0)] * 8 + [(7, 7, 7)]
	img = imagem(512, 224, cores)
	img.paste(1, [0, 0, 512, 224])
	import random
	random.seed(7)
	for _ in range(260):
		x, y = random.randrange(512), random.randrange(224)
		img.putpixel((x, y), random.choice([2, 2, 2, 3, 3, 4, 5, 6]))
	salvar(img, pasta / "res" / "estrelas.png")

	# Nave do jogador (PAL1): 24×16.
	cores = [(0, 0, 0), (1, 1, 2), (4, 4, 5), (6, 6, 7), (2, 4, 7), (7, 4, 1), (7, 7, 3)]
	img = imagem(24, 16, cores)
	d = ImageDraw.Draw(img)
	d.polygon([(2, 3), (20, 7), (20, 8), (2, 12)], fill=2, outline=1)
	d.polygon([(6, 1), (12, 6), (6, 6)], fill=3, outline=1)
	d.polygon([(6, 14), (12, 9), (6, 9)], fill=3, outline=1)
	d.rectangle([11, 6, 15, 9], fill=4)
	d.rectangle([0, 6, 2, 9], fill=5)
	img.putpixel((0, 7), 6)
	salvar(img, pasta / "res" / "nave.png")

	# Tiro (PAL1, a mesma paleta da nave): 8×8.
	img = imagem(8, 8, cores)
	d = ImageDraw.Draw(img)
	d.rectangle([0, 3, 7, 4], fill=6)
	d.rectangle([2, 2, 5, 5], fill=5)
	salvar(img, pasta / "res" / "tiro.png")

	# Inimigo (PAL2): 2 quadros de 16×16.
	cores = [(0, 0, 0), (1, 0, 0), (6, 1, 1), (7, 4, 2), (7, 7, 3), (3, 0, 2)]
	img = imagem(32, 16, cores)
	d = ImageDraw.Draw(img)
	for q in range(2):
		x0 = q * 16
		d.ellipse([x0 + 2, 3, x0 + 13, 12], fill=2, outline=1)
		d.ellipse([x0 + 4, 5, x0 + 8, 9], fill=4 if q else 3)
		d.line([x0 + 12, 2 + q, x0 + 15, 0 + q], fill=5)
		d.line([x0 + 12, 13 - q, x0 + 15, 15 - q], fill=5)
	salvar(img, pasta / "res" / "inimigo.png")

	(pasta / "espaco.tscn").write_text("""[gd_scene format=3]

[ext_resource type="Texture2D" path="res://res/estrelas.png" id="1_estrelas"]
[ext_resource type="Texture2D" path="res://res/nave.png" id="2_nave"]

[node name="Espaco" type="MDCena"]

[node name="Estrelas" type="MDFundo" parent="."]
texture = ExtResource("1_estrelas")
plano = 0

[node name="Nave" type="MDAtor" parent="." groups=["jogador"]]
position = Vector2(32, 104)
texture = ExtResource("2_nave")
paleta = 1
caixa_colisao = Rect2i(4, 4, 16, 8)
codigo = "res://src/nave.c"
""", encoding="utf-8")
	(pasta / "tiro.tscn").write_text("""[gd_scene format=3]

[ext_resource type="Texture2D" path="res://res/tiro.png" id="1_tiro"]

[node name="Tiro" type="MDAtor" groups=["tiro"]]
texture = ExtResource("1_tiro")
paleta = 1
caixa_colisao = Rect2i(0, 2, 8, 4)
codigo = "res://src/tiro.c"
""", encoding="utf-8")
	(pasta / "inimigo.tscn").write_text("""[gd_scene format=3]

[ext_resource type="Texture2D" path="res://res/inimigo.png" id="1_inimigo"]

[node name="Inimigo" type="MDAtor" groups=["inimigo"]]
texture = ExtResource("1_inimigo")
hframes = 2
paleta = 2
caixa_colisao = Rect2i(2, 3, 12, 10)
velocidade_animacao = 8
codigo = "res://src/inimigo.c"
""", encoding="utf-8")

	(pasta / "src" / "nave.c").write_text("""// Nave do jogador: anda nas 8 direções (presa à tela) e atira com A ou C. Encostar num inimigo tira
// uma vida (a nave pisca por 2 s); sem vidas, fim de jogo.
#include "gerado/codigo_nave.h"

#define VELOCIDADE PX(2)
#define TIROS_NA_TELA 4
#define INTERVALO 8 // Quadros entre dois tiros.
#define ESPERA v[0]

void nave_pronto(Ator *eu) {
	if (vidas == 0) {
		vidas = 3; // Jogo novo.
	}
	eu->ESPERA = 0;
}

void nave_quadro(Ator *eu) {
	eu->vx = botao(BOTAO_DIREITA) ? VELOCIDADE : botao(BOTAO_ESQUERDA) ? -VELOCIDADE : 0;
	eu->vy = botao(BOTAO_BAIXO) ? VELOCIDADE : botao(BOTAO_CIMA) ? -VELOCIDADE : 0;
	eu->x = clamp(eu->x + eu->vx, PX(0), PX(320 - 24));
	eu->y = clamp(eu->y + eu->vy, PX(16), PX(224 - 16));
	if (eu->ESPERA) {
		eu->ESPERA--;
	}
	if (botao(BOTAO_A | BOTAO_C) && !eu->ESPERA && contar_atores(&TIPO_TIRO) < TIROS_NA_TELA) {
		criar_ator(&TIPO_TIRO, eu->x + PX(20), eu->y + PX(4));
		tocar_som(SOM_PULO);
		eu->ESPERA = INTERVALO;
	}
	for (Ator *inimigo = NULL; (inimigo = proximo_ator(inimigo, GRUPO_INIMIGO));) {
		if (tocando(eu, inimigo) && ferir(eu, 1, 120)) {
			remover_ator(inimigo);
			tocar_som(SOM_DANO);
			tremer_tela(10, 2);
			if (vidas <= 1) {
				vidas = 0;
				jogo_perdeu();
			} else {
				vidas--;
			}
			break;
		}
	}
}
""", encoding="utf-8")
	(pasta / "src" / "tiro.c").write_text("""// Tiro da nave: voa para a direita e some fora da tela; no primeiro inimigo que tocar, os dois somem
// e o jogador ganha 100 pontos.
#include "gerado/codigo_tiro.h"

void tiro_pronto(Ator *eu) {
	(void)eu;
}

void tiro_quadro(Ator *eu) {
	eu->x += PX(6);
	if (PIXELS(eu->x) > 320) {
		remover_ator(eu);
		return;
	}
	for (Ator *inimigo = NULL; (inimigo = proximo_ator(inimigo, GRUPO_INIMIGO));) {
		if (tocando(eu, inimigo)) {
			remover_ator(inimigo);
			remover_ator(eu);
			pontos += 100;
			tocar_som(SOM_PISAO);
			return;
		}
	}
}
""", encoding="utf-8")
	(pasta / "src" / "inimigo.c").write_text("""// Inimigo: entra pela direita e atravessa a tela em zigue-zague; some ao sair pela esquerda.
#include "gerado/codigo_inimigo.h"

#define CENTRO v[0] // Altura do meio do zigue-zague.
#define PASSO v[1]

void inimigo_pronto(Ator *eu) {
	eu->CENTRO = PIXELS(eu->y);
	eu->PASSO = 0;
}

void inimigo_quadro(Ator *eu) {
	static const s8 onda[16] = { 0, 4, 8, 11, 12, 11, 8, 4, 0, -4, -8, -11, -12, -11, -8, -4 };
	eu->x -= PX(1) + PX(1) / 2;
	eu->PASSO++;
	eu->y = PX(eu->CENTRO + onda[(eu->PASSO >> 2) & 15] * 2);
	if (PIXELS(eu->x) < -16) {
		remover_ator(eu);
	}
}
""", encoding="utf-8")
	(pasta / "src" / "espaco.c").write_text("""// Código da cena do espaço: as estrelas rolam, um inimigo nasce a cada meio segundo numa altura
// sorteada e os pontos e as vidas ficam no topo.
#include "gerado/cena_espaco.h"
#include "gerado/codigo_nave.h"

static s16 rolagem;
static u32 pontos_mostrados;
static u8 vidas_mostradas;

static void placar(void) {
	char texto[32];
	sprintf(texto, "PONTOS %06lu   VIDAS %u", pontos, vidas);
	VDP_drawText(texto, 1, 0);
	pontos_mostrados = pontos;
	vidas_mostradas = vidas;
}

void espaco_iniciar(void) {
	rolagem = 0;
	placar();
}

void espaco_atualizar(void) {
	rolagem -= 2;
	VDP_setHorizontalScroll(BG_B, rolagem);
	if (quadro_do_jogo() % 30 == 0) {
		criar_ator(&TIPO_INIMIGO, PX(320), PX(32 + random() % 160));
	}
	if (pontos != pontos_mostrados || vidas != vidas_mostradas) {
		placar();
	}
}
""", encoding="utf-8")
	titulo(pasta, "Titulo", [("NAVE", 144, 64), ("A OU C ATIRA", 112, 88)], "res://espaco.tscn")


# ---------------------------------------------------------------- briga de rua

def briga():
	pasta = MODELOS / "briga_de_rua"
	base(pasta, "titulo.tscn", "Briga de rua: dois jogadores (controles 1 e 2) andam pela rua e derrubam os capangas no soco (A).")
	# Rua (PAL0): tiles 0 parede, 1 parede com janela, 2 calçada, 3 asfalto, 4 faixa.
	cores = [(0, 0, 0), (3, 2, 2), (4, 3, 3), (2, 2, 3), (5, 5, 6), (4, 4, 4), (3, 3, 3), (2, 2, 2), (6, 6, 2), (1, 1, 1)] + [(0, 0, 0)] * 5 + [(7, 7, 7)]
	img = imagem(40, 8, cores)
	d = ImageDraw.Draw(img)
	d.rectangle([0, 0, 7, 7], fill=1)
	d.line([0, 3, 7, 3], fill=2)
	d.line([0, 7, 7, 7], fill=2)
	d.rectangle([8, 0, 15, 7], fill=1)
	d.rectangle([10, 1, 13, 6], fill=3)
	d.point([(11, 2)], fill=4)
	d.rectangle([16, 0, 23, 7], fill=5)
	d.line([16, 0, 23, 0], fill=4)
	d.rectangle([24, 0, 31, 7], fill=7)
	d.point([(26, 3), (29, 6)], fill=6)
	d.rectangle([32, 0, 39, 7], fill=7)
	d.rectangle([33, 3, 38, 4], fill=8)
	salvar(img, pasta / "res" / "rua.png")
	tileset(pasta / "tileset.tres", "res://res/rua.png", 5, 1)

	def lutador(cores_roupa, arquivo, chefe=False):
		# 2 quadros × 3 linhas (parado, andando, soco) de 24×32; os pés no canto de baixo.
		cores = [(0, 0, 0), (1, 1, 1), (6, 4, 3)] + cores_roupa + [(7, 7, 7), (2, 1, 1)]
		img = imagem(48, 96, cores)
		d = ImageDraw.Draw(img)
		for linha in range(3):
			for coluna in range(2):
				x0, y0 = coluna * 24, linha * 32
				passo = coluna if linha == 1 else 0
				d.rectangle([x0 + 8, y0 + 2, x0 + 15, y0 + 9], fill=2, outline=1)  # cabeça
				d.rectangle([x0 + 8, y0 + 2, x0 + 15, y0 + 4], fill=7)  # cabelo
				d.point([(x0 + 13, y0 + 6)], fill=1)
				d.rectangle([x0 + 7, y0 + 10, x0 + 16, y0 + 20], fill=3, outline=1)  # tronco
				d.rectangle([x0 + 8, y0 + 21, x0 + 15, y0 + 23], fill=4)  # cinto
				d.rectangle([x0 + 7 + passo, y0 + 24, x0 + 10 + passo, y0 + 31], fill=4, outline=1)  # pernas
				d.rectangle([x0 + 13 - passo, y0 + 24, x0 + 16 - passo, y0 + 31], fill=4, outline=1)
				if linha == 2 and coluna == 1:
					d.rectangle([x0 + 16, y0 + 12, x0 + 23, y0 + 15], fill=2, outline=1)  # soco esticado
				else:
					d.rectangle([x0 + 15, y0 + 11, x0 + 18, y0 + 18], fill=2, outline=1)  # braço
		salvar(img, pasta / "res" / arquivo)

	lutador([(2, 2, 6), (1, 1, 3)], "jogador1.png")
	lutador([(6, 2, 2), (3, 1, 1)], "jogador2.png")
	lutador([(3, 4, 2), (2, 2, 1)], "capanga.png")

	largura, altura = 120, 28
	celulas = {}
	for y in range(altura):
		for x in range(largura):
			if y < 13:
				celulas[(x, y)] = (1, 0) if (y in (4, 5, 8, 9) and x % 6 in (2, 3)) else (0, 0)
			elif y < 15:
				celulas[(x, y)] = (2, 0)
			else:
				celulas[(x, y)] = (4, 0) if (y == 21 and x % 4 < 2) else (3, 0)
	cena = """[gd_scene format=3]

[ext_resource type="TileSet" path="res://tileset.tres" id="1_tiles"]
[ext_resource type="Texture2D" path="res://res/jogador1.png" id="2_j1"]
[ext_resource type="Texture2D" path="res://res/jogador2.png" id="3_j2"]
[ext_resource type="Texture2D" path="res://res/capanga.png" id="4_capanga"]

[node name="Rua" type="MDCena"]

[node name="Rua" type="MDMapa" parent="."]
plano = 0
tile_map_data = PackedByteArray(""" + mapa(celulas) + """)
tile_set = ExtResource("1_tiles")
paleta = 0
solido = false

[node name="Jogador1" type="MDAtor" parent="." groups=["jogador"]]
position = Vector2(40, 140)
texture = ExtResource("2_j1")
hframes = 2
vframes = 3
paleta = 1
caixa_colisao = Rect2i(6, 20, 12, 12)
velocidade_animacao = 10
vida = 5
camera_segue = true
codigo = "res://src/lutador.c"

[node name="Jogador2" type="MDAtor" parent="." groups=["jogador"]]
position = Vector2(40, 176)
texture = ExtResource("3_j2")
hframes = 2
vframes = 3
paleta = 2
caixa_colisao = Rect2i(6, 20, 12, 12)
velocidade_animacao = 10
vida = 5
codigo = "res://src/lutador.c"
"""
	for i, (x, y) in enumerate(((260, 140), (300, 180), (480, 150), (520, 190), (700, 140), (740, 170), (900, 160))):
		cena += f"""
[node name="Capanga{i + 1}" type="MDAtor" parent="." groups=["capanga"]]
position = Vector2({x}, {y})
texture = ExtResource("4_capanga")
hframes = 2
vframes = 3
paleta = 3
caixa_colisao = Rect2i(6, 20, 12, 12)
velocidade_animacao = 12
vida = 3
dorme_longe = true
codigo = "res://src/capanga.c"
"""
	(pasta / "rua.tscn").write_text(cena, encoding="utf-8")
	(pasta / "src" / "lutador.c").write_text("""// Os dois jogadores usam este código: o Jogador1 lê o controle 1 e o Jogador2, o controle 2. Andam
// pela rua (os lados e a profundidade, entre a calçada e o meio-fio) e socam com A: o soco acerta os
// capangas logo à frente. Sem vida, o lutador sai; sem nenhum, fim de jogo.
#include "gerado/codigo_lutador.h"

#define CONTROLE v[0]
#define SOCO v[1] // Quadros que faltam no soco.
#define VELOCIDADE PX(1) + PX(1) / 2
#define TOPO_DA_RUA 128 // Pés: da calçada...
#define FUNDO_DA_RUA 216 // ...até a parte de baixo da tela.

enum { ANIM_PARADO, ANIM_ANDANDO, ANIM_SOCO };

void lutador_pronto(Ator *eu) {
	// O primeiro lutador da cena é o controle 1; o segundo, o 2.
	eu->CONTROLE = primeiro_ator(GRUPO_JOGADOR) == eu ? 1 : 2;
	eu->SOCO = 0;
}

void lutador_quadro(Ator *eu) {
	const u8 c = eu->CONTROLE;
	if (eu->vida <= 0) {
		remover_ator(eu);
		if (!primeiro_ator(GRUPO_JOGADOR)) {
			jogo_perdeu();
		}
		return;
	}
	if (eu->SOCO) {
		if (--eu->SOCO == 8) {
			// O meio do soco acerta quem estiver na frente, na mesma faixa da rua.
			for (Ator *alvo = NULL; (alvo = ator_na_area(eu, 14, 16, 18, 16, GRUPO_CAPANGA, alvo));) {
				if (ferir(alvo, 1, 20)) {
					alvo->vx = eu->direcao * PX(3);
					parar_jogo(3);
					tocar_som(SOM_PISAO);
					pontos += 50;
				}
			}
		}
		return;
	}
	eu->vx = botao_de(c, BOTAO_DIREITA) ? VELOCIDADE : botao_de(c, BOTAO_ESQUERDA) ? -(VELOCIDADE) : 0;
	eu->vy = botao_de(c, BOTAO_BAIXO) ? PX(1) : botao_de(c, BOTAO_CIMA) ? -PX(1) : 0;
	if (eu->vx) {
		virar(eu, eu->vx > 0 ? 1 : -1);
	}
	eu->x = clamp(eu->x + eu->vx, tela_x() > 0 ? PX(tela_x()) : 0, PX(mundo_largura() - 24));
	eu->y = clamp(eu->y + eu->vy, PX(TOPO_DA_RUA - 32), PX(FUNDO_DA_RUA - 32));
	if (apertou_de(c, BOTAO_A)) {
		eu->SOCO = 16;
		reiniciar_animacao(eu, ANIM_SOCO);
		return;
	}
	tocar_animacao(eu, (eu->vx || eu->vy) ? ANIM_ANDANDO : ANIM_PARADO);
	SPR_setDepth(eu->sprite, -PIXELS(eu->y)); // Quem está mais embaixo passa na frente.
}
""", encoding="utf-8")
	(pasta / "src" / "capanga.c").write_text("""// Capanga: vai atrás do jogador mais perto e, encostado, soca de vez em quando. Ao levar soco, é
// empurrado para trás; sem vida, some e dá pontos.
#include "gerado/codigo_capanga.h"

#define ESPERA v[0] // Quadros até o próximo soco.

enum { ANIM_PARADO, ANIM_ANDANDO, ANIM_SOCO };

static Ator *mais_perto(Ator *eu) {
	Ator *melhor = NULL;
	s16 menor = 32767;
	for (Ator *j = NULL; (j = proximo_ator(j, GRUPO_JOGADOR));) {
		const s16 d = abs(distancia_x(eu, j)) + abs(distancia_y(eu, j));
		if (d < menor) {
			menor = d;
			melhor = j;
		}
	}
	return melhor;
}

void capanga_pronto(Ator *eu) {
	eu->ESPERA = 60;
}

void capanga_quadro(Ator *eu) {
	if (eu->vida <= 0) {
		pontos += 200;
		remover_ator(eu);
		return;
	}
	// Recuo do soco que levou.
	if (eu->vx) {
		eu->x += eu->vx;
		eu->vx = eu->vx * 3 / 4;
		if (abs(eu->vx) < PX(1) / 4) {
			eu->vx = 0;
		}
		return;
	}
	Ator *alvo = mais_perto(eu);
	if (!alvo || !na_tela(eu)) {
		tocar_animacao(eu, ANIM_PARADO);
		return;
	}
	const s16 dx = distancia_x(eu, alvo), dy = distancia_y(eu, alvo);
	virar(eu, dx > 0 ? 1 : -1);
	if (abs(dx) > 22 || abs(dy) > 4) {
		eu->x += abs(dx) > 22 ? (dx > 0 ? PX(1) : -PX(1)) : 0;
		eu->y += abs(dy) > 4 ? (dy > 0 ? PX(1) / 2 : -PX(1) / 2) : 0;
		tocar_animacao(eu, ANIM_ANDANDO);
	} else if (eu->ESPERA) {
		eu->ESPERA--;
		tocar_animacao(eu, ANIM_PARADO);
	} else {
		reiniciar_animacao(eu, ANIM_SOCO);
		if (ferir(alvo, 1, 60)) {
			tocar_som(SOM_DANO);
		}
		eu->ESPERA = 70;
	}
	SPR_setDepth(eu->sprite, -PIXELS(eu->y));
}
""", encoding="utf-8")
	(pasta / "src" / "rua.c").write_text("""// Código da cena da rua: a vida dos dois jogadores e os pontos ficam no topo da tela.
#include "gerado/cena_rua.h"
#include "gerado/codigo_lutador.h"

void rua_atualizar(void) {
	if (quadro_do_jogo() % 10) {
		return;
	}
	char texto[41];
	Ator *j1 = primeiro_ator(GRUPO_JOGADOR);
	Ator *j2 = j1 ? proximo_ator(j1, GRUPO_JOGADOR) : NULL;
	sprintf(texto, "1P %d   2P %d   PONTOS %06lu ", j1 ? j1->vida : 0, j2 ? j2->vida : 0, pontos);
	VDP_drawText(texto, 1, 0);
}
""", encoding="utf-8")
	titulo(pasta, "Titulo", [("BRIGA DE RUA", 112, 56), ("CONTROLE 1 E 2 - A SOCA", 64, 80)], "res://rua.tscn")


if __name__ == "__main__":
	MODELOS.mkdir(exist_ok=True)
	visto_de_cima()
	nave()
	briga()
	(MODELOS / "LEIA-ME.md").write_text("""# Modelos de jogo

Projetos prontos que o gerenciador de projetos copia em "Novo projeto" → Modelo. O de plataforma é o
`retro_studio/jogo_padrao`. Estes são gerados por `retro_studio/tools/criar_modelos.py`; para mudar um
modelo, mude o script e rode de novo.

- `visto_de_cima/`: MDJogador no modo visto de cima, mapa com paredes, moedas e inimigos.
- `nave/`: nave com código C (MDAtor), tiros e inimigos criados pelo código, estrelas rolando.
- `briga_de_rua/`: dois jogadores (controles 1 e 2) com o mesmo código, capangas que perseguem.

Cada pasta tem um `modelo.cfg` com a cena principal e a descrição mostrada no gerenciador.
""", encoding="utf-8")
	print("Modelos gerados em", MODELOS)
