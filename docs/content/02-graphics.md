---
title: Gráficos e VDP
icon: fas fa-tv
---

# Gráficos e VDP (Video Display Processor)

O VDP é o coração do sistema de vídeo do Mega Drive. Ele gerencia:

- **Planos de fundo** (backgrounds)
- **Sprites** (objetos animados)
- **Paletas de cores**
- **Resolução e modo de vídeo**

## Inicializando o VDP

```c
#include <genesis.h>

int main() {
    VDP_init();           // Inicializa com configurações padrão
    VDP_setScreenWidth320();  // Configura largura para 320px
    VDP_setScreenHeight224(); // Configura altura para 224px (NTSC)
    
    return 0;
}
```

## Planos de Fundo (Planes)

O Mega Drive possui **2 planos de fundo principais**:

### BG_A (Plano Frontal)
- Renderizado na frente de sprites
- Usado para elementos de primeiro plano

### BG_B (Plano Traseiro)
- Renderizado atrás de sprites
- Usado para backgrounds distantes

### WINDOW (Plano Estático)
- Não faz scroll
- Ideal para HUD e interfaces

## Escrevendo Texto na Tela

```c
// Desenhar texto no plano A
VDP_drawText("Hello, Mega Drive!", 10, 5);

// Desenhar em posição específica
VDP_drawTextEx(BG_A, "Score: 100", 2, 2, PLAN_A);
```

## Cores e Paletas

O Mega Drive usa **4 paletas de 16 cores cada** (total de 64 cores simultâneas):

- **PAL0**: Paleta 0 (geralmente para sprites do jogador)
- **PAL1**: Paleta 1 (geralmente para inimigos)
- **PAL2**: Paleta 2 (geralmente para backgrounds)
- **PAL3**: Paleta 3 (geralmente para interface)

## VSync (Sincronização Vertical)

Sempre sincronize com o VSync para evitar flickering:

```c
while(1) {
    // Seu código aqui
    VDP_waitVSync();  // Aguarda a próxima sincronização vertical
}
```

## Modo de Vídeo

Você pode configurar diferentes modos:

```c
VDP_setWindowVSize(WINDOW_SIZE_16);  // Tamanho da janela
VDP_setPalette(PAL0, my_palette.data); // Carregar paleta
```

Agora você está pronto para criar gráficos impressionantes no Mega Drive!
