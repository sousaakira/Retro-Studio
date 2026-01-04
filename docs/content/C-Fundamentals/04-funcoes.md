---
title: Funções - Reutilizando Código
description: Como não repetir código 100 vezes
---

# 🔧 Funções - Reutilizando Código

**Função** = Um pedaço de código que você reutiliza.

Ao invés de repetir a mesma lógica:

```c
/* ❌ Ruim: Repetir código */
int x1 = 50, y1 = 50;
x1 = x1 + 10;
y1 = y1 - 5;

int x2 = 100, y2 = 100;
x2 = x2 + 10;
y2 = y2 - 5;

int x3 = 150, y3 = 150;
x3 = x3 + 10;
y3 = y3 - 5;
```

Use uma função:

```c
/* ✅ Bom: Uma função */
void mover(int* x, int* y, int dx, int dy)
{
    *x += dx;
    *y += dy;
}

mover(&x1, &y1, 10, -5);
mover(&x2, &y2, 10, -5);
mover(&x3, &y3, 10, -5);
```

---

## Anatomia de uma Função

```c
int somar(int a, int b)
{
    return a + b;
}
```

Quebra por partes:

```
int          ← RETORNO (tipo de dado que retorna)
somar        ← NOME (como você chama)
(int a, int b) ← PARÂMETROS (dados que recebe)
{...}        ← CORPO (código que executa)
return       ← Retorna um valor
```

---

## Tipos de Retorno

### Sem Retorno: `void`

```c
void desenhar_tela()
{
    VDP_clearPlane(PLAN_A, 0);
    VDP_drawText("Hello!", 5, 5);
    /* Sem return */
}

int main()
{
    desenhar_tela();  /* Chama, não espera valor */
}
```

### Com Retorno

```c
int multiplicar(int a, int b)
{
    return a * b;
}

int main()
{
    int resultado = multiplicar(5, 3);  /* resultado = 15 */
}
```

### Múltiplos Retornos Possíveis

```c
u16 calcular_dano(u8 tipo_ataque)
{
    if(tipo_ataque == 0) {
        return 10;
    } else if(tipo_ataque == 1) {
        return 25;
    } else {
        return 5;
    }
}
```

---

## Parâmetros

### Passar Valor (Cópia)

```c
void aumentar_saude(int saude, int bonus)
{
    saude += bonus;     /* Modifica CÓPIA */
}

int main()
{
    int minha_saude = 100;
    aumentar_saude(minha_saude, 10);
    printf("%d\n", minha_saude);  /* Ainda 100! */
}
```

### Passar Ponteiro (Referência)

```c
void aumentar_saude(int* saude, int bonus)
{
    *saude += bonus;    /* Modifica ORIGINAL */
}

int main()
{
    int minha_saude = 100;
    aumentar_saude(&minha_saude, 10);
    printf("%d\n", minha_saude);  /* 110! */
}
```

**Regra**: Use ponteiro se quiser modificar!

---

## Exemplo Real: Funções de Utilidade

```c
/* Limitar valor dentro de range */
u16 clamp(u16 value, u16 min, u16 max)
{
    if(value < min) return min;
    if(value > max) return max;
    return value;
}

/* Calcular distância entre dois pontos */
u32 distancia_quadrada(u16 x1, u16 y1, u16 x2, u16 y2)
{
    s16 dx = x2 - x1;
    s16 dy = y2 - y1;
    return (dx * dx) + (dy * dy);
}

/* Verificar colisão simples */
u8 colidem(u16 x1, u16 y1, u16 w1, u16 h1,
           u16 x2, u16 y2, u16 w2, u16 h2)
{
    if(x1 + w1 < x2) return 0;
    if(x2 + w2 < x1) return 0;
    if(y1 + h1 < y2) return 0;
    if(y2 + h2 < y1) return 0;
    return 1;
}

int main()
{
    /* Usar as funções */
    u16 x = clamp(350, 0, 320);     /* x = 320 */
    
    u32 dist = distancia_quadrada(100, 100, 110, 100);
    
    u8 colisao = colidem(50, 50, 32, 32,
                         70, 50, 32, 32);
}
```

---

## Funções com Structs

### Passando Struct

```c
struct Player {
    u16 x, y;
    u16 saude;
};

void atualizar_player(struct Player* p)
{
    p->x += 5;          /* Mover */
    if(p->saude > 0) {
        p->saude--;     /* Envenenado? */
    }
}

int main()
{
    struct Player heroi = {160, 100, 100};
    atualizar_player(&heroi);
}
```

### Retornando Struct

```c
struct Posicao {
    u16 x, y;
};

struct Posicao calcular_nova_pos(u16 x, u16 y, 
                                 s16 vx, s16 vy)
{
    struct Posicao nova;
    nova.x = x + vx;
    nova.y = y + vy;
    return nova;
}

int main()
{
    struct Posicao pos = calcular_nova_pos(100, 50, 5, -3);
}
```

---

## Ordem de Declaração

```c
/* Problema: */
int main()
{
    int resultado = somar(5, 3);  /* ❌ somar não existe ainda */
}

int somar(int a, int b)
{
    return a + b;
}

/* Solução 1: Definir antes */
int somar(int a, int b)
{
    return a + b;
}

int main()
{
    int resultado = somar(5, 3);  /* ✅ OK */
}

/* Solução 2: Protótipo (Declaração) */
int somar(int a, int b);          /* Declara */

int main()
{
    int resultado = somar(5, 3);  /* ✅ OK */
}

int somar(int a, int b)           /* Define depois */
{
    return a + b;
}
```

**Prática**: Colocar protótipos no início!

---

## Exemplo Prático: Game Loop com Funções

```c
#include <genesis.h>

struct Player {
    u16 x, y;
    u16 vx, vy;
    u16 saude;
};

struct Enemy {
    u16 x, y;
    u16 vx, vy;
    u16 saude;
};

/* Protótipos */
void inicializar_game(struct Player* p, struct Enemy* e);
void update_player(struct Player* p, u16 input);
void update_enemy(struct Enemy* e);
void render(struct Player* p, struct Enemy* e);
u8 verificar_colisao(u16 x1, u16 y1, u16 x2, u16 y2);

/* Implementações */
void inicializar_game(struct Player* p, struct Enemy* e)
{
    p->x = 160;
    p->y = 100;
    p->vx = 0;
    p->vy = 0;
    p->saude = 100;
    
    e->x = 50;
    e->y = 50;
    e->vx = 2;
    e->vy = 1;
    e->saude = 50;
}

void update_player(struct Player* p, u16 input)
{
    p->vx = 0;
    p->vy = 0;
    
    if(input & BUTTON_LEFT) p->vx = -5;
    if(input & BUTTON_RIGHT) p->vx = 5;
    if(input & BUTTON_UP) p->vy = -5;
    if(input & BUTTON_DOWN) p->vy = 5;
    
    p->x += p->vx;
    p->y += p->vy;
    
    /* Limites */
    if(p->x > 300) p->x = 300;
    if(p->y > 200) p->y = 200;
}

void update_enemy(struct Enemy* e)
{
    e->x += e->vx;
    e->y += e->vy;
    
    /* Rebote nas paredes */
    if(e->x > 300 || e->x < 0) e->vx *= -1;
    if(e->y > 200 || e->y < 0) e->vy *= -1;
}

void render(struct Player* p, struct Enemy* e)
{
    VDP_clearPlane(PLAN_A, 0);
    
    char buffer[40];
    sprintf(buffer, "Player: X=%d Y=%d", p->x, p->y);
    VDP_drawText(buffer, 2, 5);
    
    sprintf(buffer, "Health: %d", p->saude);
    VDP_drawText(buffer, 2, 7);
    
    sprintf(buffer, "Enemy: X=%d Y=%d", e->x, e->y);
    VDP_drawText(buffer, 2, 9);
    
    if(verificar_colisao(p->x, p->y, e->x, e->y)) {
        VDP_drawText("COLLISION!", 10, 11);
        p->saude -= 1;
    }
}

u8 verificar_colisao(u16 x1, u16 y1, u16 x2, u16 y2)
{
    /* Colisão simples: se distâncias < 30 */
    s16 dx = x2 - x1;
    s16 dy = y2 - y1;
    u32 dist = (dx * dx) + (dy * dy);
    
    return dist < (30 * 30);
}

int main(u16 hard)
{
    struct Player player;
    struct Enemy enemy;
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    inicializar_game(&player, &enemy);
    
    while(TRUE)
    {
        VSync();
        
        u16 pad = JOY_readJoypad(JOY_1);
        
        update_player(&player, pad);
        update_enemy(&enemy);
        render(&player, &enemy);
    }
    
    return 0;
}
```

---

## Dicas de Boas Práticas

✅ **Nomes descritivos:**
```c
void atualizar_posicao_player()   /* Bom */
void upd_pos()                    /* Ruim */
```

✅ **Uma função = Uma responsabilidade:**
```c
void renderizar_ui();             /* Só renderiza UI */
void atualizar_física();          /* Só atualiza */
```

✅ **Funções pequenas são melhores:**
```c
/* Muito grande? Quebra em funções menores */
void game_loop() { ... }
```

✅ **Documentar com comentário:**
```c
/* Calcula dano com crit e armadura
 * Retorna: dano_final
 * Parâmetros: dano_base, crit_chance, armadura_alvo
 */
u16 calcular_dano(u16 base, u8 crit, u16 armor)
{
    /* ... */
}
```

---

## Exercício

Crie as seguintes funções:

1. `u16 lerJoystick()` - Lê entrada e retorna valores
2. `void moverPlayer(Player* p)` - Move player baseado em velocidade
3. `u8 estaVivo(Player* p)` - Retorna 1 se vivo, 0 senão
4. `void aplicarDano(Player* p, u16 dano)` - Tira saúde

Depois crie um main() que use todas!

---

## Próximo Capítulo

Agora vamos dominar **[Memória: Stack vs Heap](./05-memoria.md)** 🚀
