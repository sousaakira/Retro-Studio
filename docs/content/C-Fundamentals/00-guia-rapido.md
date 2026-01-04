---
title: Guia Rápido - C para Games em 10 Minutos
description: Resumo visual dos conceitos essenciais
---

# ⚡ Guia Rápido - C para Games em 10 Minutos

**Não tem tempo?** Aqui estão os 10 conceitos que realmente importam:

---

## 1. Variáveis - Caixas para Guardar Dados

```c
int idade = 25;           /* Inteiro */
u16 posicao_x = 160;      /* Sem sinal (Mega Drive) */
s16 velocidade = -5;      /* Com sinal (pode ser negativo) */
float vida = 99.5;        /* Decimal */
```

**Tipos SGDK que você vai usar:**
- `u8` (0-255), `s8` (-128-127)
- `u16` (0-65535), `s16` (-32768-32767)
- `u32` (gigante), `fix16` (decimal rápido)

---

## 2. Structs - Agrupar Dados Relacionados

```c
struct Player {
    u16 x, y;           /* Posição */
    u16 vx, vy;         /* Velocidade */
    u16 saude;
    u8 ativo;           /* Flag: 0 ou 1 */
};

/* Usar: */
struct Player heroi = {160, 100, 0, 0, 100, 1};
heroi.x = 170;          /* Acessar membro */
```

---

## 3. Ponteiros - Endereços de Memória

```c
int x = 42;
int* ptr = &x;          /* & = "endereço de" */
                        /* ptr aponta para x */

int valor = *ptr;       /* * = "conteúdo de" */
                        /* valor = 42 */

/* Regra: Use ponteiro se quer MODIFICAR */
void danificar(int* saude) {
    *saude -= 10;       /* Modifica ORIGINAL */
}
```

---

## 4. Funções - Reutilizar Código

```c
/* Definir */
int somar(int a, int b) {
    return a + b;
}

/* Usar */
int resultado = somar(5, 3);  /* 8 */

/* Sem retorno */
void mostrar_msg(char* texto) {
    VDP_drawText(texto, 5, 5);
}
```

---

## 5. Arrays - Listas de Dados

```c
int numeros[10];        /* Array de 10 ints */
u16 posicoes[100];      /* Array de 100 u16s */

/* Inicializar */
numeros[0] = 42;
numeros[1] = 99;

/* Loop */
for(int i = 0; i < 10; i++) {
    numeros[i] = i * 10;
}
```

---

## 6. Game Loop - O Coração de Todo Jogo

```c
int main() {
    while(TRUE) {
        /* 1. INPUT */
        u16 input = JOY_readJoypad(JOY_1);
        
        /* 2. UPDATE */
        player.x += player.vx;
        
        /* 3. RENDER */
        VDP_drawText("Score: 100", 5, 5);
        
        /* 4. VSYNC */
        VSync();  /* Sincronizar com tela */
    }
}
```

---

## 7. Memória - Stack vs Heap

```c
/* STACK: Rápido, automático, limitado */
int array[100];         /* Variáveis locais */
struct Player p;        /* Automáticamente liberadas */

/* HEAP: Lento, manual, grande */
int* data = malloc(10000 * sizeof(int));
if(data == NULL) { /* Erro! */ }
/* ... usar data ... */
free(data);         /* IMPORTANTE! Liberar */
```

---

## 8. Operador `->` - Acessar Struct via Ponteiro

```c
struct Player* p = &heroi;

/* Ambos funcionam: */
(*p).x = 100;       /* Feio */
p->x = 100;         /* Melhor */

VDP_drawText(p->nome, 5, 5);
```

---

## 9. Tipos de Retorno - `void` vs Valores

```c
void nao_retorna() {
    /* ... */
}

int retorna_valor() {
    return 42;
}

u8 retorna_flag() {
    return 1;  /* true/false */
}
```

---

## 10. Máquina de Estados - Controlar Fluxo

```c
#define STATE_MENU    0
#define STATE_PLAYING 1
#define STATE_GAMEOVER 2

u8 estado = STATE_MENU;

while(TRUE) {
    switch(estado) {
        case STATE_MENU:
            if(botao_start) estado = STATE_PLAYING;
            break;
            
        case STATE_PLAYING:
            /* Lógica do jogo */
            break;
            
        case STATE_GAMEOVER:
            if(botao_start) estado = STATE_MENU;
            break;
    }
    
    VSync();
}
```

---

## Padrão: Um Jogo Simples

```c
#include <genesis.h>

struct Game {
    u16 player_x;
    u16 pontos;
};

int main(u16 hard) {
    struct Game game = {160, 0};
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    while(TRUE) {
        /* INPUT */
        u16 input = JOY_readJoypad(JOY_1);
        if(input & BUTTON_LEFT) game.player_x -= 5;
        if(input & BUTTON_RIGHT) game.player_x += 5;
        
        /* UPDATE */
        game.pontos++;
        
        /* RENDER */
        VDP_clearPlane(PLAN_A, 0);
        char buf[20];
        sprintf(buf, "Pontos: %d", game.pontos);
        VDP_drawText(buf, 5, 5);
        
        /* VSYNC */
        VSync();
    }
    
    return 0;
}
```

---

## Checklist: Usar Sempre

✅ **Inicializar variáveis**
```c
int x = 0;
```

✅ **Verificar malloc**
```c
if(ptr == NULL) { }
```

✅ **Liberar heap**
```c
free(ptr);
ptr = NULL;
```

✅ **Usar ponteiro em funções**
```c
void func(Type* p)
```

✅ **VSync no loop**
```c
VSync();
```

✅ **Comentar código complexo**
```c
/* Isso faz X */
```

---

## Erros Comuns

| Erro | Problema | Solução |
|------|----------|---------|
| `*ptr` sem iniciar | Acesso aleatório | `int* ptr = NULL;` |
| Sem `free()` | Vazamento de memória | `free(ptr); ptr = NULL;` |
| Sem `VSync()` | Tearing visual | Adicionar `VSync();` |
| Stack overflow | Array muito grande | Usar `malloc()` |
| `ptr->x` sem `->` | Sintaxe errada | Usar `p->membro` sempre |

---

## Próximos Passos

1. **Quer detalhes?** Veja: [Variáveis e Tipos](./01-variaveis-tipos.md)
2. **Assustado com Ponteiros?** Leia: [Ponteiros 101](./02-ponteiros-basico.md)
3. **Entender Estrutura de Jogo?** Vá para: [Game Loop](./06-game-loop.md)

---

## Lembre-se

> C é honesto. Sem abstrações. Sem magia.
> 
> Você vê:
> - Memória
> - Velocidade
> - Limitações reais
> 
> Isso é BOM. Acelera o aprendizado de verdade.
> 
> 🎮 Divirta-se!
