# Versões de ROM para teste (#100)

Uma versão é uma ROM numerada para enviar a quem testa, com o registro do que mudou. Vale para
qualquer jogo aberto no Retro Studio.

## Gerar uma versão

1. Clique em **Construir** (o martelo ao lado do Jogar, na barra de título) ou use **Ctrl+Shift+B**.
   A mesma tela fica no modo **Rodar** (Alt+5) → **Versões para teste**, com a lista de todas as versões.
2. Preencha os campos:
   - **Versão:** três números, como `0.3.0`, ou `0.3.0-beta` para uma prévia. A IDE sugere a próxima.
   - **Título no cabeçalho da ROM** (opcional, até 48 caracteres, sem acento): aparece em emuladores e flashcarts no lugar de "SAMPLE PROGRAM".
   - **O que mudou:** uma mudança por linha, do ponto de vista de quem joga. A partir da segunda versão, a IDE já preenche com os commits desde a versão anterior (sem os merges); revise o texto antes de gerar.
   - **Observações para quem testa** (opcional): o que testar com atenção e os problemas conhecidos.
3. **Gerar versão.** A IDE então:
   - grava `src/generated/game_version.h` com a versão;
   - faz um build **limpo de release**;
   - copia a ROM para `releases/<versão>/<jogo>-<versão>.bin`, com a revisão no serial do cabeçalho (`GM 00000000-RR`, RR = número da versão) e o checksum corrigido. O código do jogo não muda;
   - grava `releases/<versão>/LEIA-ME.txt`, para enviar junto da ROM;
   - registra a versão em `releases/releases.json` e `releases/CHANGELOG.md`.

Em cada versão da lista:
- **Mostrar na pasta** abre o arquivo;
- **Copiar notas** copia o texto para mandar a quem testa.

Se o build falhar, nada é registrado e os erros aparecem na tela.

**Para testar, use o Jogar:** ele compila e abre o emulador sem gerar versão. Na janela do
Construir, **Só compilar** faz o build simples, só para conferir o código. O comando `build`
da IA também só compila.

## O que fica registrado

| Arquivo | Conteúdo | Git |
|---|---|---|
| `releases/releases.json` | versão, data, o que mudou, observações, ROM (arquivo, tamanho, SHA-256, serial, checksum), commit, ramo, alterações não commitadas, commits desde a versão anterior, arquivos do projeto adicionados, alterados e removidos, com o resumo por área (mapas, código, recursos…) | sim |
| `releases/CHANGELOG.md` | o mesmo, legível, da versão mais nova para a mais antiga | sim |
| `releases/<versão>/inputs.json` | hash de cada arquivo de entrada do build, para comparar com a próxima versão | sim |
| `releases/<versão>/LEIA-ME.txt` | texto para quem testa | sim |
| `releases/<versão>/*.bin` | a ROM | não (`releases/.gitignore`) |

Os arquivos comparados são os mesmos do recibo do build: `src`, `res`, `maps`, `world` e as
configurações do jogo. A mudança no `game_version.h` não conta.

## Mostrar a versão no jogo

```c
#include "generated/game_version.h"
/* GAME_VERSION "0.3.0", GAME_VERSION_MAJOR/MINOR/PATCH, GAME_RELEASE_NUMBER,
   GAME_BUILD_DATE "2026-10-22", GAME_COMMIT "abc1234" */
VDP_drawText("v" GAME_VERSION, 30, 27);
```

O arquivo só existe depois da primeira versão. Builds normais usam o da última versão gerada.

## IA

- `release_list`: as versões, com o que mudou, o commit e as áreas alteradas.
- `release_read`: tudo de uma versão, incluindo os commits e os arquivos.
- `release_create`: gera uma versão. A IA só deve usar esse comando quando você pedir.

O painel IA já avisa o agente desses comandos. Peça, por exemplo: "em que versão mudou a
gravidade?" ou "gera a 0.4.0 com o que fizemos hoje".

Verificação: `node scripts/smoke-rom-releases.mjs`.
