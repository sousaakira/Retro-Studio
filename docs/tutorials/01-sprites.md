---
title: Criando Sprites Básicos
description: Aprenda como criar e renderizar sprites usando o SGDK
tags: [sprites, beginner, graphics, tutorial]
---

# Criando Sprites Básicos

Os **sprites** são objetos gráficos animados no Mega Drive. Neste tutorial vamos aprender o básico.

## Pré-requisitos

Você deve ter:
- SGDK instalado
- Um arquivo `.h` com a definição do sprite
- Uma imagem PNG em 8-bit com paleta apropriada

## Inicializando o Motor de Sprites

Primeiro, você deve inicializar o motor de sprites no seu `main()`:

```c
#include <genesis.h>

int main() {
    VDP_init();
    SPR_init();
    
    while(1) {
        SYS_doVBlankProcess();
    }
    
    return 0;
}
```

## Criando um Sprite

Após inicializar, você pode criar sprites:

```c
Sprite* my_sprite = SPR_addSprite(
    &my_sprite_definition,  // Definição do sprite
    160,                    // Posição X
    120,                    // Posição Y
    NULL                    // Dados de animação (opcional)
);
```

## Movimentando Sprites

Para mover um sprite:

```c
SPR_setPosition(my_sprite, 200, 150);
```

## Mudando Frames/Animações

Para trocar o frame visual:

```c
SPR_setFrame(my_sprite, 1);  // Frame 1
```

## Removendo Sprites

Quando o sprite não for mais necessário:

```c
SPR_releaseSprite(my_sprite);
```

## Exemplo Completo

```c
#include <genesis.h>

// Definições de sprite (geradas pelo SGDK)
extern SpriteDefinition player_def;

int main() {
    VDP_init();
    SPR_init();
    
    Sprite* player = SPR_addSprite(&player_def, 160, 120, NULL);
    
    u16 x = 160, y = 120;
    
    while(1) {
        u16 joy = JOY_readJoypad(JOY_1);
        
        if (joy & BUTTON_UP) y--;
        if (joy & BUTTON_DOWN) y++;
        if (joy & BUTTON_LEFT) x--;
        if (joy & BUTTON_RIGHT) x++;
        
        SPR_setPosition(player, x, y);
        SYS_doVBlankProcess();
    }
    
    return 0;
}
```

Agora você tem um sprite que pode ser controlado pelo jogo pad!
