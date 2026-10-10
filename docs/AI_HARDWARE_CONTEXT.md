# Contexto de hardware e de SDK da IA — issue #43

Este documento descreve o que o assistente interno recebe sobre o hardware, o SDK e o
projeto, de onde cada afirmação vem e o que continua sem verificação.

## Regras de hardware auditadas

O texto fixo do prompt fica em `electron/ai/agent.js` (`MEGADRIVE_IDENTITY`). Cada regra foi
conferida com os headers do SGDK 1.81 instalado e com o manual de software do console.

| Regra no prompt | Fonte |
|---|---|
| 64 KiB de VRAM divididos entre padrões e tabelas; tile 8×8 em 4 bpp ocupa 32 bytes; não existe limite fixo de 512 tiles | `vdp.h`: `TILE_SIZE 32`, `TILE_SPACE`, `TILE_MAX_NUM = TILE_SPACE / TILE_SIZE`, `TILE_USER_INDEX`, `TILE_FONT_INDEX`; Genesis Software Manual, seção VDP |
| BG_A, BG_B e WINDOW; a janela substitui parte de BG_A | `vdp.h`: `enum { BG_A, BG_B, WINDOW }`; os nomes `VDP_PLAN_A/B` geram erro de compilação no 1.81 |
| H40 = 320 pixels, H32 = 256 pixels; 224 linhas em NTSC e PAL, 240 linhas só em PAL | `vdp.h`: `VDP_setScreenWidth256/320`, `VDP_setScreenHeight240` (“Only work on PAL system”) |
| H40: 80 sprites na lista, 20 por linha ou 320 pixels; H32: 64 na lista, 16 por linha ou 256 pixels; sprite de 1 a 4 tiles por eixo | `vdp_spr.h`: `SAT_MAX_SIZE 80`, `SPRITE_SIZE(w, h)`; Genesis Software Manual, seção de sprites |
| Quatro bancos de 16 cores de 9 bits; índice 0 de cada banco transparente | `vdp.h`: `PAL0`–`PAL3`; `pal.h`: `VDPPALETTE_*MASK`; Genesis Software Manual, seção CRAM |
| Orçamento de DMA depende de região e modo; precisa ser medido | `dma.h`: `DMA_TRANSFER_CAPACITY_NTSC 7200`, `DMA_TRANSFER_CAPACITY_PAL_LOW 8000`, `DMA_TRANSFER_CAPACITY_PAL_MAX 15000` (bytes por quadro sugeridos pelo SGDK), `DMA_getQueueTransferSize` |
| NTSC ≈ 60 quadros/s e PAL ≈ 50 quadros/s; não presumir 60 Hz | `vdp.h`: `IS_PAL_SYSTEM`; Genesis Software Manual, temporização |

Referências: headers em `<toolkit>/m68k-elf/inc`; https://github.com/Stephane-D/SGDK/tree/master/inc;
“Genesis Software Manual” (Sega, 1989). Os números de capacidade de DMA são valores de
configuração do SGDK, não medições deste projeto.

## Bloco injetado a cada mensagem

`electron/ai/sdk/sgdkApi.js` (`getSdkApiBlock`) monta o bloco “SDK e integração do projeto”:

- **SDK instalado:** versão lida de `genesis.h` do toolkit configurado e protótipos completos
  extraídos dos headers (inclusive `inc/snd/` do SGDK 2.x). O XGM2 só aparece quando o SDK
  configurado o declara. É o contexto do toolkit: um Makefile próprio pode apontar para outro SDK.
- **Capacidades do adaptador:** alvo, adaptador e capacidades de `retro-studio.json`; projeto
  legado é descrito como não verificado.
- **Módulos de runtime instalados:** IDs e versões de `.retrostudio/runtime-installation.json`;
  registro ausente, vazio e ilegível são três mensagens diferentes.
  O assistente é instruído a não usar nem prometer funções `retro*` de módulos ausentes.
- **Recursos:** contagem do catálogo aqui; nomes de sprites, tiles, paletas, mapas, áudio
  (`XGM`, `XGM2`, `WAV`…) e imagens no bloco “ASSETS DO PROJETO”, lidos dos `.res`.
- **Último build:** data e tamanho da ROM do recibo `.retro-studio/builds/latest.json` (o tamanho só
  é citado enquanto a ROM registrada continua no disco com o mesmo tamanho), mais quantas
  entradas têm data ou tamanho diferentes desde então. Recibo sem entradas, com entradas
  alteradas durante o build ou com data no futuro não gera afirmação de frescor. É um indício barato; a
  comparação por hash fica no Relatório de hardware. Sem recibo, o assistente é instruído a
  não afirmar que o projeto compila. O registro ACP (`.retrostudio/last-acp-build.json`)
  continua informando ação, sucesso e data.
- **Natureza dos números:** estimativa (dimensões de imagem, orçamentos), dado compilado
  (tamanhos lidos do ELF/ROM) e medição (ROM em execução) são nomeados separadamente, e o
  assistente deve dizer qual está citando.

## Sugestões do editor

Autocompletar (`sgdkAutocomplete.js`), snippets (`sgdkSnippets.js`), hover
(`sgdkHoverProvider.js`) e ajuda (`sgdkDocsData.js`) usam o SGDK 1.81 distribuído com a IDE.
Entradas exclusivas do SGDK 2.x (`XGM2_*`) dizem isso na descrição. Em 2026-10-10 foram
trocadas dezenas de entradas que não existiam em nenhuma versão instalada (`SYS_init`,
`VDP_drawIntEx`, `SND_play`, `SPR_setAnimationEx`, `F16_sin`, `VDP_PLANE_A`,
`SPRITE_SIZE_2x2`…) ou que tinham quantidade errada de argumentos (`VDP_setTileMapEx`,
`PAL_setColor`, `DMA_doDma`…).

`node scripts/smoke-sdk-suggestions.mjs` reprova nome inexistente ou aposentado (`_Pragma` no
header, como `VDP_setPaletteColor`), entrada duplicada, quantidade de argumentos e tipo de
retorno diferentes dos declarados, e qualquer função chamada em um snippet que não exista no
SDK nem seja definida no próprio snippet. O teste usa
`scripts/data/sgdk-symbol-index.json`, gerado dos headers reais; com `--sdk <inc>` ele confere
o índice contra um SDK instalado e com `--update` o regenera:

```sh
node scripts/smoke-sdk-suggestions.mjs --update --sdk <marsdev>/m68k-elf/inc --sdk <sgdk 2.x>/m68k-elf/inc
```

## Proteção de dados

Leituras têm tamanho máximo e symlinks ficam confinados ao projeto ou ao toolkit. Só campos
permitidos saem dos arquivos: nada de configurações completas, variáveis de ambiente,
credenciais, hashes ou logs de build. Um recibo de outro produtor, com caminho fora do
projeto ou com data inválida é tratado como ausente.

## Limites

- A regressão confere existência, quantidade de argumentos e tipo de retorno, não os tipos dos
  argumentos nem as descrições: um argumento de tipo errado ainda passa. Sem `--sdk` (CI) ela
  confia no índice versionado.
- O bloco é montado a cada iteração do assistente, sem cache (medido pela revisão: cerca de
  8 ms, até 55 ms com um recibo de 4096 entradas).
- Os tutoriais em `docs/content/` seguem a wiki do SGDK mais recente e citam nomes (`F16_*`)
  que não existem no 1.81.
- A cadeia ACP externa recebe o próprio contexto/MCP; este documento trata do assistente interno.
- O comportamento do modelo diante do bloco não foi avaliado; o que está comprovado é o
  conteúdo entregue a ele.
