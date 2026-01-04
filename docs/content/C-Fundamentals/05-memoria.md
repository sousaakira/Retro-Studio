---
title: Memória - Stack vs Heap
description: Como a memória funciona no Mega Drive e por que importa
---

# 💾 Memória: Stack vs Heap

No Mega Drive, você tem **apenas 64 KB de RAM**. Precisa entender como usá-la!

Existem duas formas principais de guardar dados: **Stack** e **Heap**.

---

## Stack: Rápido, Limitado e Automático

### O que é?

Stack é como uma **pilha de pratos**:
- Você coloca (push)
- Você tira (pop)
- LIFO (Last In, First Out)

```
Tempo:   Antes    →    Depois de adicionar    →    Depois de remover
        [vazio]        [plate1]                     [vazio]
                        [plate2]
                        [plate3] ← Topo
```

### Características

✅ **Muito rápido** (alocação = incrementar ponteiro)

✅ **Automático** (libera quando função termina)

✅ **Limitado** (~16-64 KB no Mega Drive)

❌ **Tamanho fixo em compilação**

### Exemplos

```c
void funcao()
{
    int x = 10;             /* Stack */
    struct Player p;        /* Stack */
    int array[100];         /* Stack */
    
    /* Todos são AUTOMÁTICAMENTE liberados ao sair da função */
}

int main()
{
    funcao();
    /* x, p, array não existem mais */
}
```

### Quando Stack Falha

```c
void criar_muitos_dados()
{
    int array[10000];       /* ❌ STACK OVERFLOW! */
                            /* 40 KB! Stack é muito pequeno */
    
    struct Enemy inimigos[1000];  /* ❌ Muito grande! */
}
```

---

## Heap: Lento, Grande e Manual

### O que é?

Heap é como um **depósito de itens desordenado**:
- Você requisita um espaço
- Você DEVE devolver quando termina
- Não tem ordem (LIFO não aplica)

```
Heap: [Bloco A][Bloco B][Bloco C][Espaço Livre][Bloco D]...
       ↑      ↑      ↑      ↑        ↑         ↑
       Você requisita onde quer, na ordem que quer
```

### Características

❌ **Mais lento** (buscar espaço, fragmentação)

❌ **Manual** (você deve liberar com `free()`)

✅ **Grande** (~usar a maioria da RAM)

✅ **Tamanho dinâmico** (decide em runtime)

### Exemplos

```c
#include <stdlib.h>

void criar_dados()
{
    /* malloc = alocação manual */
    int* array = (int*)malloc(10000 * sizeof(int));
                            /* Aloca 40 KB no heap */
    
    if(array == NULL) {
        /* Falhou! Sem memória */
        return;
    }
    
    array[0] = 42;          /* Usa como array normal */
    
    free(array);            /* ✅ IMPORTANTE! Libera */
                            /* array não está mais válido depois */
}
```

---

## Stack vs Heap: Comparação

⭕ **Velocidade**

Stack: ⚡ Muito rápido | Heap: 🐢 Mais lento

⭕ **Tamanho**

Stack: 🔒 Limitado (~64KB) | Heap: 📦 Grande

⭕ **Alocação**

Stack: ✅ Automática | Heap: ❌ Manual (malloc)

⭕ **Liberação**

Stack: ✅ Automática | Heap: ❌ Manual (free)

⭕ **Tamanho dinâmico**

Stack: ❌ Fixo em compilação | Heap: ✅ Runtime

⭕ **Fragmentação**

Stack: ❌ Não | Heap: ✅ Sim

⭕ **Uso típico**

Stack: Variáveis locais | Heap: Estruturas grandes

---

## Quando Usar Cada Um

### Use Stack Quando:

✅ **Dados pequenos** (< 1 KB)

✅ **Variáveis locais**

✅ **Tamanho conhecido em compilação**

✅ **Quer rapidez**

```c
void render_frame()
{
    char buffer[20];            /* Stack OK */
    struct Vector pos = {0, 0}; /* Stack OK */
}
```

### Use Heap Quando:

✅ **Dados grandes** (> 1 KB)

✅ **Tamanho não é conhecido em compilação**

✅ **Quer reutilizar depois que a função termina**

```c
int* criar_tileset(u16 quantidade)
{
    /* Não pode colocar array no stack */
    /* Tamanho varia em runtime */
    
    int* tiles = (int*)malloc(quantidade * sizeof(int));
    
    if(tiles == NULL) return NULL;
    
    return tiles;  /* Dados continuam existindo! */
}

int main()
{
    int* meus_tiles = criar_tileset(200);
    
    /* Usar meus_tiles */
    
    free(meus_tiles);  /* Liberar quando terminar */
}
```

---

## Alocação Dinâmica: malloc/free

### malloc: Requisitar Memória

```c
#include <stdlib.h>

/* Sintaxe básica */
tipo* ponteiro = (tipo*)malloc(quantidade * sizeof(tipo));

if(ponteiro == NULL) {
    /* Falhou! Sem memória */
}

/* Exemplos */
int* array_int = (int*)malloc(100 * sizeof(int));
char* texto = (char*)malloc(50 * sizeof(char));

struct Player* inimigos = (struct Player*)malloc(
    50 * sizeof(struct Player)
);
```

### free: Liberar Memória

```c
free(array_int);        /* Libera */
array_int = NULL;       /* Importante: apontar para NULL */

free(inimigos);
inimigos = NULL;
```

### Regra Ouro

**Toda malloc precisa de um free!**

```c
int* p = malloc(1000);
/* Usar p */
free(p);            /* ✅ Sempre liberar */
```

---

## Perigos Comuns

### 1. Memory Leak (Vazamento)

```c
void vazar_memoria()
{
    int* p = malloc(1000);
    /* Usar p */
    
    return;  /* ❌ Oops! Esqueceu de free */
             /* 1000 bytes perdidos para sempre! */
}
```

### 2. Use After Free

```c
int* p = malloc(1000);
free(p);

p[0] = 42;  /* ❌ CRASH! p não está mais válido */
```

### 3. Double Free

```c
int* p = malloc(1000);
free(p);
free(p);  /* ❌ CRASH! Já foi liberado! */
```

### 4. Stack Overflow

```c
void overflow()
{
    int huge_array[1000000];  /* ❌ Muito grande pro stack! */
}
```

---

## SGDK: Como Usar Memória

### Tipos Fixos vs Dinâmicos

```c
/* Fixo: Tamanho conhecido */
#define MAX_INIMIGOS 100
struct Enemy inimigos[MAX_INIMIGOS];  /* Stack ou seção de dados */

/* Dinâmico: Runtime */
struct Enemy* inimigos = malloc(quantidade * sizeof(struct Enemy));
```

### Sprites SGDK

```c
/* SGDK gerencia sprites */
Sprite* player_sprite = SPR_addSprite(
    &sprite_player,
    x, y,
    SPRITE_FLAG_VISIBLE
);

/* SGDK cuida da memória */
SPR_releaseSprite(player_sprite);  /* Libera quando necessário */
```

### Exemplo Prático: Pool de Inimigos

```c
#include <genesis.h>
#include <stdlib.h>

#define POOL_SIZE 50

struct Enemy {
    u16 x, y;
    u16 vx, vy;
    u16 health;
    u8 ativo;
};

struct EnemyPool {
    struct Enemy* inimigos;
    u16 max_count;
    u16 active_count;
};

/* Criar pool */
struct EnemyPool* criar_pool(u16 tamanho)
{
    struct EnemyPool* pool = malloc(sizeof(struct EnemyPool));
    
    if(pool == NULL) return NULL;
    
    pool->inimigos = malloc(tamanho * sizeof(struct Enemy));
    
    if(pool->inimigos == NULL) {
        free(pool);
        return NULL;
    }
    
    pool->max_count = tamanho;
    pool->active_count = 0;
    
    return pool;
}

/* Adicionar inimigo */
void pool_add_enemy(struct EnemyPool* pool, 
                    u16 x, u16 y, u16 health)
{
    if(pool->active_count >= pool->max_count) {
        return;  /* Pool cheio */
    }
    
    struct Enemy* e = &pool->inimigos[pool->active_count];
    e->x = x;
    e->y = y;
    e->health = health;
    e->ativo = 1;
    
    pool->active_count++;
}

/* Atualizar pool */
void pool_update(struct EnemyPool* pool)
{
    for(int i = 0; i < pool->active_count; i++)
    {
        if(pool->inimigos[i].ativo)
        {
            pool->inimigos[i].x += pool->inimigos[i].vx;
            
            if(pool->inimigos[i].health <= 0) {
                pool->inimigos[i].ativo = 0;
            }
        }
    }
}

/* Liberar pool */
void liberar_pool(struct EnemyPool* pool)
{
    if(pool == NULL) return;
    
    free(pool->inimigos);
    free(pool);
}

int main(u16 hard)
{
    struct EnemyPool* inimigos = criar_pool(POOL_SIZE);
    
    if(inimigos == NULL) {
        /* Erro! */
        return 1;
    }
    
    /* Usar pool */
    pool_add_enemy(inimigos, 50, 50, 100);
    pool_add_enemy(inimigos, 100, 50, 50);
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    while(TRUE)
    {
        VSync();
        
        pool_update(inimigos);
        
        VDP_clearPlane(PLAN_A, 0);
        VDP_drawText("Enemies activos", 2, 5);
    }
    
    liberar_pool(inimigos);
    
    return 0;
}
```

---

## Checklist de Segurança

✅ **Sempre verificar malloc != NULL**

✅ **Sempre fazer free() correspondente**

✅ **Apontar para NULL após free**

✅ **Não acessar dados após free**

✅ **Usar sizeof() para portabilidade**

✅ **Prefira stack se possível** (mais rápido)

✅ **Use pool allocation para itens similares**

---

## Próximo Capítulo

Agora que você entende **Memória**, vamos aprender **[Arrays](./06-arrays.md)** e como organizá-los! 🚀
