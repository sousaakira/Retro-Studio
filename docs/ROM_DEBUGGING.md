# Depuração da ROM com emuladores — issue #64

No modo **Executar** (Alt+5), a seção **Depurar o jogo** roda a ROM compilada em um emulador
com depurador e mostra onde o jogo parou. Cada emulador aparece com a lista do que oferece;
o que ele não faz fica desabilitado e escrito como “não disponível”, nunca simulado.

## Backends e capacidades

Conferidas com o BlastEm 0.6.3 (Linux) por `scripts/smoke-debug-session.mjs --blastem`.

| Capacidade | BlastEm · depurador nativo | BlastEm · protocolo do GDB | Genesis Plus GX · PicoDrive |
|---|---|---|---|
| Passo (1 instrução do 68000) | sim | sim | não |
| Continuar até um breakpoint | sim | sim | não |
| Avançar N quadros de vídeo (1–600) | sim | não | não |
| Breakpoints (até 64) | sim | sim | não |
| Registros do 68000 | sim | sim | não |
| Leitura de memória (ROM e RAM) | sim, até 1024 bytes | sim, até 4096 bytes | não |
| VDP: registros e lista de sprites | sim | não | não |
| Mensagens KDebug do jogo | sim | não | não |
| Pausar o jogo rodando | não | não | não |
| Gravar e reproduzir entradas | não | não | não |

Limites que valem para os dois backends do BlastEm:

- **Não há pausa.** Com o jogo rodando, o controle só volta em um breakpoint (ou, no nativo,
  ao fim dos quadros pedidos). Para parar sem breakpoint é preciso encerrar a depuração.
  Sem breakpoints, o primeiro **Continuar** só mostra o aviso; o jogo roda no segundo
  (“Continuar mesmo assim”). Comandos são recusados enquanto o jogo roda.
- **VRAM e CRAM não são lidas pela IDE.** O depurador nativo entrega os registros do VDP (com a
  descrição do próprio emulador, em inglês), o estado interno (endereço, contadores, status) e
  a lista encadeada de sprites. Tiles e paletas aparecem só nas janelas do próprio BlastEm
  (teclas `v` e `c` na janela do emulador).
- **Memória só da ROM e da RAM do 68000** (`0x000000` até o fim da ROM e `0xFF0000–0xFFFFFF`).
  Fora delas o stub do GDB devolve valores sem sentido e chega a parar de responder (visto ao
  ler 32 bytes em `0xC00000`), e no depurador nativo a leitura passaria pelo barramento e
  mexeria no hardware emulado. A IDE recusa essas leituras antes de enviá-las.
- **Entradas não são gravadas nem reproduzidas.** O protocolo do GDB não tem isso, e o comando
  `bindown` do depurador nativo desta versão do BlastEm responde “not a recognized command”.
  Nenhum backend marca a capacidade.
- Sob Xvfb (sem aceleração de vídeo) o BlastEm abre uma caixa “Failed to set vsync” que
  bloqueia o início; a tela diz para confirmar o aviso na janela do emulador e tentar de novo.

Outros achados que moldaram a integração:

- O stub do GDB encerra o emulador ao receber um comando que não conhece e não responde ao
  pedido de interrupção. Só saem os comandos de `shared/retro/gdbRemote.js` (`?`, `g`, `s`,
  `c`, `m`, `Z0`, `z0`), e cada resposta de memória é cortada em 255 bytes (lemos de 128 em 128).
- O depurador nativo só conversa por um terminal (a IDE usa o `node-pty` que já serve ao
  terminal integrado), lê números sem `$` como decimais e não volta de `frames 0`.
- Um comando sem resposta deixa o protocolo fora de sincronia: a sessão é encerrada e a tela
  diz “O emulador parou de responder”. Fechar a janela do emulador também encerra a sessão,
  com aviso.

## Símbolos e linhas de C

- **Construir** (build comum, `release`) gera `out/rom.out` com os nomes das funções e das
  variáveis globais. Com ele já funcionam: breakpoint por nome de função ou endereço, “parado
  em `função+deslocamento`” e leitura de variável global pelo nome (o tamanho vem do símbolo).
- **Construir para depurar** roda `make debug` do SGDK (`-O1 -ggdb -DDEBUG=1`, `libmd_debug`) e
  acrescenta as linhas de C: breakpoint em `arquivo.c:linha` (se a linha não tem código, vale a
  próxima das 8 seguintes) e o link para abrir o fonte na linha da parada. A ROM de depuração é
  mais lenta e maior; não é a que se distribui: **Empacotar** recusa enquanto o último build
  for o de depuração (ou não tiver terminado).
- Os dois tipos usam os mesmos objetos em `out/`. A IDE registra o tipo do último build em
  `.retrostudio/build-flavor.json` (`{"flavor":"release"|"debug"|"unknown"}`) e, ao trocar de
  tipo, limpa antes de construir. O arquivo só nasce no primeiro build para depurar: projetos
  que nunca o usaram não ganham arquivo (nem em build limpo, nem em build com erro) e
  continuam construindo como antes. `unknown` (build para depurar interrompido, cancelado ou
  com erro; arquivo ilegível) também limpa. É um registro local desta máquina; pode ficar
  fora do controle de versão.
- Antes de limpar, a IDE pergunta ao `make` (`make -n debug`) se o alvo existe. Um projeto com
  Makefile próprio sem `debug` recebe a mensagem com a saída do `make`; nada é limpo, a ROM
  fica e nenhum arquivo é criado. Essa pergunta só é feita em Linux/macOS.
- Um build por projeto: com “Construir para depurar” rodando, **Construir**, **Construir e
  jogar** e o build pedido pela IA são recusados (e vice-versa), porque todos escrevem em
  `out/`. O build para depurar tem **Cancelar build**; cancelado, o próximo build limpa.
- O jogo compilado é procurado em `out/rom.out` + `out/rom.bin` (SGDK) e em `out.elf` +
  `out.bin` na raiz (template `md-skeleton`).

A linha de C só vira link navegável quando há prova de que ROM, símbolos e fontes são do
mesmo build:

| Situação | O que a tela mostra |
|---|---|
| Build comum | função+deslocamento; “Sem linha de C: o jogo não foi construído para depurar.” |
| Endereço em código de montagem ou da biblioteca | função (se houver); arquivo fora do projeto é citado, sem link |
| Sem recibo de build da IDE ligando `out/rom.bin` a `out/rom.out` | a linha como texto, com o aviso; sem link |
| Fontes alterados depois do build | a linha como texto, “a posição pode estar deslocada”; sem link |
| Jogo construído de novo com a sessão aberta | aviso de que o emulador ainda roda a ROM antiga; sem link |
| Recibo confere e fontes iguais | link `src/arquivo.c:linha`, que abre o editor de código na linha |

O recibo e os fontes são conferidos de novo a cada parada, não só no início da sessão.

Nomes repetidos não são adivinhados: duas funções estáticas com o mesmo nome, ou dois
arquivos com o mesmo nome em pastas diferentes, pedem o endereço ou a pasta. O arquivo de
cada trecho da tabela de linhas vem do caminho completo gravado pelo compilador (perguntado
ao `addr2line`), então `src/util.c` e `src/sub/util.c` não se misturam, e um projeto aberto
por um link simbólico é reconhecido como o mesmo projeto.

## Arquivos e canais

| Parte | Arquivo |
|---|---|
| Protocolo remoto do GDB (pacotes, soma, registros) | `shared/retro/gdbRemote.js` |
| Texto do depurador nativo (prompt, eco, VDP, sprites, KDebug) | `shared/retro/blastemDebugger.js` |
| Sessões (uma por processo de emulador) e tabela de capacidades | `electron/retro/debugSession.js`, `electron/retro/blastemNativeSession.js` |
| Símbolos, linhas (`m68k-elf-readelf`, `m68k-elf-addr2line` do toolkit) | `electron/retro/debugSymbols.js` |
| Tipo de build | `electron/retro/buildFlavor.js` |
| Serviço (uma sessão por vez) | `electron/retro/debugService.js` |
| Tela | `src/components/retro/RomDebugger.vue` (dentro de `RunWorkspace.vue`) |

Canais IPC, todos confinados ao workspace aberto: `retro:debug-status`, `retro:debug-build`,
`retro:debug-start`, `retro:debug-command` (`step`, `continue`, `frames`, `registers`,
`breakpoint`, `memory`, `vdp`, `stop`) e o evento `retro:debug-event` (`state`, `log`,
`closed`). A tela não envia texto livre ao emulador: endereços e contagens são validados no
processo principal e viram comandos de uma lista fixa.

A sessão termina ao encerrar pela tela, ao fechar o emulador, ao iniciar outra, ao abrir
outro projeto e ao sair da IDE. O botão **Parar** do modo Executar não mexe na sessão de
depuração, e “Construir para depurar” é recusado com uma sessão aberta ou outro build em
andamento. Se a tela for remontada com a sessão aberta, ela volta com o backend da sessão e
a última parada.

## Como acrescentar outro emulador

1. Comprovar o que ele faz com um teste de integração como o de `--blastem` (o que não for
   comprovado fica `false`).
2. Acrescentar a linha em `DEBUG_BACKENDS` com `capabilities`, `notes`, `memoryScope` e
   `memoryLimit`, e uma sessão com a mesma interface (`start`, `registers`, `memory`,
   `setBreakpoint`, `step`, `continue`, `stop`; opcionais `frames`, `vdp`; eventos `state`,
   `closed`, `log`).
3. A tela e os textos já seguem a tabela de capacidades.

## Verificação

- `node scripts/smoke-gdb-remote.mjs` — pacotes, escape, repetição, fluxo com ruído, registros.
- `node scripts/smoke-debug-session.mjs` — stub falso do GDB e terminal falso do depurador
  nativo, tipo de build, símbolos, serviço e canais. Com `--project <projeto construído com make
  debug> --toolkit <marsdev> --blastem <binário>` roda também contra o toolchain (inclusive os
  casos de linhas: fonte sem troca de arquivo, nomes repetidos, link simbólico) e o BlastEm
  reais (precisa de display; `--on-launch` aceita um comando para confirmar a caixa de vsync).
- `node scripts/smoke-build-flavor.mjs` — tipo de build com `make` de verdade: troca que limpa,
  build concorrente recusado, cancelamento, Makefile sem `debug`, projeto antigo intocado.
- `node scripts/smoke-rom-debugger.mjs` — a tela: capacidades por backend, paradas, breakpoints,
  memória, VDP, quadros, KDebug, desconexão, build para depurar, textos nos quatro idiomas.
- `scripts/inspect-electron.sh <home isolado> scripts/electron-debugger.steps.mjs <saída>` — o
  fluxo inteiro na IDE real com o BlastEm real (`E_BACKEND=blastem-gdb` troca o backend).

## Limites conhecidos

- Nomes de backend, notas, erros e avisos que vêm do processo principal estão só em
  português (como nos outros painéis de runtime); os rótulos da tela seguem o idioma da IDE.
- Ler símbolos e linhas roda ferramentas do toolkit de forma síncrona no processo principal
  (até alguns segundos em um ELF grande, uma vez por build). Se a ferramenta falhar ou
  demorar demais, o jogo aparece como “sem linhas de C”.
- O protocolo do GDB divide a saída padrão com o texto do emulador. Um `$` ou `-` solto nesse
  texto não repete comandos nem engole respostas, mas texto que imite um pacote inteiro com
  soma correta seria aceito.

## Não verificado

- Windows e macOS (caminho do BlastEm, `node-pty` com o depurador nativo, `make debug` no Windows).
- Outras versões do BlastEm: o texto do depurador nativo e o comportamento do stub podem mudar.
- Projetos com Makefile próprio sem o alvo `debug` (Alice, Tempo) não foram construídos em
  modo de depuração; para eles vale a depuração por nome de função com o build comum.
- Hardware real: nada aqui fala com um console.
