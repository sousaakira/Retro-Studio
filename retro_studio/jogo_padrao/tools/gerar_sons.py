#!/usr/bin/env python3
# Gera os sons do jogo padrão: efeitos em WAV (pulo, dano, moeda e pisão) e duas músicas em VGM só com o PSG
# (SN76489), que o rescomp converte para XGM.
# Uso: python3 tools/gerar_sons.py  (na pasta do jogo)
import random
import struct
import wave
from pathlib import Path

SOM = Path(__file__).resolve().parent.parent / "som"
TAXA_WAV = 14000


def gravar_wav(nome, amostras):
	with wave.open(str(SOM / nome), "wb") as arquivo:
		arquivo.setnchannels(1)
		arquivo.setsampwidth(1)
		arquivo.setframerate(TAXA_WAV)
		arquivo.writeframes(bytes(max(0, min(255, int(128 + a * 110))) for a in amostras))


def pulo():
	# Onda quadrada subindo de 300 a 900 Hz.
	total = int(TAXA_WAV * 0.16)
	fase = 0.0
	for i in range(total):
		t = i / total
		fase += (300 + 600 * t) / TAXA_WAV
		yield (1 if fase % 1 < 0.5 else -1) * (1 - t)


def dano():
	# Ruído que vai ficando grave (cada valor se repete por mais amostras) e some.
	random.seed(7)
	total = int(TAXA_WAV * 0.4)
	valor, contador = 0.0, 0
	for i in range(total):
		t = i / total
		if contador <= 0:
			valor = random.uniform(-1, 1)
			contador = 1 + int(t * 12)
		contador -= 1
		yield valor * (1 - t)


def moeda():
	# Duas notas agudas em sequência (si e mi), em onda quadrada.
	total = int(TAXA_WAV * 0.22)
	fase = 0.0
	for i in range(total):
		t = i / total
		fase += (988 if t < 0.3 else 1319) / TAXA_WAV
		yield (1 if fase % 1 < 0.5 else -1) * 0.8 * (1 - t * 0.7)


def pisao():
	# Onda quadrada descendo rápido de 500 a 120 Hz.
	total = int(TAXA_WAV * 0.14)
	fase = 0.0
	for i in range(total):
		t = i / total
		fase += (500 - 380 * t) / TAXA_WAV
		yield (1 if fase % 1 < 0.5 else -1) * (1 - t)


# ---- VGM com o PSG ----

CLOCK_PSG = 3579545
NOTAS = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def periodo(nota):
	nome, oitava = nota[:-1], int(nota[-1])
	frequencia = 440 * 2 ** ((NOTAS[nome] + 12 * (oitava - 4) - 9) / 12)
	return max(1, min(1023, round(CLOCK_PSG / (32 * frequencia))))


def musica(vozes, quadros_por_tempo):
	# vozes: uma lista por canal de tom com (nota ou None, duração em tempos). Toca em repetição.
	eventos = {}
	for canal, voz in enumerate(vozes):
		quadro = 0
		for nota, tempos in voz:
			duracao = int(tempos * quadros_por_tempo)
			comandos = eventos.setdefault(quadro, [])
			if nota is None:
				comandos.append(0x90 | canal << 5 | 0x0F)
			else:
				p = periodo(nota)
				comandos += [0x80 | canal << 5 | (p & 15), p >> 4, 0x90 | canal << 5 | (3 if canal == 0 else 6)]
			# Solta a nota um pouco antes da próxima.
			eventos.setdefault(quadro + max(1, duracao - 2), []).append(0x90 | canal << 5 | 0x0F)
			quadro += duracao
	fim = max(sum(int(t * quadros_por_tempo) for _, t in voz) for voz in vozes)
	dados = bytearray()
	for canal in range(4):
		dados += bytes([0x50, 0x90 | canal << 5 | 0x0F])
	for quadro in range(fim):
		for comando in eventos.get(quadro, []):
			dados += bytes([0x50, comando])
		dados.append(0x62)  # Espera 1/60 s.
	dados.append(0x66)
	cabecalho = bytearray(0x40)
	cabecalho[0:4] = b"Vgm "
	struct.pack_into("<I", cabecalho, 0x04, len(cabecalho) + len(dados) - 4)
	struct.pack_into("<I", cabecalho, 0x08, 0x150)
	struct.pack_into("<I", cabecalho, 0x0C, CLOCK_PSG)
	struct.pack_into("<I", cabecalho, 0x18, fim * 735)
	struct.pack_into("<I", cabecalho, 0x1C, 0x40 + 8 - 0x1C)  # Repete depois dos 4 comandos de silêncio do início.
	struct.pack_into("<I", cabecalho, 0x20, fim * 735)
	struct.pack_into("<I", cabecalho, 0x24, 60)
	struct.pack_into("<HB", cabecalho, 0x28, 0x0009, 16)
	struct.pack_into("<I", cabecalho, 0x2C, 7670453)
	struct.pack_into("<I", cabecalho, 0x34, 0x40 - 0x34)
	return bytes(cabecalho + dados)


TITULO = [
	[("E5", 1), ("G5", 1), ("C6", 2), ("B5", 1), ("G5", 1), ("A5", 2), ("F5", 1), ("A5", 1), ("D6", 2), ("C6", 1), ("B5", 1), ("G5", 2)],
	[("C3", 2), ("G3", 2), ("F3", 2), ("C3", 2), ("D3", 2), ("A3", 2), ("G3", 2), ("G3", 2)],
]

FASE = [
	[("C5", 0.5), ("E5", 0.5), ("G5", 0.5), ("E5", 0.5), ("A5", 1), ("G5", 1), ("F5", 0.5), ("E5", 0.5), ("D5", 0.5), ("E5", 0.5), ("C5", 2),
	 ("C5", 0.5), ("E5", 0.5), ("G5", 0.5), ("C6", 0.5), ("B5", 1), ("G5", 1), ("A5", 0.5), ("G5", 0.5), ("F5", 0.5), ("D5", 0.5), ("C5", 2)],
	[("C3", 1), ("C3", 1), ("F3", 1), ("F3", 1), ("G3", 1), ("G3", 1), ("C3", 1), (None, 1),
	 ("C3", 1), ("C3", 1), ("E3", 1), ("E3", 1), ("F3", 1), ("G3", 1), ("C3", 1), (None, 1)],
]

SOM.mkdir(exist_ok=True)
gravar_wav("pulo.wav", pulo())
gravar_wav("dano.wav", dano())
gravar_wav("moeda.wav", moeda())
gravar_wav("pisao.wav", pisao())
(SOM / "titulo.vgm").write_bytes(musica(TITULO, 24))
(SOM / "fase.vgm").write_bytes(musica(FASE, 14))
print("Sons gerados em", SOM)
