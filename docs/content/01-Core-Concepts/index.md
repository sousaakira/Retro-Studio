---
title: Core Concepts - Conceitos Fundamentais
description: Aprenda os conceitos essenciais do desenvolvimento no Mega Drive
icon: fas fa-graduation-cap
---

# 🎓 Conceitos Fundamentais

Antes de criar jogos complexos, você precisa entender como o Mega Drive funciona.

## Tópicos Principais

### 1. **Arquitetura do Hardware**
- **Processadores**: 68000 (CPU principal) + Z80 (som)
- **Memória**: 64 KB RAM, 64 KB VRAM
- **Resolução**: 320x224 pixels (H40 mode)
- **Cores**: 512 cores disponíveis (16 por paleta)

### 2. **O Sistema VDP (Video Display Processor)**
O VDP é o "coração" dos gráficos do Mega Drive.

**Características principais:**
- Baseado em **Tiles** (blocos de 8x8 pixels)
- Dois **planos de fundo** (Plane A e Plane B)
- Suporta até **80 sprites** na tela
- Sistema de **prioridade de renderização**
- Dois modos de cores: **indexed color** (4 bits por pixel)

### 3. **Tipos de Dados SGDK**

```c
u8   - unsigned 8-bit (0-255)
s8   - signed 8-bit (-128 a 127)
u16  - unsigned 16-bit (0-65535)
s16  - signed 16-bit (-32768 a 32767)
u32  - unsigned 32-bit (0-4294967295)
s32  - signed 32-bit (-2147483648 a 2147483647)

fix16 - Fixed point 16-bit (para decimais com menos overhead)
fix32 - Fixed point 32-bit
```

### 4. **Sistema de Coordenadas**

```
(0,0) ┌─────────────────────────┐ (319,0)
      │                         │
      │    Tela 320x224        │
      │    (em modo H40)       │
      │                         │
(0,223)└─────────────────────────┘ (319,223)

Cada posição: X=0 a 319, Y=0 a 223
```

## Diagrama de Renderização

```
┌──────────────────────────────────────┐
│     RENDERING PIPELINE DO VDP        │
├──────────────────────────────────────┤
│                                      │
│  1. Plane B (Fundo)                 │
│     ↓                               │
│  2. Plane A (Meio)                  │
│     ↓                               │
│  3. Sprites (Frente)                │
│     ↓                               │
│  4. Window Plane (Interface)        │
│     ↓                               │
│  5. Cor de Fundo                    │
│                                      │
│  = Imagem final                     │
└──────────────────────────────────────┘
```

## Próximos Capítulos

1. **[VDP Básico](./01-vdp-basico.md)** - Como usar o VDP
2. **[Paletas de Cores](./02-paletas.md)** - Sistema de cores
3. **[Sprites](./03-sprites.md)** - Objetos móveis
4. **[Backgrounds](./04-backgrounds.md)** - Planos de fundo
5. **[Som e Música (XGM)](./05-audio.md)** - Áudio no Mega Drive
6. **[Entrada de Controles](./06-input.md)** - Processamento de botões
7. **[Matemática Fixa (fix16/fix32)](./07-fixed-math.md)** - Decimais eficientes

---

> **Dica**: Leia na ordem acima para melhor compreensão!
