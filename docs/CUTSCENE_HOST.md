# Adaptador SGDK de referência para cutscenes (#63)

O intérprete de cenas (`cutscene_runner`) continua C puro e sem dependências.
Este adaptador é uma implementação pronta do `CutsceneHost` que liga as cenas
aos módulos comuns, para o jogo não escrever essa cola à mão. É opcional:
jogos com um `CutsceneHost` próprio continuam válidos e não precisam dele.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `src/retro_runtime/retro_cutscene_host.{h,c}` | Módulo `cutscene-host` v1 (depende de `core`, `camera`, `audio`, `progress`). C puro. |
| `src/retro_runtime/retro_cutscene_sgdk.h` | Apresentação de referência no SGDK 1.81: caixa de texto, escolha, fade e leitura do controle. |
| `src/generated/cutscene_adapter.h` | Gatilhos dos mapas e ligação de flags; gerado pela IDE. |
| `.retrostudio/cutscene-adapter-export.json` | Registro de propriedade do header gerado. |

O módulo precisa do runtime de cutscenes instalado (`src/retrostudio/`). Sem
ele, os arquivos compilam vazios, então instalar os módulos em um projeto sem
cutscenes não quebra o build.

## O que o adaptador conecta

| Cena | Destino |
|------|---------|
| Atores (mover, posicionar, virar, mostrar) | Tabela `RetroCutsceneActor` do jogo: `x` (centro), `y` (pés), `facingLeft`, `visible`, `moving`, `changed`. |
| Animações | `actor.animation`: número do vocabulário, ou `RETRO_ID_NONE` para automática (o jogo escolhe parado/andando por `moving`). |
| Câmera | Módulo `camera`: a cena assume o eixo X e devolve ao jogador (#59). |
| Diálogo e escolha | Cópias em `host.dialogue` e `host.choice`, com `dialogueVisible`, `choiceVisible` e `textChanged`. |
| Fade | `host.dark`, `host.fadeFrames`, `host.fadeChanged`. |
| Som e música | Módulo `audio`: efeito pelo número do catálogo; música de cena esconde a da sala (#50). |
| Flags | Flags do runner, salvas no módulo `progress` pelas ligações exportadas (#60). |
| Habilidade, evento, fim | Callbacks opcionais do jogo em `RetroCutsceneHooks`. |

Câmera, áudio e callbacks podem ser nulos; o adaptador roda qualquer cena mesmo
assim.

## Regras de pausa e devolução do controle

`retroCutsceneHostUpdate` é chamado uma vez por quadro e devolve quem é dono do
jogador naquele quadro:

- **`RETRO_CUTSCENE_CONTROL_SCENE`**: o jogo não aplica entrada nem física ao
  jogador e copia a posição do ator para o corpo dele. Vale do quadro em que a
  cena começa até **um quadro depois** de ela terminar, para o botão que fechou
  o último diálogo não virar pulo ou ataque.
- **`RETRO_CUTSCENE_CONTROL_PLAYER`**: quadro normal; o jogo escreve a posição
  do jogador no ator dele.

Enquanto a cena é dona do jogador, gatilhos não são avaliados e uma segunda
cena não começa, com uma exceção: `retroCutsceneHostStart` pode ser chamado
dentro do callback `finished` para encadear cenas sem devolver o controle.
Nunca chame `cutsceneStart` direto no runner. Um gatilho de entrada na sala não
se perde quando outro gatilho dispara no mesmo quadro: ele roda logo depois. O resto do jogo (inimigos, relógio) não é pausado pelo
adaptador: o jogo decide, usando o mesmo valor de retorno.

Ao terminar qualquer cena, tocada até o fim ou pulada, o adaptador garante:

1. a música da sala volta (mesmo que a cena não tenha um passo “música da sala”);
2. diálogo e escolha somem;
3. a câmera volta a seguir o jogador (o runner já devolve o eixo);
4. o callback `finished` do jogo é chamado, e o controle volta no quadro seguinte.

O fade não é desfeito: uma cena que termina escura deixa a tela escura, de
propósito, tanto tocada quanto pulada.

## Executar e pular

Pular (`CUTSCENE_INPUT_SKIP`) leva ao mesmo estado final de tocar a cena:
posições, direção e visibilidade dos atores, flags, cenas vistas, música,
câmera e fade. Em uma escolha aberta, pular usa a opção sob o cursor; nas
escolhas seguintes, a opção padrão.

Isso vale para cenas em que cada comando que lê a posição de um ator encontra
esse ator parado. É uma característica do runner (não alterado): um movimento
relativo, um “virar para o ator” ou uma câmera no ator logo depois de um
movimento **sem espera** do mesmo ator usa a posição intermediária ao tocar e a
posição final ao pular. Ponha “esperar movimentos” antes desses passos. Diferenças intencionais do runner:
sons não tocam durante o avanço rápido; habilidades e eventos acontecem uma
vez, como na execução normal. O teste compara os dois estados pulando em cada
quadro de uma cena com movimentos esperados.

## Gatilhos e validação de referências

Os gatilhos são objetos `cutscene_trigger` nos mapas (ver “Gatilho no mapa” em
`CUTSCENES.md`). Em modo Jogo → **Cutscenes: gatilhos e flags…** a IDE
lê os mapas das salas do grafo de salas (em projetos de mapa único, o primeiro
mapa de `mapExport.sourceMaps`, exportado como sala `RETRO_ID_NONE`), confere e
exporta `src/generated/cutscene_adapter.h`:

```c
static const CutsceneTrigger retroProjectCutsceneTriggers_<sala>[] = { ... };
static const RetroCutsceneRoomTriggers retroProjectCutsceneRooms[] = { ... };
static const RetroCutsceneFlagLink retroProjectCutsceneFlags[] = { ... };
#define RETRO_PROJECT_CUTSCENE_PLAYED_OFFSET ...
#define RETRO_PROJECT_CUTSCENE_PLAYED_BYTES ...
```

Erros (bloqueiam a exportação e o build): cena inexistente, `cutscene` vazio,
`start` desconhecido, flag que não está em `cutscene-config.json`, área vazia
ou fora do limite, mais de 32 gatilhos em uma sala, mapa de sala ausente,
gatilho que o leitor não conseguiu interpretar, e IDs que viram a mesma macro
em `cutscene_ids.h` (entre cenas, entre cena e flag, ou com nomes do runtime). Avisos: flag de cena sem flag de progresso com o mesmo ID, e falta
do campo `cutscenes_played`. As referências do vocabulário de som e música ao
catálogo de áudio são conferidas pelo relatório de áudio.

O header é derivado: quando um mapa, uma cena, o vocabulário ou o progresso
mudam, o build pela IDE pede uma nova exportação. Projetos que nunca exportaram
não são verificados. O exportador de mapas do skeleton, que recusava mapas com
gatilhos, passa a aceitá-los depois da primeira exportação.

### Flags e cenas vistas no save

- Uma flag de cena é salva quando “Progresso e save” tem uma flag com o **mesmo
  ID**. As outras valem só enquanto o console está ligado.
- O campo de progresso `cutscenes_played` (1, 2 ou 4 bytes) guarda quais cenas
  já rodaram, 8 cenas por byte, pela posição da cena na ordem alfabética dos
  arquivos. Acrescentar, remover ou renomear cenas desloca essas posições:
  crie uma nova versão do formato de progresso quando fizer isso. Sem ele, gatilhos de execução única voltam a
  disparar depois de continuar.
- `retroCutsceneHostStore` antes de salvar; `retroCutsceneHostLoad` depois de
  continuar; em novo jogo, `cutsceneResetProgress(&host.runner)`.
- Posição e visibilidade dos atores não são salvas: ao continuar, o jogo
  reposiciona os atores a partir das flags.

## Integração no jogo

```c
#include "retro_runtime/retro_cutscene_sgdk.h"
#include "cutscene_data.h"                 /* em um único arquivo C */
#include "generated/cutscene_adapter.h"
static RetroCutsceneActor actors[2];
static RetroCutsceneHost host;

/* uma vez */
RetroCutsceneHooks hooks = { 0, 0, sceneFinished, 0 };
retroCutsceneHostInit(&host, &cutsceneLibrary, actors, 2, &camera, &audio, &hooks, 320);

/* ao entrar em uma sala */
triggers = retroCutsceneRoomTriggers(retroProjectCutsceneRooms,
           RETRO_PROJECT_CUTSCENE_ROOM_COUNT, room->id, &triggerCount);
retroCutsceneHostRoom(&host);

/* a cada quadro */
control = retroCutsceneHostUpdate(&host, triggers, triggerCount, feetX, feetY,
          retroCutsceneSgdkInput(&input), interactPressed);
if (control == RETRO_CUTSCENE_CONTROL_PLAYER) { /* jogo normal; actors[0] = jogador */ }
else { /* jogador = actors[0]; sem entrada nem física */ }
retroCutsceneSgdkPresent(&host, palette);   /* caixa de texto e fade */
```

`assets/toolkit/fixtures/cutscene-diagnostic.c` é o projeto de exemplo
completo: dois atores, câmera, música de sala e de cena, efeito, escolha, fade,
gatilhos por toque, interação e entrada na sala, e progresso salvo na SRAM ao
fim de cada cena.

A apresentação de referência usa o plano WINDOW nas 7 linhas de baixo, a fonte
e a paleta de texto atuais do SGDK, A/C para confirmar e START para pular.
Substitua-a à vontade: o estado que ela lê é público.

## Compatibilidade

- Projetos existentes e hosts próprios: nenhuma mudança. O runner, o bytecode e
  os headers `cutscene_ids.h`/`cutscene_data.h` não foram alterados.
- Adotar aos poucos é possível: só os gatilhos exportados, só o adaptador, ou
  só a apresentação.

## Limites conhecidos

- Até 8 atores (limite do runner) e 32 gatilhos por sala.
- `cutscenes_played` cobre no máximo 32 das 64 cenas possíveis.
- Retratos não são desenhados pela apresentação de referência (o número do
  retrato está em `host.dialogue.portrait`).
- O fade da apresentação de referência escurece as 64 cores, inclusive o texto:
  não mostre diálogo com a tela escura. O clarear sempre parte do preto.
- Sem um `RetroCamera`, o jogo precisa escrever a posição da própria câmera em
  `host.cameraX` nos quadros de jogador, para a cena partir do lugar certo.
- A leitura dos mapas é textual e considera só objetos `cutscene_trigger`.
  Deslocamentos de camadas e grupos, templates TMX externos e objetos de tile
  não são resolvidos; marcação que o leitor não entende vira erro.
- Um projeto que já exportou e depois perdeu `cutscene-config.json` ou tem uma
  cena com JSON inválido fica bloqueado no build até o arquivo ser corrigido
  (ou `.retrostudio/cutscene-adapter-export.json` ser removido à mão).
- A posição dos atores depois de continuar um save é responsabilidade do jogo.
- Não comprovado em hardware real.

## Verificações

```sh
node scripts/smoke-runtime-cutscene-host.mjs [--m68k-cc <m68k-elf-gcc>]
node scripts/smoke-cutscene-adapter.mjs [--sgdk <raiz-do-SGDK> [--keep-rom <arquivo>]]
node scripts/smoke-cutscene-adapter-panel.mjs
```

ROM no emulador: `scripts/capture-rom.sh <rom> <saída> <emulador>
assets/toolkit/fixtures/cutscene-diagnostic.steps.sh`; `CUTSCENE_PHASE=second`
reinicia com o `game.srm` anterior e `CUTSCENE_PHASE=skip` pula a cena.
