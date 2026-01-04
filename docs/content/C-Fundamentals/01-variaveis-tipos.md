---
title: Variáveis e Tipos de Dados
description: Os blocos de construção do C - Fase 1
---

# 📝 Variáveis e Tipos de Dados

Variáveis são **caixas** onde você guarda números, textos, dados.

Tipos dizem **qual tipo de coisa** você pode guardar em cada caixa.

## Tipos em C Padrão

```c
int     /* Inteiro comum: -2 bilhões a +2 bilhões */
char    /* Um caractere: 'A', 'z', '5' */
float   /* Número com decimal: 3.14, 99.9 */
double  /* Float maior e mais preciso */
```

## Tipos SGDK (Mais úteis para Mega Drive)

```c
u8      /* Unsigned 8-bit: 0 até 255 */
s8      /* Signed 8-bit: -128 até 127 */
u16     /* Unsigned 16-bit: 0 até 65535 */
s16     /* Signed 16-bit: -32768 até 32767 */
u32     /* Unsigned 32-bit: gigante */
s32     /* Signed 32-bit: gigante, negativo */

fix16   /* Decimal "fixo" (rápido no 68000) */
fix32   /* Decimal fixo maior */
```

**Por que SGDK?** Porque o Mega Drive tem 16 bits. SGDK deixa explícito.

---

## Declarando Variáveis

### Forma Básica

```c
int idade = 25;          /* Tipo, nome, valor inicial */
u16 pontos = 0;
char inicial = 'A';
```

### No SGDK

```c
u16 x = 160;             /* Posição X do player */
u16 y = 100;             /* Posição Y do player */
u16 velocidade = 5;      /* Pixels por frame */
s16 saude = 100;         /* Pode ser negativo? Não, mas... */
```

### Inicialização é Importante!

```c
int numero;              /* ❌ Lixo de memória! Undefined! */
int numero = 0;          /* ✅ Inicializado com 0 */
```

---

## Exemplo Real: Player Simples

```c
#include <genesis.h>

int main(u16 hard)
{
    /* Dados do player */
    u16 player_x = 160;      /* Posição inicial: centro da tela */
    u16 player_y = 112;      /* Meio da altura */
    u16 velocidade = 3;      /* 3 pixels por frame */
    u16 saude = 100;
    u8  invuneravel = 0;     /* Flag: 0 ou 1 (false/true) */
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    /* Desenhar posição inicial */
    char buffer[20];
    sprintf(buffer, "X:%d Y:%d", player_x, player_y);
    VDP_drawText(buffer, 5, 5);
    
    /* Loop mostrando valores */
    while(TRUE)
    {
        VSync();
        
        /* Simular movimento */
        player_x += velocidade;
        
        /* Se saiu da tela, volta */
        if(player_x > 320)
            player_x = 0;
        
        /* Atualizar display */
        VDP_clearPlane(PLAN_A, 0);
        sprintf(buffer, "X:%d Y:%d", player_x, player_y);
        VDP_drawText(buffer, 5, 5);
    }
    
    return 0;
}
```

---

## Tabela: Quando Usar Cada Tipo

| Tipo | Use para... | Exemplo |
|------|------------|---------|
| `u8` | Números 0-255 | Contador, índice pequeno |
| `s8` | Números -128 a 127 | Offset pequeno |
| `u16` | Números 0-65535 | Posição na tela (320x224) |
| `s16` | Números com sinal | Velocidade (pode ir pra trás) |
| `u32` | Números GRANDES | Pontuação, timer longo |
| `fix16` | Decimais (1.5, 2.3) | Velocidade decimal |
| `fix32` | Decimais GRANDES | Ângulos, zoom |

---

## Escala de Tamanho

```
u8 = 1 byte = 8 bits
s8 = 1 byte = 8 bits

u16 = 2 bytes = 16 bits
s16 = 2 bytes = 16 bits

u32 = 4 bytes = 32 bits
s32 = 4 bytes = 32 bits

fix16 = 2 bytes (como u16)
fix32 = 4 bytes (como u32)
```

**Importante**: Menos bytes = mais rápido no Mega Drive!

---

## Operações Básicas

```c
u16 x = 100;
u16 y = 50;

/* Aritmética */
u16 soma = x + y;       /* 150 */
u16 diff = x - y;       /* 50 */
u16 mult = x * 2;       /* 200 */
u16 div = x / 2;        /* 50 */

/* Modificação */
x = x + 10;             /* x agora é 110 */
x += 10;                /* Mesmo que acima */
x++;                    /* x agora é 111 */

/* Comparação (para if) */
if(x > 100) { }         /* x é maior que 100? */
if(x == 100) { }        /* x é exatamente 100? */
if(x != 100) { }        /* x NÃO é 100? */
```

---

## Conversão Entre Tipos

```c
u8 pequeno = 100;
u16 grande = pequeno;   /* OK, expande */

u16 grande2 = 50000;
u8 pequeno2 = grande2;  /* ⚠️ Perde dados! */
                        /* 50000 não cabe em u8 */
                        /* Resultado: lixo */

/* Conversão explícita */
u8 pequeno3 = (u8)grande2;  /* Força conversão */
                            /* Mas ainda perde dados */
```

---

## Nomes de Variáveis

### ✅ BOM

```c
u16 player_x;
u16 health;
u16 score;
u8 is_jumping;
```

### ❌ RUIM

```c
u16 px;         /* Muito curto */
u16 a;          /* Uma letra? */
u16 data;       /* Muito vago */
u16 x1x2x3;     /* Confuso */
```

---

## Escopo de Variável

```c
int main()
{
    u16 x = 100;        /* x existe aqui */
    
    if(x > 50)
    {
        u16 y = 200;    /* y existe DENTRO do if */
        x = y;          /* OK, x existe */
    }
    
    /* y não existe mais! Erro! */
    /* x ainda existe */
    
    return 0;
}
```

---

## Exercício Prático

Crie um programa que:

1. Declare 5 variáveis para um inimigo:
   - posição x, y
   - velocidade
   - saúde
   - ativo (sim/não)

2. Inicialize todas

3. Mostre os valores na tela

**Solução**:

```c
#include <genesis.h>

int main(u16 hard)
{
    /* Dados do inimigo */
    u16 enemy_x = 50;
    u16 enemy_y = 50;
    u16 enemy_speed = 2;
    u16 enemy_health = 50;
    u8 enemy_ativo = 1;     /* 1 = ativo, 0 = morto */
    
    Z80_requestBus(TRUE);
    VDP_setScreenWidth(320);
    VDP_setScreenHeight(224);
    VDP_setEnable(TRUE);
    Z80_releaseBus();
    
    char buffer[30];
    
    while(TRUE)
    {
        VSync();
        
        VDP_clearPlane(PLAN_A, 0);
        
        sprintf(buffer, "Enemy X:%d Y:%d", enemy_x, enemy_y);
        VDP_drawText(buffer, 2, 5);
        
        sprintf(buffer, "Health: %d", enemy_health);
        VDP_drawText(buffer, 2, 7);
        
        sprintf(buffer, "Ativo: %s", enemy_ativo ? "SIM" : "NAO");
        VDP_drawText(buffer, 2, 9);
    }
    
    return 0;
}
```

---

## Próximo Capítulo

Agora que você sabe declarar variáveis, vamos aprender **[Funções](./02-funcoes.md)** - reutilizar código! 🚀
