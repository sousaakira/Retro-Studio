---
title: Game Loop - O Coração de Todo Jogo
description: Estrutura fundamental que faz tudo funcionar
---

# 🔄 Game Loop - O Coração de Todo Jogo

**Game Loop** é a estrutura básica que tudo o mais segue.

Sem um game loop bem estruturado, seu jogo é caos.

---

## A Ideia Básica

```
┌─────────────────┐
│  GAME LOOP      │
├─────────────────┤
│  1. INPUT       │ ← Ler joystick
│  2. UPDATE      │ ← Atualizar física, lógica
│  3. RENDER      │ ← Desenhar na tela
│  4. VSYNC       │ ← Sincronizar com tela
└─────────────────┘
     ↓
  REPETE INFINITO
```

---

## Versão Simples

```c
#include <genesis.h>

int main(u16 hard)
{
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    while(TRUE)
    {
        /* 1. INPUT */
        u16 input = JOY_readJoypad(JOY_1);
        
        /* 2. UPDATE */
        if(input & BUTTON_UP) {
            /* Player subiu */
        }
        
        /* 3. RENDER */
        VDP_clearPlane(PLAN_A, 0);
        VDP_drawText("Hello!", 5, 5);
        
        /* 4. VSYNC */
        VSync();
    }
    
    return 0;
}
```

---

## Versão Melhorada com Estrutura

```c
#include <genesis.h>

/* Estado do jogo */
struct GameState {
    u16 player_x;
    u16 player_y;
    u16 pontos;
    u8 jogo_rodando;
};

/* Funções das fases */
void input_phase(struct GameState* game, u16 pad)
{
    if(pad & BUTTON_UP) {
        game->player_y -= 5;
    }
    if(pad & BUTTON_DOWN) {
        game->player_y += 5;
    }
}

void update_phase(struct GameState* game)
{
    /* Limites de tela */
    if(game->player_y > 220) {
        game->player_y = 220;
    }
    if(game->player_y < 0) {
        game->player_y = 0;
    }
    
    /* Lógica do jogo */
    game->pontos += 1;
}

void render_phase(struct GameState* game)
{
    VDP_clearPlane(PLAN_A, 0);
    
    char buffer[40];
    sprintf(buffer, "Player Y: %d", game->player_y);
    VDP_drawText(buffer, 5, 5);
    
    sprintf(buffer, "Pontos: %d", game->pontos);
    VDP_drawText(buffer, 5, 7);
}

int main(u16 hard)
{
    struct GameState game = {
        .player_x = 160,
        .player_y = 112,
        .pontos = 0,
        .jogo_rodando = 1
    };
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    while(game.jogo_rodando)
    {
        /* 1. INPUT */
        u16 input = JOY_readJoypad(JOY_1);
        input_phase(&game, input);
        
        /* 2. UPDATE */
        update_phase(&game);
        
        /* 3. RENDER */
        render_phase(&game);
        
        /* 4. VSYNC */
        VSync();
    }
    
    return 0;
}
```

---

## VSync: O Que É?

```c
VSync();
```

**VSync = Sincronização Vertical**

Espera o "refresh" da tela (para de desenhar, aguarda TV, depois volta).

### Por Quê?

Sem VSync:
```
Você desenha:    ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
                 │ FR  │ │ FR  │ │ FR  │ │ FR  │
                 └─────┘ └─────┘ └─────┘ └─────┘
                 
TV renderiza:    ┌──────┐  ┌──────┐  ┌──────┐
                 │SCAN  │  │SCAN  │  │SCAN  │
                 └──────┘  └──────┘  └──────┘
                 
Resultado: ❌ Tearing (visual quebrado)
```

Com VSync:
```
Você espera:     ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
                 │WAIT │ │FR   │ │WAIT │ │FR   │
                 └─────┘ └─────┘ └─────┘ └─────┘
                 
TV renderiza:    ┌──────┐ ┌──────┐ ┌──────┐
                 │SCAN  │ │SCAN  │ │SCAN  │
                 └──────┘ └──────┘ └──────┘
                 
Resultado: ✅ Sincronizado!
```

**Mega Drive: 60 FPS (PAL: 50 FPS)**

---

## Estrutura com Estados

Muitas vezes um jogo tem múltiplos "estados":

```c
#define STATE_MENU    0
#define STATE_PLAYING 1
#define STATE_PAUSED  2
#define STATE_GAMEOVER 3

struct GameState {
    u8 estado_atual;
    /* ... outros dados */
};

int main()
{
    struct GameState game;
    game.estado_atual = STATE_MENU;
    
    while(TRUE)
    {
        u16 input = JOY_readJoypad(JOY_1);
        
        switch(game.estado_atual)
        {
            case STATE_MENU:
                if(input & BUTTON_START) {
                    game.estado_atual = STATE_PLAYING;
                }
                break;
                
            case STATE_PLAYING:
                update_playing(&game, input);
                if(input & BUTTON_PAUSE) {
                    game.estado_atual = STATE_PAUSED;
                }
                break;
                
            case STATE_PAUSED:
                if(input & BUTTON_PAUSE) {
                    game.estado_atual = STATE_PLAYING;
                }
                break;
                
            case STATE_GAMEOVER:
                if(input & BUTTON_START) {
                    game.estado_atual = STATE_MENU;
                }
                break;
        }
        
        render(&game);
        VSync();
    }
}
```

---

## Exemplo Completo: Jogo Simples

```c
#include <genesis.h>

#define STATE_MENU    0
#define STATE_PLAYING 1
#define STATE_GAMEOVER 2

struct Player {
    u16 x, y;
    u16 vx, vy;
};

struct Enemy {
    u16 x, y;
    u16 vx, vy;
    u8 ativo;
};

struct Game {
    u8 estado;
    struct Player player;
    struct Enemy inimigo;
    u16 pontos;
    u16 tempo;
};

void init_game(struct Game* g)
{
    g->estado = STATE_PLAYING;
    
    g->player.x = 160;
    g->player.y = 200;
    g->player.vx = 0;
    g->player.vy = 0;
    
    g->inimigo.x = 50;
    g->inimigo.y = 50;
    g->inimigo.vx = 2;
    g->inimigo.vy = 1;
    g->inimigo.ativo = 1;
    
    g->pontos = 0;
    g->tempo = 0;
}

void input_phase(struct Game* g, u16 pad)
{
    g->player.vx = 0;
    
    if(pad & BUTTON_LEFT) {
        g->player.vx = -5;
    }
    if(pad & BUTTON_RIGHT) {
        g->player.vx = 5;
    }
}

void update_phase(struct Game* g)
{
    switch(g->estado)
    {
        case STATE_PLAYING:
            /* Mover player */
            g->player.x += g->player.vx;
            
            if(g->player.x > 320) g->player.x = 0;
            if(g->player.x < 0) g->player.x = 320;
            
            /* Mover inimigo */
            if(g->inimigo.ativo) {
                g->inimigo.x += g->inimigo.vx;
                g->inimigo.y += g->inimigo.vy;
                
                /* Rebote */
                if(g->inimigo.x > 320 || g->inimigo.x < 0) {
                    g->inimigo.vx *= -1;
                }
                if(g->inimigo.y > 220 || g->inimigo.y < 0) {
                    g->inimigo.vy *= -1;
                }
            }
            
            /* Verificar colisão */
            {
                s16 dx = g->inimigo.x - g->player.x;
                s16 dy = g->inimigo.y - g->player.y;
                u32 dist = (dx * dx) + (dy * dy);
                
                if(dist < (30 * 30)) {
                    g->estado = STATE_GAMEOVER;
                    g->pontos = 0;
                }
            }
            
            g->tempo++;
            g->pontos = g->tempo / 60;  /* Segundo para pontos */
            break;
    }
}

void render_phase(struct Game* g)
{
    VDP_clearPlane(PLAN_A, 0);
    
    char buffer[40];
    
    switch(g->estado)
    {
        case STATE_PLAYING:
            sprintf(buffer, "Pontos: %d", g->pontos);
            VDP_drawText(buffer, 2, 5);
            
            sprintf(buffer, "Player X: %d", g->player.x);
            VDP_drawText(buffer, 2, 7);
            
            sprintf(buffer, "Enemy X: %d", g->inimigo.x);
            VDP_drawText(buffer, 2, 9);
            break;
            
        case STATE_GAMEOVER:
            VDP_drawText("GAME OVER!", 10, 10);
            sprintf(buffer, "Pontos: %d", g->pontos);
            VDP_drawText(buffer, 10, 12);
            VDP_drawText("Pressione START", 8, 14);
            break;
    }
}

int main(u16 hard)
{
    struct Game game;
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    init_game(&game);
    
    while(TRUE)
    {
        u16 input = JOY_readJoypad(JOY_1);
        
        input_phase(&game, input);
        update_phase(&game);
        render_phase(&game);
        
        if(input & BUTTON_START && game.estado == STATE_GAMEOVER) {
            init_game(&game);
        }
        
        VSync();
    }
    
    return 0;
}
```

---

## Padrões Comuns

### Frame Counter

```c
u16 frame_count = 0;

while(TRUE)
{
    frame_count++;
    
    if(frame_count % 60 == 0) {
        /* Executa a cada 1 segundo */
    }
    
    if(frame_count % 30 == 0) {
        /* Executa a cada 0.5 segundo */
    }
    
    VSync();
}
```

### Delta Time (Simplificado)

```c
u16 last_frame_time = 0;
u16 delta_time = 0;

while(TRUE)
{
    u16 current_time = get_ticks();  /* Se disponível */
    delta_time = current_time - last_frame_time;
    last_frame_time = current_time;
    
    /* Usar delta_time para movimentos */
    
    VSync();
}
```

### Pausa

```c
u8 pausado = 0;

while(TRUE)
{
    u16 input = JOY_readJoypad(JOY_1);
    
    if(input & BUTTON_PAUSE) {
        pausado = !pausado;
    }
    
    if(!pausado) {
        update_phase(&game, input);
    }
    
    render_phase(&game);
    VSync();
}
```

---

## Performance: Tips

⚡ **VSync está lento?** Significa seu update/render são pesados  
⚡ **Limpar sprite após desenho:**
```c
VDP_clearPlane(PLAN_A, 0);  /* Sempre fazer antes de desenhar */
```

⚡ **Evitar operações caras em loops:**
```c
/* ❌ Ruim: Cada frame calcula */
while(TRUE) {
    u32 resultado = sqrt(1000000);  /* Caro! */
    VSync();
}

/* ✅ Bom: Calcular uma vez */
u32 resultado = sqrt(1000000);
while(TRUE) {
    /* Usar resultado */
    VSync();
}
```

---

## Próximo Capítulo

Agora vamos aprender **[Máquina de Estados](./07-state-machine.md)** - Padrão importante! 🚀
