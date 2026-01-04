# 🎮 SGDK Snippets Guide - Retro Studio

## Como Usar Snippets

Digite `sgdk:` + o nome do snippet no editor para ativar o autocomplete!

---

## 📋 Snippets Disponíveis

### Core

- **`sgdk:main`** - Template básico de função main
- **`sgdk:game_loop`** - Loop principal completo com VBlank

### Graphics & Rendering

- **`sgdk:vdp_palette`** - Definir cores de paleta
- **`sgdk:vdp_text`** - Desenhar texto na tela
- **`sgdk:tilemap`** - Carregar mapa de tiles
- **`sgdk:fade_effect`** - Efeito fade in/out

### Sprites

- **`sgdk:sprite_init`** - Inicializar um sprite
- **`sgdk:sprite_animation`** - Sistema de animação de sprites

### Input & Controls

- **`sgdk:input`** - Leitura de controle (gamepad)

### Physics & Movement

- **`sgdk:physics`** - Sistema de física básico (gravidade, velocidade)
- **`sgdk:collision`** - Detecção de colisão (AABBs)
- **`sgdk:tile_collision_map`** - Colisão baseada em tiles

### Camera & Effects

- **`sgdk:parallax`** - Parallax scrolling (dois planos)
- **`sgdk:camera_system`** - Sistema de câmera com smooth follow

### Audio

- **`sgdk:music_system`** - Reproduzir música e SFX

### Game Architecture

- **`sgdk:state_machine`** - Máquina de estados para controlar fases

### Utilities

- **`sgdk:memory_alloc`** - Alocação e liberação de memória
- **`sgdk:fixed_point`** - Matemática de ponto fixo (fix16)
- **`sgdk:debug_print`** - Debug com prints na tela

### Advanced

- **`sgdk:vblank_handler`** - Handler customizado para VBlank interrupt
- **`sgdk:dma_operations`** - Operações de DMA para transferências rápidas
- **`sgdk:bitmask_operations`** - Operações com bits para flags
- **`sgdk:animation_state_machine`** - Máquina de estados para animações
- **`sgdk:level_loader`** - Sistema de carregamento de níveis
- **`sgdk:score_system`** - Sistema de pontuação e HUD

---

## 🚀 Quick Start Example

```c
// Digite: sgdk:main
// e escolha o template
// Pronto! Você tem o esqueleto de um jogo

// Para adicionar input:
// Digite: sgdk:input

// Para adicionar sprites:
// Digite: sgdk:sprite_init
// e depois: sgdk:sprite_animation

// Para adicionar física:
// Digite: sgdk:physics
```

---

## 💡 Dicas

1. **Use Ctrl+Space** para abrir autocomplete
2. **Digite `sgdk:`** para filtrar apenas snippets SGDK
3. **Snippets são templates** - Modifique conforme necessário
4. **Combine snippets** para criar um jogo completo

---

## 📊 Total de Snippets

✅ **26+ snippets profissionais** cobrindo:
- Estrutura de jogo
- Gráficos e rendering
- Sprites e animações
- Entrada (input)
- Física e colisão
- Câmera e efeitos
- Áudio
- Utilitários

---

## 🎯 Próximos Passos

1. **Hover Documentation** - Passe mouse em funções SGDK para ver documentação
2. **Autocomplete** - Use Ctrl+Space para completar nomes de funções
3. **Error Parsing** - Clique em erros para ir direto para a linha
4. **Assets Manager** - Gerencie recursos do projeto

Aproveite! 🚀
