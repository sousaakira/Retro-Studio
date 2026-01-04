---
title: Introdução ao SGDK
icon: fas fa-info-circle
---

# Introdução ao SGDK

O **SGDK (Sega Genesis Development Kit)** é um kit de desenvolvimento gratuito e de código aberto que permite a criação de software em linguagem **C** para o console Sega Mega Drive / Genesis.

Ele fornece uma biblioteca completa e ferramentas personalizadas para compilar recursos (imagens, sons) e gerar imagens de ROM prontas para serem executadas em hardware real ou emuladores.

## Principais Características

- **Compilador C (GCC)**: Otimizado para o processador Motorola 68000.
- **Biblioteca Gráfica**: Funções de alto nível para manipular o VDP (Video Display Processor).
- **Motor de Sprites**: Sistema avançado para gerenciamento de objetos animados na tela.
- **Suporte a Som**: Drivers para música (XGM) e efeitos sonoros (PSG/FM).
- **Gerenciamento de Recursos**: Ferramenta `rescomp` que automatiza a conversão de PNG, WAV, MIDI para o formato do hardware.
- **Matemática de Ponto Fixo**: Funções otimizadas para cálculos rápidos sem usar ponto flutuante (que o 68k não possui nativamente).

## Por que usar o SGDK?

Desenvolver para o Mega Drive diretamente em Assembly pode ser extremamente complexo. O SGDK abstrai a maior parte da complexidade do hardware, permitindo que você se concentre na lógica do seu jogo, mantendo uma performance excelente.

## Próximos Passos

Nesta seção de introdução, você aprenderá:
1. [Estrutura Básica de um Projeto](./01-estrutura-basica.md)
2. [Arquitetura do Hardware](./02-arquitetura-hardware.md)
3. [Gerenciamento de Memória e DMA](./03-gerenciamento-memoria.md)

Prepare seu compilador e vamos começar! 🎮
