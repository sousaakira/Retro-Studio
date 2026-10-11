# Paletas, composição, ciclos e fades — issue #57

modo Jogo → **Paletas e composição** reúne as quatro paletas do projeto, as imagens
que usam cada uma, uma prévia de tela com a ordem de camadas do console e os efeitos de cor
que o jogo pode ligar. Projetos sem `palettes/palettes.json` não mudam em nada.

## O que o editor faz

| Seção | O que mostra | O que grava |
|---|---|---|
| Paletas | PAL0–PAL3, 16 cores cada, 8 níveis por canal; cor 0 = transparência; cor de fundo da tela | `palettes/palettes.json` |
| Recursos | Paleta de cada imagem, conflitos e comparação antes/depois | atribuições no mesmo arquivo; opcionalmente uma **cópia** indexada em `res/` |
| Composição | BG B, BG A e sprite empilhados como no console, com prioridade por tile | nada (vale só com o editor aberto) |
| Ciclos e fades | Efeitos, custo estimado e limitações | efeitos no mesmo arquivo |
| No jogo compilado | Paletas lidas do ELF do último build | nada |

“Salvar e exportar paletas” publica em uma transação a fonte, `src/generated/palette_config.h`
e o registro `.retrostudio/palette-export.json`. O build é recusado, com instrução, enquanto a
fonte e o header não corresponderem; um header alterado à mão é preservado e bloqueia o build
até ser revisado. A linha “Paletas, ciclos e fades” aparece na visão geral de exportações.

### Originais preservados

O editor só lê imagens. “Usar as cores desta imagem” e a comparação trabalham sobre cópias em
memória. “Salvar cópia indexada…” grava um PNG **novo** (`<pasta>-<nome>-pal<N>.png`, 4 bits
por pixel, 16 cores, índice 0 transparente) pela mesma rotina de importação que nunca
sobrescreve conteúdo diferente (ver `ASSET_LIFECYCLE.md`). A cópia não é declarada em
`resources.res` nem atribuída a uma paleta: isso continua sendo decisão do jogo. Conferido com
o `rescomp` real: a cópia gera uma paleta de 16 entradas com exatamente as cores do editor.

### Quantização e conflitos

- Cada pixel é convertido como o rescomp do SGDK 1.81 converte ao compilar: os 3 bits mais
  altos de cada canal (trunca, não arredonda). Assim “sem conflito” no editor e as cores do
  jogo compilado coincidem. Alfa abaixo de 128 é transparente.
- Com mais de 15 cores, as duas mais parecidas são unidas (a menos usada cede) até caber. O
  resultado é determinístico.
- Conflitos mostrados por imagem: “usa N cores” (não cabe em uma paleta) e “N cores não estão
  na paleta” com a quantidade de pixels que mudariam. Um pixel opaco nunca vai para o índice 0.

### Composição

`shared/retro/vdpCompose.js` aplica a ordem do VDP, de trás para a frente: cor de fundo, BG B,
BG A, sprites, BG B com prioridade, BG A com prioridade, sprites com prioridade. Índice 0 é
transparente em qualquer camada. Nos planos a prioridade vale por tile de 8×8 (clique na
prévia, use os campos “Tile X/Y”, ou foque a prévia e use setas e Espaço); nos sprites, por sprite; entre sprites, o que vem antes na lista fica na frente
e esconde os seguintes mesmo que eles tenham prioridade. “Mostrar qual camada venceu” pinta
cada pixel com a camada que o console exibiria.

Não simulados: rolagem, plano janela, sombra/realce, limite de sprites por linha e mais de um
sprite. Os planos são recortados em 320×224.

## Formato `palettes/palettes.json`

```json
{ "format": "retro-studio.palettes", "version": 1, "backdrop": 0,
  "palettes": [ { "name": "Cenário", "colors": [0, 14, 224, 3584, "… 16 no total"] }, "… 4 no total" ],
  "assignments": [ { "resource": "res/cenario.png", "palette": 0 } ],
  "cycles": [ { "id": "agua", "palette": 0, "first": 1, "count": 3, "frames": 4, "direction": "forward" } ],
  "fades": [ { "id": "entrada", "kind": "in", "palettes": [0, 1, 2, 3], "frames": 30 } ] }
```

- Cores são palavras do VDP (`0000BBB0GGG0RRR0`), guardadas como números.
- `backdrop` é o índice global (paleta × 16 + cor) da cor de fundo.
- `resource` é um caminho relativo ao projeto. Limites: 128 atribuições, 8 ciclos, 8 fades.
- Ciclo: de `first` (1–15) por `count` cores (2–15) dentro de uma paleta, um passo a cada
  `frames` quadros (1–255). A cor 0 nunca entra; dois ciclos não podem girar a mesma cor.
- Fade: `in` (do preto para a paleta) ou `out` (para o preto), nas paletas listadas, em
  `frames` quadros (1–255).
- Nomes de efeitos: minúsculas, dígitos e `_`, até 24 caracteres; viram `RETRO_CYCLE_<NOME>` e
  `RETRO_FADE_<NOME>`.

## Uso no jogo (SGDK 1.81)

Instale o módulo `palette` em modo Jogo (`src/retro_runtime/retro_palette.{h,c}` e
`retro_palette_sgdk.h`).

```c
#include <genesis.h>
#include "generated/palette_config.h"
#include "retro_runtime/retro_palette_sgdk.h"
static RetroPalette palette;

retroPaletteInit(&palette, retroProjectPalettes, retroProjectCycles, RETRO_PROJECT_CYCLE_COUNT);
retroPaletteSgdkLoad(&palette);                              /* envia as 64 cores */
VDP_setBackgroundColor(RETRO_PROJECT_BACKDROP);
retroPaletteCycleEnable(&palette, RETRO_CYCLE_AGUA, 1);
retroPaletteFadeStart(&palette, &retroProjectFades[RETRO_FADE_ENTRADA]);
while (TRUE) {
    retroPaletteSgdkUpdate(&palette);                        /* uma vez por quadro */
    SYS_doVBlankProcess();
}
```

`retroPaletteSet` troca as 16 cores de uma paleta (mudança de sala), `retroPaletteBrightness`
define o brilho de uma vez e `retroPaletteFading` diz se há fade em andamento. O núcleo
(`retro_palette.c`) é C99 puro; só o adaptador toca o SGDK. A prévia do editor usa o mesmo
algoritmo em JavaScript (`shared/retro/paletteRuntime.js`), conferido contra o C.

Um fade parte do brilho em que cada paleta está: interromper um fade com outro continua sem
salto, e as paletas que o novo fade não cita ficam no brilho em que estavam. Se a fila de DMA
estiver cheia, o adaptador não marca as cores como enviadas e tenta de novo no quadro seguinte.

Não use `PAL_fadeIn/Out` nas mesmas paletas: os fades do SGDK guardam uma cópia das cores e a
escrevem por cima. `PAL_setPalette`/`PAL_setColors` escrevem direto no console; o módulo só
volta a escrever uma cor quando ele mesmo a altera, então troque paletas com `retroPaletteSet`
para que ciclos e fades as acompanhem.

## Custo e limitações

O editor mostra, a partir da configuração (estimativa de planejamento, não medição):

- memória: 128 bytes de ROM para as cores mais 4 por ciclo e 3 por fade; cerca de 4,7 KiB de
  código do módulo com as opções de release do SGDK (`-O3`; 1,8 KiB com `-O2`/`-Os`); 326 bytes
  de RAM para o estado (`sizeof(RetroPalette)` no 68000, conferido no teste);
- carga inicial: as 64 cores de uma vez;
- CPU de um fade: 7 multiplicações por paleta por quadro (a tabela de níveis); as 16 cores da
  paleta só são recompostas nos quadros em que algum nível visível muda. O tempo de CPU em
  si não foi medido;
- por ciclo: cores reenviadas a cada passo e passos por segundo em NTSC (60 Hz) e PAL (50 Hz);
- por fade: até 16 cores por paleta por quadro; como cada canal tem 8 níveis, só alguns
  quadros de um fade longo mudam alguma cor (no teste, um fade de 200 quadros em uma paleta
  toda branca envia 7 vezes);
- pior quadro: as cores alteradas seguem em **uma faixa contínua** (do primeiro ao último
  índice alterado), pela fila de DMA, no intervalo vertical.

Limitações declaradas no editor: quatro paletas; 15 cores mais transparência; uma
transferência por quadro; fade só de/para o preto; sem efeitos por linha; sem sombra/realce;
não combinar com os fades do SGDK.

Outros limites desta etapa: trocar de projeto com o editor aberto descarta alterações não
exportadas (como nos demais painéis de Runtime); a prévia de composição aceita um sprite; o
tempo de CPU dos efeitos não foi medido na ROM.

A ROM de diagnóstico (`assets/toolkit/fixtures/palette-diagnostic.c`) mede o que acontece de
fato: quadros que enviaram cores e o maior envio em um quadro.

## Inspeção do jogo compilado

A seção “No jogo compilado” lê do ELF do último build as paletas que o rescomp gravou para
cada `PALETTE`, `IMAGE` e `SPRITE` ligado ao jogo e, quando a imagem de origem tem paleta
atribuída, diz quantas cores diferem da configurada (a cor 0 não entra na comparação). É dado
compilado, não estimativa. Depende de o formato dos recursos estar confirmado no Relatório de
hardware (`hardwareBudget.resourceAbi`); sem isso a tela explica por que nada foi lido.
Recursos que o jogo não usa não aparecem (o ligador os descarta).

## Verificação

```sh
node scripts/smoke-runtime-palette.mjs --m68k-cc <marsdev>/m68k-elf/bin/m68k-elf-gcc
node scripts/smoke-palette-configuration.mjs --sgdk <marsdev>/m68k-elf --keep-rom /tmp/palette.bin
node scripts/smoke-palette-editor.mjs
scripts/capture-rom.sh /tmp/palette.bin /tmp/palette-shots <emulador> assets/toolkit/fixtures/palette-diagnostic.steps.sh
node scripts/preview-runtime-panels.mjs --palette-fixture <fixture.json>   # http://127.0.0.1:5184/?panel=palettes
```

- Núcleo C com sanitizadores: contrato, ciclos, fades, troca de paleta e 6000 passos de
  paridade C/JS.
- Header gerado compilado em C99 com o runtime real; a prévia em JS reproduz, quadro a quadro,
  a saída do programa compilado do mesmo arquivo.
- ROM compilada com SGDK 1.81 e executada no Genesis Plus GX: barras das quatro paletas,
  ciclos girando, fade até o preto apenas nas paletas pedidas e retorno.
- Paletas lidas de um ELF real e comparadas com a configuração.
- Tela conferida no Chrome headless com imagens PNG reais.

Não comprovado: console real; outros emuladores; SGDK 2.x (o adaptador usa só
`PAL_setColors` com `DMA_QUEUE`, mas não foi compilado nem executado lá); a IDE Electron real;
cores exibidas por um televisor (a prévia usa nível × 36, uma convenção de emuladores).
