---
title: C Fundamentals for Games
description: Aprenda C focado em desenvolvimento de games para Mega Drive - sem enrolação
icon: fas fa-code
---

# 🎮 C Fundamentals for Games

**Não é teoria de sistemas operacionais. É C prático para fazer jogos no Mega Drive.**

## Por que C é diferente aqui?

```
C "Enterprise" (UNIX, Linux)
├─ Garbage collection
├─ Abstrações
├─ Threads
└─ Muito overhead

            ▼

C "Games" (Mega Drive)
├─ Controle direto
├─ Sem magia
├─ Rodar em 8 MB de RAM
└─ Ver como funciona de verdade
```

## O que você realmente precisa

✅ **Variáveis e tipos de dados**

✅ **Ponteiros** (sim, inescapável)

✅ **Structs** (essencial para organizações)

✅ **Arrays**

✅ **Funções**

✅ **Memória** (stack vs heap)

✅ **Headers**

✅ **Compilação e flags gcc**

---

## O que você pode ignorar

❌ **Threads**

❌ **Garbage collection**

❌ **Classes** (C tem structs!)

❌ **Templates/Genéricos**

❌ **90% do C "moderno"**

---

## Roadmap de 3 Fases

### **⚡ ATALHO: Guia Rápido**

**Tá na pressa?** Comece com: **[Guia Rápido em 10 Minutos](./00-guia-rapido.md)** - Resumo visual dos 10 conceitos essenciais!

### **📋 SNIPPETS PRÁTICOS**

**Quer código pronto?** Veja: **[Snippets - Copie e Cole](./99-snippets.md)** - 15 receitas rápidas!

---

### **Fase 1: C Básico (2-3 semanas)**
Você aprenderá os **fundamentos** necessários:

1. **[Variáveis e Tipos](./01-variaveis-tipos.md)**
   - int, u16, u32, fix16
   - Declaração e inicialização
   - Tipos SGDK vs C padrão

2. **[Funções](./02-funcoes.md)**
   - Definição
   - Parâmetros e retorno
   - Escopo
   - Funções no SGDK

3. **[Structs](./03-structs.md)**
   - Organizando dados
   - Membros
   - Alignment
   - Exemplo: Player struct

4. **[Ponteiros 101](./04-ponteiros-basico.md)**
   - O que são?
   - `&` (endereço)
   - `*` (desreferência)
   - Não é tão assustador

5. **[Arrays](./05-arrays.md)**
   - Arrays simples
   - Multidimensionais
   - String arrays
   - Inicialização

6. **[Memória (Stack vs Heap)](./06-memoria.md)**
   - Stack: rápido, limitado
   - Heap: grande, lento
   - malloc/free no SGDK
   - Quando usar cada um

7. **[Memória (Stack vs Heap)](./05-memoria.md)**
   - Stack: rápido, limitado
   - Heap: grande, manual
   - malloc/free
   - Pool allocation

8. **[Arrays](./06-arrays.md)** (em desenvolvimento)
   - Arrays simples
   - Multidimensionais
   - Inicialização
   - Matrizes

9. **[Headers e Organização](./07-headers.md)** (em desenvolvimento)
   - #include
   - Header guards
   - Estrutura de projeto
   - Compilação modular

---

### **Fase 2: C Aplicado a Games (2 semanas)**

1. **[Game Loop](./06-game-loop.md)** ⭐ LEITURA ESSENCIAL
   - Estrutura básica
   - VSync
   - Update/Render/Input
   - Estados de jogo
   - Exemplo completo

2. **[Máquina de Estados](./07-state-machine.md)** (em desenvolvimento)
   - Menu
   - Jogando
   - Pausa
   - Game Over
   - Padrão switch/case

3. **[Organização de Sprites](./08-sprite-organization.md)** (em desenvolvimento)
   - Structs de sprite
   - Listas de sprites
   - Update/Render
   - Colisão básica

4. **[Input e Controles](./09-input-patterns.md)** (em desenvolvimento)
   - Leitura de joystick
   - Debounce
   - Action mapping
   - Exemplos SGDK

5. **[Padrões de Memória](./10-memory-patterns.md)** (em desenvolvimento)
   - Pool allocation
   - Object lists
   - Gerenciamento eficiente
   - Problemas comuns

---

### **Fase 3: C + Hardware (1.5 semanas)**

1. **[Entendendo VRAM](./11-vram-concepts.md)** (em desenvolvimento)
   - O que é VRAM
   - Endereços
   - DMA
   - Limites

2. **[Performance e Otimização](./12-performance.md)** (em desenvolvimento)
   - Profiling
   - Gargalos comuns
   - Otimizações importantes
   - Quando NOT otimizar

3. **[Debug Prático](./13-debugging.md)** (em desenvolvimento)
   - printf debugging
   - Common crashes
   - Memory leaks
   - Usar emuladores

4. **[Padrões Avançados](./14-advanced-patterns.md)** (em desenvolvimento)
   - Callbacks
   - Linked lists
   - Bit manipulation
   - Assembly inline

---

## Filosofia

> "Aprenda C jogando, não lendo livros de UNIX."

Cada conceito é:
- ✅ Ensinado com exemplos SGDK
- ✅ Direto ao ponto
- ✅ Prático
- ✅ Sem teoria desnecessária

---

## Como Usar Este Material

### Primeira vez?
1. Comece pela **Fase 1** na ordem
2. Implemente cada exemplo
3. Modifique e experimente

### Já sabe um pouco?
1. Pule para o conceito que precisa
2. Use como referência

### Desenvolvedor experiente?
1. Use para adaptar conhecimento
2. Foco em padrões SGDK

---

## Exemplo Rápido: De Conceito a Código

**Conceito**: Guardar dados de um player

**Pseudo-código**:
```
Um player tem:
- Posição X, Y
- Velocidade
- Sprite
- Saúde
```

**C struct**:
```c
struct Player {
    int x, y;
    int vx, vy;
    Sprite* sprite;
    int health;
};
```

**Usando**:
```c
struct Player hero = {160, 100, 0, 0, NULL, 100};
hero.x += hero.vx;
hero.health -= 10;
```

---

## Capítulos Criados Até Agora ✅

**Atalhos:**
- ✅ 00-guia-rapido.md (287 linhas) - COMECE AQUI!
- ✅ 99-snippets.md (488 linhas) - Códigos prontos

**Fase 1 Completa:**
- ✅ 01-variaveis-tipos.md (298 linhas)
- ✅ 02-ponteiros-basico.md (300 linhas)
- ✅ 03-structs.md (412 linhas)
- ✅ 04-funcoes.md (466 linhas)
- ✅ 05-memoria.md (429 linhas)

**Fase 2 (Começada):**
- ✅ 06-game-loop.md (514 linhas) - ESSENCIAL!

**Total criado:** 3794 linhas de conteudo + exemplos compiláveis!

---

## Começar Agora

**Primeira vez?** Comece com: **[Variáveis e Tipos](./01-variaveis-tipos.md)**

**Quer ver um jogo funcionar?** Pule para: **[Game Loop](./06-game-loop.md)**

---

> **Lembre-se**: C não é complicado. É apenas mais explícito que linguagens modernas.
> Você vai gostar depois que entender.
>
> E com game development, tudo faz muito mais sentido. 🚀
