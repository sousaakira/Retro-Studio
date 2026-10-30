#!/usr/bin/env python3
# Gera a arte do jogo padrão (res/fundo.png, res/heroi.png e res/tiles.png) em PNG indexado de até 16 cores,
# o formato que o rescomp do SGDK converte sem requantizar. A cor 0 é a transparência.
# Uso: python3 tools/gerar_arte.py  (na pasta do jogo)
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent


def paleta(cores):
	# Cores em níveis do Mega Drive (0–7 por canal, ×36), completadas até 16.
	plana = []
	for r, g, b in cores:
		plana += [r * 36, g * 36, b * 36]
	plana += [0] * (48 - len(plana))
	return plana


def fundo():
	# PAL0. A cor 15 fica branca: é a cor do texto do SGDK (VDP_drawText).
	cores = [
		(0, 0, 0),  # 0 transparência
		(1, 2, 5),  # 1 céu alto
		(2, 3, 6),  # 2 céu
		(3, 5, 7),  # 3 céu baixo
		(4, 6, 7),  # 4 horizonte
		(2, 2, 4),  # 5 montanha longe
		(1, 1, 3),  # 6 montanha perto
		(1, 4, 1),  # 7 grama escura
		(2, 6, 2),  # 8 grama
		(4, 3, 1),  # 9 terra
		(3, 2, 1),  # 10 terra escura
		(6, 6, 4),  # 11 nuvem sombra
		(7, 7, 6),  # 12 nuvem
		(5, 4, 2),  # 13 pedra
		(0, 0, 0),  # 14 livre
		(7, 7, 7),  # 15 texto
	]
	largura, altura = 320, 224
	img = Image.new("P", (largura, altura), 1)
	img.putpalette(paleta(cores))
	px = img.load()
	chao = 176
	for y in range(chao):
		cor = 1 if y < 48 else 2 if y < 96 else 3 if y < 136 else 4
		for x in range(largura):
			px[x, y] = cor
	# Montanhas: duas camadas de triângulos.
	for base, altura_max, passo, cor in ((chao, 70, 96, 5), (chao, 44, 64, 6)):
		for x in range(largura):
			fase = x % passo
			h = altura_max - abs(fase - passo // 2) * altura_max * 2 // passo
			for y in range(base - max(0, h), base):
				px[x, y] = cor
	# Nuvens: elipses simples.
	for cx, cy, rx, ry in ((50, 40, 26, 9), (262, 34, 34, 10), (180, 76, 20, 7)):
		for y in range(cy - ry, cy + ry + 1):
			for x in range(cx - rx, cx + rx + 1):
				if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 and 0 <= x < largura:
					px[x, y] = 11 if y > cy + ry // 3 else 12
	# Sem chão: o chão vem do mapa (MDMapa), que rola por cima do fundo.
	for y in range(chao, altura):
		for x in range(largura):
			px[x, y] = 6
	img.save(RAIZ / "res" / "fundo.png", transparency=0)


def heroi():
	# PAL1. Folha 64×64: linha 0 = parado (2 quadros), linha 1 = andando (2 quadros), 32×32 cada.
	cores = [
		(0, 0, 0),  # 0 transparência
		(0, 0, 0),  # 1 contorno
		(7, 5, 3),  # 2 pele
		(6, 1, 1),  # 3 lenço
		(1, 2, 5),  # 4 roupa
		(2, 3, 7),  # 5 roupa clara
		(1, 1, 1),  # 6 cinto e botas
		(7, 7, 7),  # 7 olho
	]
	img = Image.new("P", (64, 64), 0)
	img.putpalette(paleta(cores))
	px = img.load()

	def ret(ox, oy, x0, y0, x1, y1, cor):
		for y in range(y0, y1):
			for x in range(x0, x1):
				px[ox + x, oy + y] = cor

	def quadro(ox, oy, respira, passo):
		r = respira
		ret(ox, oy, 11, 4 + r, 21, 13 + r, 1)  # cabeça (contorno)
		ret(ox, oy, 12, 5 + r, 20, 12 + r, 2)  # rosto
		ret(ox, oy, 16, 7 + r, 18, 9 + r, 7)  # olho
		ret(ox, oy, 11, 9 + r, 21, 11 + r, 3)  # lenço
		ret(ox, oy, 20, 9 + r, 24, 11 + r, 3)  # ponta do lenço
		ret(ox, oy, 10, 13 + r, 22, 23, 1)  # corpo (contorno)
		ret(ox, oy, 11, 14 + r, 21, 22, 4)  # roupa
		ret(ox, oy, 12, 15 + r, 15, 21, 5)  # brilho
		ret(ox, oy, 11, 19, 21, 20, 6)  # cinto
		pe_esq, pe_dir = (11, 17) if passo == 0 else ((9, 19) if passo == 1 else (13, 15))
		ret(ox, oy, pe_esq, 23, pe_esq + 4, 29, 4)  # pernas
		ret(ox, oy, pe_dir, 23, pe_dir + 4, 29, 4)
		ret(ox, oy, pe_esq - 1, 29, pe_esq + 5, 31, 6)  # botas
		ret(ox, oy, pe_dir - 1, 29, pe_dir + 5, 31, 6)

	quadro(0, 0, 0, 0)
	quadro(32, 0, 1, 0)
	quadro(0, 32, 0, 1)
	quadro(32, 32, 0, 2)
	img.save(RAIZ / "res" / "heroi.png", transparency=0)


def tiles():
	# PAL2. Atlas 64×16: tiles de 16×16 — grama, terra, bloco de plataforma e pedra.
	cores = [
		(0, 0, 0),  # 0 transparência
		(0, 0, 0),  # 1 contorno
		(2, 6, 2),  # 2 grama
		(1, 4, 1),  # 3 grama escura
		(4, 3, 1),  # 4 terra
		(3, 2, 1),  # 5 terra escura
		(6, 4, 2),  # 6 bloco
		(4, 2, 1),  # 7 bloco escuro
		(7, 6, 3),  # 8 bloco claro
		(4, 4, 4),  # 9 pedra
		(2, 2, 3),  # 10 pedra escura
		(6, 6, 6),  # 11 pedra clara
	]
	img = Image.new("P", (64, 16), 0)
	img.putpalette(paleta(cores))
	px = img.load()
	for y in range(16):
		for x in range(16):
			# Grama: borda verde em cima, terra embaixo.
			px[x, y] = (2 if (x + y) % 5 else 3) if y < 4 else 3 if y < 6 else (5 if ((x // 4) + (y // 4)) % 2 else 4)
			# Terra.
			px[16 + x, y] = 5 if ((x // 4) + (y // 4)) % 2 else 4
			# Bloco com relevo.
			borda = x in (0, 15) or y in (0, 15)
			px[32 + x, y] = 1 if borda else 8 if x == 1 or y == 1 else 7 if x == 14 or y == 14 else 6
			# Pedra.
			px[48 + x, y] = 10 if borda else 11 if (x * 3 + y * 5) % 11 == 0 else 9
	img.save(RAIZ / "res" / "tiles.png", transparency=0)


if __name__ == "__main__":
	fundo()
	heroi()
	tiles()
	print("res/fundo.png, res/heroi.png e res/tiles.png gerados.")
