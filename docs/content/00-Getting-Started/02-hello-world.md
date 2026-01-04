---
title: Seu Primeiro Programa - Hello World
description: Crie e execute seu primeiro programa no Mega Drive
---

# 👋 Seu Primeiro Programa - Hello World

Vamos criar o programa mais simples: exibir "Hello World!" na tela do Mega Drive.

## Estrutura do Projeto

Crie uma pasta chamada `hello-world` com essa estrutura:

```
hello-world/
├── src/
│   └── main.c
├── Makefile
└── README.md
```

## Passo 1: Criar o Arquivo Makefile

O Makefile controla como seu programa é compilado. Crie `Makefile` na raiz do projeto:

```makefile
# Usar SGDK instalado
export SGDK_PATH ?= ~/SGDK

# Nome do projeto
TARGET = helloworld
OBJECT = obj
SRCDIR = src

# Compilador e flags
CC = m68k-elf-gcc
AR = m68k-elf-ar
LD = m68k-elf-ld
AS = m68k-elf-as

# Arquivos de origem
CSOURCES = $(wildcard $(SRCDIR)/*.c)
ASOURCES = $(wildcard $(SRCDIR)/*.s)
COBJS = $(CSOURCES:$(SRCDIR)/%.c=$(OBJECT)/%.o)
AOBJS = $(ASOURCES:$(SRCDIR)/%.s=$(OBJECT)/%.o)
OBJS = $(COBJS) $(AOBJS)

# Flags de compilação
CFLAGS = -m68000 -Wall -O2 -fomit-frame-pointer -fno-strict-aliasing
CFLAGS += -I$(SGDK_PATH)/inc
LDFLAGS = -T$(SGDK_PATH)/md.ld -Map=$(TARGET).map

# Alvo padrão
all: $(TARGET).bin

# Criar diretório de objetos
$(OBJECT):
	mkdir -p $(OBJECT)

# Compilar arquivos C
$(OBJECT)/%.o: $(SRCDIR)/%.c | $(OBJECT)
	$(CC) $(CFLAGS) -c $< -o $@

# Compilar arquivo final
$(TARGET).bin: $(OBJS)
	$(LD) $(LDFLAGS) $(OBJS) $(SGDK_PATH)/lib/*.a -o $(TARGET).elf
	m68k-elf-objcopy -O binary $(TARGET).elf $(TARGET).bin

# Limpar
clean:
	rm -rf $(OBJECT) $(TARGET).elf $(TARGET).bin $(TARGET).map

.PHONY: all clean
```

## Passo 2: Criar o Código C

Crie `src/main.c`:

```c
#include <genesis.h>

/*
 * Main Function
 * 
 * O ponto de entrada de todo programa SGDK.
 * Chamada automaticamente quando o console liga.
 */
int main(u16 hard)
{
    /* 
     * hard = 1 significa reset por hardware (console ligado)
     * hard = 0 significa reset por software (dentro do jogo)
     */

    /* Parar a CPU de som (Z80) para evitar conflitos */
    Z80_requestBus(TRUE);

    /* Inicializar o VDP (Video Display Processor) */
    VDP_setScreenWidth(320);  /* Modo H40 (320 pixels) */
    VDP_setScreenHeight(224); /* NTSC (224 linhas) */
    VDP_setPalette(PAL0, (u16*)&palette_black);

    /* Ativar display */
    VDP_setEnable(TRUE);

    /* Liberar Z80 */
    Z80_releaseBus();

    /* Escrever "Hello World!" na posição (1, 1) */
    VDP_drawText("Hello World!", 1, 1);

    /* Loop principal - mantém o jogo rodando */
    while(TRUE)
    {
        /* Processar eventos de VSync (sincronização vertical) */
        VSync();
    }

    return 0;
}
```

## Passo 3: Compilar

Abra o terminal/prompt de comando na pasta do projeto e execute:

### Windows (Command Prompt ou PowerShell)
```bash
make
```

### Mac/Linux
```bash
make
```

Se tudo der certo, você verá:
```
linking helloworld.elf
```

E um arquivo `helloworld.bin` será criado! 🎉

## Passo 4: Testar no Emulador

Use um emulador como **Gens KMod** ou **BlastEm**:

1. Abra o arquivo `helloworld.bin`
2. Você deve ver:

```
┌─────────────────────┐
│                     │
│                     │
│   Hello World!      │
│                     │
│                     │
└─────────────────────┘
```

## Entendendo o Código

### Função Main
```c
int main(u16 hard)
```
- Função de entrada do programa
- `hard` indica tipo de reset (1 = hard reset, 0 = soft reset)

### Inicialização VDP
```c
VDP_setScreenWidth(320);    /* Define largura como 320px (H40) */
VDP_setScreenHeight(224);   /* Define altura como 224px (NTSC) */
VDP_setEnable(TRUE);        /* Liga o display */
```

### Desenhar Texto
```c
VDP_drawText("Hello World!", 1, 1);
```
- Posição X = 1 (coluna)
- Posição Y = 1 (linha)
- O VDP já possui uma fonte padrão

### Loop Principal
```c
while(TRUE)
{
    VSync();  /* Espera sincronização vertical */
}
```
- `VSync()` aguarda o VDP completar o desenho de um frame
- Mantém o programa rodando eternamente

## Próximos Passos

Agora que você tem um programa funcionando:

1. **[Estrutura do Projeto](./03-estrutura-projeto.md)** - Entenda como os projetos SGDK são organizados
2. **[Entendo o VDP](../01-core-concepts/01-vdp-basico.md)** - Aprenda sobre o sistema de gráficos
3. **[Sprites e Movimento](../02-practical/01-sprites.md)** - Crie objetos que se movem

---

## Troubleshooting

### Erro: "make: comando não encontrado"
- No Windows, você pode estar usando PowerShell
- Use Command Prompt (`cmd`) em vez disso
- Ou instale MinGW/MSYS

### Erro: "m68k-elf-gcc: comando não encontrado"
- O SGDK não foi adicionado ao PATH corretamente
- Revise a [seção de Instalação](./01-instalacao.md)

### Emulador abre mas não mostra nada
- Verifique se o arquivo foi compilado (deve existir `.bin`)
- Tente outro emulador (Gens KMod, BlastEm, etc)
