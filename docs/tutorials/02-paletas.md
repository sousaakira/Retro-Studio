---
title: Trabalhando com Paletas de Cores
description: Aprenda a carregar e manipular paletas no SGDK
tags: [paletas, cores, graphics, tutorial]
---

# Trabalhando com Paletas de Cores

As **paletas** definem os 16 ou 64 cores que podem ser usadas na tela do Mega Drive.

## Formato JASC-PAL

O formato mais comum é o **JASC-PAL**:

```
JASC-PAL
0100
16
0 0 0
255 255 255
255 0 0
...
```

- **Linha 1**: Identificador `JASC-PAL`
- **Linha 2**: Versão `0100`
- **Linha 3**: Número de cores (16, 32, 48 ou 64)
- **Linhas restantes**: Valores RGB (0-255) para cada cor

## Carregando uma Paleta

Para carregar uma paleta no seu código C:

```c
#include <genesis.h>

// Inclua o arquivo de recursos
#include "resources.h"

int main() {
    VDP_init();
    
    // Carregar paleta para PAL0
    PAL_setPalette(PAL0, my_palette.data, CPU);
    
    // Ou usar DMA (mais rápido)
    PAL_setPalette(PAL0, my_palette.data, DMA);
    
    return 0;
}
```

## Múltiplas Paletas

O Mega Drive possui 4 slots de paleta (PAL0, PAL1, PAL2, PAL3):

```c
// Carregar diferentes paletas
PAL_setPalette(PAL0, palette_player.data, CPU);
PAL_setPalette(PAL1, palette_enemy.data, CPU);
PAL_setPalette(PAL2, palette_background.data, CPU);
PAL_setPalette(PAL3, palette_ui.data, CPU);
```

## Alterando Cores Individuais

Para mudar uma cor específica:

```c
// Mudar a cor 5 da PAL0 para vermelho
u16 red_color = 0x0E00;  // Formato VDP
PAL_setColor(PAL0, 5, red_color);
```

## Fading (Desvanecimento)

Fade out:

```c
// Desvan ecer para preto
PAL_fadeOutAll(60);  // 60 frames
```

Fade in:

```c
// Voltar à intensidade normal
PAL_fadeInAll(60);
```

## Criando Paletas no Retro Studio

1. Abra a aba **Resources** no Retro Studio
2. Importe um arquivo `.pal` no formato JASC-PAL
3. Veja a previsualização das cores em tempo real
4. Use a paleta no seu projeto

## Dicas Importantes

- A cor 0 é sempre **transparente** para sprites
- Sprites usam apenas 4 cores + transparência (índices 0-3, 4-7, 8-11, 12-15)
- Backgrounds podem usar até 16 cores por tile
- Sempre verifique se suas imagens importadas usam apenas cores da paleta!

Pronto! Agora você pode trabalhar com paletas de forma profissional.
