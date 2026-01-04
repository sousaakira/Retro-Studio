---
title: VDP Básico
description: Entenda o Video Display Processor - o coração dos gráficos do Mega Drive
---

# 📺 VDP Básico - Video Display Processor

O **VDP** é um chip especializado em renderizar gráficos. Ele é responsável por tudo que aparece na tela.

## O que o VDP Faz?

```
┌─────────────────────────────────┐
│   VRAM (64 KB)                  │
│   - Armazena tiles              │
│   - Armazena dados de planos    │
│   - Armazena dados de sprites   │
└────────────┬────────────────────┘
             │
       ┌─────▼─────┐
       │    VDP    │  ◄─ Le dados
       └─────┬─────┘     e renderiza
             │
       ┌─────▼──────────────────┐
       │  Tela (320x224 pixels) │
       └────────────────────────┘
```

## Estrutura do VDP

O VDP trabalha com 4 componentes principais:

### 1. **VRAM (Video RAM)**
Memória de 64 KB onde ficam os gráficos

```c
/* Dados são organizados em: */
- Tile Data       (gráficos 8x8 pixels)
- Pattern Tables  (arranjo de tiles)
- Sprite Table    (dados de sprites)
- Scroll Tables   (posição de scroll)
```

### 2. **CRAM (Color RAM)**
128 bytes para armazenar **4 paletas de cores** (16 cores cada)

```c
/* Cada cor usa 2 bytes (16 bits) */
/* Formato: 0BBBGGGRRR */
/*   B = Blue   (0-7)   */
/*   G = Green  (0-7)   */
/*   R = Red    (0-7)   */

Exemplo: Cor vermelha pura = 0x000E (ou em SGDK: RGB(7,0,0))
```

### 3. **VSRAM (Vertical Scroll RAM)**
80 bytes para dados de scroll vertical

### 4. **Registradores**
24 registradores que controlam comportamento do VDP

---

## Exemplo Prático 1: Mudar Cor de Fundo

```c
#include <genesis.h>

int main(u16 hard)
{
    /* Parar Z80 para evitar conflitos */
    Z80_requestBus(TRUE);

    /* Inicializar display */
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);

    /* Definir cor de fundo como VERDE */
    u16 cor_verde = RGB(0, 7, 0);  /* R=0, G=7, B=0 */
    VDP_setPalette(PAL0, &cor_verde);
    
    /* Ativar display */
    VDP_setEnable(TRUE);

    Z80_releaseBus();

    /* Escrever texto branco */
    VDP_drawText("Fundo Verde!", 5, 5);

    /* Loop principal */
    while(TRUE)
    {
        VSync();
    }

    return 0;
}
```

---

## Exemplo Prático 2: Criar uma Paleta Personalizada

```c
#include <genesis.h>

int main(u16 hard)
{
    /* Criar uma paleta com 4 cores */
    u16 minhas_cores[] = {
        RGB(0, 0, 0),  /* Preto (índice 0) - sempre transparente */
        RGB(7, 0, 0),  /* Vermelho puro */
        RGB(0, 7, 0),  /* Verde puro */
        RGB(0, 0, 7),  /* Azul puro */
    };

    Z80_requestBus(TRUE);
    
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    
    /* Carregar paleta customizada */
    VDP_setPalette(PAL0, minhas_cores);
    VDP_setPalette(PAL1, minhas_cores);
    
    VDP_setEnable(TRUE);

    Z80_releaseBus();

    /* Linha 1: Texto em vermelho */
    VDP_setTextPlane(PLAN_A);
    VDP_setTextPalette(PAL1);
    VDP_drawText("VERMELHO", 10, 5);

    /* Linha 2: Texto em verde */
    VDP_setTextPalette(PAL1);
    VDP_drawText("VERDE", 10, 7);

    /* Linha 3: Texto em azul */
    VDP_setTextPalette(PAL1);
    VDP_drawText("AZUL", 10, 9);

    while(TRUE)
    {
        VSync();
    }

    return 0;
}
```

---

## Exemplo Prático 3: Trabalhar com Tiles

Tiles são blocos de 8x8 pixels. Eles são a unidade básica de gráficos no Mega Drive.

```c
#include <genesis.h>

/* Definir uma tile (8x8 pixels) como padrão */
u32 tile_xadrez[8] = {
    0xAAAAAAAA,  /* 1010 1010 1010 1010 (4 pixels por u32) */
    0x55555555,  /* 0101 0101 0101 0101 */
    0xAAAAAAAA,
    0x55555555,
    0xAAAAAAAA,
    0x55555555,
    0xAAAAAAAA,
    0x55555555,
};

int main(u16 hard)
{
    Z80_requestBus(TRUE);

    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);

    /* Carregar tile na VRAM no índice 1 */
    VDP_loadTileData(tile_xadrez, 1, 1, TRUE);

    VDP_setEnable(TRUE);

    Z80_releaseBus();

    /* Agora você poderia usar essa tile em backgrounds ou sprites */
    VDP_drawText("Tile carregada!", 5, 5);

    while(TRUE)
    {
        VSync();
    }

    return 0;
}
```

---

## Funções VDP Mais Comuns

| Função | O que faz |
|--------|-----------|
| `VDP_setScreenWidth()` | Define largura (256 ou 320) |
| `VDP_setScreenHeight()` | Define altura (224 ou 240) |
| `VDP_setEnable()` | Liga/desliga display |
| `VDP_setPalette()` | Carrega paleta de cores |
| `VDP_setTextPlane()` | Define plano para texto (PLAN_A/PLAN_B) |
| `VDP_drawText()` | Escreve texto na tela |
| `VDP_setTextPalette()` | Define paleta para texto |
| `VDP_clearPlane()` | Limpa um plano |
| `VDP_fillTileMapRect()` | Preenche área com tile |
| `VDP_loadTileData()` | Carrega tile para VRAM |
| `VSync()` | Sincroniza com vertical blank |

---

## Coordenadas e Posições

```c
/*
 * Modo de texto: Posições em COLUNAS e LINHAS
 * 40 colunas x 28 linhas (em H40 mode)
 */

VDP_drawText("Texto", 0, 0);    /* Canto superior-esquerdo */
VDP_drawText("Texto", 19, 13);  /* Centro da tela */
VDP_drawText("Texto", 39, 27);  /* Canto inferior-direito */

/*
 * Modo gráfico: Posições em PIXELS
 * 320 x 224 pixels
 */

/* Você verá mais sobre isso em sprites e backgrounds */
```

---

## Exemplo Prático 4: Paleta Gradiente

```c
#include <genesis.h>

int main(u16 hard)
{
    /* Criar gradiente de tons vermelhos */
    u16 gradiente[] = {
        RGB(0, 0, 0),  /* Preto */
        RGB(1, 0, 0),  /* Vermelho escuro */
        RGB(3, 0, 0),  /* Vermelho médio */
        RGB(5, 0, 0),  /* Vermelho claro */
        RGB(7, 0, 0),  /* Vermelho puro */
    };

    Z80_requestBus(TRUE);
    
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setPalette(PAL0, gradiente);
    
    VDP_setEnable(TRUE);
    Z80_releaseBus();

    /* Desenhar linhas com cores diferentes */
    for(u8 i = 0; i < 5; i++)
    {
        VDP_setTextPalette(PAL0);
        VDP_drawText("█████████", 5, 5 + i);
    }

    while(TRUE)
    {
        VSync();
    }

    return 0;
}
```

---

## Próximo Capítulo

Agora que você entende o VDP básico, vamos aprender sobre:
- **[Paletas de Cores](./02-paletas.md)** - Sistema completo de cores
- **[Sprites](./03-sprites.md)** - Objetos móveis
- **[Backgrounds](./04-backgrounds.md)** - Planos de fundo complexos

---

## Dicas Importantes

✅ **Sempre chame `Z80_requestBus()` antes de modificar VDP**  
✅ **Sempre chame `Z80_releaseBus()` depois**  
✅ **Use `VSync()` para sincronizar com tela**  
✅ **Cor 0 é sempre transparente em tiles e sprites**  
✅ **Máximo de 4 paletas (0-3), cada uma com 16 cores**

---

## Referência Rápida

```c
/* Setup básico */
Z80_requestBus(TRUE);
VDP_setScreenWidth(320);
VDP_setScreenHeight(224);
VDP_setPalette(PAL0, cores);
VDP_setEnable(TRUE);
Z80_releaseBus();

/* Draw text */
VDP_drawText("Texto", 10, 5);

/* Sync */
while(TRUE) VSync();
```
