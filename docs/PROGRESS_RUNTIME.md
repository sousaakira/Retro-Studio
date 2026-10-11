# Progresso, checkpoints e save em SRAM (#60)

Formato versionado do progresso do jogo, configurado na IDE e usado por um
módulo C opcional. Nada é ativado sozinho: projetos sem `progress/progress.json`
continuam exatamente como estavam, e o jogo decide quando salvar e carregar.
Jogos sem SRAM usam o mesmo código: o progresso vive só na RAM.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `progress/progress.json` | Fonte editada na IDE (formato, flags, campos, SRAM). |
| `src/generated/progress_config.h` | Header gerado; não editar à mão. |
| `.retrostudio/progress-export.json` | Registro de propriedade do header (hash). |
| `src/retro_runtime/retro_progress.{h,c}` | Módulo `progress` v1 (depende de `core`). |
| `src/retro_runtime/retro_progress_sgdk.h` | Adaptador de SRAM do SGDK 1.81. |

Salvar publica fonte, header e registro na mesma transação (#46). Um header
alterado à mão ou sem registro é preservado e bloqueia a exportação e o build
até ser revisado. O build recusa header desatualizado e também SRAM ativada
quando `src/boot/rom_head.c` do projeto não declara `"RA"`.

## O que é salvo

- **Checkpoint**: ID numérico da sala e do checkpoint (`RETRO_ID_NONE` = nenhum),
  os mesmos IDs estáveis de `RetroWorldSave` (#55).
- **Flags**: bits nomeados (porta aberta, chefe derrotado). Até 256.
- **Campos do jogo**: valores de 1, 2 ou 4 bytes, big-endian, dentro de até
  64 bytes de dados (vidas, moedas, pontuação).

O espaço é **reservado**: a capacidade de flags (múltiplo de 8) e o tamanho dos
dados fazem parte do formato. Acrescentar flags e campos dentro do espaço
reservado não muda o formato; saves antigos leem as novidades como zero.

## Versões do formato e migração

O número de versão (`schema`) identifica o significado dos bits e bytes. Só com
uma **nova versão** é possível mudar o espaço reservado, o bit de uma flag ou a
posição e o tamanho de um campo. A IDE e a exportação recusam essas mudanças na
mesma versão. Ao criar uma nova versão, a anterior entra no histórico, e o jogo
continua lendo os saves dela:

- flags são copiadas pelo número do bit; bits que não cabem mais são descartados;
- os dados são copiados do início; o que sobra começa zerado;
- o carregamento informa `migrated` e a versão encontrada, para o jogo ajustar
  campos cujo significado mudou.

A migração é só essa cópia; reinterpretações ficam com o jogo. Reutilizar na
mesma versão o bit de uma flag removida ou os bytes de um campo removido faz
saves antigos aparecerem com o valor antigo no lugar novo: a IDE compara só com
a última exportação e não detecta esse reuso. Prefira espaço livre ou uma nova
versão. Remover uma versão do histórico exige
confirmação explícita no editor; o jogo passa a recusar esses saves.

Um save mais novo do que o jogo conhece nunca é carregado nem trocado por uma
cópia antiga legível: o resultado é `RETRO_PROGRESS_UNSUPPORTED`. Salvar nesse
slot também devolve `UNSUPPORTED` até o jogo apagá-lo de forma explícita.

A posição dos slots não depende da versão. Depois de exportado, mudar o
“Primeiro byte usado” ou reduzir os slots faz os saves existentes serem lidos
no slot errado ou sumirem; a IDE recusa a mudança sem confirmação explícita.

## SRAM e integridade

| Item | Valor |
|------|-------|
| Tipo | SRAM de 8 bits nos endereços ímpares, a partir de `0x200001` (padrão do SGDK). |
| Cabeçalho da ROM | `"RA"`, `0xF820`, início e fim; o `rom_head.c` padrão do SGDK já declara. |
| Tamanhos aceitos | 512 a 32768 bytes (o editor mostra também em kbit). |
| Slot | 256 bytes: duas cópias de 128 bytes. Até 8 slots. |
| Primeiro byte | Configurável, para conviver com dados próprios do jogo na SRAM. |

Cada cópia: assinatura `RP`, versão do registro, versão do formato, capacidade
de flags, tamanho dos dados, número de sequência (32 bits), sala, checkpoint,
flags, dados e CRC-16/CCITT-FALSE. Tudo big-endian. Os deslocamentos dos slots
não dependem do formato, então versões diferentes convivem.

Salvar grava sempre na cópia danificada ou mais antiga e lê de volta para
conferir. Se a energia cair durante a gravação, a outra cópia continua válida e
o próximo carregamento devolve o save anterior com `recovered = 1`.

| Resultado | Significado | O que o jogo faz |
|-----------|-------------|------------------|
| `RETRO_PROGRESS_OK` | Carregado (veja `migrated` e `recovered`). | Continuar. |
| `RETRO_PROGRESS_EMPTY` | Nenhum save no slot. | Oferecer só “novo jogo”. |
| `RETRO_PROGRESS_CORRUPT` | Não há cópia válida e ao menos uma está danificada (inclui o primeiro save do slot interrompido). | Avisar e começar novo jogo; o próximo save repara o slot. |
| `RETRO_PROGRESS_UNSUPPORTED` | O save mais novo do slot é de versão desconhecida (ao carregar e ao salvar). | Avisar; apagar só se o jogador pedir. |
| `RETRO_PROGRESS_NO_STORAGE` | Projeto sem SRAM (0 slots) ou sem armazenamento. | Seguir só com a RAM. |
| `RETRO_PROGRESS_STORAGE` | Leitura, gravação ou conferência falhou. | Avisar que não foi salvo. |
| `RETRO_PROGRESS_INVALID` | Argumentos fora do contrato. | Erro de integração. |

Qualquer resultado diferente de `OK` deixa o progresso em RAM intocado.

## Memória

- `RetroProgress`: 100 bytes de RAM por instância.
- Pilha: até 448 bytes ao carregar e 336 ao salvar (medido no 68000 com
  `-O2`), mais os callbacks. Cabe na pilha padrão do SGDK (2560 bytes). Não
  chame de dentro de uma interrupção.
- SRAM: 256 bytes por slot.
- Código: cerca de 2,8 KiB no 68000 com `-O2`.

## Integração no jogo

```c
#include "generated/progress_config.h"
#include "retro_runtime/retro_progress_sgdk.h"
static RetroProgress progress;
static RetroProgressStorage storage;

/* uma vez */
storage = retroProgressSgdkStorage(RETRO_PROJECT_PROGRESS_SRAM_BYTES);

/* novo jogo */
retroProgressNew(&progress, &retroProjectProgress);

/* continuar */
RetroProgressInfo info;
if (retroProgressLoad(&progress, &retroProjectProgress, &storage, slot, &info) == RETRO_PROGRESS_OK) {
    RetroWorldSave save = { 1, progress.room, progress.checkpoint };
    retroWorldRestore(&world, &save);
}

/* ao ativar um checkpoint */
RetroWorldSave save;
if (retroWorldSnapshot(&world, &save)) { progress.room = save.room; progress.checkpoint = save.checkpoint; }
retroProgressSetFlag(&progress, &retroProjectProgress, RETRO_PROJECT_PROGRESS_FLAG_KEY, 1);
retroProgressWrite(&progress, &retroProjectProgress, RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET,
                   RETRO_PROJECT_PROGRESS_FIELD_COINS_BYTES, coins);
retroProgressSave(&progress, &retroProjectProgress, &storage, slot);

/* apagar */
retroProgressErase(&retroProjectProgress, &storage, slot);
```

Com a SRAM desativada, `RETRO_PROJECT_PROGRESS_SLOTS` é 0 e salvar, carregar e
apagar devolvem `RETRO_PROGRESS_NO_STORAGE` sem acessar o hardware. O módulo
não depende do SGDK nem do módulo `world`; o armazenamento é uma dupla de
callbacks, então outro meio (ou um buffer de teste) pode ser usado.
`assets/toolkit/fixtures/progress-diagnostic.c` é um exemplo completo.

## Editor

modo Jogo → **Progresso e save…**

- Espaço reservado, flags (ID, nome, bit) e campos (ID, nome, byte, tamanho),
  com mapa de bits e bytes ocupados, livres e em conflito.
- SRAM: ativar, slots, tamanho e primeiro byte; aviso quando o cabeçalho da ROM
  do projeto não declara a SRAM.
- Orçamento: bytes do registro, SRAM usada, RAM e pilha.
- “Nova versão do formato” e histórico de versões que o jogo ainda lê.
- “Dados exportados” mostra o header que será gravado.
- Rascunhos separados por projeto; mudanças externas e header personalizado
  bloqueiam a exportação sem descartar o rascunho.

## Compatibilidade

- Projetos existentes: nenhuma mudança. Não há migração automática de saves de
  jogos que já usam a SRAM por conta própria; use “Primeiro byte usado” para
  reservar a região deles.
- Jogos com sistema de save próprio podem adotar só o header, só o módulo, ou nada.

## Limites conhecidos

- Não comprovado em hardware real. Para validar em cartucho ou flashcart:
  salvar, desligar, religar e continuar; desligar durante um save repetidas
  vezes e conferir que o save anterior volta; testar com a bateria ausente.
- O CRC detecta dano, não o corrige; com as duas cópias danificadas o save se perde.
- SRAM de 16 bits ou em endereços pares, EEPROM e mapeadores não são cobertos
  pelo adaptador; forneça outros callbacks.
- ROMs acima de 2 MiB dividem o endereço com a SRAM. O adaptador mapeia a SRAM
  só durante cada chamada e com interrupções desligadas, mas música ou samples
  que o driver de som leia acima de 2 MiB podem falhar durante um save:
  mantenha-os abaixo ou salve em silêncio. Esse caso não foi executado.
- A conferência do cabeçalho da ROM é textual (`"RA"` em `src/boot/rom_head.c`,
  ignorando comentários); não avalia `#if` nem confere a faixa declarada.
- As mensagens de validação do formato aparecem em inglês no editor.

## Verificações

```sh
node scripts/smoke-runtime-progress.mjs [--m68k-cc <m68k-elf-gcc>]
node scripts/smoke-progress-configuration.mjs [--sgdk <raiz-do-SGDK> [--keep-rom <arquivo>]]
node scripts/smoke-progress-editor.mjs
```

- `runtime-progress`: novo jogo, flags, campos, caminho sem SRAM, slots, cópias
  alternadas, gravação interrompida em cada posição, erro de cada bit do
  registro, reparo, falhas de armazenamento, apagar, migração e paridade do
  formato em JS.
- `progress-configuration`: validação, disciplina de versões, transação, gate de
  build, cabeçalho da ROM, conflitos e header → módulo C; com `--sgdk`, ROM diagnóstica.
- `progress-editor`: script real do componente Vue em host mínimo.

ROM no emulador: `scripts/capture-rom.sh <rom> <saída> <emulador>
assets/toolkit/fixtures/progress-diagnostic.steps.sh`. `PROGRESS_PHASE=second`
reinicia com o `game.srm` da rodada anterior copiado para `<saída>/home`;
`--inspect-srm <arquivo>` do teste de configuração decodifica a SRAM do emulador
e `--damage-newest <destino>` grava uma cópia com um byte danificado para a
terceira rodada. Inspeção do editor: `node scripts/preview-progress-editor.mjs`.
