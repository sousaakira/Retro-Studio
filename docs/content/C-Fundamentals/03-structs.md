---
title: Structs - Organizando Dados
description: Como agrupar dados relacionados (essencial!)
---

# 🎁 Structs - Guardando Dados Juntos

**Struct** = Uma caixa que contém várias coisas relacionadas.

Ao invés de:
```c
u16 player_x, player_y;
u16 player_saude;
u8 player_ativo;
```

Use:
```c
struct Player {
    u16 x, y;
    u16 saude;
    u8 ativo;
};
```

Muito melhor!

---

## Definindo Structs

### Sintaxe Básica

```c
struct Player {
    u16 x;              /* Posição X */
    u16 y;              /* Posição Y */
    u16 velocidade;     /* Pixels por frame */
    u16 saude;          /* 0-100 */
    u8 ativo;           /* 0 ou 1 */
};
```

### No SGDK

```c
struct Enemy {
    u16 x, y;           /* Posição */
    u16 vx, vy;         /* Velocidade */
    Sprite* sprite;     /* Sprite SGDK */
    u16 health;
    u8 tipo;            /* 0=basico, 1=forte */
};

struct Projectile {
    u16 x, y;
    s16 vx, vy;         /* Pode ser negativo */
    u16 vida;           /* Frames restantes */
};
```

---

## Criando Instâncias

### Declaração Simples

```c
struct Player heroi;            /* Só declara, lixo dentro! */
struct Player heroi = {0};      /* Inicializa com zeros */
```

### Com Valores

```c
struct Player heroi = {
    160,    /* x */
    100,    /* y */
    5,      /* velocidade */
    100,    /* saude */
    1       /* ativo */
};
```

### Nomeado (Mais Legível!)

```c
struct Player heroi = {
    .x = 160,
    .y = 100,
    .velocidade = 5,
    .saude = 100,
    .ativo = 1
};
```

---

## Acessando Membros

### Com Variável Normal

```c
struct Player heroi = {160, 100, 5, 100, 1};

heroi.x = 170;          /* Muda X */
heroi.saude -= 10;      /* Tira 10 de saúde */

printf("%d\n", heroi.x);  /* Lê X */
```

### Com Ponteiro

```c
struct Player heroi = {160, 100, 5, 100, 1};
struct Player* p = &heroi;

p->x = 170;             /* Acessa via ponteiro */
p->saude -= 10;

printf("%d\n", p->x);
```

---

## Array de Structs

### Declarar Array

```c
#define MAX_INIMIGOS 50

struct Enemy inimigos[MAX_INIMIGOS];

/* Inicializar */
inimigos[0].x = 50;
inimigos[0].y = 50;
inimigos[0].health = 100;
```

### Loop Percorrendo

```c
for(int i = 0; i < MAX_INIMIGOS; i++)
{
    if(inimigos[i].health > 0)
    {
        inimigos[i].x += inimigos[i].vx;
        inimigos[i].y += inimigos[i].vy;
    }
}
```

---

## Usando em Funções

### Passar por Valor (Copia)

```c
void danificar_player(struct Player p, u16 dano)
{
    p.saude -= dano;        /* Modifica CÓPIA */
}

int main()
{
    struct Player heroi = {...};
    danificar_player(heroi, 10);
    
    printf("%d\n", heroi.saude);  /* Saúde ORIGINAL não mudou! */
}
```

### Passar por Referência (Ponteiro)

```c
void danificar_player(struct Player* p, u16 dano)
{
    p->saude -= dano;       /* Modifica ORIGINAL */
}

int main()
{
    struct Player heroi = {...};
    danificar_player(&heroi, 10);
    
    printf("%d\n", heroi.saude);  /* Saúde MUDOU! */
}
```

**Regra**: Use ponteiro se quiser modificar! (Mais rápido também)

---

## Structs Dentro de Structs

```c
struct Posicao {
    u16 x;
    u16 y;
};

struct Velocidade {
    s16 x;
    s16 y;
};

struct Player {
    struct Posicao pos;
    struct Velocidade vel;
    u16 saude;
};

/* Usando: */
struct Player heroi = {
    {160, 100},     /* pos */
    {2, -1},        /* vel */
    100             /* saude */
};

heroi.pos.x = 170;
heroi.vel.y = 0;
```

---

## Tamanho de Struct

```c
struct Player {
    u16 x;          /* 2 bytes */
    u16 y;          /* 2 bytes */
    u16 saude;      /* 2 bytes */
    u8 ativo;       /* 1 byte */
};

sizeof(struct Player);  /* Resultado: 7 bytes */
                        /* (ou 8, depende de alignment) */
```

**Alignment**: O compilador pode adicionar "vazio" para alinhar dados!

```c
struct Exemplo {
    u8 a;           /* 1 byte */
    /* (1 byte de padding invisível) */
    u16 b;          /* 2 bytes, alinhado */
};

sizeof(struct Exemplo);  /* 4 bytes, não 3! */
```

Para forçar sem padding:

```c
struct Player {
    u16 x, y, saude;
    u8 ativo;
} __attribute__((packed));
```

---

## Exemplo Completo: Game Loop com Structs

```c
#include <genesis.h>

#define MAX_INIMIGOS 10

struct Player {
    u16 x, y;
    u16 vx, vy;
    u16 saude;
    u8 ativo;
};

struct Enemy {
    u16 x, y;
    u16 vx, vy;
    u16 saude;
    u8 tipo;
};

/* Função para mover player */
void update_player(struct Player* p, u16 pad_state)
{
    p->x += p->vx;
    p->y += p->vy;
    
    /* Limites de tela */
    if(p->x > 300) p->x = 300;
    if(p->y > 200) p->y = 200;
}

/* Função para mover inimigos */
void update_enemies(struct Enemy enemies[], u16 count)
{
    for(int i = 0; i < count; i++)
    {
        if(enemies[i].saude > 0)
        {
            enemies[i].x += enemies[i].vx;
            enemies[i].y += enemies[i].vy;
        }
    }
}

int main(u16 hard)
{
    /* Criar player */
    struct Player player = {
        .x = 160, .y = 112,
        .vx = 0, .vy = 0,
        .saude = 100,
        .ativo = 1
    };
    
    /* Criar inimigos */
    struct Enemy inimigos[MAX_INIMIGOS] = {0};
    inimigos[0].x = 50;
    inimigos[0].y = 50;
    inimigos[0].vx = 1;
    inimigos[0].saude = 20;
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    char buffer[40];
    u8 enemy_count = 1;
    
    while(TRUE)
    {
        VSync();
        VDP_clearPlane(PLAN_A, 0);
        
        /* Update */
        update_player(&player, 0);
        update_enemies(inimigos, enemy_count);
        
        /* Draw */
        sprintf(buffer, "Player: X=%d Y=%d", player.x, player.y);
        VDP_drawText(buffer, 2, 5);
        
        sprintf(buffer, "Health: %d", player.saude);
        VDP_drawText(buffer, 2, 7);
        
        for(int i = 0; i < enemy_count; i++)
        {
            if(inimigos[i].saude > 0)
            {
                sprintf(buffer, "Enemy %d: X=%d", i, inimigos[i].x);
                VDP_drawText(buffer, 2, 9 + i);
            }
        }
    }
    
    return 0;
}
```

---

## Dicas Importantes

✅ **Inicialize sempre!**
```c
struct Player heroi = {0};  /* Todos membros = 0 */
```

✅ **Use typedef para simplificar:**
```c
typedef struct {
    u16 x, y;
    u16 saude;
} Player;

Player heroi;  /* Sem "struct" */
```

✅ **Passe por ponteiro em funções:**
```c
void danificar(Player* p, u16 dano)
```

❌ **Evite cópias desnecessárias:**
```c
void danificar(Player p, u16 dano)  /* Lento! Cópia inteira */
```

---

## Exercício

Crie um struct `Item` com:
- Nome (char array)
- Tipo (0=poção, 1=arma, 2=armor)
- Valor
- Quantidade

Depois crie um array de 5 itens e mostre todos na tela!

---

## Próximo Capítulo

Agora vamos aprender **[Funções](./04-funcoes.md)** - Reutilizar código! 🚀
