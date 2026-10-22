# Panoramas e streaming de cenário — issues #62 e #90

O editor de mapas guarda até oito panoramas por mapa (imagem, velocidade horizontal e
vertical, repetição). Este runtime os executa nas **salas do mundo**, junto com o envio do
mapa aos poucos conforme a câmera anda, dentro de uma faixa de VRAM e de um orçamento de
DMA por quadro.

## Como as camadas viram planos

O Mega Drive tem dois planos de fundo. Cada sala usa um de dois arranjos, escolhido pelo
exportador:

| Sala | BG_B (fundo) | BG_A (frente) | Padrões de tiles |
|---|---|---|---|
| Sem panoramas, cabe na VRAM (como antes) | cenário (com o fundo fixo, se houver) | camada de frente | tileset inteiro carregado ao entrar na sala |
| Sem panoramas, não cabe na VRAM (#90) | cenário (com o fundo fixo, se houver) | camada de frente | os dois planos por streaming, numa faixa só |
| Com panoramas | panoramas | cenário | panoramas carregados ao entrar; cenário por streaming |

"Não cabe na VRAM": os padrões do cenário e da frente somam mais de 1424 tiles (os 1536 antes
das tabelas dos planos, menos 16 do sistema e 96 da fonte). Uma sala assim nunca funcionou pelo
caminho antigo, então o streaming entra sozinho sem mudar nenhuma sala que já funcionava. A
propriedade `retroStudio.sceneryStreaming` = `true` no TMX força o streaming numa sala menor.

Com fundo fixo e a camada de frente vazia, o fundo vai sozinho para BG_B e o cenário para BG_A,
com a prioridade por tile dele (o personagem passa na frente dos tiles sem prioridade). Desenhados
juntos, cada tile misturaria as cores das duas imagens e uma fase importada em duas camadas
(como o BGA/BGB do Ibirapuera) passaria de três paletas. Com tiles na frente, o fundo continua
desenhado junto do cenário, como antes.

Em uma sala com panoramas, a prioridade por tile continua valendo: um tile do cenário
marcado como prioritário passa na frente dos sprites, como antes.

### O que não cabe (o exportador recusa e diz o motivo)

| Combinação | Por quê | Saída |
|---|---|---|
| Panoramas + camada de frente com tiles | cenário, frente e panorama seriam três planos | mover os tiles da frente para o cenário, ou tirar os panoramas |
| Panoramas + fundo fixo | o fundo fixo é desenhado junto do cenário e cobriria os panoramas | transformar o fundo em panorama (velocidade 1 acompanha o mapa) |
| Opacidade menor que 100% ou transparência parcial na imagem | o console não mistura camadas | pixels totalmente opacos ou totalmente transparentes |
| Velocidades **verticais** diferentes | todos os panoramas dividem um plano, com um só scroll vertical | mesma velocidade vertical em todos |
| Velocidades **horizontais** diferentes com pixels nas mesmas linhas | velocidades diferentes só existem em faixas horizontais da tela, de 8 em 8 linhas | deixar transparente a parte que cobre o outro panorama, ou igualar as velocidades |
| Faixas (velocidades horizontais diferentes) com velocidade vertical ≠ 0 | as faixas são fixas na tela | velocidade vertical 0 |
| Mais de 8 faixas ou de 8 panoramas | limite da tabela | — |
| Repetição que não fecha no plano | o plano dá a volta a cada 512 × 256 px | largura que divida 512 (32…512) / altura que divida 256, velocidade 0 no eixo, ou velocidade com que o panorama ande até 192 px (H40) / 32 px no eixo |
| Mais de 15 cores em um tile, ou mais de três paletas somando cenário e panoramas | paletas do console (a paleta 1 fica com os sprites) | reduzir cores |
| Sala que precisa de mais tiles do que a reserva de cenário | ver “VRAM” abaixo | aumentar a reserva, simplificar panoramas, reduzir a variedade de tiles próximos |
| O trecho em volta da tela precisa de mais de 1424 tiles diferentes | é o que a VRAM comporta de uma vez | reduzir a variedade de tiles próximos |
| Mais de 24 KiB de RAM para o streaming (2 bytes por tile diferente da sala + 4 por lugar de VRAM, ~9400 tiles) | memória do console | dividir a sala ou reduzir a variedade |
| Orçamento por quadro menor que uma linha da janela, ou `firstTile` entre 1 e 15 | o runtime recusaria a sala | H40: pelo menos 1530 bytes e 47 transferências; H32: 1258 e 39 |

A seção **Parallax** da barra lateral do editor de mapas mostra, enquanto se edita, o
arranjo de planos e os problemas que não dependem dos pixels (`shared/retro/sceneryComposition.js`,
mesmas frases do exportador). Sobreposição de faixas, cores, contagem de tiles e imagem fora
do projeto só o exportador confere. A prévia dos panoramas no editor usa a tela do console
(320 ou 256 × 224) como referência para ajuste, centralização e repetição, como o exportador.

A regra das faixas olha só as linhas que a tela mostra: com velocidade vertical 0, as 28
linhas de tiles da tela; com velocidade vertical diferente de 0, o plano inteiro (e aí todos
os panoramas precisam da mesma velocidade horizontal).

Aceito: vários panoramas com a mesma velocidade (viram uma imagem só); panorama fixo
(velocidade horizontal 0) de qualquer largura; um conjunto de panoramas de mesma velocidade
com scroll vertical. Linhas sem nenhum pixel de panorama mostram a cor de fundo (cor 0 da
paleta 0) e seguem a faixa de cima.

### Velocidades e repetição

- A velocidade do editor (0 = fixo na tela, 1 = junto com o mapa, até 2) vai para o jogo em
  ponto fixo 8.8: `fator = round(velocidade × 256)`. O scroll do panorama é
  `(câmera × fator) >> 8`, arredondado para baixo — o mesmo deslocamento da prévia do editor,
  com erro menor que 1 pixel. Velocidades que não são múltiplos de 1/256 são arredondadas
  para o passo mais próximo.
- A repetição é a da prévia: a imagem repete no próprio tamanho; em um eixo que não repete
  (ou nos modos cobrir/conter/esticar) ela aparece uma vez por tela, centralizada. O
  exportador desenha o plano inteiro de 512 × 256 px já repetido
  (`res/generated/world-<sala>-pan.png`).

## Células e padrões, separados

- **Célula**: uma palavra na tabela de nomes do plano (qual padrão, paleta, prioridade,
  espelhamento). **Padrão**: os 32 bytes de um tile 8 × 8.
- O cenário por streaming é exportado em binário sem compressão (`BIN` do ResComp, #90):
  `world-<sala>-stream-patterns.bin` (32 bytes por padrão), `-stream-cells.bin` (a palavra do
  VDP de cada célula: prioridade, paleta e espelhos) e `-stream-ids.bin` (o número do padrão de
  cada célula, 16 bits). Com dois planos, `-back-cells.bin` e `-back-ids.bin` são os do cenário
  (BG_B); os do `stream` são da frente (BG_A). Os dois planos dividem uma tabela de padrões:
  um tile usado nos dois vai uma vez para a VRAM.
- Por isso a sala não tem mais o limite de 2048 tiles diferentes (que vinha dos 11 bits do
  número do padrão na palavra do VDP): só o trecho em volta da tela precisa caber na VRAM.
  Cópias espelhadas de um tile são o mesmo padrão, com o espelho na célula. Célula sem nenhum
  pixel tem o número `0xFFFF` e aponta para o tile 0 da VRAM (em branco), sem gastar padrão.
- O runtime mantém uma **janela** de células em volta da
  tela; quando uma coluna ou linha entra na janela, envia as células dela e os padrões que
  ainda não estão na VRAM; quando sai, os padrões que ninguém mais usa liberam o lugar. Os
  padrões vão da ROM para a VRAM por DMA, um tile por vez, sem passar pela RAM.
- A janela é a tela mais uma célula de antecipação e até duas de folga atrás (para a
  câmera que vai e volta na fronteira de uma célula não reenviar padrões).
- Com dois planos, cada linha nova vai um plano por vez: o mínimo por quadro continua o de um
  plano (H40: 1530 bytes e 47 transferências), que cabe na fila padrão de 64 dos jogos. A câmera
  só avança quando a linha está nos dois planos.
- O panorama não custa DMA por quadro: células e padrões são carregados ao entrar na sala;
  depois só mudam os registros de scroll (com faixas, as duas tabelas de scroll por linha
  de tiles, 56 bytes cada, só quando a câmera anda na horizontal).

## VRAM e DMA

Configuração em `retro-studio.json` (todos opcionais):

```json
"scenery": { "firstTile": 0, "tiles": 0, "dmaBytes": 2048, "dmaEntries": 56 }
```

| Campo | Significado | Padrão |
|---|---|---|
| `firstTile` | primeiro tile de VRAM das salas com panoramas | 0 = `TILE_USER_INDEX` |
| `tiles` | quantos tiles a sala pode usar (panoramas + cenário em volta da tela) | 0 = tudo até `TILE_SPRITE_INDEX` |
| `dmaBytes`, `dmaEntries` | quanto o cenário pode enfileirar por quadro | 2048 bytes, 56 transferências |

- A sala escreve **só** nos tiles `[firstTile, firstTile + tiles)`. Antes de a sala aparecer
  o runtime confere que a faixa começa em `TILE_USER_INDEX` ou depois, termina em
  `TILE_SPRITE_INDEX` ou antes (a reserva de sprites que o jogo fez com `SPR_initEx`) e
  comporta os padrões dos panoramas mais o pior trecho do mapa. Com `tiles` em 0 a sala usa
  tudo entre `TILE_USER_INDEX` e os sprites: tiles próprios do jogo nessa área seriam
  sobrescritos (como já acontece nas salas sem panoramas). As reservas do Orçamento de
  hardware não são cruzadas com esta faixa: se o jogo usa tiles próprios, defina `firstTile` e
  `tiles`. Esse “pior trecho” é
  calculado pelo exportador (a janela com mais padrões diferentes em toda a sala) e vai no
  header como `minimumSlots`; se `tiles` foi configurado, a falta aparece já na exportação.
  Sala recusada não aparece: a sala atual continua na tela (`lastError` =
  `RETRO_WORLD_SGDK_VRAM`).
- O orçamento precisa comportar pelo menos uma linha da janela (H40: 1530 bytes e 47
  transferências). O jogo precisa de `DMA_setMaxQueueSize(dmaEntries + 6)` ou mais, buffer de
  DMA ≥ `dmaBytes` e limite de transferência 0 ou ≥ `dmaBytes`; senão a sala é recusada
  (`RETRO_WORLD_SGDK_QUEUE` / `RETRO_WORLD_SGDK_VDP`).
- Quando a câmera pede mais do que o orçamento do quadro comporta, a coluna ou linha que
  não coube espera o quadro seguinte e **a câmera para na borda do que já foi desenhado**:
  `retroWorldSgdkScroll` devolve OK e `bridge.cameraX/Y` trazem a posição mostrada, que o
  jogo deve usar para posicionar os sprites. A tela nunca mostra célula que não foi enviada.
- Entrada na sala e salto de câmera (mais de um bloco de 16 px de uma vez) redesenham a
  janela com o display desligado, em lotes do tamanho do orçamento, cada um seguido de
  `SYS_doVBlankProcess`. Com o display desligado o SGDK não espera o VBlank real: o redesenho
  é rápido, e um fade de paleta assíncrono em curso avançaria vários passos de uma vez —
  termine os fades antes de trocar de sala.
- Se os tiles acabarem no meio do caminho (só acontece com uma faixa menor do que a que o
  exportador calculou), `retroWorldSgdkScroll` devolve `RETRO_WORLD_SGDK_VRAM`, a câmera fica
  onde a tela está (`bridge.cameraX/Y`) e a imagem continua correta; voltar funciona. Uma
  falha no redesenho de um salto deixa na tela o que pôde ser desenhado e o erro em `lastError`.
- RAM por sala com streaming na tela: `2 × padrões do cenário + 4 × tiles de streaming`
  bytes, mais cerca de 200 bytes de estado. Exemplo: a fase do Ibirapuera (566 × 68 tiles, dois
  planos, 4007 padrões) usa cerca de 13,6 KiB.

## Faixas de correnteza (versão 3)

Uma faixa de correnteza faz as linhas de um trecho do cenário deslizarem para o lado sem
parar, como a água de um lago. O cenário continua andando junto com o mapa. Cada faixa tem
velocidade própria, então dá para fazer parallax por profundidade: a água distante mais
lenta, a próxima mais rápida.

**No editor:**
1. Em Objetos → **Animação do cenário**, clique em **＋ Faixa de correnteza (água no
   cenário)**.
2. Ajuste o **topo** e a **altura** do retângulo para cobrir as linhas da água. O X e a
   largura não importam: a faixa vale na largura inteira da sala.
3. No painel do objeto, preencha:
   - **velocidade**, em px/s;
   - **período**, a cada quantos pixels a arte se repete na horizontal;
   - **direção**.
4. Salve. A sala passa a usar o streaming sozinha.

No TMX, a faixa é um objeto `type="scenery_drift"`, com as propriedades `speed`, `period` e
`direction` (`right` ou `left`). Ela não entra no jogo como objeto.

**O que o exportador gera** (`world_maps.h`):
- um `RetroSceneryDrift` por faixa: `{topo, base, velocidade 8.8 com sinal, período}`, em
  pixels do mundo;
- os campos `drifts`, `driftCount` e `marginX` no fim de `RetroScenerySgdkRoom`;
- um `#error` se o `scenery-sgdk` do projeto for anterior à versão 3.

**Como funciona:**
- **Scroll por linha:** a sala troca para `HSCROLL_LINE`. O BG_A e as linhas do BG_B fora das
  faixas recebem `-câmera X`; as linhas de cada faixa recebem `-câmera X + deslocamento`. A
  faixa é medida em linhas do **mundo**, então acompanha a câmera em qualquer Y, inclusive
  fora da grade de 8.
- **Margem só onde a água desliza:** o BG_B ganha `marginX` colunas além de cada lado da
  janela de streaming, `ceil((período − 1) / 8)`; um período de 40 px pede 5 colunas. A margem
  vale **só nas linhas das faixas** (`retroSceneryStreamSetMargin`): a janela principal, o
  BG_A e o resto do BG_B ficam exatamente como sem faixas. Assim, a linha deslocada nunca
  mostra uma célula que não foi enviada.
  - **VRAM:** como a água se repete, quase não há padrões novos. No Ibirapuera, a sala
    continua pedindo 1197 tiles ao mesmo tempo. Uma primeira versão, que alargava a janela
    inteira, pedia 1324 e não cabia no Sota (a sala não abria).
  - **Colunas, sem trocas de padrão:** uma coluna que entra na janela deixa a margem; uma que
    sai fica desenhada e passa para a margem.
  - **Câmera:** como o resto da janela, a câmera não anda enquanto a margem da próxima
    posição não estiver desenhada.
  - **Limite do plano:** a tela (41 colunas em H40), as duas margens, o que cada lado guarda
    (2) e a coluna em desenho precisam caber no plano de 64 colunas. Em H40, o período vai
    até 73 px.
  - **O que o exportador calcula:** os tiles ao mesmo tempo (`minimumSlots`), contando a
    margem nas linhas das faixas. O orçamento por quadro do mapa não muda: os trechos da
    margem são menores que uma linha da janela.
  - **Limite por quadro:** se `dmaBytes` mais as duas tabelas de scroll (`4 × 224` bytes)
    passarem de 7200 bytes, o exportador recusa a sala e explica o motivo.
- **Deslocamento:** vai de 0 ao período − 1. Junto da borda esquerda da sala, o mesmo
  deslocamento é dado pelo outro lado (valor negativo, com células à direita): a arte se
  repete no período, então a imagem é a mesma.
- **Tempo:** o deslocamento é guardado em 1/(256 × Hz) de pixel, sem erro acumulado. O mesmo
  número de px/s sai a 50 Hz (PAL) e a 60 Hz (NTSC), e a volta no período não pula mais
  de 1 px por quadro.
  - O relógio é o `vtimer` do SGDK. Depois de um redesenho bloqueante, contam no máximo 4
    quadros, para a água não saltar.
  - A fase se mantém nos redesenhos (salto de câmera) e recomeça do zero ao entrar na sala.
- **DMA por quadro:** quando a câmera anda, vão as duas tabelas inteiras (896 bytes, 2
  transferências); com a câmera parada, só as linhas das faixas no BG_B.

**No jogo:** chame `retroScenerySgdkTick(&ponte)` todo quadro, **depois** de
`retroWorldSgdkScroll` e antes de `SYS_doVBlankProcess`, inclusive quando a câmera não se
moveu. É isso que mantém a água andando com a câmera parada.
- A ponte exige a fila de DMA vazia quando é chamada; por isso o tick vem depois do scroll.
- Num quadro em que o scroll já moveu as faixas, o tick não faz nada.
- Salas sem faixas, outros renderizadores e o mundo ocupado são ignorados.
- No Sota, a chamada entra em `sotaWorldScroll` (`src/sota/world.c`), que hoje retorna cedo
  quando a câmera não muda:

```c
void sotaWorldScroll(s16 *x, s16 *y) {
    if(*x!=bridge.cameraX || *y!=bridge.cameraY)
        retroWorldSgdkScroll(&bridge,sotaCameraScrollStep(bridge.cameraX,*x),
            sotaCameraScrollStep(bridge.cameraY,*y));
    retroScenerySgdkTick(&bridge);   /* faixas de correnteza: todo quadro */
    *x=bridge.cameraX;*y=bridge.cameraY;
}
```

**Recusas:**
- **Do runtime, antes de a sala aparecer:**
  - período maior que a margem permite;
  - faixa invertida (topo abaixo da base);
  - margem que não cabe no plano;
  - margem sem faixas;
  - faixas sem segundo plano ou junto com panorama;
  - transferência por quadro menor que o mapa mais as tabelas.
- **Do exportador, com o motivo:**
  - velocidade fora de 0 a 120 px/s;
  - direção inválida;
  - período que não é inteiro de 1 a 128, ou que não cabe no plano;
  - mais de 8 faixas;
  - sala sem frente e cenário;
  - sala estreita demais para o período;
  - faixa no mapa inicial avulso.

## Integração

- Módulos de runtime: `scenery` (C portátil, `retro_scenery.{h,c}`) e `scenery-sgdk`
  (`retro_scenery_sgdk.{h,c}`), que depende de `world-sgdk` **versão 3**. Instale em
  modo Jogo. A exportação do mundo pela IDE recusa um mundo com panoramas enquanto
  o módulo `scenery-sgdk` não estiver instalado e atual, dizendo o que instalar. O header gerado traz `#error` pedindo a atualização se o `world-sgdk`
  do projeto for anterior.
- `scenery` 2 e `scenery-sgdk` 2 (#90) acrescentam ao fim de `RetroSceneryLayer` e de
  `RetroScenerySgdkRoom` o vetor de números de padrão e o segundo plano (`patterns`, `back`,
  `backPatterns`); tabelas geradas antes continuam compilando. O callback `cells` do
  `RetroScenerySink` ganhou o parâmetro `plane`. O header gerado traz `#error` pedindo a
  atualização se o `scenery-sgdk` do projeto for anterior.
- `scenery` 3 e `scenery-sgdk` 3 acrescentam as faixas de correnteza:
  - a margem no fim de `RetroSceneryStream`, `retroSceneryStreamSetMargin`, `retroSceneryDriftMargin`,
    `RetroSceneryDrift`, `retroSceneryDriftAdvance`, `retroSceneryDriftShift` e
    `retroSceneryLineScroll` no núcleo;
  - `drifts`, `driftCount` e `marginX` no fim de `RetroScenerySgdkRoom`, e
    `retroScenerySgdkTick` no adaptador.

  Sem faixas, a versão 3 faz exatamente as mesmas transferências da 2 (o teste compara as
  duas).
  - Tabelas geradas para a versão 2 continuam compilando; o compilador só avisa do
    inicializador incompleto até a próxima exportação.
  - O exportador agora sempre escreve os campos novos (`0,0,0` sem faixas) e pede a
    versão 3 para qualquer sala com streaming.
- `world-sgdk` 3 acrescenta ao fim de `RetroWorldSgdkRoom` os campos `renderer` e
  `rendererData`. Tabelas geradas antes (sem os campos) continuam compilando — o compilador
  só avisa do inicializador incompleto até a próxima exportação. Salas sem panoramas não
  mudam de comportamento. Um jogo pode fornecer o próprio renderizador
  (`RetroWorldSgdkRenderer`: `prepare`, `draw`, `scroll`, `release`).
- O jogo não muda de API: `retroWorldSgdkScroll` a cada quadro, antes de `SPR_update`, e
  `bridge.cameraX/Y` para os sprites. A sala com panoramas troca o modo de scroll horizontal
  (por plano, ou por linha de tiles quando há faixas) e a sala seguinte o restaura.
- `retroScenerySgdkStats` dá, para a sala na tela: tiles de streaming em uso e pico, bytes e
  transferências do quadro e pico, quadros em que a câmera foi segurada.
- Exportador: `tools/export-world-maps.py` trata como sala de cenário todo mapa do mundo com
  panoramas. O mapa inicial avulso (`mapExport.sourceMaps`, fora do mundo) continua
  recusando panoramas e diz onde eles funcionam. A exportação do mundo feita pela IDE usa o
  exportador que vem com ela, então projetos existentes passam a exportar panoramas sem
  mexer em nada; a cópia em `tools/` do projeto (usada pelo `make` para o mapa avulso) só
  muda se for atualizada. Mudar `scenery` ou o modo de vídeo em `retro-studio.json` marca a
  exportação do mundo como desatualizada.

## Verificação

- `node scripts/smoke-runtime-scenery.mjs` — o núcleo contra um VDP simulado, com
  sanitizadores: H40, H32, 240 linhas, plano 128 × 64, orçamento mínimo, mapa menor que a
  tela; a cada quadro a tela é exatamente o mapa, dentro do orçamento e da faixa.
- `node scripts/smoke-runtime-scenery-sgdk.mjs` — ponte + adaptador + núcleo: 9000 quadros em
  4 salas (faixas, panorama com scroll vertical, sem panorama, caminho antigo), trocas de
  sala e saltos de câmera; os dois planos conferidos célula a célula, a velocidade de cada
  faixa igual a `(câmera × fator) >> 8`, tiles de outros consumidores intactos, recusas antes
  de a sala aparecer.
- `node scripts/smoke-scenery-export.mjs` — do TMX aos recursos; 11 combinações recusadas com o
  motivo. Com `--sgdk <marsdev/m68k-elf>` constrói a ROM de referência
  (`assets/toolkit/fixtures/scenery-diagnostic.c`); `--keep-rom <arquivo>` a guarda para
  `scripts/capture-rom.sh` com `assets/toolkit/fixtures/scenery-diagnostic.steps.sh`.
- `node scripts/smoke-runtime-scenery-drift.mjs` — faixas de correnteza:
  - a versão 3 sem faixas comparada com a 2, com o mesmo roteiro e o mesmo registro de
    transferências;
  - a margem de 5 colunas nas linhas das faixas em 8000 quadros a até 16 px/quadro, sem
    nenhuma célula ao alcance do deslocamento sem desenho, com as referências dos tiles
    recontadas a cada quadro;
  - a tabela por linha com câmera Y fora da grade de 8;
  - 6 s a 50 e a 60 Hz andando os mesmos pixels;
  - o adaptador com a ponte: tela conferida linha a linha nos dois planos, animação com a
    câmera parada só pelo tick, PAL e NTSC, salto de câmera mantendo a fase, orçamento por
    quadro e recusas.
- A fase do Ibirapuera numa cópia do Sota:
  - as duas faixas marcadas no mapa (176–199 a 16 px/s e 200–319 a 24 px/s, período de
    40 px);
  - módulos atualizados pelo instalador e exportação pela IDE;
  - ROM com o Makefile do jogo e o SGDK real, sem avisos;
  - no Genesis Plus GX, com a câmera parada, as linhas da água deslizam 9 e 13–14 px em
    ~0,56 s (proporção 2:3), enquanto na ROM sem faixas as mesmas linhas não mudam. As
    bordas da tela ficam limpas, inclusive com a câmera em x = 0.
- `node scripts/smoke-scenery-composition.mjs` — as regras mostradas no editor.
- `node scripts/smoke-raster-tilemap.mjs` — a importação de imagem do editor: espelhos como o
  mesmo tile, mais de 2048 tiles, tamanho do mapa.
- #90 também foi conferido com uma cópia do Sota e a fase do Ibirapuera (566 × 68, BGB no
  cenário e BGA na frente, 4007 padrões): exportação pela IDE, ROM com o Makefile do jogo e o
  Genesis Plus GX percorrendo a fase até o fim, com a tela igual à imagem original.

## Limites e o que não foi verificado

- Uma camada de mapa por sala com panoramas (sem camada de frente), e um plano para todos
  os panoramas. Não há panorama em sprites nem scroll por linha de varredura. Sem panoramas,
  os dois planos de mapa andam juntos com a câmera.
- A camada de frente continua sempre prioritária (BG_A na frente dos sprites sem
  prioridade), como no caminho antigo. Uma frente opaca, como a de uma fase importada inteira,
  cobre o personagem.
- Só 224 linhas: em um jogo de 240 linhas as faixas não cobrem a tela e o runtime recusa a
  sala com panoramas.
- O cenário por streaming vai para a ROM sem compressão: 4 bytes por célula de cada plano
  (atributos e número) mais 32 bytes por tile diferente. A fase do Ibirapuera ocupa cerca de
  430 KiB.
- Quando uma sala muda de tipo (ganha ou perde panoramas), os recursos do tipo anterior
  continuam declarados em `res/resources.res` e ocupam ROM até serem removidos à mão — a
  política da exportação do mundo é nunca apagar declarações.
- Exportar uma sala de 256 × 256 leva cerca de 25 s (quase tudo já era da exportação de
  mapas); o limite da IDE para o mundo inteiro é de 3 minutos.
- Salas sem panorama que cabem na VRAM continuam carregando o tileset inteiro ao entrar.
- Salas exportadas antes de #90 com panorama deixam no `res/resources.res` as declarações
  antigas `TILESET`/`TILEMAP` do cenário (a política é nunca apagar declarações).
- A janela simulada e a ROM de referência foram conferidas em H40 × 224 no Genesis Plus GX;
  H32 e 240 linhas só no simulador do teste. Hardware real não foi usado.
- O orçamento de DMA do cenário é dele: a soma com sprites, paletas e áudio no mesmo quadro
  é responsabilidade do jogo (o Diagnóstico em jogo mostra o total enfileirado).
- A reserva de cenário é configurada em `retro-studio.json`; não há tela para ela.
- Projetos com exportador próprio (Alice, Tempo) não mudam e não ganham panoramas sozinhos.
