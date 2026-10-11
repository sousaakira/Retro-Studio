# Áudio: catálogo, prévia e runtime de música e efeitos (#50)

Um catálogo de áudio configurado na IDE, exportado como recursos do driver de
som do SGDK e usado por um módulo C opcional. Nada é ativado sozinho: projetos
sem `audio/audio.json` continuam exatamente como estavam, `res/resources.res`
nunca é reescrito e o jogo decide quando tocar.

A ROM só recebe formatos do driver do Mega Drive. MP3 e OGG servem de prévia na
IDE e nunca entram na ROM; não há player moderno embutido.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `audio/audio.json` | Fonte editada na IDE (`retro-studio.audio` v1). |
| `res/audio_resources.res` | Recursos para o rescomp (linhas `XGM` e `WAV`); gerado. |
| `src/generated/audio_config.h` | Números de músicas e efeitos, tabela de efeitos e de música por sala; gerado. |
| `src/generated/audio_sgdk.h` | Liga os símbolos do rescomp ao adaptador SGDK; gerado. |
| `.retrostudio/audio-export.json` | Registro de propriedade dos três arquivos gerados (hashes). |
| `src/retro_runtime/retro_audio.{h,c}` | Módulo `audio` v1 (depende de `core`), sem SGDK. |
| `src/retro_runtime/retro_audio_sgdk.h` | Adaptador do driver XGM do SGDK 1.81. |

Salvar publica tudo na mesma transação (#46). Um arquivo gerado alterado à mão,
ou um arquivo que já existia nesses caminhos, é preservado e bloqueia a
exportação e o build até ser revisado.

## Catálogo

```json
{ "format": "retro-studio.audio", "version": 1, "driver": "xgm", "effectChannels": 3,
  "music":   [{ "id": "cave", "name": "Caverna", "source": "audio/music/cave.vgm",
                "preview": "audio/preview/cave.ogg", "timing": "auto" }],
  "effects": [{ "id": "jump", "name": "Pulo", "source": "audio/sfx/jump.wav",
                "priority": 2, "channel": 0 }],
  "rooms":   [{ "room": "cave", "music": "cave" }] }
```

- **ID**: minúsculas, dígitos e `_` (`count` é reservado para músicas). É o que o código usa
  (`RETRO_PROJECT_AUDIO_MUSIC_CAVE`, `RETRO_PROJECT_AUDIO_SFX_JUMP`). Músicas e
  efeitos têm espaços de ID separados.
- **Original** (`source`): arquivo do projeto que vai para a ROM. Música em
  `.vgm` ou `.xgm`; efeito em `.wav` PCM.
- **Prévia** (`preview`): `.ogg`, `.wav` ou `.mp3` opcional, só para ouvir na IDE.
- **Andamento** (`timing`): `auto`, `ntsc` ou `pal`, repassado ao rescomp.
- **Prioridade** (0 a 15) e **canal** (0 = automático, ou um canal fixo) dos efeitos.
- **Música por sala**: liga uma sala do grafo de salas (#55) a uma música.

Os números exportados são índices em ordem de ID: só mudam quando um ID é
criado, removido ou renomeado. Use sempre as macros, nunca o número.

## Driver e limites

| Item | XGM (SGDK 1.81) |
|------|-----------------|
| Música | VGM/XGM convertido pelo rescomp (`XGM símbolo "arquivo" andamento`). |
| Efeitos | WAV convertido para PCM de 14 000 Hz, mono, 8 bits (`WAV símbolo "arquivo" XGM`). |
| Canais PCM | 4. Com 3 canais para efeitos (padrão), o canal 1 fica com os samples da própria música. |
| Efeitos | Até 192 (samples 64 a 255; 1 a 63 pertencem à música). |

XGM2 (SGDK 2.x) não é exportado: o toolkit configurado é o 1.81. O relatório
acusa quando o driver do catálogo não existe no toolkit.

## Política de música

- **Música da sala** (`retroAudioRoomMusic`): toca ao entrar na sala. A mesma
  música em salas vizinhas não reinicia. `RETRO_ID_NONE` é silêncio.
- **Música de cena** (`retroAudioScriptMusic`): esconde a música da sala. Trocas
  de sala durante a cena ficam guardadas e não tocam.
- **Fim da cena** (`retroAudioRestoreMusic`): volta a música da sala atual, sem
  reiniciar se for a mesma que a cena tocava.
- **Pausa** (`retroAudioPause`): repassa ao driver apenas mudanças de estado.
  Uma troca de música pedida durante a pausa fica guardada e começa ao retomar.
- Pedir de novo a faixa que já está tocando não a reinicia, mesmo que ela seja
  um jingle sem loop que já terminou: troque para silêncio antes.
- Uma cena que troca a música precisa terminar com o passo “música da sala” ou
  o jogo precisa chamar `retroAudioRestoreMusic`; o adaptador de referência de
  cutscenes (#63) faz isso ao fim de toda cena.

## Política de efeitos e interrupção

1. Efeito com canal fixo só considera aquele canal.
2. Efeito automático usa o primeiro canal livre.
3. Sem canal livre, o candidato é a voz de menor prioridade; em caso de empate,
   a mais antiga.
4. O efeito novo interrompe o candidato se a prioridade dele for igual ou
   maior; caso contrário é descartado, sem tocar no driver.

Um driver sem o callback `busy` nunca libera um canal: só um efeito de
prioridade igual ou maior substitui o anterior. O adaptador SGDK fornece `busy`.
Cada consulta para o Z80 por um instante; o módulo consulta cada canal no
máximo uma vez por efeito.

`retroAudioPlayEffect` devolve o canal usado (0 = descartado) e o efeito
interrompido. Chame `retroAudioTick` uma vez por quadro: o driver só informa que
um canal está ocupado depois de processar o comando, então sem essa reserva
curta (2 quadros) vários efeitos disparados no mesmo quadro escolheriam todos o
mesmo canal.

## Integração no jogo

```c
#include "generated/audio_sgdk.h"
static RetroAudio audio;

/* uma vez, depois do boot do SGDK */
RetroAudioDriver driver = retroAudioSgdkDriver(&retroProjectAudioSgdk);
retroAudioInit(&audio, &driver, RETRO_PROJECT_AUDIO_MUSIC_COUNT,
               retroProjectAudioEffects, RETRO_PROJECT_AUDIO_EFFECT_COUNT,
               RETRO_PROJECT_AUDIO_CHANNELS);

/* a cada quadro */
retroAudioTick(&audio);

/* ao ativar uma sala (por exemplo no activate da ponte world-sgdk) */
retroAudioRoomMusic(&audio, retroAudioRoomTrack(retroProjectAudioRooms,
                    RETRO_PROJECT_AUDIO_ROOM_COUNT, room->id));

/* efeitos e eventos */
retroAudioPlayEffect(&audio, RETRO_PROJECT_AUDIO_SFX_JUMP);
```

Eventos de animação (`RETRO_CHARACTER_SOUND`, argumento = número do efeito)
podem chamar `retroAudioPlayEffect` direto. O módulo não conhece nomes do jogo
nem o SGDK: o driver é um conjunto de callbacks, então outro driver ou um duplo
de teste pode ser usado.

### Cutscenes

```c
host.context = &audio; /* ou um contexto do jogo que repasse as chamadas */
host.sound   = retroAudioCutsceneSound;
host.music   = retroAudioCutsceneMusic;
```

No vocabulário de `cutscenes/cutscene-config.json`, use as macros do catálogo
como `value` (`"RETRO_PROJECT_AUDIO_SFX_DOOR"`) e inclua
`generated/audio_config.h` antes de `cutscene_data.h`. O passo de música
“da sala” devolve a música da sala. A IDE nunca reescreve esse arquivo; o
relatório lista os valores que não correspondem ao catálogo. O `context` do
host é único: se a cena também controla a câmera, o jogo precisa de um contexto
próprio que repasse cada callback ao módulo certo (o adaptador de referência é
a #63).

## Editor

modo Jogo → **Áudio: músicas e efeitos…**

- Abas de músicas, efeitos, música por sala e relatório. Os originais são
  escolhidos entre os arquivos de áudio encontrados em `audio/` e `res/`.
- **Prévia**: tocar uma música como sala ou como cena, encerrar a cena, pausar,
  e disparar efeitos (um, ou quatro no mesmo quadro). A lista de canais e o
  registro mostram em que canal cada efeito entrou, o que foi interrompido e o
  que foi descartado, pela mesma política do módulo C.
- O som da prévia vem dos arquivos de prévia e dos WAV originais. A IDE não
  emula o YM2612: uma música sem arquivo de prévia muda o estado, sem som.
- **Relatório**: driver e formatos aceitos, disponibilidade no toolkit, tamanho
  estimado por item e total, e conflitos.
- “Dados exportados” mostra o `.res` e o header que serão gravados.

### Relatório: o que é conferido

| Código | Gravidade | Significado |
|--------|-----------|-------------|
| `missing-source` | erro | Original ausente ou fora do projeto. |
| `invalid-wav`, `wav-not-pcm` | erro | Efeito que não é WAV PCM legível. |
| `wav-extensible` | aviso | WAV no formato estendido; pode precisar ser reexportado como PCM simples. |
| `duplicate-resource` | aviso | O mesmo arquivo está no catálogo e em outro `.res`. |
| `invalid-vgm` | erro | `.vgm` sem assinatura (por exemplo `.vgz` renomeado). |
| `invalid-resource-type` | erro | Linha `SOUND` em algum `.res`; o rescomp não tem esse tipo. |
| `symbol-conflict` | erro | Outro `.res` define um símbolo gerado pelo catálogo. |
| `driver-unavailable` | erro | O toolkit configurado não tem o driver escolhido (mostrado no editor; o build não confere o toolkit). |
| `driver-mix` | aviso | Recurso `XGM2` em projeto configurado para XGM. |
| `long-effect` | aviso | Efeito com mais de 4 s. |
| `shared-source` | aviso | Dois IDs usam o mesmo arquivo. |
| `missing-preview` | aviso | Prévia indicada não existe. |
| `cutscene-vocabulary` | aviso | Som ou música de cutscene cujo valor não é do catálogo. |
| `no-preview`, `wav-converted` | informação | Música sem prévia; WAV que será convertido. |

Erros bloqueiam o build pela IDE; avisos não.

**Trocar o arquivo de um som.** O makefile do SGDK não acompanha os originais:
substituir um WAV ou VGM sem mudar o catálogo não recompila os recursos. Por
isso o `.res` gerado leva uma linha com o resumo dos originais, e o build pela
IDE avisa “Um arquivo de música ou efeito mudou” até você usar “Salvar e
exportar áudio” de novo. Em builds pelo terminal, reexporte ou use `make clean`. O tamanho de um efeito é
calculado pela duração a 14 000 Hz. O de uma música é o do arquivo original,
um limite superior: a conversão costuma reduzir os dados de FM.

## Compatibilidade e migração

- Projetos existentes: nenhuma mudança e nenhuma migração automática.
- O seletor de música por mapa (`retroStudio.musicTrack` no TMX, com
  `audio/soundtrack/catalog.json`) continua funcionando e **não** é lido por
  este catálogo. Quem usa aquele fluxo com scripts próprios pode mantê-lo.
- Jogos com som próprio podem adotar só o catálogo (recursos e números), só o
  módulo, ou nada.
- A importação comum de assets deixou de gravar `SOUND nome "arquivo" 0`, que o
  rescomp recusava: `.wav` vira `WAV … XGM`, `.vgm`/`.xgm` viram `XGM …`, e
  `.mp3`/`.ogg` são copiados sem linha de recurso. Linhas `SOUND` antigas não
  são alteradas; o relatório as aponta.
- Makefiles de projetos criados antes desta versão compilam `main.o` apenas
  depois de `resources.o`. Para usar `audio_resources.h`, troque essa regra por
  `$(filter-out $(RESOURCE_OBJECTS),$(OBJS)): $(RESOURCE_OBJECTS)`, como no
  skeleton atual.

## Limites conhecidos

- Só o driver XGM do SGDK 1.81. Sem XGM2, PCM de 4 canais ou ADPCM.
- Sem síntese de VGM na IDE; a prévia depende de um arquivo renderizado.
- O tamanho das músicas no relatório é um limite superior, não o da ROM.
- Sem volume, fade ou pan por efeito; a pausa afeta a música, e efeitos em
  andamento terminam.
- Com 4 canais para efeitos e músicas que usam samples, o canal 1 é disputado
  com a música: um efeito pode ser recusado pelo driver ou cortar a bateria.
- Renomear o ID de uma música no editor não atualiza as ligações de sala;
  reescolha a música nas salas afetadas.
- Cada relatório lê os originais inteiros; catálogos com muitos arquivos
  grandes deixam a abertura do editor e o início do build mais lentos.
- A reserva de canal dura 2 quadros: um efeito mais curto que isso ainda conta
  como ocupado nesse intervalo.
- Não comprovado em hardware real.

## Verificações

```sh
node scripts/smoke-runtime-audio.mjs [--m68k-cc <m68k-elf-gcc>]
node scripts/smoke-audio-configuration.mjs [--sgdk <raiz-do-SGDK> [--keep-rom <arquivo>]]
node scripts/smoke-audio-editor.mjs
```

- `runtime-audio`: música de sala e de cena, pausa, canais livres, interrupção,
  descarte, canal fixo, reserva no mesmo quadro, runner real de cutscenes e
  4000 decisões comparadas entre o C e a prévia em JS.
- `audio-configuration`: validação, vínculo com o mundo, transação, relatório,
  gate de build, confinamento e header → módulo C; com `--sgdk`, a ROM
  diagnóstica com música VGM e efeitos WAV gerados pelo próprio teste.
- `audio-editor`: script real do componente Vue com um elemento de áudio falso.

Som real no emulador: `SDL_AUDIODRIVER=disk SDL_DISKAUDIOFILE=<saída>/audio.raw
scripts/capture-rom.sh <rom> <saída> <emulador>
assets/toolkit/fixtures/audio-diagnostic.steps.sh` grava o que o emulador toca,
e `node scripts/analyze-audio-capture.mjs <saída>/audio.raw <saída>/marks.txt
--rate 48000` mede o nível e os tons de cada passo. Inspeção do editor:
`node scripts/preview-audio-editor.mjs`.
