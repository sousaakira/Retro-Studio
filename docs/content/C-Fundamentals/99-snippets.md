---
title: Snippets Práticos - Copie e Cole
description: Códigos prontos para usar no seu jogo
---

# 📋 Snippets Práticos - Copie e Cole

Receitas rápidas de código para ganhar tempo!

---

## 1. Template Básico de Jogo

```c
#include <genesis.h>

struct Game {
    u16 frame;
    u8 estado;
    /* Adicione aqui */
};

int main(u16 hard) {
    struct Game game = {0};
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    while(TRUE) {
        u16 input = JOY_readJoypad(JOY_1);
        
        /* UPDATE */
        game.frame++;
        
        /* RENDER */
        VDP_clearPlane(PLAN_A, 0);
        
        /* VSYNC */
        VSync();
    }
    
    return 0;
}
```

---

## 2. Estrutura de Player

```c
struct Player {
    u16 x, y;
    s16 vx, vy;         /* Velocidade */
    u16 saude;
    u8 vivo;
    Sprite* sprite;
};

void update_player(struct Player* p) {
    p->x += p->vx;
    p->y += p->vy;
    
    /* Limites */
    if(p->x > 320) p->x = 0;
    if(p->y > 224) p->y = 0;
    
    /* Morte */
    if(p->saude <= 0) {
        p->vivo = 0;
    }
}

void draw_player(struct Player* p) {
    if(p->vivo && p->sprite) {
        SPR_setPosition(p->sprite, p->x, p->y);
    }
}
```

---

## 3. Array de Inimigos com Pool

```c
#define MAX_ENEMIES 50

struct Enemy {
    u16 x, y;
    u16 vx, vy;
    u16 health;
    u8 ativo;
};

struct Enemy inimigos[MAX_ENEMIES];

void init_enemies() {
    for(int i = 0; i < MAX_ENEMIES; i++) {
        inimigos[i].ativo = 0;
    }
}

void spawn_enemy(u16 x, u16 y, u16 health) {
    for(int i = 0; i < MAX_ENEMIES; i++) {
        if(!inimigos[i].ativo) {
            inimigos[i].x = x;
            inimigos[i].y = y;
            inimigos[i].health = health;
            inimigos[i].ativo = 1;
            return;
        }
    }
}

void update_enemies() {
    for(int i = 0; i < MAX_ENEMIES; i++) {
        if(inimigos[i].ativo) {
            inimigos[i].x += inimigos[i].vx;
            inimigos[i].y += inimigos[i].vy;
            
            if(inimigos[i].health <= 0) {
                inimigos[i].ativo = 0;
            }
        }
    }
}
```

---

## 4. Detecção de Colisão Simples

```c
/* Colisão com distância */
u8 colidem_circular(u16 x1, u16 y1, u16 r1,
                    u16 x2, u16 y2, u16 r2) {
    s16 dx = x2 - x1;
    s16 dy = y2 - y1;
    u32 dist_sq = (dx * dx) + (dy * dy);
    u32 min_dist = r1 + r2;
    
    return dist_sq < (min_dist * min_dist);
}

/* Colisão com retângulo (AABB) */
u8 colidem_aabb(u16 x1, u16 y1, u16 w1, u16 h1,
                u16 x2, u16 y2, u16 w2, u16 h2) {
    if(x1 + w1 < x2) return 0;
    if(x2 + w2 < x1) return 0;
    if(y1 + h1 < y2) return 0;
    if(y2 + h2 < y1) return 0;
    return 1;
}

/* Usar */
if(colidem_circular(player.x, player.y, 16,
                    inimigo.x, inimigo.y, 16)) {
    player.saude -= 10;
}
```

---

## 5. Input com Debounce

```c
u16 prev_input = 0;

u8 botao_pressionado(u16 input, u16 botao) {
    return (input & botao) && !(prev_input & botao);
}

/* No game loop */
u16 input = JOY_readJoypad(JOY_1);

if(botao_pressionado(input, BUTTON_A)) {
    /* Fire! Executado uma vez por pressão */
}

prev_input = input;
```

---

## 6. Máquina de Estados

```c
#define STATE_MENU      0
#define STATE_PLAYING   1
#define STATE_PAUSED    2
#define STATE_GAMEOVER  3

u8 estado = STATE_MENU;

switch(estado) {
    case STATE_MENU:
        render_menu();
        if(input & BUTTON_START) {
            estado = STATE_PLAYING;
        }
        break;
        
    case STATE_PLAYING:
        update_game();
        render_game();
        if(input & BUTTON_PAUSE) {
            estado = STATE_PAUSED;
        }
        break;
        
    case STATE_PAUSED:
        render_paused();
        if(input & BUTTON_PAUSE) {
            estado = STATE_PLAYING;
        }
        break;
        
    case STATE_GAMEOVER:
        render_gameover();
        if(input & BUTTON_START) {
            estado = STATE_MENU;
            reset_game();
        }
        break;
}
```

---

## 7. Frame Counter para Timer

```c
u16 frame_count = 0;
u16 tempo_segundos = 0;

/* No loop */
frame_count++;

if(frame_count % 60 == 0) {  /* A cada 1 segundo */
    tempo_segundos++;
    frame_count = 0;
}

if(frame_count % 30 == 0) {  /* A cada 0.5 segundo */
    /* Blink, piscar, etc */
}

if(frame_count % 15 == 0) {  /* A cada 0.25 segundo */
    /* Lógica rápida */
}
```

---

## 8. String Buffer para Display

```c
char buffer[40];

/* Número simples */
sprintf(buffer, "Score: %d", pontos);
VDP_drawText(buffer, 2, 5);

/* Posição */
sprintf(buffer, "X:%d Y:%d", x, y);
VDP_drawText(buffer, 2, 7);

/* Múltiplos valores */
sprintf(buffer, "HP: %d/%d", saude, max_saude);
VDP_drawText(buffer, 2, 9);

/* Texto customizado */
sprintf(buffer, "Wave: %d/10", onda);
VDP_drawText(buffer, 2, 11);
```

---

## 9. Alocação Dinâmica Segura

```c
struct Enemy* inimigos = NULL;
u16 max_inimigos = 0;

/* Alocar */
max_inimigos = 100;
inimigos = malloc(max_inimigos * sizeof(struct Enemy));

if(inimigos == NULL) {
    /* Erro! */
    return;
}

/* Usar */
inimigos[0].x = 50;

/* Liberar */
free(inimigos);
inimigos = NULL;
max_inimigos = 0;
```

---

## 10. Efeito de Piscar

```c
u16 blink_timer = 0;
u8 visivel = 1;

blink_timer++;

if(blink_timer > 15) {  /* A cada 15 frames */
    visivel = !visivel;
    blink_timer = 0;
}

if(visivel) {
    SPR_setPosition(sprite, x, y);
} else {
    SPR_setVisibility(sprite, VISIBLE_FLAG_OFF);
}
```

---

## 11. Movimento Baseado em Velocidade

```c
struct Entity {
    s16 x, y;
    s16 vx, vy;     /* Velocidade */
    s16 acx, acy;   /* Aceleração */
};

void update_entity(struct Entity* e) {
    /* Aplicar aceleração */
    e->vx += e->acx;
    e->vy += e->acy;
    
    /* Limitar velocidade */
    if(e->vx > 10) e->vx = 10;
    if(e->vx < -10) e->vx = -10;
    if(e->vy > 10) e->vy = 10;
    if(e->vy < -10) e->vy = -10;
    
    /* Aplicar movimento */
    e->x += e->vx;
    e->y += e->vy;
    
    /* Atrito */
    e->vx = (e->vx * 90) / 100;  /* 10% atrito */
    e->vy = (e->vy * 90) / 100;
}
```

---

## 12. Spawn com Delay

```c
u16 spawn_timer = 0;
u16 spawn_delay = 60;  /* 1 segundo */

spawn_timer++;

if(spawn_timer >= spawn_delay) {
    spawn_enemy(50, 50, 20);
    spawn_timer = 0;
    spawn_delay = 45;  /* Cada vez mais rápido */
    if(spawn_delay < 30) spawn_delay = 30;
}
```

---

## 13. Pontuação com Multiplicador

```c
struct Score {
    u32 points;
    u16 multiplier;
};

void add_score(struct Score* s, u32 valor) {
    s->points += valor * s->multiplier;
}

void increase_multiplier(struct Score* s) {
    if(s->multiplier < 10) {
        s->multiplier++;
    }
}

void reset_multiplier(struct Score* s) {
    s->multiplier = 1;
}

/* Usar */
add_score(&score, 100);  /* +100 * multiplier */
increase_multiplier(&score);
```

---

## 14. Pré-alocação vs Dinâmico

```c
/* Opção 1: ESTÁTICO (Mais rápido, menos flexível) */
#define MAX_INIMIGOS 50
struct Enemy inimigos_estático[MAX_INIMIGOS];

/* Opção 2: DINÂMICO (Mais flexível, mais lento) */
struct Enemy* inimigos_dinâmico = malloc(quantidade * sizeof(struct Enemy));

if(inimigos_dinâmico) {
    /* Usar */
    free(inimigos_dinâmico);
}

/* Dica: Para Mega Drive, prefira ESTÁTICO (stack) */
```

---

## 15. Pausar e Retomar

```c
u8 pausado = 0;

if(input & BUTTON_PAUSE) {
    pausado = !pausado;
}

if(!pausado) {
    update_game();
} else {
    render_paused_message();
}

render_game();
VSync();
```

---

## Tips de Performance

⚡ **Use stack sempre que possível**
```c
/* Bom */
struct Player p;  /* Stack, rápido */

/* Evitar */
struct Player* p = malloc(sizeof(struct Player));
```

⚡ **Minimize desenho**
```c
/* Bom */
VDP_clearPlane(PLAN_A, 0);
/* Só desenhar sprite */

/* Ruim */
VDP_clearPlane(PLAN_A, 0);
/* Desenhar tudo de novo */
```

⚡ **Use constantes**
```c
#define SCREEN_WIDTH 320
#define SCREEN_HEIGHT 224
#define MAX_ENEMIES 50

/* Não fazer cálculos em runtime */
```

---

## Próximos Passos

Quer aprender os detalhes de cada snippet? Veja:
- [Structs](./03-structs.md) - Organizando dados
- [Funções](./04-funcoes.md) - Reutilizando código
- [Game Loop](./06-game-loop.md) - Estrutura de jogo
