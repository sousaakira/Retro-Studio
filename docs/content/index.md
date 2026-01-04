---
title: Documentação Completa do SGDK para Retro Studio
description: Guia elaborado para desenvolvedores iniciantes em desenvolvimento para Mega Drive/Genesis
icon: fas fa-book
---

# 📚 Documentação Completa do SGDK

Bem-vindo à documentação oficial do SGDK integrada no **Retro Studio**!

Esta documentação é organizada em 4 camadas progressivas, do básico até conceitos avançados.

## 🗺️ Mapa da Documentação

### **Nível 1: 🚀 Getting Started (Comece Aqui!)**

Para **completos iniciantes** que ainda não fizeram nada.

- **[Introdução ao SGDK](./00-Getting-Started/index.md)**
  - O que é SGDK
  - Por que usar SGDK
  
- **[Instalação](./00-Getting-Started/01-instalacao.md)**
  - Windows, Mac, Linux
  - Verificação de instalação
  
- **[Seu Primeiro Programa](./00-Getting-Started/02-hello-world.md)**
  - Hello World no Mega Drive
  - Primeiros passos
  
- **[Estrutura de Projeto](./00-Getting-Started/03-estrutura-projeto.md)**
  - Como organizar seu projeto
  - Makefile explicado

---

### **Nível 1.5: 💻 C Fundamentals (Programação em C para Games)**

Para entender **como realmente funciona** a programação no Mega Drive.

**🔥 ATALHOS PRINCIPAIS:**
- **[Guia Rápido em 10 Minutos](./C-Fundamentals/00-guia-rapido.md)** ⚡ COMECE AQUI!
- **[Snippets - Códigos Prontos](./C-Fundamentals/99-snippets.md)** - 15 receitas

**Camadas de Aprendizado:**

**Fase 1: C Básico**
- [Variáveis e Tipos](./C-Fundamentals/01-variaveis-tipos.md)
- [Ponteiros 101](./C-Fundamentals/02-ponteiros-basico.md) ⭐ ESSENCIAL
- [Structs](./C-Fundamentals/03-structs.md)
- [Funções](./C-Fundamentals/04-funcoes.md)
- [Memória (Stack vs Heap)](./C-Fundamentals/05-memoria.md)

**Fase 2: Aplicado a Games**
- [Game Loop](./C-Fundamentals/06-game-loop.md) ⚙️ CORAÇÃO DO JOGO
- Máquinas de Estado (em desenvolvimento)
- Organização de Sprites (em desenvolvimento)

**[→ Índice Completo de C Fundamentals](./C-Fundamentals/index.md)**

---

### **Nível 2: 🎓 Core Concepts (Conceitos Fundamentais)**

Conhecimento técnico necessário para programar.

- **[Visão Geral Técnica](./01-Core-Concepts/index.md)**
  - Arquitetura do Mega Drive
  - Sistema VDP
  - Tipos de dados SGDK
  
- **[VDP Básico](./01-Core-Concepts/01-vdp-basico.md)** ⭐ LEITURA IMPORTANTE
  - Como funciona o sistema de gráficos
  - Paletas de cores
  - Tiles e renderização
  
- **[Paletas Avançadas](./01-Core-Concepts/02-paletas.md)**
  - Manipulação de cores
  - Transições de paleta
  
- **[Sprites](./01-Core-Concepts/03-sprites.md)**
  - Objetos móveis
  - Animação de sprites
  
- **[Backgrounds (Planos de Fundo)](./01-Core-Concepts/04-backgrounds.md)**
  - Plane A e Plane B
  - Scroll e parallax
  
- **[Som e Música (XGM)](./01-Core-Concepts/05-audio.md)**
  - Driver XGM
  - Reproduzir músicas
  - Efeitos sonoros
  
- **[Entrada de Controles](./01-Core-Concepts/06-input.md)**
  - Joystick e botões
  - Processamento de input
  
- **[Matemática Fixa (fix16/fix32)](./01-Core-Concepts/07-fixed-math.md)**
  - Números decimais eficientes
  - Operações matemáticas

---

### **Nível 3: 🛠️ Practical (Projetos Práticos)**

Exemplos completos que você pode compilar e executar.

**Para Iniciantes:**
1. **[Texto Colorido na Tela](./02-Practical/01-texto-colorido.md)**
2. **[Quadrado Que Se Move](./02-Practical/02-quadrado-movimento.md)**
3. **[Contador de Frames](./02-Practical/03-contador-frames.md)**

**Para Intermediários:**
4. **[Jogo Pong Simples](./02-Practical/04-pong.md)**
5. **[Parallax Scrolling](./02-Practical/05-parallax.md)**
6. **[Reproduzir Som](./02-Practical/06-som.md)**

**Para Avançados:**
7. **[Space Invaders Clone](./02-Practical/07-space-invaders.md)**
8. **[Editor de Paletas](./02-Practical/08-palette-editor.md)**

---

### **Nível 4: 🔍 Reference (Referência Técnica)**

Documentação de referência e troubleshooting.

- **[API Reference](./03-Reference/01-api-reference.md)**
  - Todas as funções SGDK
  - Parâmetros e retornos
  
- **[Troubleshooting](./03-Reference/02-troubleshooting.md)**
  - Erros comuns
  - Como resolver problemas
  
- **[FAQ](./03-Reference/03-faq.md)**
  - Perguntas frequentes
  
- **[Recursos Externos](./03-Reference/04-recursos.md)**
  - Links úteis
  - Comunidade

---

## 📊 Sugestão de Aprendizado

```
Semana 0 (Preparação)
├─ Ler: C Fundamentals (visão geral)
├─ Entender: Variáveis e Tipos
├─ Aprender: Ponteiros e Structs
└─ Dominar: Funções

Semana 1
├─ Ler: Getting Started (completo)
├─ Fazer: Texto Colorido
└─ Fazer: Quadrado Que Se Move

Semana 2
├─ Ler: Core Concepts (VDP + Sprites)
├─ Fazer: Contador de Frames
└─ Experimentar: modificações simples

Semana 3
├─ Ler: Core Concepts (Input + Audio)
├─ Fazer: Pong Simples
└─ Entender: colisão e lógica de jogo

Semana 4
├─ Ler: Reference (API)
├─ Fazer: Parallax Scrolling
└─ Começar seu próprio jogo
```

---

## 🎯 Roadmap de Desenvolvimento

```
START
  │
  ▼
[Getting Started]
  │
  ▼
[Hello World] ────→ [Funciona!]
  │
  ▼
[Core Concepts]
  │ ├─ VDP Básico
  │ ├─ Sprites
  │ ├─ Input
  │ └─ Audio
  │
  ▼
[Projetos Práticos]
  │ ├─ Texto Colorido (10 min)
  │ ├─ Quadrado (30 min)
  │ ├─ Pong (2h)
  │ └─ Space Invaders (4h)
  │
  ▼
[SEU PRÓPRIO JOGO!]
```

---

## 💡 Dicas de Uso

### Para Iniciantes
1. Comece no **Getting Started** (não pule!)
2. Compile Hello World
3. Leia **Core Concepts** pelo menos uma vez
4. Faça os **Projetos Práticos** em ordem

### Para Intermediários
1. Revise Core Concepts conforme necessário
2. Escolha projetos práticos mais complexos
3. Modifique projetos existentes
4. Consulte API Reference

### Para Avançados
1. Use Reference como lookup
2. Combine conceitos de diferentes projetos
3. Crie seus próprios componentes
4. Contribua com exemplos!

---

## 🔗 Navegação Rápida

| Preciso... | Vá para... |
|-----------|----------|
| ⭐ Começar rápido | [Guia Rápido - 10 min](./C-Fundamentals/00-guia-rapido.md) |
| Aprender C | [C Fundamentals](./C-Fundamentals/index.md) |
| Entender Ponteiros | [Ponteiros 101](./C-Fundamentals/02-ponteiros-basico.md) |
| Ver códigos prontos | [Snippets](./C-Fundamentals/99-snippets.md) |
| Entender Game Loop | [Game Loop](./C-Fundamentals/06-game-loop.md) |
| Instalar SGDK | [Instalação](./00-Getting-Started/01-instalacao.md) |
| Entender VDP | [VDP Básico](./01-Core-Concepts/01-vdp-basico.md) |
| Um exemplo rápido | [Texto Colorido](./02-Practical/01-texto-colorido.md) |
| Usar sprites | [Sprites](./01-Core-Concepts/03-sprites.md) |
| Adicionar som | [Audio XGM](./01-Core-Concepts/05-audio.md) |
| Fazer um jogo | [Pong](./02-Practical/04-pong.md) |
| Resolver erro | [Troubleshooting](./03-Reference/02-troubleshooting.md) |
| Referência de API | [API Reference](./03-Reference/01-api-reference.md) |

---

## 📖 Documentação Complementar

Dentro do Retro Studio você também tem:

- **Wiki do SGDK** (tópicos da comunidade)
- **Guia de Gráficos do Mega Drive** (técnico)
- **Hover Documentation** (ao programar no editor)

---

## ❓ Precisa de Ajuda?

1. Verifique o **[Troubleshooting](./03-Reference/02-troubleshooting.md)**
2. Consulte o **[FAQ](./03-Reference/03-faq.md)**
3. Veja **[Recursos Externos](./03-Reference/04-recursos.md)**
4. Acesse a comunidade SGDK no GitHub

---

## 🚀 Pronto para Começar?

**Primeira vez aqui?** Comece com: **[Getting Started](./00-Getting-Started/index.md)**

**Já tem experiência?** Vá direto para: **[Projetos Práticos](./02-Practical/index.md)**

---

**Última atualização**: Janeiro 2026  
**Versão**: 1.0 - Completa para Iniciantes  
**Linguagem**: Português (Brasil)

---

> 🎮 Divirta-se desenvolvendo para o Mega Drive!
