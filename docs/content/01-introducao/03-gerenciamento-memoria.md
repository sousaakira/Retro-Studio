---
title: Memória e DMA
icon: fas fa-memory
---

# Gerenciamento de Memória e DMA

O Mega Drive tem uma arquitetura de memória segmentada. Entender como mover dados entre a ROM, RAM e VRAM é essencial para performance.

## 1. DMA (Direct Memory Access)

O DMA é um recurso do hardware que permite mover grandes blocos de dados (como tiles ou cores de paleta) para a VRAM de forma extremamente rápida, sem sobrecarregar o processador principal.

O SGDK gerencia uma **Fila de DMA (DMA Queue)** automaticamente.

### Como usar o DMA no SGDK:

A maioria das funções do SGDK permite escolher o método de transferência:

```c
// Usando DMA para carregar uma paleta
PAL_setPalette(PAL0, my_image.palette->data, DMA);

// Usando o processador (CPU) para carregar (mais lento)
PAL_setPalette(PAL0, my_image.palette->data, CPU);
```

**Por que usar a fila?** Se você tentar enviar muitos dados de uma vez fora do VBlank, o VDP pode travar ou exibir artefatos. O SGDK acumula os pedidos e os envia no momento exato durante o próximo VBlank.

## 2. Gerenciamento de Heap (RAM)

Diferente de sistemas modernos, você tem apenas 64 KB de RAM. O SGDK fornece funções similares ao C padrão para gerenciar a memória dinâmica (Heap).

```c
// Alocar 1024 bytes
u16* buffer = MEM_alloc(1024);

if (buffer != NULL) {
    // Usar o buffer...
    
    // Liberar a memória
    MEM_free(buffer);
}
```

**Importante:** Evite alocações frequentes no loop principal para não causar fragmentação da memória.

## 3. VRAM (Video RAM)

A VRAM é onde os tiles, mapas e sprites residem. No SGDK, você deve gerenciar os índices de tiles.

- O índice `TILE_USER_INDEX` (geralmente 16) é o ponto de partida seguro para carregar seus tiles personalizados.
- Os primeiros tiles são reservados pelo SGDK para o sistema (como a fonte padrão).

```c
// Carregando tilesets na VRAM
VDP_loadTileSet(&my_tileset, TILE_USER_INDEX, DMA);
```

---

Dominar o DMA e a VRAM é a chave para criar jogos com visuais complexos e performance estável no Mega Drive!
