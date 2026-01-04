---
title: Estrutura Básica
icon: fas fa-file-code
---

# Estrutura Básica de um Projeto

Todo programa SGDK segue uma estrutura fundamental baseada no arquivo de cabeçalho `genesis.h` e uma função `main`.

## O Arquivo `genesis.h`

Este é o arquivo principal que inclui todas as definições da biblioteca SGDK. Ele deve estar no topo de todos os seus arquivos fonte `.c`.

```c
#include <genesis.h>
```

## A Função `main`

Diferente de programas C padrão para PC, a função `main` no SGDK recebe um booleano que indica se o console sofreu um **Hard Reset** (ligar o console) ou **Soft Reset** (botão reset).

```c
int main(bool hardReset)
{
    // Código de inicialização aqui
    
    while(1)
    {
        // Lógica do jogo aqui
        
        // Sincronização obrigatória com o VBlank
        SYS_doVBlankProcess();
    }

    return 0;
}
```

## O Loop Principal e `SYS_doVBlankProcess`

O Mega Drive renderiza a imagem a uma taxa de 60Hz (NTSC) ou 50Hz (PAL). O "VBlank" é o curto período de tempo entre os frames onde o hardware de vídeo não está desenhando e podemos enviar dados com segurança.

A função `SYS_doVBlankProcess()` é vital porque ela:
- Aguarda o início do VBlank.
- Processa a fila de **DMA** (Direct Memory Access).
- Atualiza o estado dos **controles**.
- Sincroniza o driver de **som**.
- Realiza o **Fading** de paletas se houver algum em progresso.

## Exemplo Completo de Inicialização

Aqui está um "Hello World" básico que prepara a tela:

```c
#include <genesis.h>

int main(bool hardReset)
{
    // Inicializa o VDP
    VDP_init();
    
    // Configura resolução padrão 320x224
    VDP_setScreenWidth320();
    VDP_setScreenHeight224();

    // Escreve um texto simples
    VDP_drawText("Ola, Retro Studio!", 10, 10);

    while(1)
    {
        // O loop mantém o programa rodando
        SYS_doVBlankProcess();
    }

    return 0;
}
```

---

**Dica:** Sempre tente manter sua lógica de jogo rápida o suficiente para terminar antes do próximo `SYS_doVBlankProcess()`, caso contrário o jogo sofrerá "slowdown".
