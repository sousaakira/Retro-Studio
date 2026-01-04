---
title: Texto Colorido na Tela
description: Seu primeiro projeto - exibir texto com cores diferentes
---

# 🎨 Projeto 1: Texto Colorido na Tela

**Dificuldade**: 🟢 Beginner  
**Tempo**: ~10 minutos  
**Conceitos**: VDP, Paletas de Cores, drawText

## Objetivo

Exibir texto em cores diferentes na tela do Mega Drive.

## Setup do Projeto

### Estrutura de Pastas

```
texto-colorido/
├── src/
│   └── main.c
├── Makefile
└── README.md
```

## Código Completo

### Makefile

```makefile
export SGDK_PATH ?= ~/SGDK

TARGET = textocolorido
OBJECT = obj
SRCDIR = src

CC = m68k-elf-gcc
AR = m68k-elf-ar
LD = m68k-elf-ld

CSOURCES = $(wildcard $(SRCDIR)/*.c)
ASOURCES = $(wildcard $(SRCDIR)/*.s)
COBJS = $(CSOURCES:$(SRCDIR)/%.c=$(OBJECT)/%.o)
AOBJS = $(ASOURCES:$(SRCDIR)/%.s=$(OBJECT)/%.o)
OBJS = $(COBJS) $(AOBJS)

CFLAGS = -m68000 -Wall -O2 -fomit-frame-pointer -fno-strict-aliasing
CFLAGS += -I$(SGDK_PATH)/inc
LDFLAGS = -T$(SGDK_PATH)/md.ld

all: $(TARGET).bin

$(OBJECT):
	mkdir -p $(OBJECT)

$(OBJECT)/%.o: $(SRCDIR)/%.c | $(OBJECT)
	$(CC) $(CFLAGS) -c $< -o $@

$(TARGET).bin: $(OBJS)
	$(LD) $(LDFLAGS) $(OBJS) $(SGDK_PATH)/lib/*.a -o $(TARGET).elf
	m68k-elf-objcopy -O binary $(TARGET).elf $(TARGET).bin

clean:
	rm -rf $(OBJECT) $(TARGET).elf $(TARGET).bin

.PHONY: all clean
```

### src/main.c

```c
#include <genesis.h>

/*
 * PROJETO 1: TEXTO COLORIDO NA TELA
 * 
 * Exibe texto em 4 cores diferentes usando paletas
 */

int main(u16 hard)
{
    /* ========================================
     * PASSO 1: Setup Inicial
     * ======================================== */
    
    /* Parar Z80 (processador de som) */
    Z80_requestBus(TRUE);
    
    /* Configurar resolução da tela */
    VDP_setScreenWidth(320);    /* Modo H40 (320 pixels) */
    VDP_setScreenHeight(224);   /* NTSC (224 linhas) */
    
    
    /* ========================================
     * PASSO 2: Criar Paleta de Cores
     * ======================================== */
    
    /* Criar array com cores (máximo 16 por paleta) */
    u16 paleta_colorida[] = {
        RGB(0, 0, 0),  /* Índice 0: Preto (transparente) */
        RGB(7, 0, 0),  /* Índice 1: Vermelho puro */
        RGB(0, 7, 0),  /* Índice 2: Verde puro */
        RGB(0, 0, 7),  /* Índice 3: Azul puro */
        RGB(7, 7, 0),  /* Índice 4: Amarelo */
        RGB(7, 0, 7),  /* Índice 5: Magenta */
        RGB(0, 7, 7),  /* Índice 6: Ciano */
        RGB(7, 7, 7),  /* Índice 7: Branco */
    };
    
    /* Carregar paleta na memória do VDP */
    VDP_setPalette(PAL0, paleta_colorida);
    
    
    /* ========================================
     * PASSO 3: Ativar Display
     * ======================================== */
    
    VDP_setEnable(TRUE);
    
    /* Liberar Z80 */
    Z80_releaseBus();
    
    
    /* ========================================
     * PASSO 4: Desenhar Texto
     * ======================================== */
    
    /* VDP_drawText(texto, x, y)
     * x e y são em COLUNAS e LINHAS (não pixels!)
     * Máximo: 40 colunas x 28 linhas
     */
    
    /* Linha 1: Título em branco */
    VDP_setTextPalette(PAL0);
    VDP_drawText("=== TEXTO COLORIDO ===", 8, 3);
    
    /* Linha 5: Texto em vermelho */
    VDP_drawText("Este texto é VERMELHO", 9, 5);
    
    /* Linha 7: Texto em verde */
    VDP_drawText("Este texto é VERDE", 10, 7);
    
    /* Linha 9: Texto em azul */
    VDP_drawText("Este texto é AZUL", 11, 9);
    
    /* Linha 11: Texto em amarelo */
    VDP_drawText("Este texto é AMARELO", 9, 11);
    
    /* Linha 13: Informações */
    VDP_drawText("Cores disponíveis: 512", 8, 20);
    VDP_drawText("Paletas: 4 (cada uma com 16 cores)", 5, 22);
    
    
    /* ========================================
     * PASSO 5: Loop Principal
     * ======================================== */
    
    /* Este loop mantém o programa rodando */
    while(TRUE)
    {
        /* VSync() sincroniza com o refresh da tela
         * Importante para evitar flickering e garantir
         * que as mudanças apareçam suavemente
         */
        VSync();
    }
    
    return 0;
}
```

## Compilação e Execução

### Compilar

```bash
cd texto-colorido
make
```

### Executar

Abra o arquivo `textocolorido.bin` no seu emulador (Gens KMod, BlastEm, etc)

### Esperado

Você deve ver uma tela com:
- Título em branco
- Várias linhas com textos em cores diferentes
- Informações sobre paletas

---

## Entendendo o Código

### RGB(R, G, B)

```c
RGB(7, 0, 0)  /* Vermelho máximo */
RGB(0, 7, 0)  /* Verde máximo */
RGB(0, 0, 7)  /* Azul máximo */
```

Cada componente vai de **0 a 7** (não 0-255!)

### VDP_setPalette()

```c
VDP_setPalette(PAL0, meus_dados);
```

- `PAL0` até `PAL3` = 4 paletas disponíveis
- Cada paleta tem até 16 cores
- Primeira cor (índice 0) é sempre transparente

### VDP_drawText()

```c
VDP_drawText("Texto", 10, 5);
```

- Primeiro argumento: string (texto)
- Segundo: coluna (0-39)
- Terceiro: linha (0-27)

---

## Modificações e Aprendizado

### Desafio 1️⃣ (Fácil)
Mude as posições dos textos. Por exemplo:
```c
VDP_drawText("Vermelho", 0, 10);   /* Mais à esquerda */
VDP_drawText("Verde", 35, 10);     /* Mais à direita */
```

### Desafio 2️⃣ (Médio)
Crie novas cores:
```c
u16 paleta_pastel[] = {
    RGB(0, 0, 0),
    RGB(7, 3, 3),  /* Vermelho pastel */
    RGB(3, 7, 3),  /* Verde pastel */
    RGB(3, 3, 7),  /* Azul pastel */
};
```

### Desafio 3️⃣ (Difícil)
Crie um loop que desenha números em diferentes cores:
```c
for(u8 i = 0; i < 8; i++)
{
    VDP_drawText("Cor ", 5, 5 + i);
    /* Desenhe o número i */
}
```

---

## Dicas Importantes

✅ Sempre use `Z80_requestBus(TRUE)` e `Z80_releaseBus()`  
✅ `VSync()` é essencial no loop principal  
✅ Primeira cor de uma paleta é sempre transparente  
✅ Cores usam RGB(0-7, 0-7, 0-7), não 0-255  
✅ Você pode ter até 4 paletas (16 cores cada)

---

## Próximo Projeto

Quando estiver confortável com isso, vá para:
**[Quadrado Que Se Move](./02-quadrado-movimento.md)**

Lá você aprenderá sobre sprites e movimento! 🎮

---

## Solução dos Desafios

### Desafio 1 - Posições
```c
VDP_drawText("VERMELHO", 0, 10);
VDP_drawText("VERDE", 35, 10);
VDP_drawText("AZUL", 15, 15);
```

### Desafio 2 - Cores Pastel
```c
u16 paleta_pastel[] = {
    RGB(0, 0, 0),  /* Preto */
    RGB(7, 3, 3),  /* Vermelho pastel */
    RGB(3, 7, 3),  /* Verde pastel */
    RGB(3, 3, 7),  /* Azul pastel */
    RGB(7, 7, 3),  /* Amarelo pastel */
    RGB(7, 3, 7),  /* Magenta pastel */
    RGB(3, 7, 7),  /* Ciano pastel */
};

VDP_setPalette(PAL0, paleta_pastel);
```

### Desafio 3 - Loop de Cores
```c
for(u8 i = 1; i < 8; i++)
{
    char buffer[20];
    sprintf(buffer, "Cor %d", i);
    VDP_drawText(buffer, 5, 5 + i);
}
```
