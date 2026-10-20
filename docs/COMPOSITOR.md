# Compositor de músicas (modo Música)

Issue #89. Compor músicas para o Mega Drive tocando num teclado MIDI, ouvindo o YM2612 e o PSG emulados e exportando para o driver XGM do SGDK.

Abra pelo botão **Música** na barra de modos (Alt+7).

## Teclado MIDI

- **Bluetooth (ex.: M-Vave SMK-25):** "Conectar SMK-25" no topo. O Retro Studio lê o BLE-MIDI direto pelo Web Bluetooth, porque o BlueZ do Ubuntu/Pop!_OS vem sem o plugin MIDI e o teclado não vira porta ALSA. O teclado usado é lembrado e reconecta sozinho.
- **USB:** ligue o cabo e o teclado aparece sozinho (Web MIDI). O SMK-25 por USB cria as portas `SMK25-Master`, `SMK25-Private` e uma terceira; a `Midi Through` do Linux não aparece. Uma porta pode ser ocultada (fica oculta nas próximas sessões).
- **Permissão:** desde o Chromium 124, todo acesso ao Web MIDI pede a permissão `midiSysex`, mesmo sem SysEx; o app a libera só para as próprias páginas (`file://` instalado e `localhost:5175` em desenvolvimento). O código do app nunca pede SysEx.
- **Sem teclado:** mouse no teclado da tela, ou `Z`…`M` (a partir de C3) e `Q`…`I` (a partir de C4). Espaço toca/para.
- **Controles:** a roda de pitch dobra a nota (±2 semitons); a de modulação faz vibrato pelo LFO do YM2612. Em "Teclado MIDI → Controles" dá para ligar knobs por MIDI learn (volume e parâmetros).

## Pads

Os 8 pads do SMK-25 mandam notas no canal 10, com a força da batida: a fileira de cima (pads 1 2 3 4) manda 40-43 e a de baixo (5 6 7 8) manda 36-39. A tela mostra os pads na mesma disposição. Ficam embaixo, ao lado do teclado da tela, e acendem com o toque; também tocam com o mouse.

- **Bateria** (padrão): cada pad toca uma peça: 1 bumbo, 2 caixa, 3 chimbal, 4 chimbal aberto, 5 tom agudo, 6 tom grave, 7 prato, 8 palmas. Em **Configurar**, cada pad escolhe qualquer instrumento (do banco ou da música) e a nota. Gravando, cada peça vai para a sua faixa (a primeira faixa com aquele instrumento, ou uma nova com o nome dele); as teclas continuam na faixa selecionada.
- **Controles**: 1 tocar/parar, 2 gravar, 3 metrônomo, 4 loop, 5 desfazer, 6 refazer, 7 faixa anterior, 8 próxima faixa (só com o modo Música aberto).
- **Aprender pads**: se o teclado usar outras notas ou outra ordem, toque os pads do 1 ao 8.
- O ruído do PSG é um canal só: caixa, chimbal, prato e palmas cortam um ao outro, como no hardware.
- A configuração fica nesta máquina (como o MIDI learn). Código: `shared/retro/drumPads.js`, `src/composables/useDrumPads.js`, `src/components/retro/PadPanel.vue`.

## Instrumentos

25 instrumentos prontos em `shared/retro/chipInstruments.js` (FM de 4 operadores, onda quadrada do PSG e ruído). Cada faixa usa um instrumento; o teclado toca com o instrumento da faixa selecionada. Até 6 notas FM, 3 de PSG e 1 de ruído soam juntas; acima disso a nota mais antiga é cortada.

### Instrumentos da música

Além do banco pronto, cada música guarda até 64 instrumentos próprios (`instruments` no `.song.json`):

- **Editar cópia:** copia o instrumento da faixa para a música e abre o editor. Edite o algoritmo, o feedback, o LFO (AMS/PMS) e, em cada operador S1–S4, volume (TL), envelope (AR, D1R, SL, D2R, RR), multiplicador, detune, key scale e AM. O desenho mostra a forma do envelope; a borda destaca os operadores que soam. Instrumentos PSG e de ruído têm volume, ataque, decaimento, sustentação e soltura em quadros. O teclado toca com os valores novos na hora.
- **Importar…:** TFI, DMP (FM do Genesis e, aproximado, PSG do SMS), FUI do Furnace (formato novo `FINS` e antigo `-Furnace instr.-`), OPNI e bancos WOPN (escolha quais instrumentos entram). Do Furnace vem só o patch FM; macros não. FUI de SN76489 (novo e antigo) entra com a macro de volume convertida em envelope aproximado.
- **Da internet…:** navega a biblioteca de instrumentos do Furnace Tracker no GitHub (pastas do Mega Drive: FM do YM2612, série Uhrwerk e PSG; cerca de 830 instrumentos), com busca e categoria. ▶ baixa e toca antes de importar; marque os que quiser e importe. Também aceita um link https direto para um arquivo de instrumento (até 2 MiB). O instrumento guarda a origem (`source`), mostrada no editor.
  - A lista vem numa única chamada à API do GitHub (sem login, o limite é 60 por hora) e fica em cache por um dia em `~/.retrostudio/cache/instruments/`; sem conexão, usa a lista guardada. Os arquivos ficam em cache pelo hash do Git.
  - O download é do processo principal (`electron/retro/instrumentLibrary.js`): da biblioteca só baixa arquivos que estão na lista; de link, só https, sem endereços da rede local (inclusive nomes que resolvem para a rede local), com tempo e tamanho máximos.
  - Testado contra a biblioteca inteira: 828 de 829 importam (o que falta é um patch do YM2151 com nome de OPN). DMP do Neo Geo (YM2610) entra, porque o FM é o mesmo OPN; DMP do YM2151 (arcade) não.
- **Exportar** (no editor): TFI, DMP, FUI e OPNI. O TFI não guarda o bit AM.
- Um instrumento só pode ser apagado quando nenhuma faixa o usa.

Detalhes dos formatos (referência: carregadores do Furnace): todos guardam os operadores na ordem dos registradores (S1, S3, S2, S4); TFI, DMP e FUI usam o detune na escala do Furnace (3 = sem detune), OPNI/WOPN o byte do registrador. Ver `shared/retro/instrumentFormats.js`.

## Piano roll

- Clique no vazio cria uma nota (arraste para a duração); arraste a nota para mover; a borda direita muda a duração; botão direito apaga.
- `Shift`/`Ctrl`+arrastar no vazio seleciona várias; `Delete` apaga; setas ↑↓ transpõem (com `Shift`, uma oitava); ←→ movem pela grade; `Ctrl+D` duplica; `Ctrl+A` seleciona tudo.
- Roda do mouse rola; `Shift`+roda rola na horizontal; `Ctrl`+roda dá zoom no tempo; `Alt`+roda muda a altura das linhas.
- Régua: clique posiciona o início da reprodução; `Shift`+arrastar marca o loop.
- Cada gesto (criar, mover, redimensionar) é um passo de desfazer (`Ctrl+Z` / `Ctrl+Shift+Z`).

## Rascunho

Alterações não salvas vão para `.retrostudio/drafts/music.json` enquanto você edita. Se o app fechar, travar ou recarregar, o modo Música reabre o rascunho e avisa ("Alterações não salvas recuperadas"); "Descartar rascunho" volta para a versão salva. Salvar apaga o rascunho.

## Gravar

"● Gravar" toca a partir do marcador e grava o que se toca no teclado MIDI na faixa selecionada, compensando o atraso da saída de áudio. Com "Quantizar gravação", início e duração vão para a grade. Com loop ligado, a gravação continua a cada volta. O metrônomo não vai para o VGM.

## Compor com a IA

O agente interno e os agentes ACP (Claude, Codex, OpenCode, pelo MCP `retro-studio`) compõem pelos comandos da API de controle (`electron/control/commands.js`, docs/API-CONTROLE-IA.md):

| Comando | O que faz |
|---------|-----------|
| `music_guide` | Formato, limites do YM2612/PSG, dicas, exemplo e a lista de instrumentos |
| `music_list` | Músicas do projeto |
| `music_read` | Uma música em tempos e nomes de nota, com a revisão e a análise |
| `music_write` | Cria ou substitui (com a revisão de `music_read`); `exportToGame` gera o VGM e cadastra no catálogo; devolve a análise |
| `music_open` | Abre no modo Música (e toca, com `play`) para o usuário ouvir |

- **Formato em tempos** (`shared/retro/songAuthoring.js`): notas `{at, len, note, vel}` com `at`/`len` em semínimas e `note` como "C4" (dó central = 60), "F#3", "Bb2" ou número MIDI; `loop` em compassos. A IA não precisa lidar com ticks.
- **Análise:** pico de vozes FM (limite 6, ou 5), PSG (3) e ruído (1), notas de PSG graves demais e instrumentos que não existem, para a IA corrigir antes de entregar.
- **Segurança da edição:** substituir uma música exige a revisão lida; se o usuário mudou a música depois, o comando recusa. Com a música aberta e sem alterações no editor, ela recarrega sozinha; com alterações, o editor não é tocado. `music_open` não troca de música se a aberta tiver alterações não salvas.

## Arquivos e exportação

| Arquivo | O que é |
|---------|---------|
| `music/<id>.song.json` | Fonte da música (formato `retro-studio.song` v1, `shared/retro/song.js`) |
| `res/music/<id>.vgm` | Gerado por "Exportar para o jogo" (VGM 1.50, YM2612 + SN76489) |
| `.retrostudio/music-export.json` | Hashes dos VGMs gerados pelo compositor |

- "Salvar" grava só a fonte. "Exportar para o jogo" também gera o VGM e cadastra (ou atualiza) a música no catálogo de áudio (`audio/audio.json`) pelo mesmo serviço do editor de áudio, reexportando `audio_resources.res` e os headers. O ID da música vira o ID no catálogo e a constante no código.
- O VGM é gerado no processo principal a partir da fonte validada, com a mesma linha do tempo que toca no editor (`shared/retro/songTimeline.js`): o que se ouve é o que vai para a ROM. Tempo em quadros de 60 Hz (NTSC), como o XGM.
- Com loop, o VGM marca o ponto de loop; no início do loop o chip é zerado e os patches recarregados, para cada volta soar igual.
- "FM 6 livre p/ efeitos": a música usa só 5 canais FM e deixa o FM 6 (DAC) para os efeitos PCM do XGM.
- Mudo e solo valem só para ouvir no editor; a exportação leva todas as faixas.
- Um `.vgm` em `res/music/` que não foi gerado pelo compositor nunca é sobrescrito. Se o catálogo já tiver o mesmo ID apontando para outro arquivo, o VGM é gravado e o editor explica o conflito.

## Código

| Parte | Arquivo |
|-------|---------|
| Parser BLE-MIDI e decodificação MIDI | `shared/retro/midi.js` |
| Seleção do dispositivo Bluetooth, permissão de MIDI só para as páginas do app | `electron/midiBluetooth.js` |
| Entrada MIDI (Bluetooth + Web MIDI), MIDI learn | `src/composables/useMidiInput.js` |
| YM2612 e SN76489 emulados | `shared/retro/ym2612.js`, `shared/retro/sn76489.js` |
| Driver: notas → registradores, vozes, envelopes do PSG | `shared/retro/chipDriver.js` |
| AudioWorklet (chip 0 = música agendada, chip 1 = teclado ao vivo) | `src/audio/chipWorklet.js` |
| Som e teclado ao vivo | `src/composables/useChipSynth.js` |
| Editor (documento, tocar, gravar, salvar) | `src/composables/useSongEditor.js` |
| Telas | `src/components/retro/MusicWorkspace.vue`, `PianoRoll.vue`, `MidiKeyboard.vue`, `MidiDevicePanel.vue` |
| VGM | `shared/retro/vgm.js` |
| Formatos de instrumento (TFI, DMP, FUI, OPNI, WOPN) | `shared/retro/instrumentFormats.js` |
| Editor de instrumento | `src/components/retro/InstrumentEditor.vue` |
| Salvar/exportar no projeto | `electron/retro/musicProject.js` (IPC `retro:music-list`, `retro:music-load`, `retro:music-save`) |

Emulação: 6 canais FM, 8 algoritmos, feedback, envelope com as taxas do chip, detune, multiplicador, key scaling, LFO (AM/PM), pan e DAC; PSG com 3 tons e ruído (LFSR de 16 bits, taps 0 e 3). Fora: SSG-EG, modo especial do canal 3 e o "ladder effect" do DAC.

## Testes

```bash
node scripts/smoke-ble-midi.mjs        # parser BLE-MIDI (com bytes reais do SMK-25)
node scripts/smoke-chip-synth.mjs      # afinação FM/PSG, envelopes, vozes, banco de instrumentos
node scripts/smoke-song-export.mjs     # música → linha do tempo → VGM (e xgmtool, se o toolkit existir)
node scripts/smoke-music-project.mjs   # salvar/exportar no projeto e catálogo de áudio
node scripts/smoke-instrument-formats.mjs  # importar/exportar instrumentos (bytes montados pela especificação)
node scripts/smoke-instrument-library.mjs  # biblioteca online e links (fetch e DNS falsos, sem internet)
node scripts/smoke-drum-pads.mjs       # pads: canal 10, kit padrão soa e silencia, configuração salva
node scripts/smoke-music-ai.mjs        # IA: formato em tempos, análise e comandos music_*
```

`SMOKE_WAV_DIR=/pasta node scripts/smoke-chip-synth.mjs` grava uma prévia WAV de cada instrumento.
