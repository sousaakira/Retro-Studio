---
title: Guia Completo de Gráficos do Sega Mega Drive / Genesis
description: Um guia técnico e abrangente sobre como os gráficos do Mega Drive funcionam, desde o VDP até efeitos avançados
tags: [graphics, vdp, mega-drive, genesis, tutorial, graphics-effects]
---

# Guia Completo de Gráficos do Sega Mega Drive / Genesis

> **Nota**: Este guia é uma tradução e compilação baseada na excelente documentação disponível em [rasterscroll.com/mdgraphics/](https://rasterscroll.com/mdgraphics/). Recomendamos consultar o site original para mais detalhes e exemplos visuais.

## Introdução

Este guia foi criado para todos aqueles que desejam entender como os gráficos do Mega Drive funcionam, sem necessariamente precisar aprender a programar o console. A maioria das informações e guias disponíveis online são direcionadas para programadores ou aqueles que já possuem conhecimento sobre hardware de consoles.

Este guia, em contraste, é destinado a um público geral não-programador, embora não evitemos incluir um certo nível necessário de complexidade nos detalhes técnicos.

### Por que aprender como os gráficos do Mega Drive funcionam?

Compreender como os gráficos do Mega Drive funcionam traz uma nova apreciação pelos jogos antigos. Essa compreensão nos permite vislumbrar a criatividade dos desenvolvedores que, com ferramentas limitadas, criavam efeitos visuais impressionantes e inovadores.

### Como ler este guia

Existem (pelo menos) duas formas de ler este guia, dependendo de seus interesses:

1. **Se você já está familiarizado com hardware de consoles** ou quer apenas uma visão rápida de como os efeitos gráficos funcionam, pule para a seção de "Efeitos Gráficos".

2. **Se você é novo no hardware** e está motivado a aprender seu funcionamento interno, comece do início e leia tudo antes de passar para a seção de Efeitos Gráficos.

---

## Visão Geral do VDP

O **VDP (Video Display Processor)** é o chip de vídeo personalizado responsável por renderizar os gráficos do Mega Drive. Mais do que qualquer outro componente do sistema, o VDP define as características e limitações gráficas do console. Para entender os gráficos do Mega Drive significa, em grande medida, entender como o VDP funciona.

### Tiles (Blocos)

Como a maioria dos chips de vídeo de placas de arcade e consoles caseiros dos anos 1980, o VDP é baseado em tiles. Um tile, no caso do VDP, é um quadrado de 8 x 8 pixels, representando a unidade gráfica mais básica que o VDP pode exibir.

**Características dos Tiles:**

- Todos os gráficos dos sprites e planos de fundo são compostos por tiles
- Pixels podem ser transparentes, fazendo um tile parecer menor que 8 x 8 pixels
- Tiles são tipicamente armazenados como dados na ROM do cartucho e depois transferidos para a VRAM (Video RAM)
- A mesma tile pode ser referenciada múltiplas vezes, economizando memória

**Vantagens do sistema de Tiles:**

- Reduz dramaticamente o uso de memória
- Simplifica o desenvolvimento de jogos
- Em vez de referenciar a localização de cada pixel, os desenvolvedores apenas referenciam cada tile

**Modos de Exibição:**

Para televisões NTSC, o VDP pode trabalhar em dois tamanhos de exibição:

- **H40 (40 x 28 tiles / 320 x 224 pixels)** - Modo mais comum em jogos Mega Drive, oferece melhor resolução
- **H32 (32 x 28 tiles / 256 x 224 pixels)** - Modo alternativo onde pixels aparecem horizontalmente "esticados"

### Planos de Fundo

O VDP suporta **dois planos de fundo com scroll independente**: Plane A e Plane B.

**Características:**

- Plane B fica atrás de Plane A por padrão
- Ambos os planos funcionam da mesma forma
- Podem ser usados em conjunto para criar efeito de parallax (paralaxe)

**Tamanhos Suportados (horizontal x vertical, em tiles):**

- 32 x 32; 32 x 64; 32 x 128
- 64 x 32; 64 x 64
- 128 x 32

**Importante:** Ambos os planos devem ser configurados com o mesmo tamanho.

**Loop de Planos:**

Os planos fazem loop endlessly - quando a extremidade horizontal ou vertical é atingida, o plano volta para o começo. Isso significa que mesmo se o plano for menor que o tamanho de exibição, a tela ainda pode ser totalmente preenchida com tiles (embora alguns se repitam).

### Scrolling (Deslocamento)

O scroll é uma função importante para jogos 2D. O VDP permite que a CPU indique ao VDP para fazer scroll de um ou ambos os planos independentemente, tanto horizontalmente quanto verticalmente.

**Características do Scroll:**

- Pode ser feito pixel-por-pixel, garantindo movimento suave
- A velocidade do scroll pode ser ajustada
- Mesmo que um plano seja maior que o tamanho de exibição, pode ser totalmente visualizado deslocando-se para a área de exibição

### Plano de Janela (Window Plane)

O VDP também suporta um plano de janela, que é renderizado como uma porção de Plane A que permanece fixa e não sofre scroll com o resto do plano.

**Usos típicos:**

- Exibir informações do jogador (saúde, vidas, pontuação)
- Como tem uma tilemap diferente de Plane A, oferece flexibilidade total de design
- Alguns jogos optam por não usar e em vez disso exibem informações de jogador usando sprites

### Sprites

Além de dois planos de fundo com scroll, o VDP suporta um grande número de sprites na tela.

**Características dos Sprites:**

- Representam personagens, inimigos, itens e outros objetos pequenos e móveis
- São um dos componentes principais de jogos 2D
- Podem ser animados (ciclar através de série de frames de animação)
- O VDP pode virar um sprite através de ambos seus eixos (horizontal e vertical)

**Animação de Sprites:**

O VDP não oferece suporte especial para animação. Em vez disso, a CPU 68000 atualiza as informações de sprite do VDP a cada alguns frames para referenciar um tile de gráficos diferente na VRAM.

### Prioridade de Exibição

O VDP combina informações de ambos os planos e sprites para determinar o que está na área de exibição ativa. A ordem em que esses elementos aparecem é definida pela **prioridade de exibição**.

**Padrão de Prioridade (do topo para baixo):**

1. Sprites
2. Plane A
3. Plane B
4. Cor de Fundo

**Configuração de Prioridade:**

- Cada tile de cada plano pode ser configurada como baixa ou alta prioridade
- Cada sprite pode ter sua prioridade definida independentemente
- Uma sprite ou plano configurado como alta prioridade sempre aparecerá acima de qualquer coisa com baixa prioridade

### Cor (Indexed Color)

O VDP usa **cor indexada** para armazenar informações de cores.

**Como funciona:**

- Cada pixel é definido por apenas 4 bits (um número entre 0-15)
- Esses 4 bits representam uma entrada em uma das 4 paletas de cores do VDP
- Cada paleta contém 16 cores
- Total: O VDP tem acesso a 512 cores disponíveis

**Vantagens:**

- Reduz dramaticamente a memória necessária para armazenar um tile
- Permite que cores sejam alteradas facilmente sem mudar o tile em si
- Facilita adicionar variedade aos tiles de fundo ou sprites de inimigos
- A mesma tile com diferentes paletas cria visuais completamente diferentes

**Cor Transparente:**

- A primeira cor de uma tile (cor 0) é sempre transparente
- Permite que tiles pareçam menores que 8 x 8 pixels
- Útil para desenhar objetos pequenos, curvas, etc.

### DMA (Direct Memory Access)

O DMA é um método para transferir dados para a VRAM de forma mais eficiente que transferências normais pela CPU.

---

## Funcionamento Interno do VDP

Esta seção apresenta uma discussão mais profunda sobre como o VDP realmente implementa as características discutidas na visão geral.

### Registradores do VDP

O VDP possui **24 registradores** usados para configurá-lo. Cada registrador é definido escrevendo um comando particular para a porta de controle do VDP.

**Funções dos Registradores:**

- Ligar/desligar a exibição
- Definir modo NTSC ou PAL
- Definir endereços iniciais das tabelas de plano, sprite e scroll na VRAM
- Definir a cor de fundo
- Definir modo H32 ou H40
- Ativar modo de sombra e destaque
- Definir o tamanho dos planos de fundo
- Definir a posição do plano de janela
- Configurar scroll horizontal como por plano, por linha ou por scanline
- Configurar scroll vertical como por plano ou por coluna
- Ativar interrupções horizontal e vertical
- Configurar DMA

### Estrutura de Tile

O VDP usa 64 KB de memória, chamada VRAM (Video RAM), para armazenar tiles de gráficos e tabelas.

**Além de VRAM:**

- **VSRAM (Vertical Scroll RAM)**: 80 bytes para a tabela de scroll vertical
- **CRAM (Color RAM)**: 128 bytes para a tabela de paleta de cores

**Armazenamento em VRAM:**

- A maioria da VRAM é usada para armazenar tiles de gráficos
- O VDP referencia dados de tiles armazenados em VRAM ao renderizar a tela
- Um tile não pode ser renderizado se não estiver armazenado em VRAM

**Estrutura Exata de um Tile:**

Um tile é um bitmap - uma série de bits definindo as cores dos pixels que compõem o tile. Para o VDP, um único pixel é definido por apenas 4 bits (um número entre 0-15, convenientemente representável por um dígito hexadecimal único).

### Tabelas do VDP

A VRAM contém os dados de tile usados pelo VDP para renderizar os gráficos, mas os dados de tile sozinhos não dizem ao VDP como as tiles devem ser arranjadas e exibidas na tela ou qual paleta de cores usar. Essa informação vem de um conjunto de tabelas armazenadas na RAM do VDP:

#### Plane Pattern Tables

Essas tabelas contêm o arranjo dos tiles de gráficos em ordem desejada (qual tile e onde).

**Características:**

- Cada entrada na tabela define um tile de gráficos do plano
- A ordem das entradas reflete a ordem em que os tiles são exibidos
- Primeira entrada: tile superior-esquerdo do plano
- Segunda entrada: tile à direita do primeiro
- Continua atravessando o linha antes de pular para a próxima linha
- Cada entrada tem 2 bytes e contém: prioridade, paleta de cores, orientação, número indexado

#### Sprite Attribute Table

Contém toda a informação concernente aos sprites.

**Características:**

- Cada entrada representa um único sprite
- O VDP suporta 80 sprites, então há 80 entradas
- Cada entrada tem 8 bytes contendo: posição de exibição, tamanho, dados de link de sprite, etc.

#### Tabela de Scroll

Define quanto cada plano foi deslocado (rolado) em pixels.

#### Color Palette Table

Define as cores reais que aparecem na tela. A CRAM (Color RAM) armazena 4 paletas de 16 cores cada.

### Limitações de Memória

Uma das principais limitações que os programadores enfrentaram é um gargalo em relação a quanto dados podem ser enviados para o VDP em um curto período de tempo.

**Implicações:**

- Mesmo que uma grande quantidade de dados possa ser armazenada na ROM do cartucho
- Apenas uma pequena porção é acessível ao VDP por vez na VRAM
- O processo de enviar novos dados para o VDP é relativamente lento
- Isso forçou os desenvolvedores a serem criativos com reutilização de tiles

### Shadow and Highlight Mode

O VDP suporta um modo especial chamado Shadow and Highlight que cria efeitos visuais especiais.

---

## Arquitetura de Hardware do Mega Drive

O Mega Drive possui dois processadores, cada um com seu próprio barramento:

1. **CPU**: Motorola 68000
2. **Co-processador**: Zilog Z80

### CPU - Motorola 68000

O 68000 era um dos processadores mais populares dos anos 1980.

**Vantagens da escolha:**

- Custo acessível (após negociações bem-sucedidas com o fabricante Signetics)
- Desempenho capaz
- Arquitetura bem-projetada
- Já familiar para muitos desenvolvedores
- Permitiu aos desenvolvedores portar facilmente jogos de arcade que usavam 68000

### Co-processador - Zilog Z80

O Z80 foi o CPU usado no Sega Master System e foi incluído no Mega Drive primariamente para suporte à compatibilidade reversa.

**Funções:**

- Controlador para os chips de som Yamaha YM2612 FM e TI SN76489 PSG
- O SN76489 é fisicamente parte do VDP

### Memória do Sistema

O 68000 do Mega Drive tem acesso a:

- **64 KB de RAM**: Usado para armazenar temporariamente dados sendo processados
- **ROM do Cartucho**: Armazenamento permanente para código de jogo e dados

**Conteúdo da RAM:**

- Variáveis de estado de jogo
- Saúde do jogador, pontuação
- Localizações de sprites na tela
- Estados de ação de personagens inimigos
- Gráficos descompactados
- Efeitos gráficos baseados em software

### Memory-Mapped I/O

Cada componente do sistema é referenciado por um endereço de memória específico ou intervalo de endereços:

| Intervalo de Endereços | Descrição |
|------------------------|-----------|
| $000000 - $3FFFFF | ROM do Cartucho |
| $A00000 - $A01FFF | RAM do Z80 |
| $A10002 - $A10003 | Porta de dados do Controle 1 |
| $A10004 - $A10005 | Porta de dados do Controle 2 |
| $C00000 - $C00003 | Porta de dados do VDP |
| $C00004 - $C00007 | Porta de controle do VDP |
| $FF0000 - $FFFFFF | RAM do 68000 |

### Comunicação com o VDP

O 68000 comunica com o VDP através de duas portas principais:

1. **Porta de Controle**: Para definir registradores do VDP e instruir o VDP sobre o que fazer com dados recebidos
2. **Porta de Dados**: Para ler e escrever dados de/para VRAM

**Processo de Envio de Gráficos para VRAM:**

1. 68000 envia para a porta de controle do VDP o endereço da VRAM onde os gráficos serão escritos
2. 68000 envia os dados de gráficos para a porta de dados do VDP
3. VDP escreve os dados no endereço especificado na VRAM

---

## Efeitos Gráficos no Mega Drive

Esta seção apresenta uma série de efeitos gráficos básicos encontrados no Mega Drive. Não é abrangente, mas cobre os efeitos mais comuns que o VDP suportava.

### 1. Full-Screen Scrolling (Scroll de Tela Inteira)

O Mega Drive possui dois planos de fundo que podem ser feitos scroll independentemente um do outro, horizontalmente, verticalmente, ou em ambos os eixos.

**Efeito de Parallax:**

Um efeito de parallax pode ser criado rolando os planos em diferentes velocidades. Isso adiciona uma sensação de profundidade fazendo o fundo mais distante rolar em velocidade mais lenta que o primeiro plano.

**Técnica:**

- Plane A (primeiro plano) rola em velocidade X
- Plane B (fundo) rola em velocidade Y (geralmente menor que X)
- Diferença de velocidades cria ilusão de profundidade

**Window Plane:**

O Window Plane, que faz parte de Plane A, nunca faz scroll e é típico ser usado para exibir informações do jogador.

**Scroll Diagonal:**

Scroll horizontal e vertical podem ser combinados para fazer scroll diagonal.

### 2. Row / Column Scrolling

Permite scroll diferenciado por linhas (Row) ou colunas (Column), criando efeitos wavy e distorções.

### 3. Line Scrolling

Oferece controle de scroll por linha de scanline, permitindo efeitos ainda mais complexos e distorções.

### 4. Animation (Animação)

Sprites e tiles podem ser animados alternando entre diferentes frames de animação armazenados em VRAM.

**Como funciona:**

- VRAM contém várias versões de um sprite/tile
- CPU atualiza continuamente quais frames estão sendo exibidos
- Ciclar através de frames cria ilusão de movimento

### 5. Multi-Jointed Characters (Personagens com Múltiplas Articulações)

Personagens complexos são compostos de vários sprites ligados que podem ser animados independentemente.

### 6. Tilting / Rotation (Inclinação / Rotação)

O VDP não suporta nativamente rotação ou inclinação de sprites ou planos.

**Simulação de Rotação:**

- Pré-renderizar vários frames da animação de rotação
- Alternar entre frames para criar ilusão de rotação suave
- Técnica custosa em termos de memória

### 7. Scaling (Zoom)

Como rotação, o VDP não suporta scaling nativamente.

**Técnicas de Simulação:**

1. **Pre-drawn Animation**: Armazenar múltiplos tamanhos pré-desenhados da mesma imagem
2. **Sprite Repositioning**: Reorganizar sprites para criar ilusão de escala

**Exemplo Prático:**

Em jogos como Dynamite Headdy, esferas que formam os membros de um boss escalam conforme se movem, criando a sensação de uma plataforma redonda mesmo sendo 2D.

### 8. Shadow and Highlight (Sombra e Destaque)

O VDP tem um modo especial que permite criar efeitos de sombra e destaque sem usar paletas adicionais.

### 9. Transparency (Transparência)

Tiles e sprites podem ter transparência usando a cor 0 em sua paleta.

### 10. Silhouette (Silhueta)

Modo especial que renderiza sprites ou planos como silhuetas usando cores especiais.

### 11. Palette Swapping (Troca de Paleta)

Mudar a paleta de cores de um tile ou sprite sem alterar o tile em si.

**Criatividade:**

- Mesmo conjunto de tiles com paletas diferentes cria visuais completamente diferentes
- Técnica clássica para adicionar variedade visual com memória limitada
- Exemplo: Água em um jogo pode usar os mesmos tiles da terra, apenas com cores diferentes

### 12. Vertical Scaling (Escala Vertical)

Escala diferentes em eixos horizontal e vertical para efeitos especiais.

### 13. Sprite Raster Effects (Efeitos de Raster em Sprites)

Manipular sprites por scanline para criar efeitos complexos.

---

## Referências e Leitura Adicional

- [Raster Scroll Books - Complete Graphics Guide](https://rasterscroll.com/mdgraphics/)
- [SGDK Official Documentation](https://github.com/Stephane-D/SGDK)
- [Genesis/Mega Drive Technical Specifications](http://www.retrodev.com/megadrive.html)
- Emuladores para estudo: Gens KMod, BlastEm, Exodus

---

## Termos Importantes

- **VDP**: Video Display Processor
- **VRAM**: Video RAM
- **VSRAM**: Vertical Scroll RAM
- **CRAM**: Color RAM
- **Tile**: Bloco gráfico de 8x8 pixels
- **Sprite**: Objeto gráfico móvel
- **Plane**: Plano de fundo
- **Parallax**: Efeito de profundidade visual
- **Indexed Color**: Sistema de cores onde pixels referenciam entradas em tabelas de paleta

---

**Nota Final**: Este guia visa complementar a documentação existente do SGDK. Para implementação prática em C/C++, consulte a documentação oficial do SGDK e seus exemplos inclusos.
