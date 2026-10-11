# Runtime modular — issue #47
A biblioteca em assets/toolkit/lib/runtime/manifest.json descreve módulos, versões,
dependências e arquivos de destino. O instalador rejeita ciclos, IDs duplicados,
symlinks, escapes e versões desconhecidas do formato.

Arquivos são instalados em src/retro_runtime/. O registro em
.retrostudio/runtime-installation.json mantém hashes da versão instalada.
O plano distingue novo, atual, atualização, modificado e não gerenciado.
Atualizações que substituem arquivos modificados exigem revisão explícita;
os bytes anteriores recebem backup transacional em .retrostudio/runtime-backups/.
Publicação conjunta usa a mesma recuperação das exportações. Arquivos removidos
do pacote permanecem no projeto e no registro, sem exclusão automática.
Downgrade de módulo instalado mais novo é recusado, inclusive com revisão de conflitos.
Configuração/adapter do game e código Alice/Tempo não são reescritos.

## Primeiro módulo: core v1
C99 sem alocação dinâmica: bordas de entrada, combinações, eixo, interseção de
retângulos e temporização de animações com duração por frame. Coordenadas RetroFixed
usam Q8 (256 unidades/pixel), distinto dos tipos fix16/fix32 do SGDK.
Retângulos usam int16; somas de extremidades são promovidas a int32.
Contagem/tempo de frames usam uint16, ticks são quadros de vídeo.

O módulo não lê joystick SGDK, não desenha sprites nem muda o personagem sozinho.
Host/renderização/colisão/mundo e adaptação SGDK prosseguem nas issues dependentes.
Instalação não declara suporte do game a features que ele ainda não consome.

Verificação: smoke-runtime-core compila no host com cc e testa casos de borda.
smoke-runtime-install verifica versões, backups, falhas e preservação de Alice.
O core também compilou com o GCC 68000 do MarsDev instalado. Host SGDK e ROM
executável ainda pendentes nesta etapa. Inicialize RetroInput com zeros antes do
primeiro update. Desenhe o frame atual antes de chamar RetroAnimationTick; ticks
seguem a frequência PAL/NTSC do host, sem conversão automática.

## Módulo input v1
Mapeamento de ações com combinações, exclusões, buffers e estado por jogador.
Adaptador header SGDK verificado com 1.81; configuração e prévia na IDE.
Veja INPUT_ACTIONS.md. ROM original de diagnóstico compilada com MarsDev.

## Módulo collision v1
Caixas locais espelhadas, grupos e sweep por eixo de sólidos/plataformas.
Veja COLLISION_RUNTIME.md; combate e rampas de piso têm APIs opcionais.
Autoria de plataforma/rampa no mapa e exportação opcional de grupos/terreno
disponíveis no skeleton atual; consumidor C e ROM temporária compilados.
Diagnóstico completo em ROM e integração completa do host ainda pendentes.

## Módulo scene v2
Adaptador SGDK para sprites de cena: init/tick/position/free, apoio espelhado,
frames com tempos exportados e rollback de alocação. Exportação de cenas e
visuais do kit integrada ao skeleton. Acrescenta preflight opcional de paletas
e orçamento máximo de tiles/sprites por instância, sem alterar init nem fazer
alocação/DMA. Veja SCENE_RUNTIME.md.

## Módulo character v1
Controlador C de estados por ID, condições/prioridade/interrupção e eventos por
passagem de quadro. Usa timers/poses do header exportado pelo Charset Maker de
forma opcional; callbacks customizados permanecem disponíveis. Ver
CHARACTER_CONTROLLER.md. Autoria de transições/eventos disponível na aba
Comportamento; prévia de estados com condições manuais disponível.
Inspeção visual ainda pendente em #54.

## Módulo character-sprite v1
Depende de character e vincula seu controlador a um sprite SGDK emprestado.
Aplica frames, apoio, câmera, facing/flips, prioridade e clipping; encadeia
callbacks existentes e mantém o timer SGDK parado. O jogo mantém a propriedade
do sprite/VRAM e chama SPR_update. Detach confere a propriedade dos callbacks
e recusa substituições parciais do host sem modificar o vínculo.
Headers reais 1.81 e ROM temporária Charset Maker → ResComp → adaptador foram
compilados. Ver CHARACTER_CONTROLLER.md para ciclo de vida e limites;
renderização visual e uso real em jogos existentes ainda precisam de verificação.

## Módulo world v1
Grafo e lifecycle de salas por IDs estáveis, condições, checkpoints e respawn.
O host fornece preparação/ativação/liberação dos próprios recursos; o módulo
não reescreve o gerenciador de fases customizado. Ver WORLD_RUNTIME.md para
contratos, fonte/exportação e editor de grafo. Integração completa do game
com mapas/cenas continua pendente.

## Módulo world-sgdk v2
Depende de world; distribui uma ponte para TileSet/MapDefinition compilados,
BG_B/camada da frente BG_A, paletas com slots do host preservados e preparação
com rollback. O host mantém sprite engine, condições, posição e controle.
Instalação padrão inclui os fontes; ativação exige chamada explícita do game.
Streaming de câmera e redraw bloqueante têm contrato VDP/DMA documentado em
WORLD_RUNTIME.md. C nativo e compilação 68000 passaram; exemplo isolado gerou
ROM SGDK. Exportação integrada de múltiplos mapas e execução visual pendentes.

World-sgdk v2 mantém a inicialização original e acrescenta conteúdo de sala
com prepare/activate/release. A preparação pode falhar com rollback; a ativação
usa somente conteúdo preparado e não pode falhar. Ver WORLD_RUNTIME.md.

## Módulo camera v1
Depende de core. Controlador de enquadramento em C99 puro: limites da sala,
zona de tolerância, acompanhamento por eixo com limite de velocidade,
suavização, olhar à frente, regiões com prioridade explícita, arena travada,
transições e controle por cena com retorno ao jogador. Perfis PAL/NTSC e
regiões vêm de `src/generated/camera_config.h`, exportado pelo editor de
câmera. Não substitui câmeras customizadas; a ativação é uma chamada explícita
do jogo. Funções compatíveis com o host de cutscenes evitam disputa pelo eixo X.
C nativo, compilação 68000, ROM SGDK 1.81 diagnóstica e execução em emulador
foram verificados. Ver CAMERA_RUNTIME.md.

## Módulo progress v1
Depende de core. Progresso versionado em C99 puro: checkpoint (sala e ponto),
flags por bit e campos de 1, 2 ou 4 bytes; novo jogo, continuar, salvar e
apagar. A persistência é opcional e passa por callbacks de armazenamento;
`retro_progress_sgdk.h` liga a SRAM do SGDK 1.81. Cada slot guarda duas cópias
com CRC e sequência, de modo que uma gravação interrompida devolve o save
anterior. Saves de versões listadas no histórico são migrados; versões
desconhecidas são recusadas. O formato vem de
`src/generated/progress_config.h`, exportado pelo editor de progresso. Jogos
sem SRAM usam o mesmo código só com a RAM. C nativo, compilação 68000, ROM SGDK
1.81 diagnóstica e execução em emulador (com reinício e arquivo de SRAM
danificado) foram verificados; hardware real não. Ver PROGRESS_RUNTIME.md.

## Módulo audio v1
Depende de core. Política de música e efeitos em C99 puro, sem nomes do jogo e
sem driver: música da sala, música de cena com retorno, pausa e escolha de
canal por prioridade (livre, interrompe igual ou menor, descarta). O driver é
um conjunto de callbacks; `retro_audio_sgdk.h` liga o XGM do SGDK 1.81. Os
números, a tabela de efeitos e a música por sala vêm de
`src/generated/audio_config.h`, e os recursos de `res/audio_resources.res`,
ambos exportados pelo editor de áudio. Funções compatíveis com o host de
cutscenes. C nativo, compilação 68000, ROM SGDK 1.81 e som gravado do emulador
foram verificados; hardware real não. Ver AUDIO_RUNTIME.md.

## Módulo cutscene-host v1
Depende de core, camera, audio e progress. Implementação de referência do
`CutsceneHost` do runner de cutscenes: atores e animações em uma tabela do
jogo, câmera, diálogo, fade, som, música e flags ligados aos módulos comuns,
com regra explícita de quem controla o jogador a cada quadro e mesmo estado
final ao tocar ou pular. `retro_cutscene_sgdk.h` traz a apresentação de
referência no SGDK 1.81. Gatilhos dos mapas e ligações de flags vêm de
`src/generated/cutscene_adapter.h`. Sem o runtime de cutscenes instalado, o
módulo compila vazio. Hosts próprios continuam válidos. C nativo, compilação
68000, ROM SGDK 1.81 e execução em emulador foram verificados; hardware real
não. Ver CUTSCENE_HOST.md.

## Módulo debug v1
Depende de core. Diagnóstico em jogo: amostra de desempenho (CPU, FPS, fila de
DMA, VRAM, sprites) com marcação do que foi realmente medido, picos, dados do
personagem, caixas e registros para um console de depuração. O que não é
medido aparece como "--", nunca como estimativa. `retro_debug_sgdk.h` faz as
medições, a sobreposição e as caixas no SGDK 1.81. Com o diagnóstico desligado
em `src/generated/debug_config.h`, o módulo compila vazio e nada entra na ROM.
C nativo, compilação 68000, ROMs de diagnóstico e de produção e execução em
emulador foram verificados; hardware real não. Ver DEBUG_RUNTIME.md.

## Escrevendo um adaptador próprio

Os módulos de runtime são C puro e não conhecem o SGDK nem o jogo: tudo o que
toca hardware ou dados do jogo passa por uma estrutura de callbacks. Um
**adaptador** é o código que implementa esses callbacks. Os arquivos
`retro_*_sgdk.h` distribuídos são adaptadores de referência para o SGDK 1.81;
quem tem outro driver de som, outro tipo de save ou um host de cenas próprio
escreve o seu e não precisa dos de referência.

| Módulo | Estrutura de callbacks | O que o adaptador fornece |
|--------|------------------------|---------------------------|
| `audio` | `RetroAudioDriver` | Tocar ou parar música, tocar efeito em um canal, pausar, dizer se um canal está ocupado. |
| `progress` | `RetroProgressStorage` | Ler e gravar bytes em um armazenamento (SRAM, EEPROM, memória). |
| `world` | `RetroWorldHooks` | Preparar, ativar e liberar os recursos de uma sala; responder condições. |
| `character` | `RetroCharacterHost` | Predicados das transições e eventos por quadro. |
| cutscenes | `CutsceneHost` | Atores, diálogo, câmera, fade, som, música e eventos (ou use o módulo `cutscene-host`). |

Regras comuns:

1. O campo `context` é do adaptador: o módulo só o repassa de volta.
2. Callbacks que devolvem valor usam 1 para sucesso e 0 para falha; uma falha
   nunca deixa o módulo em estado parcial.
3. Callbacks não chamam de volta a API do mesmo módulo (reentrada é recusada
   onde poderia corromper o estado).
4. Um callback opcional pode ser nulo; o header de cada módulo diz o que muda.

Exemplo completo e comentado, que compila e roda no computador sem SGDK:
`assets/toolkit/fixtures/custom-adapter-example.c`. Ele implementa um driver de
som próprio para o módulo `audio` e um armazenamento próprio para o módulo
`progress`, e é executado por `node scripts/smoke-custom-adapter.mjs`.

Passos para o seu adaptador:

1. Instale só os módulos necessários (modo Jogo). Os `retro_*_sgdk.h`
   são cabeçalhos: se você não os incluir, nada deles entra na ROM.
2. Escreva as funções com as assinaturas da estrutura de callbacks e preencha a
   estrutura com elas e com o seu `context`.
3. Passe a estrutura para a função de inicialização do módulo
   (`retroAudioInit`, `retroProgressLoad`/`Save`, `retroWorldInit`...).
4. Teste no computador, como o exemplo: os módulos compilam com qualquer
   compilador C99.
