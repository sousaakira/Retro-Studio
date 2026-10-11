# Diagnóstico em jogo: desempenho, estado e colisões (#56)

Um build de diagnóstico mostra, dentro do próprio jogo, o que o console está
fazendo. O build de produção não leva nada disso. É opcional: projetos sem
`debug/debug.json` não são afetados.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `debug/debug.json` | Fonte editada na IDE (modo, o que mostrar, transporte). |
| `src/generated/debug_config.h` | Chaves `RETRO_PROJECT_DEBUG*` e a identificação do build; gerado. |
| `.retrostudio/debug-export.json` | Registro de propriedade do header. |
| `src/retro_runtime/retro_debug.{h,c}` | Módulo `debug` v1 (depende de `core`): dados e formatação, sem hardware. |
| `src/retro_runtime/retro_debug_sgdk.h` | Medições, sobreposição, caixas e transporte no SGDK 1.81. |

## Produção × diagnóstico

modo Jogo → **Diagnóstico em jogo…** escolhe o modo e exporta o header.
O jogo usa o módulo só dentro de `#if RETRO_PROJECT_DEBUG`:

- **Produção** (`RETRO_PROJECT_DEBUG 0`, o padrão): os blocos não são compilados
  e `retro_debug.c` compila vazio. O teste confere que a ROM de produção não
  contém nenhum texto do diagnóstico.
- **Diagnóstico** (`RETRO_PROJECT_DEBUG 1`): a instrumentação entra na ROM.

O mesmo código-fonte gera as duas ROMs; só o header muda.

## O que é medido

| Valor | Origem no SGDK 1.81 | Observação |
|-------|---------------------|------------|
| Carga de CPU | `SYS_getCPULoad` | O número do SGDK: média de 8 quadros, tirada da linha de varredura em que o jogo começa a esperar o VBlank (256 linhas = 100%; cada quadro perdido soma 100). Inclui o custo do diagnóstico. Um pico de um quadro aparece diluído. Em PAL a escala não corresponde ao quadro de 313 linhas. |
| FPS | `SYS_getFPS` | Conta as próprias chamadas por segundo: não chame `SYS_getFPS`/`VDP_showFPS` em outro lugar. |
| Fila de DMA | `DMA_getQueueSize`, `DMA_getQueueTransferSize` | Transferências e bytes aguardando o VBlank. |
| Sprites | `SPR_getNumActiveSprite`, `SPR_getUsedVDPSprite` | Sprites do motor e o **máximo** de sprites de hardware reservado para eles (mostrado como `SPR 3<=5`); não é a contagem do que está na tela nem inclui as cantoneiras do diagnóstico. Só com o motor de sprites. |
| VRAM livre e maior bloco | `VRAM_getFree`, `VRAM_getLargestFreeBlock` | **Só de uma `VRAMRegion` que o jogo possui.** |

**Valores estimados nunca aparecem como medições.** O que o console não deixa
medir fica marcado como não medido e aparece como `--`. CPU e FPS ficam como
não medidos nos primeiros 32 quadros, enquanto as janelas do SGDK enchem. Um
campo que não cabe na linha é omitido inteiro e a linha termina com `>`: um
número cortado seria outro valor. O caso mais comum: o
motor de sprites do SGDK 1.81 guarda a própria região de VRAM em uma variável
privada, então a VRAM livre dele não é mensurável e a linha mostra `VRAM --`.
A fragmentação é o “maior bloco livre” (`BLK`) comparado com o total livre.

O módulo também guarda os picos (`MAX`) desde o último reinício: um pico de um
quadro continua visível.

## O que aparece na tela

Quatro linhas no plano WINDOW, no topo:

```
CPU 81% MAX 83% FPS 60 DMA 1/8B
#E83579 VRAM -- SPR 1<=1
ST 3 AN 3:1 X 110 Y 140
VX 0.00 VY 1.50 CT 0000
```

- `ST`, `AN f:q`: estado e animação com o quadro, números informados pelo jogo.
- `X`, `Y`: posição em pixels. `VX`, `VY`: velocidade em pixels por tick.
- `CT`: contatos em hexadecimal, com os bits definidos pelo jogo.
- `#E83579`: identificação da exportação de diagnóstico, sempre no início da
  linha para nunca ser a parte cortada.

**Caixas**: cada caixa (corpo, dano, golpe, gatilho) é desenhada com quatro
cantoneiras por fora das bordas, um pixel ao redor, para não ficar escondida
pelo sprite. São sprites de hardware ligados ao fim real da cadeia de sprites
que o motor desenhou naquele quadro; por isso funcionam com vários sprites,
sprites fora da tela e com o medidor de carga do SGDK.

A sobreposição redesenha uma linha por quadro (atualização completa a cada
quatro quadros), porque desenhar texto é caro neste processador. Na primeira
versão, que redesenhava tudo a cada quadro, o próprio diagnóstico derrubava o
projeto inicial de 60 para 30 quadros por segundo.

## Associação com a ROM

- Cada exportação gera uma identificação nova, mostrada na tela e gravada nos
  registros. Ela identifica a **exportação**, não cada build: recompilar depois
  de mudar o código do jogo, sem exportar de novo, mantém a mesma. Uma semente
  por projeto evita que dois projetos com as mesmas opções coincidam.
- O painel só afirma “a ROM X é o diagnóstico #Y” quando tudo isto é verdade: o
  recibo é da IDE; a ROM em disco tem o mesmo hash do recibo; o header usado
  naquele build é o atual e é exatamente a exportação da configuração atual; e
  a identificação está nos bytes da ROM. Esta última conferência existe porque
  o makefile do SGDK não acompanha dependências de headers: um header novo não
  prova que o jogo foi recompilado.
- Para produção o painel diz apenas que o último build usou o header de
  produção; não afirma que a ROM está livre de instrumentação.
- Em qualquer outro caso (build pelo terminal, ROM trocada, configuração
  editada fora da IDE, recibo ausente) o estado é “desconhecido”, com o motivo.

## Transporte para a IDE

Com “Console de depuração (KDebug)”, a ROM escreve um registro a cada 32
quadros no console de depuração do emulador:

```
RSD1 b=E83579 f=1234 cpu=81 fps=60 dma=1,8 spr=1,1 st=3 an=3:1 x=110 y=140 vx=0 vy=384 ct=0000 ;
```

Campos não medidos são omitidos. O ` ;` final prova que o registro está
completo: um registro que não cabe não é enviado, e o leitor
(`shared/retro/debugRecord.js`) recusa qualquer linha sem o terminador, com
campo repetido ou malformado. A leitura exige a identificação, para não
misturar registros de exportações diferentes.

Isto depende do emulador: só chegam a emuladores que implementam o console
KDebug e o expõem. Em hardware real e nos demais emuladores a escrita é
ignorada. **A IDE ainda não captura esses registros sozinha** (é a issue #64), e
a recepção não foi comprovada nesta máquina: o Genesis Plus GX não mostra o
console, e o BlastEm não imprimiu os registros quando executado sem janela.

## Integração no jogo

```c
#if defined(__has_include) && __has_include("generated/debug_config.h")
#include "generated/debug_config.h"
#endif
#ifndef RETRO_PROJECT_DEBUG
#define RETRO_PROJECT_DEBUG 0
#endif
#if RETRO_PROJECT_DEBUG
#include "retro_runtime/retro_debug_sgdk.h"
static RetroDebugPeaks peaks;
#endif

/* a cada quadro, depois de SPR_update() e antes de SYS_doVBlankProcess() */
#if RETRO_PROJECT_DEBUG
RetroDebugSample sample; RetroDebugSubject subject = {0};
retroDebugSgdkSample(&sample, 0, TRUE);      /* 0 = sem VRAMRegion do jogo */
retroDebugPeaksUpdate(&peaks, &sample);
subject.state = ...; subject.x = ...;        /* dados do personagem */
retroDebugSgdkOverlay(&sample, &peaks, &subject, RETRO_PROJECT_DEBUG_BUILD);
retroDebugSgdkBoxes(boxes, count, cameraX, cameraY, PAL0, TRUE);
#endif
```

`retroDebugSgdkBoxTile()` é chamado uma vez: grava a cantoneira sobre o glifo
não usado (DEL) da fonte do SGDK, então as caixas não gastam VRAM do jogo. O
projeto inicial jogável já traz essa integração completa.

## Limites conhecidos

- A carga de CPU inclui o diagnóstico; um jogo no limite pode perder quadros só
  por ele estar ligado. Compare sempre com o build de produção.
- VRAM do motor de sprites não é mensurável no SGDK 1.81.
- Até 8 caixas por quadro; as cantoneiras ficam atrás dos sprites do motor e
  contam nos limites de 80 sprites por quadro e 20 por linha. Por estarem no
  fim da cadeia, são elas que somem primeiro em uma linha cheia. Os limites
  supõem o modo de 320 pixels.
- A cantoneira ocupa o glifo DEL da fonte: uma fonte própria que use esse glifo
  o perde, e recarregar a fonte ou reiniciar a tela exige chamar
  `retroDebugSgdkBoxTile()` de novo.
- Chame a sobreposição de um único arquivo-fonte.
- A fila de DMA é lida antes de o próprio diagnóstico enfileirar a tabela de
  sprites das caixas e não inclui transferências imediatas.
- A pasta `debug/` é um nome comum: um `debug/debug.json` de outra ferramenta
  é preservado, não bloqueia o build e apenas impede o uso deste recurso.
- A sobreposição usa o plano WINDOW e a cor 15 da paleta do texto.
- Só SGDK 1.81; não comprovado em hardware real.

## Verificações

```sh
node scripts/smoke-runtime-debug.mjs [--m68k-cc <m68k-elf-gcc>]
node scripts/smoke-debug-configuration.mjs [--sgdk <raiz-do-SGDK> [--keep-rom <arquivo>]]
node scripts/smoke-debug-panel.mjs
```

Com `--sgdk`, o teste compila o projeto inicial nos dois modos e confere que a
ROM de diagnóstico leva a identificação e que a de produção não leva nada.
