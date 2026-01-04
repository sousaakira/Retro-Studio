---
title: Guia Completo VDP (Mega Cat)
icon: fas fa-book-open
description: Guia avançado de gráficos VDP traduzido da Mega Cat Studios.
tags: ['vdp', 'avançado', 'mega-cat', 'gráficos']
---

# Desenvolvimento Retrô: Guia de Gráficos VDP

Este guia é uma tradução e adaptação do **[Sega Genesis/Mega Drive VDP Graphics Guide v1.2a (14/03/17)](https://megacatstudios.com/blogs/retro-development/sega-genesis-mega-drive-vdp-graphics-guide-v1-2a-03-14-17)** original da Mega Cat Studios.

Postado por **Write Meow** · 21 de Setembro de 2017.

**Mega Cat Studios**

---

## VISÃO GERAL DOS CONCEITOS VDP

- **VDP**
  - "**V**ideo **D**isplay **P**rocessor"
  - Chip controlador de vídeo que gerencia os gráficos de tiles, planos de scroll e sprites do Genesis. Na verdade, não é um processador de propósito geral.
- **VRAM**
  - "**V**ideo **RAM**"
    - RAM usada pelo VDP.
    - Armazena tiles (imagens de 8x8 px).
- **Os Dois Principais Tipos de Máquina**
  - **Máquinas NTSC**
    - "Sega Genesis", máquinas de 60Hz, encontradas principalmente nos EUA.
    - Resoluções:
      - Modo **H40** - 320x224 px (**40**x28 tiles). Modo de resolução mais comum.
      - Modo **H32** - 256x224 px (**32**x28 tiles). Modo menos comum.
    - Os jogos da Mega Cat são lançamentos **NTSC**, então use estas resoluções!
  - **Máquinas PAL**
    - "Sega Mega Drive", máquinas de 50Hz, no restante do mundo.
    - Resolução:
      - Modo **H40** - 320x240 px (**40**x30 tiles). Modo mais comum.
      - Modo **H32** - 256x240 px (**32**x30 tiles). Modo menos comum.

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-02.jpg?v=1504517564)
*NTSC Model 2 Sega Genesis vs PAL Model 2 Mega Drive (Europeu)*

---

## OS 3 PLANOS DE GRÁFICOS

- **2 Planos de Scroll**
  - **Plane B** - Plano de fundo (Background). Exibe gráficos de tiles via tilemaps.
  - **Plane A** - Plano frontal (Foreground). Exibe gráficos de tiles via tilemaps.
  - **Subplano Window** - Um subplano do Plane A, com gráficos estáticos que não rolam com o restante do plano.
- Cada linha de tiles é renderizada coluna por coluna.
- Tiles em cada plano podem ter prioridade: **Baixa (Low)** ou **Alta (High)**.

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-03_large.jpg?v=1504517363)
*Tiles para um sprite renderizados em formato normal (4x4 tiles)*

- **1 Plano de Sprites**
  - Desenha os gráficos dos sprites.
  - Internamente, os sprites são renderizados em ordem reversa (colunas processadas por linhas).
  - Posicionados em um espaço virtual de 512x512 px, com (128,128) sendo o canto superior esquerdo da TV.
  - O Genesis exibe até **80 sprites de hardware** simultaneamente.
  - Limite de ~20 sprites por linha (scanline) antes de ocorrer o overflow.
  - Tamanhos limitados a (L x A) de 1-4 tiles em cada dimensão.
  - Sprites maiores são feitos combinando múltiplos sprites de hardware.
  - Possuem prioridade Alta/Baixa em relação aos outros planos.

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-04_large.jpg?v=1504517385)
*Tiles de sprite renderizados internamente no formato transposto (4x4 tiles)*

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-05_large_2276f547-3e8d-4f0d-826c-447ae8e3d66b_large.jpg?v=1505332440)
*Visualização da prioridade das camadas de planos*

---

## VDP CRAM ("Color RAM")

- 4 linhas de paleta, cada uma com 16 cores.
- Profundidade de cor de **4bpp** (4 bits por componente).
- A 1ª cor de cada linha é **transparente**.
- Suporta modos de **Realce (Highlight)** ou **Sombra (Shadow)** para cores mais claras ou escuras.

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-06.jpg?v=1504517493)

---

## PLANOS DE FUNDO (BACKGROUNDS)

Existem 2 planos de tilemap: **Plane B** (fundo) e **Plane A** (frente). Dependendo do modo (H40 ou H32), um mapa de tela cheia terá 32 ou 40 tiles de largura por 28 ou 30 de altura. O Mega Drive é famoso pelo **Parallax Scrolling**: ao rolar linhas de tiles em velocidades diferentes, cria-se a ilusão de profundidade.

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-07_80015de8-cfad-438e-87ae-8f2ce16e03d6.jpg?v=1505332802)

---

## VSRAM (Video Scroll RAM)

Os planos A e B podem ter tamanhos de 32, 64 ou 128 tiles. Planos de 128x64 ou 128x128 são inválidos. Por padrão, as seções de VRAM nos endereços 0xC000 e 0xE000 mostram "tiles de lixo", mas cada pixel ali codifica o mapa VSRAM. Existem 3 modos de scroll: **por scanline**, **por tile** ou **por bloco** (2x2 tiles).

---

## CORES

Tiles podem usar apenas 1 das 4 paletas por vez. A 1ª cor é reservada para transparência (recomendado usar Roxo sólido 255,0,255 para facilitar a edição). Técnicas comuns incluem **Ciclagem de Paleta** (Palette Cycling) para animações como cachoeiras, e **Efeitos de Raster** (Raster Effects) para trocar cores no meio da tela (ex: efeito de água).

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-12_ec312d4f-7c00-449b-aa69-857a4c6ce71a.jpg?v=1505333683)
*Uso de dois planos para permitir mais cores em espaços pequenos.*

---

## SPRITES E ANIMAÇÃO

Os sprites têm tamanho de 1-4 tiles. O limite é de 80 na tela e 20 por linha. Muitos jogos usam múltiplos sprites para objetos grandes. No Mega Drive, as artes devem sempre ser divisíveis por 8 pixels para alinhar com os tiles.

A animação é feita trocando os frames dos sprites. Uma técnica comum é o **DPLC (Dynamic Pattern Load Cues)**: carregar dinamicamente apenas os tiles necessários para o frame atual na VRAM, economizando memória. O motor de sprites do SGDK utiliza DPLC para otimizar o uso de memória.

![img](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-16_0550afac-2efd-4896-b0d5-36c6295f27c7.jpg?v=1505333931)

---

## FERRAMENTAS RECOMENDADAS

- **RetroGraphicsToolkit**: Essencial para quantizar arte, otimizar tilemaps e reduzir cores.
- **IrfanView**: Editor genérico útil para manipular paletas e profundidade de cor preservando a ordem.
- **PCXpal**: Conversor de formatos de paleta (JASC, Megadrive .bin, etc.).

### Emuladores com Debugger VDP
- **Gens KMod**: Visualizador de VRAM, Sprites e Planos em tempo real.
- **Exodus**: Emulador focado em precisão de ciclo (cycle-accurate) e desenvolvimento.

---

## JOGOS PARA REFERÊNCIA

- **Sonic the Hedgehog**: Famoso pelos efeitos de raster na água, DPLC de sprites e parallax complexo.
- **The Adventures of Batman and Robin**: Efeitos gráficos avançados e pesados.
- **Castlevania Bloodlines / Aladdin**: Animações fluidas.
- **Red Zone**: Rotação de sprites e tilemaps via software!

---

*Tradução e Adaptação: Retro Studio. Créditos: Mega Cat Studios.* 🎮