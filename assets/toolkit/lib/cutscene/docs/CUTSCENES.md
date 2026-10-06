# Cutscenes do Retro Studio

Referência do formato de cenas programadas (cutscenes) do Retro Studio. Serve a pessoas e a IAs: uma IA deve conseguir ler um arquivo `.cutscene.json` e entender exatamente o que acontece na tela, ou integrar o runtime a um jogo novo, apenas com este documento.

## Visão geral

```text
Editor de cenas (Retro Studio)        Mapa (TMX)
  cutscenes/<id>.cutscene.json          objeto cutscene_trigger
            │                                   │
  tools/compile-cutscenes.mjs          exportador de mapas do jogo
            │                                   │
  src/cutscene_ids.h + cutscene_data.h  CutsceneTrigger[] por sala
            └──────────────┬────────────────────┘
               src/retrostudio/cutscene_runner.c  (genérico, C puro)
                           │  CutsceneHost (callbacks)
               adaptador do jogo (sprites, texto, som, câmera)
```

- **Cena** (`.cutscene.json`): a sequência de comandos, como os comandos de evento do RPG Maker. É a fonte de verdade.
- **Configuração** (`cutscenes/cutscene-config.json`): vocabulário do projeto (atores, animações, retratos, sons, músicas, habilidades, eventos, flags) e o valor C de cada item.
- **Compilador** (`tools/cutscene-compiler.mjs` + `tools/compile-cutscenes.mjs`): valida as cenas, quebra os textos em páginas e gera bytecode. O editor roda o mesmo compilador ao salvar.
- **Runtime** (`src/retrostudio/cutscene_runner.c/.h`): intérprete genérico, igual em todos os jogos. Não conhece SGDK; tudo que é específico do jogo passa por `CutsceneHost`.
- **Gatilho** (`cutscene_trigger` no TMX): define onde e quando a cena começa.

Não edite os cabeçalhos gerados; edite a cena ou a configuração e recompile.

## Arquivo de cena

`cutscenes/<id>.cutscene.json`:

```json
{
  "format": "retro-studio.cutscene",
  "version": 1,
  "id": "clareira_encontro",
  "title": "Encontro na clareira",
  "description": "Intenção da cena em linguagem natural, para pessoas e IAs.",
  "map": "maps/alice-forest/forest-clearing.tmx",
  "steps": [
    { "type": "move", "actor": "alice", "x": 32, "relative": true, "speed": 1, "wait": true,
      "note": "Alice hesita antes de se aproximar" },
    { "type": "say", "actor": "cat", "portrait": "cat", "side": "left", "text": "Você me ouviu?" }
  ]
}
```

| Campo | Obrigatório | Descrição |
|---|---|---|
| `format` | sim | Sempre `retro-studio.cutscene`. |
| `version` | sim | `1`. |
| `id` | sim | Minúsculas, números e `_`. Vira `CUTSCENE_<ID>` em C e é o valor da propriedade `cutscene` do gatilho. |
| `title` | não | Nome legível. |
| `description` | não | Intenção geral da cena. Não vai para a ROM. |
| `map` | não | Mapa usado como palco no editor (posições e prévia). Não vai para a ROM. |
| `steps` | sim | Lista de passos executados em ordem. |

Todo passo aceita `note` (texto livre com a intenção do passo; ignorado pelo compilador). Coordenadas são pixels do mundo (mapa), com `x` no centro horizontal do ator e `y` nos pés.

## Passos

| `type` | Campos | Efeito | Bloqueia? |
|---|---|---|---|
| `say` | `actor?`, `speaker?`, `portrait?`, `side` (`left`/`right`), `text` | Caixa de diálogo. Sem `speaker`, usa o `name` do ator. O texto é quebrado em linhas e páginas automaticamente; cada página espera confirmação. | Até confirmar |
| `choice` | `prompt?`, `default`, `options: [{ text, steps }]` | Menu de 1 a 4 opções; executa os `steps` da opção escolhida e continua depois da escolha. | Até confirmar |
| `move` | `actor`, `x`, `y?`, `relative`, `speed` (px/quadro, padrão 1), `wait` (padrão true) | Move o ator em linha reta. Sem `y`, mantém a altura. `relative: true` soma ao ponto atual. Com `wait: false`, a cena segue e o movimento corre em paralelo. | Se `wait` |
| `place` | `actor`, `x`, `y?` | Teleporta o ator. | Não |
| `face` | `actor`, `direction` (`left`/`right`/`actor`), `target` | Vira o ator; `actor` vira na direção do ator `target`. | Não |
| `animate` | `actor`, `animation` | Força uma animação da configuração; `auto` devolve o controle ao jogo. | Não |
| `show` | `actor`, `visible` | Mostra ou oculta o ator. | Não |
| `wait` | `frames` | Espera quadros (60 = 1 s em NTSC). | Sim |
| `wait_moves` | — | Espera todos os movimentos paralelos terminarem. | Sim |
| `camera` | `mode` (`actor`/`x`/`follow`), `actor`, `x`, `speed` (px/quadro; 0 = corte), `wait` | Leva a câmera até o ator ou até um x; `follow` devolve a câmera ao jogador. | Se `wait` |
| `fade` | `direction` (`out`/`in`), `frames` | Escurece ou clareia a tela. | Sim |
| `sound` | `sound` | Toca efeito sonoro. | Não |
| `music` | `music` | Troca a música; `room` volta à música da sala. | Não |
| `set_flag` | `flag`, `value` (padrão true) | Liga/desliga uma flag de progresso. | Não |
| `if_flag` | `flag`, `value`, `then: []`, `else: []` | Ramifica pelo valor da flag. | Não |
| `ability` | `ability` | Concede uma habilidade ao jogador. | Não |
| `event` | `event`, `arg` | Chama um evento específico do jogo (tremor, abrir porta, etc.). | Não |

No fim da cena, movimentos pendentes terminam no destino, a caixa de diálogo fecha, a câmera volta a seguir o jogador e a cena é marcada como já vista.

Durante a cena, o jogador pode **pular** (`CUTSCENE_INPUT_SKIP`): os passos são executados instantaneamente, diálogos são fechados e escolhas usam a opção `default`. Flags, habilidades e eventos continuam sendo aplicados, para o estado do jogo ficar consistente.

### Quebra de texto

`dialogue` na configuração define `charsPerLine`, `charsPerLineWithPortrait`, `linesPerPage` (até 4), `asciiOnly` (converte acentos para ASCII, como a fonte do SGDK exige) e `uppercaseSpeaker`. Use `\n` no texto para forçar quebra de linha. O editor mostra as páginas exatamente como o jogo.

## Configuração do projeto

`cutscenes/cutscene-config.json`:

```json
{
  "format": "retro-studio.cutscene-config",
  "version": 1,
  "output": { "ids": "src/cutscene_ids.h", "data": "src/cutscene_data.h" },
  "includes": ["game_sound.h"],
  "screen": { "width": 320, "height": 224 },
  "dialogue": { "charsPerLine": 32, "charsPerLineWithPortrait": 26, "linesPerPage": 2, "asciiOnly": true, "uppercaseSpeaker": true },
  "actors": [
    { "id": "alice", "name": "Alice", "value": 0, "color": "#f472b6", "mapObjectType": "player_spawn" },
    { "id": "cat", "name": "Gato da Floresta", "value": 1, "color": "#fbbf24", "mapObjectType": "ability_cat" }
  ],
  "animations": [{ "id": "idle", "value": "ANIM_IDLE" }],
  "portraits": [{ "id": "alice", "name": "Alice", "value": 0, "image": "art/portraits/alice.png" }],
  "sounds": [{ "id": "pickup", "value": "SFX_PICKUP" }],
  "music": [{ "id": "clearing", "value": 1 }],
  "abilities": [{ "id": "double_jump", "value": 0 }],
  "events": [{ "id": "shake", "value": 0, "description": "Treme a tela por arg quadros" }],
  "flags": [{ "id": "met_cat", "description": "Alice já conversou com o gato" }]
}
```

- `value` é escrito no C como está: número ou identificador (`SFX_PICKUP`). Cabeçalhos que definem esses identificadores vão em `includes`.
- Sem `value`, o valor é a posição do item na lista.
- `actors[].mapObjectType` diz ao editor qual objeto do mapa marca a posição inicial do ator. `color` é a cor do marcador na prévia.
- `portraits[].image` é só para a prévia do editor; o jogo desenha o retrato pelo índice `value`.
- `flags` precisam ser declaradas aqui (até 128). Os índices seguem a ordem da lista; acrescente novas flags no fim para não mudar os índices de saves existentes.

## Gatilho no mapa

Objeto TMX com `type="cutscene_trigger"`. O retângulo do objeto é a área do gatilho.

| Propriedade | Valores | Descrição |
|---|---|---|
| `cutscene` | id da cena | Cena a executar. |
| `start` | `touch` (padrão), `interact`, `enter` | `touch`: ao entrar na área. `interact`: dentro da área, apertando o botão de interação. `enter`: ao entrar na sala (a área é ignorada). |
| `once` | `true` (padrão) / `false` | Executa só uma vez por jogo. |
| `requires_flag` | id de flag | Só dispara com a flag ligada. |
| `unless_flag` | id de flag | Não dispara com a flag ligada. |

Cada jogo converte esses objetos em `CutsceneTrigger` no seu exportador de mapas, usando `CUTSCENE_<ID>` e `CUTSCENE_FLAG_<ID>` de `cutscene_ids.h`.

## Bytecode (para quem implementa ferramentas)

Cada cena vira um vetor `unsigned short`. Destinos de salto são índices de palavra dentro da cena. Valores com sinal (coordenadas, `arg`) usam complemento de dois em 16 bits. `0xFFFF` (`CUTSCENE_NONE`) significa ausente.

| Op | Nome | Argumentos |
|---|---|---|
| 0 | END | — |
| 1 | WAIT | frames |
| 2 | MOVE | actor, x, y, speed (1/256 px por quadro), flags (1 esperar, 2 relativo, 4 manter y) |
| 3 | PLACE | actor, x, y, flags (4 manter y) |
| 4 | FACE | actor, modo (0 direita, 1 esquerda, 2 olhar para), ator alvo |
| 5 | ANIMATE | actor, animação (NONE = automática) |
| 6 | VISIBLE | actor, visível |
| 7 | SAY | actor, string do nome, retrato, lado, nº de linhas, linha0..linha3 |
| 8 | CHOICE | string do prompt, nº de opções, padrão, opção0..3, destino0..3 |
| 9 | CAMERA | modo (0 seguir, 1 x, 2 ator), valor, velocidade (1/256 px; 0 = corte), flags (1 esperar) |
| 10 | FADE | escurecer (1) ou clarear (0), quadros |
| 11 | SOUND | som |
| 12 | MUSIC | faixa (NONE = música da sala) |
| 13 | SET_FLAG | flag, valor |
| 14 | IF_FLAG | flag, valor esperado, destino se diferente |
| 15 | JUMP | destino |
| 16 | ABILITY | habilidade |
| 17 | EVENT | evento, arg |
| 18 | WAIT_MOVES | — |

## Integrar o runtime a um jogo

1. Copie `src/retrostudio/cutscene_runner.c/.h` (o editor faz isso em **Instalar runtime**). O `makefile.gen` do SGDK compila `src/*/*.c` automaticamente.
2. Inclua `cutscene_data.h` em **um único** arquivo C (o adaptador) e chame `cutsceneInit(&runner, &cutsceneLibrary)`.
3. Implemente `CutsceneHost` com as funções do jogo. Ponteiros nulos são ignorados.
4. A cada quadro: se `cutsceneIsActive`, pause o controle do jogador e chame `cutsceneStep(&runner, &host, entradaNova)`. Caso contrário, chame `cutsceneTriggerFind` com a posição dos pés do jogador e os eventos do quadro (`CUTSCENE_EVENT_TOUCH` sempre, `INTERACT` ao apertar interação, `ENTER` no quadro em que a sala carregou) e inicie a cena encontrada com `cutsceneStart`.
5. Salve `runner.flags` e `runner.played` junto com o progresso do jogo, se houver salvamento.

`cutsceneStep` recebe somente botões recém-apertados (`CUTSCENE_INPUT_CONFIRM`, `UP`, `DOWN`, `SKIP`). O runtime nunca lê o controle diretamente.

## Para IAs

- Ao criar ou alterar cenas, edite apenas `.cutscene.json` e, se precisar de vocabulário novo, `cutscene-config.json`. Depois rode `node tools/compile-cutscenes.mjs`.
- Use `description` e `note` para registrar a intenção; isso ajuda o próximo agente.
- Um comando novo que precise de código do jogo deve virar um `event` na configuração e um `case` no callback `event` do adaptador, sem alterar o runtime.
- Alterações no runtime valem para todos os jogos: mantenha a compatibilidade do bytecode e incremente `CUTSCENE_RUNTIME_VERSION` se o formato mudar.
