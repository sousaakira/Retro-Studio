# HUD, fonte, menus e diálogos — issue #65

Em **modo Jogo → HUD e textos…** o autor monta a interface que o jogador vê: textos,
números, barras e ícones do HUD, menus com cursor e a caixa de diálogo, com uma fonte própria
(inclusive acentos). A IDE gera um header; o jogo só informa os valores e reage às escolhas.

## O que o editor faz

| Aba | Conteúdo |
|---|---|
| Layout | plano do HUD, largura da tela, área segura, paleta, elementos (texto fixo, número, barra, ícones repetidos) com âncora e deslocamento em pixels |
| Fonte | importar PNG em grade de 8 × 8, mapa de caracteres, cores; fonte de exemplo com acentos; voltar à fonte do SGDK |
| Menus | listas com título, cursor e itens |
| Diálogo | caixa das falas e escolhas (posição, caracteres por linha, linhas, linha de quem fala) |
| Valores do jogo | quantidades que o jogo informa (nome para o código, máximo) e o valor usado na prévia |
| No jogo | custo no console, avisos e o trecho de código de integração |

A prévia ao lado usa as mesmas regras do runtime (`shared/retro/hudRuntime.js`, conferido
célula a célula contra o C em `scripts/smoke-runtime-hud.mjs`): fundo quadriculado = o jogo,
faixa escura = linhas em que a janela cobre o plano A, tracejado = área segura.

### Posição: âncora, área segura e grade

- Nove âncoras (cantos, bordas e centro) dentro da **área segura** (margens em pixels, padrão
  8 px). O deslocamento X, Y é somado à posição da âncora.
- Texto em plano cai em múltiplos de 8 px. Se a posição não cair na grade, o editor diz onde
  ficou e pede o ajuste (nos eixos centralizados a posição desce para a célula sozinha).
- **Sprites**: número, barra ou ícones podem ser desenhados com sprites, em qualquer pixel.
  Cada caractere é um sprite do console; o total é limitado a 16 caracteres.
- O que sai da tela, se sobrepõe a outro elemento ou não cabe na faixa da janela é recusado
  com o motivo.
- A área segura posiciona as âncoras; um deslocamento negativo ou um bloco largo ainda pode
  sair dela. Isso não é recusado: a aba No jogo lista o que ficou fora da área segura.
- Tela de 320 ou 256 px de largura e 224 ou 240 linhas, escolhidas na aba Layout (precisam
  ser as do jogo; o runtime não confere).

### Plano do HUD

| Plano | Para quê | Limite |
|---|---|---|
| Janela (padrão) | HUD fixo sobre um jogo que rola | é **uma faixa só**, no alto ou embaixo, e esconde o plano A onde aparece. Elementos em cima e embaixo ao mesmo tempo são recusados (use sprites de um dos lados) |
| Plano A / Plano B | telas paradas (título, pausa de tela cheia) | rola junto com o cenário: não serve de HUD sobre um mapa que anda. Ao iniciar, só as células dos elementos são escritas; fechar um menu ou diálogo apaga as células dele (o jogo redesenha o cenário ali) |

Com um menu ou diálogo aberto, a janela passa a cobrir só as linhas dele (do alto até a
última linha dele, ou da primeira até embaixo — o que esconder menos do plano A). O HUD em
plano que ficar fora dessa faixa some até fechar; os elementos em sprites continuam. A
prévia do editor faz o mesmo.

### Fonte e mapa de caracteres

- Imagem PNG com glifos de 8 × 8 em grade, até **96 glifos** e 15 cores. O fundo é o que for
  transparente; em uma imagem sem transparência nenhuma (como as planilhas indexadas do
  console, cor 0 de fundo) a cor do canto de cima à esquerda é tratada como fundo, e a tela
  avisa. Células vazias no fim da imagem são descartadas. Os glifos ficam guardados em
  `hud/hud.json`; a imagem é só a origem da importação.
- O **mapa** diz qual caractere cada glifo é, na ordem da imagem. Começa na ordem ASCII e o
  autor corrige. Caractere repetido, mapa sem espaço, quantidade diferente da de glifos e
  caractere fora do alcance (emoji) são recusados; glifo vazio apontado por um caractere gera
  aviso de mapa desalinhado.
- A fonte importada ocupa o lugar da fonte do SGDK na VRAM (`TILE_FONT_INDEX`, 96 tiles): não
  custa tiles a mais. Consequência: `VDP_drawText` passa a desenhar com os novos glifos na
  ordem do mapa, que não é ASCII — use o HUD para os textos do jogador. Isso vale também
  para mensagens de erro do próprio jogo e para o texto de `retroCutsceneSgdkPresent`, que
  sairiam embaralhados.
- **Fonte de exemplo com acentos** (botão na aba Fonte): 96 glifos derivados da fonte do SGDK
  (licença MIT), com `á é í ó ú â ê ô ã õ ç Á É Ó Ã Õ Ç`. Gerada por
  `scripts/build-hud-sample-font.py`.
- Sem fonte importada vale a fonte padrão do SGDK (ASCII, sem acentos); a prévia então só
  marca as células ocupadas.

### Validação de textos

Todo texto do HUD e dos menus é conferido contra o mapa: um caractere que a fonte não tem
bloqueia a exportação e a mensagem diz qual elemento e qual caractere. Números: os dígitos
precisam mostrar o máximo do valor (`999999` não cabe em 5 dígitos). Ícones: a quantidade
precisa alcançar o máximo do valor.

O que chega em tempo de jogo (falas das cenas) não pode ser bloqueado na exportação do HUD:
caractere que a fonte não tem aparece como `?` (ou espaço, se a fonte não tiver `?`), e a aba
Diálogo lista, a partir das cenas do projeto (`cutscenes/**/*.cutscene.json` e
`cutscenes/cutscene-config.json`), os caracteres que cairiam nisso — já como chegam ao jogo:
quem fala em maiúsculas e, com a opção de trocar acentos por letras simples, sem acentos — e
os desencontros com a configuração das cenas (caracteres por linha, linhas por página). Os
avisos refletem o que está exportado e não bloqueiam nada.

Nomes de valores, menus e itens viram constantes no código; dois nomes que dariam a mesma
constante (menu `a` com item `b_c` e menu `a_b` com item `c`) são recusados.

## Arquivos

| Arquivo | Papel |
|---|---|
| `hud/hud.json` | fonte de verdade (formato `retro-studio.hud`, versão 1), editável e versionável |
| `src/generated/hud_config.h` | tabelas para o runtime; não edite |
| `res/generated/hud_glyphs.png`, `res/hud_resources.res` | só quando há elementos em sprites: planilha com os glifos que têm pixels (uma linha) e o recurso `RETRO_HUD_GLYPHS`; o header leva a tabela glifo → quadro |
| `.retrostudio/hud-export.json` | registro do que a IDE gravou |

Um `hud/hud.json` que não seja deste formato é tratado como arquivo de outra ferramenta:
preservado, e o HUD da IDE fica fora de uso no projeto. Arquivo gerado alterado à mão é
preservado e bloqueia a exportação e o build até ser revisado. Sem `hud/hud.json` nada muda
no projeto nem no build. Os arquivos do HUD não são entradas da exportação do mundo: salvar o
HUD não deixa os mapas “desatualizados”.

Campos de `hud/hud.json`: `screen {width 256|320, height 224|240}`, `safe {left, top, right,
bottom}`, `plane` (`window`, `bg-a`, `bg-b`), `palette` 0–3, `priority`, `font {name, glyphs[],
map, colors[16]}` (glifo = 64 dígitos hexadecimais, um por pixel, índice de cor 0–15),
`values [{id, max}]`, `elements [{id, type, anchor, x, y, …}]`, `menus [{id, anchor, x, y,
title, cursor, items [{id, text}]}]`, `dialogue {enabled, anchor, x, y, width, lines, speaker,
cursor}`. Limites: 32 elementos, 16 valores, 8 menus de até 8 itens, 4 linhas de diálogo.

## No jogo

Módulos de runtime `hud` (C portátil) e `hud-sgdk` (modo Jogo).

```c
#include "generated/hud_config.h"
#include "retro_runtime/retro_hud_sgdk.h"
static RetroHudSgdk hud;
static u8 celulas[2*RETRO_PROJECT_HUD_CELLS],porCima[2*RETRO_PROJECT_HUD_OVERLAY_CELLS];
static u32 valor(void *contexto,u16 id){
 return id==RETRO_HUD_VALUE_SCORE?pontos:id==RETRO_HUD_VALUE_LIFE?vidas:0;
}
static void escolheu(void *contexto,u16 menu,u16 item){ /* RETRO_HUD_ITEM_PAUSE_RESUME… */ }
static void cancelou(void *contexto,u16 menu){ retroHudOverlayHide(&hud.hud); }
…
const RetroHudHost host={valor,escolheu,cancelou,0};
retroHudSgdkInitProject(&hud,&host,celulas,porCima,0,0);
/* com elementos em sprites: #include "hud_resources.h" e passe &RETRO_HUD_GLYPHS no lugar do primeiro 0 */
/* a cada quadro, antes de SPR_update: */ retroHudSgdkUpdate(&hud);
```

- **Valores**: o jogo devolve o valor atual de cada `RETRO_HUD_VALUE_*`. Um elemento só é
  recalculado quando o valor muda, e a tela só é varrida quando algo mudou: com tudo parado,
  um quadro custa uma chamada do callback por elemento com valor. Os nomes dos valores, menus e itens existem apenas como constantes
  no header — nada deles aparece na tela, e sem callback o HUD mostra zero em vez de erro.
- **Número que não cabe** mostra todos os dígitos em 9, nunca um número cortado. **Barra**:
  qualquer valor acima de zero acende ao menos uma célula; só o máximo a enche.
- **Menus**: `retroHudMenuOpen(&hud.hud, RETRO_HUD_MENU_…)`, `retroHudMenuInput` com
  `RETRO_HUD_UP/DOWN/CONFIRM/CANCEL` do quadro, `retroHudOverlayHide` para fechar. O menu fica
  aberto até o jogo fechar; um menu ou diálogo por vez.
- **Diálogo**: `retroHudDialogueShow(speaker, linhas, n)` e `retroHudChoiceShow(pergunta, opções,
  n, selecionada)` recebem texto UTF-8. Com mais opções do que linhas na caixa, a lista rola
  para a opção selecionada ficar sempre visível.
- **Cores**: gravadas ao iniciar (com fonte importada, só as cores que a fonte usa; com a
  fonte do SGDK, só a cor 15 da paleta). Se o jogo recarregar a paleta (troca de sala) ou
  fizer fade, chame `retroHudSgdkColors(&hud)` em seguida.
- **Sprites do HUD** ficam na frente dos sprites do jogo (`SPR_MIN_DEPTH`).
- **Cutscenes**: `retro_hud_cutscene.h` traz `retroHudCutscenePresent(&hud.hud, &cenas)`, chamada
  a cada quadro depois de `retroCutsceneHostUpdate`. Ela mostra falas e escolhas na caixa do
  HUD com a fonte do HUD; `retroCutsceneSgdkPresent`, chamada depois, fica só com os fades.
  Para as falas usarem os acentos da fonte, desligue `asciiOnly` na configuração das cenas e
  use “caracteres por linha” ≤ largura da caixa.
- **Escrita por quadro**: até 64 células por atualização (parâmetro de
  `retroHudSgdkInitProject`), por escrita direta, sem usar a fila de DMA. Uma tela de menu ou
  diálogo grande leva alguns quadros para aparecer; o que o jogador está lendo vai primeiro.
- Depois de limpar o plano por conta própria (troca de sala no plano A/B), chame
  `retroHudInvalidate`.

### Custo

A aba **No jogo** mostra o custo da configuração atual: tiles além da fonte (zero), sprites,
RAM (`2 × células do HUD + 2 × células de menus e diálogo`, mais cerca de 320 bytes de estado),
ROM aproximada e células de tela. As regiões de células são caixas envolventes: um menu no
centro e um diálogo embaixo ocupam a caixa que cobre os dois. O código do runtime ocupa de
5 a 10 KiB de ROM no 68000, conforme a otimização (cerca de 10 KiB com `-O3`, o padrão do
SGDK). Com a tela parada o custo de CPU por quadro é o do callback de valores; ao abrir um
menu ou diálogo grande, a varredura da região e as escritas se espalham por alguns quadros.

## Limites

- Fonte de 8 × 8, largura fixa, até 96 glifos; sem kerning, sem fonte de largura variável.
- A caixa de diálogo não tem moldura nem retrato: o runtime escreve só o texto. O retrato e o
  lado configurados nas cenas continuam ignorados, como no adaptador anterior.
- A janela é do HUD enquanto ele estiver em uso: não combine com o overlay de Diagnóstico em
  jogo nem com o texto de `retroCutsceneSgdkPresent` (ambos usam a janela).
- Em plano A/B o HUD não acompanha o scroll.
- Sprites do HUD usam a reserva de sprites do jogo (1 tile e 1 sprite por caractere).
- A quebra de linha das falas é feita pelo compilador de cenas, não pelo HUD: linha mais
  longa que a caixa é cortada.
- O HUD não entra no Orçamento de hardware (não usa tiles além da fonte).
- Chaves desconhecidas em `hud/hud.json` são mantidas ao salvar, não removidas.
- Sem o registro `.retrostudio/hud-export.json` (projeto clonado sem ele) o header existente é
  tratado como personalizado: apague `src/generated/hud_config.h` e exporte de novo. Um
  `res/hud_resources.res` que não seja da IDE também impede a exportação.

## Verificação

- `node scripts/smoke-runtime-hud.mjs` — o C real com o header gerado: 32 passos (valores, dois
  menus, diálogo, escolha com rolagem, valor mudando com diálogo aberto, troca direta, invalidação) iguais à prévia célula a célula, com
  orçamento de células por quadro e sanitizadores. `--m68k-cc <gcc>` mede o código no 68000.
- `node scripts/smoke-hud-configuration.mjs` — âncoras, faixas da janela, fonte e mapa, 27
  recusas com o motivo, header compilado e executado, custo, serviço da IDE (salvar, sprites,
  desatualizado, conflito, danificado, de outra ferramenta), avisos de cenas e trava de build.
  Com `--sgdk <marsdev/m68k-elf>` constrói `assets/toolkit/fixtures/hud-diagnostic.c`
  (`--keep-rom`), para `scripts/capture-rom.sh` com `hud-diagnostic.steps.sh`.
- `node scripts/smoke-hud-editor.mjs` — a tela: importação de fonte, prévia, edição, bloqueios,
  rascunho, conflito, troca de projeto.

## Não verificado

- Hardware real; Windows/macOS; H32 e 240 linhas em emulador (só no cálculo de layout).
- A ROM de diagnóstico mostra fala e escolha pela ponte `retroHudCutscenePresent`, com o
  estado de apresentação preenchido à mão; uma cena compilada rodando até a caixa do HUD não
  foi exercitada.
- O adaptador SGDK (faixa da janela, sprites, cores) só é exercitado na ROM de diagnóstico,
  conferida por capturas; não há teste automático dele.
- Importar uma imagem de fonte pela tela (diálogo de arquivo do sistema) na IDE real: a
  conversão da imagem é testada como função, com pixels sintéticos.
