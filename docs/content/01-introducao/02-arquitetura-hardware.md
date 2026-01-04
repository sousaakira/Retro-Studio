---
title: Arquitetura do Hardware
icon: fas fa-microchip
---

# Entendendo o Hardware do Mega Drive

Para programar bem com o SGDK, é útil entender como o hardware do Sega Mega Drive / Genesis funciona. Ele é composto por vários processadores especializados.

## 1. Processador Principal: Motorola 68000 (7.67 MHz)

O **68k** é onde a lógica do seu jogo (em C) é executada. Ele é um processador de 16/32 bits.
- **RAM Principal**: 64 KB.
- **Limitação**: Não possui unidade de ponto flutuante (Floating Point Unit). Use `fix16` ou `fix32` do SGDK para cálculos fracionários.

## 2. Co-processador de Som: Zilog Z80 (3.58 MHz)

O **Z80** é o processador de 8 bits (usado no Master System) que gerencia o som no Mega Drive.
- No SGDK, você geralmente não programa o Z80 diretamente. A biblioteca fornece drivers (como o driver XGM) que rodam no Z80 e aceitam comandos do 68k.

## 3. VDP (Video Display Processor)

O **VDP** gerencia tudo o que você vê na tela. Ele possui sua própria memória dedicada (**VRAM**) de 64 KB.

### Camadas de Vídeo (Planes)
O VDP possui 3 camadas principais onde você pode desenhar tiles:
- **Plane A**: Camada de frente para o cenário.
- **Plane B**: Camada de trás para o cenário (paralaxe).
- **Window**: Camada estática para interfaces (HUD).

### Sprites
Os sprites são objetos móveis que flutuam sobre as camadas de fundo. O hardware suporta até 80 sprites simultâneos, com limites por linha horizontal.

### Paletas de Cores
O sistema suporta **4 paletas de 16 cores** cada (64 cores no total).
- A cor 0 de cada paleta é sempre transparente para sprites e planos.

## 4. Gerenciamento de Recursos (ROM)

Seu jogo é compilado em uma imagem de ROM (geralmente entre 512 KB a 4 MB). O SGDK mapeia seus recursos (sprites, imagens, músicas) diretamente na ROM e os carrega para a RAM ou VRAM conforme necessário.

---

Com este conhecimento, você entenderá por que funções como `VDP_init()` ou `PAL_setPalette()` são tão importantes!
