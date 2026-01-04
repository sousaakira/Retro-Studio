---
title: Guia de Gráficos VDP
icon: fas fa-image
description: Um guia técnico sobre o processador de vídeo do Mega Drive, baseado no material da Mega Cat Studios.
tags: ['vdp', 'gráficos', 'avançado', 'hardware']
---

# Guia Completo de Gráficos VDP (Mega Drive)

Este guia é uma tradução e adaptação técnica do renomado guia da **Mega Cat Studios**, cobrindo desde conceitos básicos até técnicas avançadas de hardware do Sega Genesis / Mega Drive.

![Sega Genesis VDP](https://megacatstudios.com/cdn/shop/articles/banner-7_1024x1024_899c24aa-5377-48af-845f-9b6c71eb5dce-3057872_394x.png?v=1763019521)

## 1. Visão Geral dos Conceitos VDP

O **VDP (Video Display Processor)** é o chip controlador de vídeo que gerencia os gráficos baseados em tiles, planos de scroll e sprites. É importante notar que ele não é um processador de propósito geral, mas um hardware especializado em desenho.

### VRAM (Video RAM)
A memória principal do VDP onde são armazenados:
- **Tiles**: Pequenas imagens de 8x8 pixels (a base de tudo).
- **Tilemaps**: Tabelas que dizem ao VDP qual tile desenhar em cada posição da tela.

### Tipos de Máquina e Resoluções
- **NTSC (Sega Genesis)**: 60Hz. Modo comum **H40 (320x224 px)**.
- **PAL (Mega Drive)**: 50Hz. Modo comum **H40 (320x240 px)**.

![Modelos de Console](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-02.jpg?v=1504517564)

---

## 2. Planos de Gráficos

O sistema utiliza 3 planos de fundo:

- **Plane B (Background)**: Plano de fundo para cenários distantes.
- **Plane A (Foreground)**: Plano frontal para o cenário de interação.
- **Window Subplane**: Uma parte especial do Plane A que não possui scroll (estática), ideal para HUDs e menus.

Cada tile nesses planos pode ter prioridade **Alta** ou **Baixa**, determinando se ficará acima ou abaixo dos sprites.

---

## 3. Cores e Paletas (CRAM)

Dominar as cores é o segredo para gráficos impressionantes no Mega Drive.

- **CRAM (Color RAM)**: 4 linhas de paleta, cada uma com 16 cores.
- **Transparência**: O índice 0 de cada paleta é **sempre transparente**.
- **Profundidade**: 4 bits por cor (4bpp), gerando uma paleta total de 512 cores.

### Exemplo de Uso de Paletas Dinâmicas:
![Comparação de Planos e Paletas](https://cdn.shopify.com/s/files/1/2330/7513/files/saga-12_ec312d4f-7c00-449b-aa69-857a4c6ce71a.jpg?v=1505333683)
*Nesta imagem, duas linhas de paleta são usadas simultaneamente para permitir mais cores em espaços pequenos combinando o Plane A e o Plane B.*

---

## 4. Técnicas Avançadas de Cor

### Palette Cycling (Ciclagem de Paleta)
Consiste em alterar as cores da paleta a cada poucos frames. Usado para criar efeitos de animação em elementos estáticos, como:
- Cachoeiras (água correndo).
- Luzes pulsantes.
- Barras de energia brilhantes.

### Raster Effects (Efeitos de Raster)
Trocar cores da paleta no meio da renderização da tela (após uma linha horizontal específica). É a técnica usada para o efeito de "água" (cores diferentes quando o jogador está mergulhado).

---

## 5. VSRAM e Scroll Planes

As camadas Plane A e B podem ter tamanhos de **32, 64 ou 128 tiles**. Esses planos são "rolados" para dentro e para fora da área visível.

O VDP suporta 3 modos de scroll:
1. **Por Scanline**: Cada linha de pixels horizontal pode se mover independentemente.
2. **Por Tile**: Blocos de 8x8 pixels se movem.
3. **Por Bloco**: Seções de 16x16 pixels.

---

## 6. Sprites e Animação

Os sprites são definidos em tamanhos de 1x1 até 4x4 tiles (max 32x32 pixels).

- **Hardware Limit**: Máximo de 80 sprites na tela e 20 por linha.
- **Link Value**: Cada sprite tem um valor de link; sprites com valores menores são desenhados sobre os de valores maiores.

### DPLC (Dynamic Pattern Load Cues)
Muitos jogos (como Sonic) usam DPLC para carregar apenas os tiles do frame atual do sprite na VRAM "on-the-fly". Isso economiza VRAM preciosa, permitindo animações muito mais ricas para o personagem principal.

---

## 7. Ferramentas Recomendadas

Para trabalhar profissionalmente com esses limites, recomenda-se:

- **RetroGraphicsToolkit**: A melhor ferramenta para quantizar arte em tiles, reduzir cores e otimizar tilemaps.
- **IrfanView**: Excelente para gerenciar paletas e preparar arquivos PNG para o `rescomp` do SGDK.

---

## Resumo Técnico (SGDK)

@ref PAL_setPalette
@description Carrega uma paleta inteira (16 cores) em um dos slots (PAL0 a PAL3).
@return void
@example
PAL_setPalette(PAL0, bg_image.palette->data, DMA);
@end

@ref VDP_setScrollingMode
@description Define a precisão do scroll (linha, tile ou plano inteiro).
@return void
@example
VDP_setScrollingMode(HSCROLL_LINE, VSCROLL_PLANE);
@end

---

*Tradução e Adaptação: Retro Studio Team. Fonte Original: Mega Cat Studios (v1.2a).* 🎮
