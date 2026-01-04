---
title: Projetos Práticos
description: Exemplos completos e funcionais para aprender na prática
icon: fas fa-code
---

# 🛠️ Projetos Práticos

Aqui você encontra exemplos completos de projetos que demonstram conceitos do SGDK funcionando.

## Projetos por Dificuldade

### 🟢 Beginner (Iniciante)

1. **[Texto Colorido na Tela](./01-texto-colorido.md)**
   - Exibir texto com cores diferentes
   - Tempo: ~10 minutos
   - Conceitos: VDP, Paletas, drawText

2. **[Quadrado Que Se Move](./02-quadrado-movimento.md)**
   - Desenhar um sprite que se move com o controle
   - Tempo: ~30 minutos
   - Conceitos: Sprites, Input, VSync

3. **[Contador de Frames](./03-contador-frames.md)**
   - Exibir FPS na tela
   - Tempo: ~15 minutos
   - Conceitos: VSync, Variables, Text

### 🟡 Intermediate (Intermediário)

4. **[Jogo Pong Simples](./04-pong.md)**
   - Implementar um mini jogo
   - Tempo: ~2 horas
   - Conceitos: Sprites, Colisão, Input, Score

5. **[Parallax Scrolling](./05-parallax.md)**
   - Scroll de fundo com efeito de profundidade
   - Tempo: ~1.5 horas
   - Conceitos: Backgrounds, Scroll, Layers

6. **[Reproduzir Som](./06-som.md)**
   - Tocar efeitos sonoros
   - Tempo: ~1 hora
   - Conceitos: XGM Driver, PCM, Sound

### 🔴 Advanced (Avançado)

7. **[Jogo Completo: Space Invaders Clone](./07-space-invaders.md)**
   - Versão simplificada de Space Invaders
   - Tempo: ~4 horas
   - Conceitos: Tudo acima + Game Logic

8. **[Editor de Paletas](./08-palette-editor.md)**
   - Ferramenta interativa para paletas
   - Tempo: ~2.5 horas
   - Conceitos: Input avançado, UI, Graphics

---

## Como Usar Estes Projetos

### Passo 1: Escolha um Projeto
Comece pelo mais fácil que te interesse

### Passo 2: Crie a Pasta
```bash
mkdir projeto-nome
cd projeto-nome
```

### Passo 3: Copie o Código
Cada projeto tem:
- `src/main.c` - Código principal
- `Makefile` - Configuração de compilação

### Passo 4: Compile
```bash
make
```

### Passo 5: Execute
Abra o `.bin` no seu emulador

### Passo 6: Modifique!
Experimente mudar valores, cores, etc.

---

## Roadmap de Aprendizado

```
┌─────────────────────────────────────┐
│  BEGINNER PROJECTS (Semana 1-2)     │
│  - Texto Colorido                   │
│  - Quadrado Que Se Move             │
│  - Contador de Frames               │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  FUNDAMENTALS REVIEW                │
│  - Releia Core Concepts             │
│  - Experimente modificações         │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  INTERMEDIATE PROJECTS (Semana 3-4) │
│  - Pong Simples                     │
│  - Parallax Scrolling               │
│  - Reproduzir Som                   │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  ADVANCED PROJECTS (Semana 5+)      │
│  - Space Invaders Clone             │
│  - Seu próprio jogo                 │
└─────────────────────────────────────┘
```

---

## Dicas para Aprender Melhor

### 📖 Leia o Código
Cada projeto é comentado. Leia **antes** de compilar.

### 🔬 Experimente
Mude números, cores, valores. Veja o que acontece.

### 📝 Tome Notas
Escreva o que cada função faz no seu próprio código.

### 🐛 Debuge
Use `printf()` para entender o que está acontecendo.

### 💾 Versione
Faça cópias antes de mudar coisas grandes.

---

## Estrutura Padrão de Projeto

Todos os projetos seguem esse padrão:

```
projeto/
├── src/
│   └── main.c           (Código principal)
├── Makefile             (Compilação)
├── README.md            (Instruções)
└── SOLUCOES.md          (Respostas para desafios)
```

---

## Desafios em Cada Projeto

Cada projeto tem **"Desafios"** no final:

**Fácil**: Mude cores ou valores  
**Médio**: Adicione nova funcionalidade  
**Difícil**: Crie algo completamente novo

---

## Precisa de Ajuda?

- Verifique a seção **[Troubleshooting](../06-troubleshooting/index.md)**
- Consulte **[Core Concepts](../01-core-concepts/index.md)**
- Leia comentários no código do projeto

---

**Pronto?** Comece com **[Texto Colorido na Tela](./01-texto-colorido.md)** 🚀
