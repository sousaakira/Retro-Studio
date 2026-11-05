// Teste do save (SRAM) e da senha do jogo.c gerado, no computador: o testar_jogos.sh recorta essas funções
// do jogo.c (save_part.c) e este arquivo as compila com tipos e uma SRAM de mentira.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int16_t s16;
typedef int bool;
#define TRUE 1
#define FALSE 0
enum { CENA_A, CENA_B, CENA_C, CENAS_TOTAL };
#define JOGO_VARS 16
#define JOGO_SLOTS 3
#define JOGO_SENHA_LETRAS 8

static u8 sram[65536];
static int sram_modo; // 0 desligada, 1 só leitura, 2 leitura e escrita.
static int falhas;
void SRAM_enable(void) { sram_modo = 2; }
void SRAM_enableRO(void) { sram_modo = 1; }
void SRAM_disable(void) { sram_modo = 0; }
u8 SRAM_readByte(u32 o) {
	if (!sram_modo) {
		printf("leitura com a SRAM desligada\n");
		falhas++;
	}
	return sram[o];
}
void SRAM_writeByte(u32 o, u8 v) {
	if (sram_modo != 2) {
		printf("escrita sem a SRAM ligada para escrita\n");
		falhas++;
	}
	sram[o] = v;
}

u8 vidas;
u32 pontos;
u16 jogo_var[JOGO_VARS];
u8 jogo_slot;
static u16 cena_atual, cena_proxima;
static bool recarregar;

#include "save_part.c"

#define CONFERIR(c) \
	do { \
		if (!(c)) { \
			printf("FALHOU: %s (linha %d)\n", #c, __LINE__); \
			falhas++; \
		} \
	} while (0)

int main(void) {
	CONFERIR(!jogo_tem_save(0));
	CONFERIR(!jogo_carregar(0));
	cena_atual = 2;
	vidas = 5;
	pontos = 123456;
	for (int i = 0; i < 16; i++) {
		jogo_var[i] = i * 1000 + 7;
	}
	CONFERIR(jogo_salvar(1));
	CONFERIR(jogo_tem_save(1));
	CONFERIR(!jogo_tem_save(0));
	vidas = 0;
	pontos = 0;
	memset(jogo_var, 0, sizeof(jogo_var));
	cena_proxima = 0;
	CONFERIR(jogo_carregar(1));
	CONFERIR(vidas == 5 && pontos == 123456 && jogo_var[15] == 15007 && cena_proxima == 2 && recarregar && jogo_slot == 1);
	sram[1 * 64 + 5] ^= 1; // Slot estragado: a soma recusa.
	CONFERIR(!jogo_tem_save(1));
	jogo_salvar(1);
	jogo_apagar_save(1);
	CONFERIR(!jogo_tem_save(1));
	CONFERIR(!jogo_salvar(3));
	char t[9];
	int certas = 0, total = 0;
	for (int c = 1; c < 3; c++) {
		for (int v = 0; v < 16; v += 3) {
			for (u32 p = 0; p < 10000000; p = p * 7 + 13) {
				cena_atual = c;
				vidas = v;
				pontos = p;
				jogo_senha(t);
				total++;
				vidas = 99;
				pontos = 1;
				cena_proxima = 0;
				if (strlen(t) == 8 && jogo_usar_senha(t) && cena_proxima == c && vidas == v && pontos == (p / 10) * 10) {
					certas++;
				}
			}
		}
	}
	CONFERIR(certas == total);
	cena_atual = 1;
	vidas = 3;
	pontos = 500;
	jogo_senha(t);
	const char *letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	int aceitas = 0;
	for (int i = 0; i < 8; i++) {
		for (int k = 0; k < 32; k++) {
			char u[9];
			strcpy(u, t);
			if (u[i] == letras[k]) {
				continue;
			}
			u[i] = letras[k];
			aceitas += jogo_usar_senha(u);
		}
	}
	CONFERIR(aceitas == 0);
	CONFERIR(!jogo_usar_senha("AAAAAAA1"));
	printf(falhas ? "%d falha(s)\n" : "save e senha: %d senhas conferidas\n", falhas ? falhas : total);
	return falhas != 0;
}
