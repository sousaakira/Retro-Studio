# Inimigos: editor, formato, exportação e runtime

Sistema de criação de inimigos a partir de personagens já exportados pelo Charset Maker. Não gera
arte: gera a **definição** (animações, atributos, caixas, comportamento) e liga as **instâncias**
colocadas nos mapas a um runtime em C para o SGDK.

```
Charset Maker (personagem exportado)          Mapa da sala (TMX)
        │                                     objeto type="enemy"
        ▼                                     propriedades enemy/facing/patrol…
Jogo → Inimigos (enemies/enemies.json)                │
        │                                             │
        └────────────── exportação ───────────────────┘
                              │
     src/generated/enemy_data.h  ·  res/enemies.res (só se remapear cores)
                              │
     src/retro_runtime/retro_enemy*.c  (módulos enemy e enemy-sgdk)
                              │
     adaptador do jogo (ex.: Sota, src/sota/enemies.c)
```

## Definição × instância

| | Definição (tipo) | Instância |
|---|---|---|
| Onde fica | `enemies/enemies.json` | objeto `type="enemy"` no TMX da sala |
| Editada em | Jogo → **Inimigos** | modo Mapas, painel do objeto |
| Contém | personagem, animações por função, vida, velocidade, dano de contato, detecção, corpo, área vulnerável, área de ataque, tempos de ataque, invulnerabilidade, comportamento | posição, orientação inicial, limites de patrulha, ativação por proximidade, política de reaparecimento |
| Referência | `id` estável (fixo depois de salvo) | propriedade `enemy` = `id`; `kind` acompanha o mesmo valor para compatibilidade |

Projetos antigos que só têm `kind` continuam funcionando: sem `enemy`, o exportador usa `kind`
como ID da definição.

## Cadastrar um inimigo pela interface

1. **Personagens:** desenhe ou recorte o personagem no Charset Maker e clique em **Exportar**.
   Marque as caixas de corpo e (opcional) a área de ataque na animação de ataque.
2. **Jogo → Inimigos → Novo inimigo.** Dê nome e escolha o personagem; as animações com nomes
   comuns (idle/parado, run/correr, ataque, dano, morte) são preenchidas sozinhas.
3. Ajuste vida, velocidade (px/s), dano de contato, alcance de detecção, invulnerabilidade
   após dano e, se quiser, o ataque (preparação, golpe ativo e recuperação, em ms).
4. Em **Ajustes gerais**, confira a paleta (veja abaixo) e quantos inimigos podem ficar ativos ao
   mesmo tempo.
5. **Salvar e exportar.** Problemas aparecem em vermelho com o motivo; a fonte é salva mesmo
   assim, mas o C só é gerado quando tudo resolve.
6. **Mapas:** abra a sala, ponha um objeto **Enemy** (categoria Inimigos) e, no painel do objeto,
   escolha o **Tipo de inimigo**. Ajuste orientação, patrulha (distâncias em pixels a partir do
   objeto; 0 e 0 = anda até parede/borda), ativação e reaparecimento. Os pés do inimigo ficam no
   centro da base do retângulo do objeto.
7. **Salve o mapa.** O mapa e os inimigos são exportados juntos. Construa e jogue.

O segundo, o terceiro… tipo são cadastrados da mesma forma, sem editar código: o C gerado traz
todas as definições e o runtime já sabe executá-las.

## Animações e fallback

Só **Parado** é obrigatória. As outras usam outra no lugar, e o editor mostra qual:

| Função | Sem animação própria usa |
|---|---|
| Andando | Parado |
| Ataque | Parado |
| Dano | Parado |
| Morte | Dano; sem Dano também, o inimigo pisca e some |

O tempo de dano, quando vazio, é a duração da animação de dano; a morte dura a animação de morte.

## Formato `enemies/enemies.json` (versão 1)

```json
{
  "format": "retro-studio.enemies", "version": 1,
  "settings": {
    "maxActive": 3, "activationMargin": 32, "gravity": 900, "maxFall": 240,
    "palette": { "mode": "shared", "slot": 1, "from": "charsets/jogador.charset.json" }
  },
  "definitions": [{
    "id": "ninja_patrulheiro", "name": "Ninja patrulheiro",
    "character": "charsets/ninja.charset.json",
    "animations": { "idle": "idle", "walk": "run", "attack": "ataque", "hurt": "dano", "death": "morte" },
    "behavior": { "type": "ground-patrol", "turnAtEdges": true, "turnAtWalls": true, "pauseMs": 250 },
    "health": 3, "speed": 40, "contactDamage": 1, "detectionRange": 48,
    "body": null, "hurt": null,
    "attack": { "enabled": true, "box": { "x": 4, "y": -30, "width": 24, "height": 18 },
                "damage": 2, "windupMs": 400, "strikeMs": 150, "recoveryMs": 500 },
    "hurtMs": null, "invulnerableMs": 400
  }]
}
```

- Caixas são relativas aos pés, com o inimigo olhando para a direita; `null` usa a do personagem
  (corpo e área vulnerável) ou a marcada na animação de ataque.
- Velocidade em pixels por segundo, tempos em milissegundos: o C gerado traz tabelas NTSC (60 Hz)
  e PAL (50 Hz), escolhidas por `IS_PAL_SYSTEM`.
- `version` muda quando o formato mudar; a IDE recusa versões que não conhece.

Propriedades da instância no TMX (todas texto; vazias usam o padrão):

| Propriedade | Valores | Padrão |
|---|---|---|
| `enemy` | ID da definição | — (obrigatória, ou `kind`) |
| `kind` | igual a `enemy` (legado) | — |
| `facing` | `left` / `right` | `right` |
| `patrolLeft`, `patrolRight` | pixels a partir do objeto | 0 (sem limite) |
| `activation` | pixels além da borda da tela | `settings.activationMargin` |
| `respawn` | `room` / `never` / `delay` | `room` |
| `respawnDelayMs` | milissegundos (com `delay`) | 3000 |

## Paleta

A exportação nunca supõe que uma linha de paleta está livre:

- **Compartilhada** (`shared`): o inimigo usa as cores que o jogo já carrega na linha escolhida
  (normalmente a do jogador). Se as cores do personagem cabem nessa paleta, o sprite exportado é
  usado como está; senão, a IDE gera uma **cópia remapeada** (`res/generated/enemy-<nome>.png`,
  declarada em `res/enemies.res`) com as cores mais próximas e avisa quantas foram aproximadas.
  O sprite original do Charset Maker não muda.
- **Própria** (`own`): a paleta do primeiro tipo de inimigo é carregada numa linha. A exportação
  recusa linhas carregadas por alguma sala (lidas de `src/generated/world_maps.h`) e as listadas
  em `palette.reserved` (linhas que o seu código usa).

## Exportação

`electron/retro/enemyConfiguration.js` (puro: `shared/retro/enemies.js`). Uma transação publica:

| Arquivo | Conteúdo |
|---|---|
| `enemies/enemies.json` | a fonte |
| `src/generated/enemy_data.h` | definições NTSC/PAL, tempos dos quadros, instâncias por sala, `retroEnemyDataRoom(room,&count)`, `retroEnemyDataLoadPalette()` |
| `res/enemies.res`, `res/generated/enemy-*.png` | só quando há cópia remapeada |
| `.retrostudio/enemy-export.json` | hashes dos gerados (propriedade) |

- Um gerado alterado fora da IDE é **preservado**: salvar recusa e o painel mostra conflito.
- Gerados que deixam de ser necessários são removidos se ainda tiverem o hash registrado.
- Salvar um mapa reexporta os inimigos (as instâncias moram no TMX); problemas aparecem num aviso,
  sem desfazer o mapa.
- **Build:** com `enemies/enemies.json`, o build pela IDE é barrado se o C estiver desatualizado,
  personalizado ou com referências inválidas (porta `validateEnemiesForBuild`). Sem o arquivo,
  nada muda.
- Com inimigos configurados, o exportador de mapa (interno e `tools/export-map.py` dos projetos)
  **não** exporta objetos `type="enemy"` como decoração animada (`RetroSceneObject`): há uma só
  representação do inimigo, a do runtime. O visual do objeto continua servindo de prévia no editor.

## Runtime (módulos `enemy` e `enemy-sgdk`)

Instale em Jogo → Módulos de apoio. Arquivos: `retro_enemy.h/.c` (lógica, sem SGDK, testável no
PC) e `retro_enemy_sgdk.h/.c` (sprites).

```c
RetroEnemyPool pool;                     /* estático: nada é alocado por quadro */
static u8 defeated[RETRO_ENEMY_DATA_DEFEATED_BYTES];
retroEnemySgdkInit(&pool, retroEnemyDataDefinitions(), RETRO_ENEMY_DATA_DEFINITION_COUNT,
                   RETRO_ENEMY_DATA_MAX_ACTIVE, defeated, RETRO_ENEMY_DATA_INSTANCE_COUNT);
/* ao ativar uma sala */
spawns = retroEnemyDataRoom(room->id, &count);
retroEnemyEnterRoom(&pool, spawns, count, colliders, colliderCount, slopes, slopeCount, w, h);
/* a cada quadro (não chamar com o jogo pausado) */
retroEnemySetTarget(&pool, &playerBody, 1);
retroEnemyUpdate(&pool, cameraX, cameraY, screenWidth, screenHeight);
retroEnemyHit(&pool, &swordBox, dano, numeroDoGolpe, 0);   /* espada: 1x por inimigo por golpe */
retroEnemyHit(&pool, &shotBox, dano, 0, 1);                 /* projétil: para no primeiro */
dano = retroEnemyTouch(&pool, &playerBody);                 /* contato e golpe ativo */
retroEnemySgdkDraw(&pool, cameraX, cameraY);                /* antes de SPR_update */
```

- **Pool:** até `RETRO_ENEMY_POOL_MAX` (8) atores; o limite de ativos (`maxActive`) é escolhido no
  editor. Até `RETRO_ENEMY_ROOM_SPAWN_MAX` (32) instâncias por sala (a exportação confere).
- **Ativação:** uma instância ativa quando o ponto de origem entra na tela mais a margem dela;
  desativa (volta a ser só instância) quando o corpo sai da tela + margem + 64 px. Depois de
  desativada viva, só reaparece quando a origem sai e volta à área (não surge na frente do jogador).
- **Sprites/VRAM:** cada ativo reserva um `Sprite` (VRAM automática) na ativação e o libera ao
  desativar, morrer ou trocar de sala. Sem VRAM, a ativação é adiada para o próximo quadro.
  Reserve no `SPR_initEx` `retroEnemySgdkTileBudget(...)` tiles a mais. Limite os ativos para
  respeitar os 80 sprites de hardware e o limite por linha (20 sprites / 320 px).
- **Animação:** manual (o runtime avança os quadros); pausado = congelado, inclusive o piscar.
- **Terreno:** `retroMoveBodySlopes` com os colisores e rampas da sala; o corpo é espelhado ao virar.
  A sonda de borda é uma coluna de 1 px à frente do pé.
- **Estados:** patrulha → (vê o alvo) preparação → golpe → recuperação; dano (pausa e
  invulnerabilidade); morrendo → derrotado. Caiu da sala = derrotado.
- **Reaparecimento:** `room` volta ao reentrar na sala (inclui respawn do jogador); `never` fica
  derrotado até `retroEnemyResetDefeated`; `delay` volta após o tempo, com a origem fora de vista.

### Novos comportamentos

1. Um id em `ENEMY_BEHAVIORS` (`shared/retro/enemies.js`), com rótulo e campos validados.
2. O mesmo id no enum `RETRO_ENEMY_BEHAVIOR_*` de `retro_enemy.h` e uma função de tick em
   `retro_enemy.c` (hoje `patrolTick`), escolhida em `tickBehavior`.
3. Campos no editor (`EnemyEditor.vue`) e no C gerado (`definitionC`).

Definições com comportamento desconhecido são recusadas no init do runtime e na exportação.

## Testes

- `node scripts/smoke-runtime-enemy.mjs [--m68k-cc <gcc>]`: runtime no PC (patrulha, parede,
  borda, limites, câmera, pool, VRAM adiada, espada, kunai, invulnerabilidade, morte, contato,
  ataque, pausa, respawn, troca de sala, limites).
- `node scripts/smoke-enemy-export.mjs`: formato, referências, limites, paleta, transação,
  propriedade dos gerados, porta de build e painel.
- `node scripts/smoke-enemy-editor.mjs`: o script real do `EnemyEditor.vue` com o exportador de
  verdade (criar, conferência ao vivo, salvar, reabrir com ID fixo, editar, duplicar, remover,
  fechar com confirmação).
- O Sota (`make test-player`) testa o adaptador dele com o runtime real.

## Limites desta versão

- Um comportamento: patrulheiro terrestre (com ataque corpo a corpo opcional).
- Paleta própria usa as cores do primeiro tipo; os demais são encaixados nela.
- Inimigos não empurram o jogador nem colidem entre si.
- A pausa precisa ser do host: o runtime não sabe quando o jogo está pausado.
