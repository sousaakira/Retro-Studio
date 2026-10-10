# Execução do épico #40
GitHub: https://github.com/sousaakira/Retro-Studio/issues/40
Autorização: operador pediu implementar as 25 issues até finalizar, em 2026-10-09.
Sem autorização para commits, PRs, push ou release. Não tocar ROMs originais/jogos fora da IDE.

## Estado em 2026-10-09
- #41: fundação implementada: validador e schema de declaração opcional de runtime,
  formatos/unidades documentados, IDs/referências normalizados, migração explícita
  com backup e diagnóstico no editor. Skeleton declara só suporte efetivo;
  projetos legados permanecem sem declaração, sem migração automática.
  Smoke de contratos passou; build passou; review estático sem bloqueadores.
  Integração de catálogos completos de cada domínio prossegue com suas issues.
- #43: prompt de hardware corrigido, resumo extrai protótipos do SDK configurado,
  versão/capacidades/contagem de assets/registro ACP com campos permitidos.
  Smoke passou; review estático sem bloqueadores. Cadeia ACP externa tem contexto
  próprio; esta tarefa corrige o assistente interno. Falta verificação manual do chat.
- #42: primeira parte implementada: atlas raster em res/generated com SHA-256,
  reaproveitamento de arquivos e tilesets; escrita confinada/atômica.
  Relatório de referências literais/símbolos .res e duplicatas disponível em Recursos → Uso dos recursos. Scanner limitado e somente leitura; novos atlas recebem ledger de propriedade, sem adotar imagens preexistentes.
  Quarentena manual/restore integradas para atlas raster novos registrados, com
  confirmação e transação. Outros derivados/proveniência/retenção pendentes.
- #46: base de publicação multiarquivo com lock, snapshots, hashes, reuso,
  rollback e recuperação explícita integrada a Recursos. Atlas + ledger usam
  transação. Charset Maker publica PNG/res/header/projeto/config juntos, com
  validação de revisões e suspensão do autosave durante exportação.
  Mapas do skeleton usam staging quando invocados pela IDE; scripts legados
  permanecem sem mudança. Cenas IDE/CLI usam publicação compartilhada; o Makefile novo gera antes de compilar.
  Transações de mapas no CLI e integração em builds customizados seguem pendentes.
- #44: suíte de 57 regressões e workflow de CI separados de release adicionados.
  Física tem inspeção de browser em fixture isolada; verificação completa
  Electron/ROM e demais screenshots/fluxos manuais ainda pendentes.
- #47: core C99 versionado, instalador transacional com dependências e backups,
  revisão na IDE e instalação pelos dois caminhos de criação de projeto.
  Downgrade bloqueado; core compilado para 68000. Host SGDK/ROM e demais módulos
  ainda pendentes.
- #53: ações C/input v1, presets 3/6 botões, dois jogadores, combos/exclusões,
  buffers e consumo. Editor de controles, fonte/header transacionais, prévia JS
  com paridade C e adaptador SGDK 1.81. ROM diagnóstica compilada. Inspeção
  visual e teste de controles em emulador/hardware ainda pendentes.
- #48: exportador de cenas gera C/header com init/tick/position/free,
  IDs estáveis e referências SPRITE; publicação transacional/confinação/ownership.
  Módulo SGDK aplica apoio, flips, prioridade, duração e câmera, com rollback
  de alocação. Testes host e ROM temporária ResComp/SGDK passaram (655360 bytes).
  Visuais do kit/TMX agora geram sprites independentes/indexados, com escala,
  apoio, prioridade, flip e FPS; skeleton reserva VRAM por instância e renderiza.
  Staging preserva derivados compartilhados/customizados e remove só os sem uso
  verificado. Teste TMX → ResComp → ROM passou. Prévia normal agora compõe BG/FG/sprites
  com máscara SAT anterior à comparação de prioridade; 128 casos de pixels
  passaram em fixture de software. Inspeção real em browser/emulador pendente;
  DMA pode atrasar frames visíveis.
- #49: base C collision v1 com caixas/apoio/espelhamento, máscaras/grupos,
  sweep por eixo e plataformas atravessáveis. Testes host/68000 passaram.
  Combate C com janela, vítimas, grupos, dano, invulnerabilidade e callbacks
  verificado no host/68000. Corpo/ataque do Charset Maker agora exportam tipos
  opcionais consumíveis pelo módulo: caixas locais, transformação mundial Q8,
  flips e janela inclusiva por frame. Header real → controlador → colisão/combate
  passou no host; helper compilou para 68000 e dados entraram na ROM SGDK temporária.
  Corpo de 16 px com arte de 80 px verificado; caminho legado preservado.
  Hurtbox autoral disponível na aba Corpo: padrão acompanha corpo ou caixa
  independente, overlay tracejado, copiar corpo, roundtrip v6 e backup de fonte
  anterior. Exportador preserva suporte v4/v5 e fornece macros/tipo opcional.
  Review frontend sem bloqueadores; inspeção visual ainda pendente.
  Rampas de piso C disponíveis com alturas nas extremidades, interpolação Q8,
  grupo, pouso, seguimento com apoio anterior e snap para descer; bloqueio por
  teto recusa o passo inteiro para preservar apoio. API antiga mantida.
  Testes host/68000 cobrem casos e limites. Editor cria plataforma/rampa em
  pixels, grupos e alturas; reduzir altura normaliza endpoints no mesmo undo.
  Exportador novo com runtimeGeometry opcional transforma campo efetivo em
  colliders, mantém faces expostas e identidade de plataforma, e gera slopes.
  TMX → Python → consumidor C → ROM SGDK temporária passou (655360 bytes).
  Recorte parcial de rampa é recusado com diagnóstico; novo skeleton habilita
  geração de dados, sem trocar controladores de games existentes.
  ROM diagnóstica separada desenha corpo/hurtbox/ataque e contatos em pixels;
  contém paredes, piso/teto, plataforma, rampa e alvo com invulnerabilidade.
  Host C real testa movimento rápido, ambos os lados, combate, limpeza visual
  e batches DMA. Mesmo fonte compilou SGDK 1.81/68000 com warnings como erros
  e gerou ROM temporária de 655360 bytes. Review SGDK aprovou sem bloqueadores. A fixture usa movimento
  isolado, sem afirmar conclusão do controlador compartilhado #58.
  Integração completa do mundo e inspeção do overlay no emulador pendentes. Sweep horizontal que
  cruza a rampa inteira requer subdivisão pelo host, conforme documentação.
- #58: módulo C movement v1 opcional com aceleração, pulo/cut, gravidade/queda,
  dash/cooldown, wall slide/jump, lock, coyote/buffer e rampas por subpassos.
  Integra conditions com #54 sem substituir player customizado. Perfis PAL/NTSC
  explícitos em pixels/ticks, fonte JSON/header/registro transacionais com
  revisão e proteção de customizações. Host/68000 e consumidor SGDK em ROM
  temporária passaram; review corrigiu DROP retirando apoio indevidamente em
  sólidos. Editor acessível em Recursos → Runtime, com sala SVG e controlador
  C real em WASM: perfis, trajetória, altura/distância/duração e velocidades.
  Métricas congelam no pouso; 600 ticks coincidem com C nativo. Rascunhos por
  projeto, conflitos, saves tardios e movimento reduzido têm regressões.
  Browser verificou layout, foco/playback e erro/retry em fixture com IPC em
  memória; reviews frontend/SGDK/segurança aprovados. Sala visual SGDK agora
  usa o wrapper/terreno/perfis reais, desenha corpo/contatos/trajetória e HUD
  das métricas. Host verifica controles e DMA; warnings como erros no 68000 e
  ROM SGDK 1.81 passaram (655360 B). CLI aceita fonte movement.json salvo,
  com cópias somente no projeto temporário. UI gera a ROM e abre o emulador
  configurado com token/revisão/hash; backend executa somente receita/fontes
  distribuídos em scratch. Serviço real compilou com a raiz MarsDev da IDE;
  empacotamento sem src/scripts e ciclo de vida têm regressões. Browser fixture
  confirmou erro/retry e pausa antes de abrir. Integração efetiva com personagem
  e controle/cadência no emulador continuam pendentes.
  Ver docs/MOVEMENT_RUNTIME.md; ainda não concluir #58.
- #55: world v1 opcional depende de core. Grafo com IDs estáveis para salas,
  entradas, saídas, checkpoints e condições; JSON/header transacionais e
  validação de destinos, posições e dimensões TMX. Legado target/requires
  preservado. C prepare/activate/release recusa reentrada/alias, preserva sala
  anterior em falhas e restaura checkpoint/posição/orientação. Host nativo,
  módulo/header 68000 e testes de exportação passaram; review apontou trigraph
  no caminho C, corrigido com caso compilado. Interface disponível em Recursos
  → Runtime → Salas e conexões, com catálogo limitado, inspector, fase inicial,
  condições, remoções protegidas e rascunhos isolados. Vue real e browser
  1280×900/720×720 passaram, incluindo erro/retry de save. Revisões de frontend
  e segurança aprovadas após corrigir retenção de cache e orçamento do catálogo.
  Builds da IDE/IA agora validam o grafo, header gerenciado e mapas antes do make;
  assinatura é conferida depois, antes de registrar sucesso ou abrir emulador.
  Fixtures executam ambos os caminhos com make real e preservam recibo anterior
  em falhas; legado sem world/world.json continua normal. Inventário inclui
  world/physics/controls. Reviews de build e integridade aprovadas.
  Ponte world-sgdk agora prepara MAPs/tiles por sala com rollback, verifica
  reserva VRAM do sprite engine, conserva paletas do host e limpa frente ausente.
  Câmera usa streaming incremental e redraw bloqueante com proteção de reentrada
  em VBlank; liberação pelo core desativa a ponte. Testes C nativos e headers
  SGDK/68000 passaram. ROM isolada com duas salas, frente, sprite persistente,
  condição e checkpoint compilou (655360 B); assinatura de main segue SGDK 1.81.
  Reviews SGDK/integridade aprovados após corrigir busy durante redraw e explicitar
  o contrato dos produtores DMA. Fontes são distribuídos por padrão, com ativação
  explícita pelo host. Compilador distribuído export-world-maps.py agora usa
  composição real do export-map.py com writer em memória e staging novo;
  nomes/assets, hitboxes, colisões/rampas e bindings são separados por sala.
  Metadata/recursos confinados e declaração na ordem ResComp revisados.
  C nativo inclui ambas as salas com hitboxes distintas; ROM SGDK agora consome
  TMX serializados pelo editor e bindings gerados (655360 B).
  Salvamento na IDE agora compila fontes distribuídos em scratch e publica
  grafo + recursos na mesma transação com ownership e guards. Falhas preservam
  geração anterior; declarações manuais/comentários e ordem de dependências
  permanecem. Testes cobrem no-op, rollback, race, colisão IMAGE, ledger cheio,
  scripts customizados ignorados, links, empacotamento e 64 salas num lote.
  Sprites do exportador único são compartilhados somente por manifesto/hash/
  declaração exata, sem duplicação. ROM diagnóstica agora compila depois da
  publicação pelo serviço da IDE (655360 B), sem executar emulador.
  Salvamento de uma sala gerenciada agora atualiza todas as salas. Registro v2
  vincula configuração, entradas, runtime e saídas ativas; gates IDE/IA antes e
  depois do Make recusam geração desatualizada ou alterada. Recibos e derivados
  legados são excluídos das entradas; exportador legado atualizado preserva
  sprites compartilhados. Cópias antigas desse script precisam ser atualizadas.
  Binding de geometria inclui corpo relativo aos pés e tamanho do quadro.
  Host diagnóstico reinicia movimento na entrada/respawn e consome terreno da
  sala ativa. Execução C nativa comprova caixas diferentes, gravidade, chão e
  salto. Ponte world-sgdk v2 prepara conteúdo por callbacks antes do commit,
  desfaz falhas e libera somente o handle antigo; API original preservada.
  Bindings genéricos de cenas associam ID a definições/count/paleta/budget,
  incluindo salas vazias e sem dependência scene para mundos inteiramente vazios.
  Fixture usa dois objetos e sala vazia com slots RetroScene e PAL1 compartilhada.
  Host diagnóstico usa header exportado pelo Charset Maker, controlador e
  adapter emprestado: idle/walk/jump/fall, pivô/câmera/flip/prioridade e reset na
  entrada. Física+grafo C nativo verificam pouso, timers de seis ticks e reset.
  Scene v2 acrescenta preflight opcional: paletas por slot (índices opacos,
  máscara 0xEEE) e máximos de tiles/sprites por instância. Host soma personagem,
  sala ativa e pendente antes de alocar, preservando rollback. Nativo e ROM
  passaram; distribuição de paletas, bindings de personagens, scanlines/DMA
  e emulação ainda pendentes. Ver WORLD_RUNTIME.md;
  não concluir #55 nesta etapa.
- #57: composição normal da prévia por prioridade implementada (BG alto, FG alto,
  sprites baixo/alto, transparência, ordem SAT e flips). Scratch limitado aos
  sprites; overlays de autoria permanecem visíveis. Editor de paletas, ciclos,
  fades e inspeção real ainda pendentes.
- #45: barra de trabalho com Código/Mapas/Personagens/Recursos, controles de build/run/stop e
  progresso compacto. Layout de sidebar/terminal/IA salvo por projeto, com reset,
  limites e fallback de armazenamento. Docks escondidos preservam componentes:
  sidebar em v-show e terminal/ACP com montagem no primeiro uso. Git, menus,
  ferramentas existentes e overlay de packaging preservados. Teste Vue passou;
  P1 de destruição de sessões ao esconder docks corrigido. ACP recria sessão na
  troca de workspace, preserva prompts por projeto, valida envio no main e
  impede callbacks/cleanup atrasados de afetar a sessão seguinte. Review de
  frontend/segurança aprovou as correções; teste Vue/manager e guard passaram.
  Charset Maker integrado à área central, com movimentos/prévia/propriedades
  e terminal compartilhado com Código. Alternar modos preserva a edição e para
  playback oculto. Salvar segue o modo atual; paleta abre os modos e salva todos
  os editores. Troca de projeto verifica save antes de ativar a pasta e bloqueia
  controles/pedidos concorrentes durante a operação. Reviews corrigiram picker
  que ativava antes do guard e edição durante save; frontend/segurança aprovaram.
  Smoke de guards/picker/comandos passou. Inspeção visual, Execução
  central, inspector entre domínios, painel inferior de autoria e atalhos/foco
  completos continuam pendentes. Ver docs/WORKSPACE_LAYOUT.md.
  Preparação dos mapas: save com retorno verdadeiro/falso, baseline de alterações
  por serialização TMX, exclusão de clock da prévia, bloqueio durante carga/save,
  guards de abertura concorrente e preservação de path/baseline na falha de escrita.
  Mapas sem imagens permanecem salváveis; JSON importado segue para SaveAs em TMX.
  Smoke inclui composable inteiro em host Vue mínimo. Hospedagem central e ligação
  ao guard implementadas: rascunhos de kit/cenas impedem troca; configuração
  e pedidos atrasados de outra raiz são descartados. Prévia oculta suspensa.
  Inspeção visual e foco em Electron continuam pendentes.
  Cenas integrado à área central, compartilhando mapa/picking e preservando
  modal legado. Save com snapshot real/retorno bool, falha de compilação e
  serialização de abertura/criação/recompile; SSR e fixtures atrasadas passam.
  Guard central salva cenas/vocabulário. #46 agora publica headers/ledger de
  cenas com transação, rollback, revisões/provenance e no-op; compilação main
  usa fontes salvas e preserva headers manuais. CLI distribuído integrado ao serviço compartilhado; Makefile novo invalida
  consumidores após mudanças de cena/mapa e reúne objetivos paralelos. Builds
  customizados ainda pendentes; layout/foco em Electron e inspector entre domínios ainda pendentes.
- #54: módulo character C v1 instalado com core: estados por ID, condições,
  prioridade, idade mínima, interrupção, sequência e eventos por quadro.
  Timers/apoio da célula comum exportados opcionalmente pelo Charset Maker;
  helpers/callbacks anteriores preservados. Teste executa C e header gerado;
  módulo compilou para 68000. Aba Comportamento salva/exporta transições por ID e eventos ligados aos
  quadros; migração v5 com backup, validação antes de save e remapeamento na
  timeline. Prévia de estados independente com condições/predicados manuais,
  canvas e log limitado de eventos; 80 ticks comparados ao C real passaram.
  Adaptador character-sprite v1 aplica poses, apoio, câmera, flips e prioridade
  em sprites emprestados; timers manuais, callbacks preservados e detach seguro
  após alterações do host. Header gerado → ResComp → adaptador → ROM SGDK 1.81
  passou em fixture temporária (655360 bytes), com compilação 68000.
  Review secundário aprovou a correção do ciclo de vida. Inspeção visual,
  física e execução efetiva dos eventos no jogo ainda pendentes. Ver CHARACTER_CONTROLLER.md.
- #51: relatório somente leitura de ELF/ROM integrado a Recursos, com leitor
  SGDK 1.81 explicitamente informado, campos compilados separados da grade
  original, RAM estática com endereços 24 bits e orçamento por instância.
  Reservas/planos/área de tiles opcionais exibem avisos e gráfico de endereços.
  Fixture sintética e ELF real ResComp/68000 passaram: 655360 B ROM, 2846 B RAM
  estática, 4 tiles para sprite com 2 frames. Editor do plano implementado com
  saves explícitos, preservação das demais configurações, backup transacional,
  revisão contra alterações externas e rascunhos separados por projeto.
  Configurações malformadas não entram no formulário nem são sobrescritas.
  Testes Vue e de salvamento passaram; revisão de IPC aprovada e P2 de
  configuração inválida corrigido. Registro após build da IDE/tools compara
  hashes das pastas padrão e ROM/ELF; alterações durante o build e cobertura
  incompleta são explícitas. Associação dos artefatos exibidos exige path+hash.
  Make real em fixture e ResComp real passaram. Prova de dependências/fontes
  compilados, inspeção visual da UI, recuperação durável de rascunhos e métricas
  em execução continuam pendentes.
- #59: módulo C camera v1 (depende de core) com limites da sala, zona de
  tolerância, enquadramento, acompanhamento por eixo com limite de velocidade,
  suavização, olhar à frente, regiões com prioridade explícita, arena travada,
  transições e controle por cena com retorno ao jogador. Fonte camera/camera.json,
  header src/generated/camera_config.h e registro transacionais, com perfis
  PAL/NTSC explícitos em pixels/ticks de vídeo e regiões vinculadas às salas do
  mundo (#55). Empate de prioridade em regiões sobrepostas é recusado. Gate de
  build IDE/ferramentas recusa header desatualizado/personalizado; projetos sem
  camera.json não são afetados. Editor em Recursos → Runtime → Câmera, com
  prévia de enquadramento, zona, foco, regiões, arena, cena e header exportado.
  Prévia JS coincide com o C nativo em 6000 ticks a partir do header exportado.
  Funções compatíveis com CutsceneHost: runner real de cutscenes faz pan, corte
  e devolve a câmera sem disputar o eixo X com o jogador (teste nativo).
  Host/68000 passaram; ROM diagnóstica SGDK 1.81 (655360 B) executada em
  emulador (Genesis Plus GX sob Xvfb) com roteiro de teclas: região superior,
  arena travada com alvo fora da tela, liberação, pan por cena e retorno
  conferidos nas capturas. Editor inspecionado em Chrome headless local em
  1280×900, 720×720 e 560×800: reprodução, arraste, setas, arena, cena e dados
  exportados, sem erros de página nem overflow. Ver CAMERA_RUNTIME.md.
  Host diagnóstico do mundo (#55) agora usa a câmera exportada para dirigir
  retroWorldSgdkScroll: no emulador, HALL → chave → saída → CAVE, arena travada
  (flag L, corpo contido nos limites), liberação e respawn conferidos.
  Revisão independente (C/SGDK, segurança/IPC, frontend) sem bloqueadores;
  fuzz diferencial C×JS com ASan/UBSan do revisor: 0 divergências. Corrigidos:
  clique no palco com SVG em letterbox (getScreenCTM), regiões órfãs de salas
  removidas do mundo (listadas e removíveis no editor), chaves herdadas de
  Object na validação, cutscene liberando só o eixo X, registro de exportação
  corrompido, rascunho apagado ao fechar após falha de carga e resposta tardia
  de save após ida e volta de projeto. Todos com regressão.
  Critérios de aceite de #59 comprovados nesta máquina. Não comprovado:
  hardware real e cadência/DMA medidos. Issue segue aberta no GitHub até o
  operador decidir fechar.
- Demais issues ainda pendentes. Não fechar o épico.

## Caminhos principais
- src/utils/retro/projectContract.js
- electron/retro/projectContractStore.js
- assets/toolkit/contracts/project-v1.schema.json
- docs/PROJECT_CONTRACT.md
- electron/ai/sdk/sgdkApi.js
- docs/AI_HARDWARE_CONTEXT.md
- electron/retro/projectAssets.js
- scripts/smoke-project-contract.mjs
- scripts/smoke-ai-sdk-context.mjs
- scripts/smoke-project-assets.mjs

## Cuidados ao continuar
O working tree já tinha muitas alterações antes do épico; preservar todas.
Backups dos arquivos alterados em /tmp/retro-studio-epic-backups/.
Issues estão no repositório sousaakira/Retro-Studio; usar credencial explicitamente
sem trocar a conta global da TV. Não imprimir tokens.
Não concluir #42 só por corrigir duplicação: ainda falta ciclo de vida completo.
Diagnóstico inicial é declarativo, não medição real de VRAM/DMA.
A revisão do runtime mostrou que o skeleton exporta spawn mas não cria jogador:
não declarar player.spawn até existir consumidor.
Toolkit configurado tem SGDK 1.81; protótipos não devem ser presumidos como 2.x.

## Próximas entregas (revisado em 2026-10-10)
0. Fechadas nesta sessão: #59, #60, #50, #63, #61, #56, #47, #53, #54, #55,
   #58, #49, #48, #44, #41, #46, #51. Restam: parciais #42, #43, #45, #57; sem
   início #52, #62, #64, #65. Última suíte: 84/84; build da IDE passando. #62 depende
   de #48/#51/#59. Usar capture-rom.sh/inspect-fixture.mjs para quitar as
   inspeções visuais pendentes de #45/#48/#51/#53/#54/#57.

Lista anterior:
1. Expandir #42 além de atlas novos: proveniência, outras famílias e retenção; validar UI manual.
2. #46: transações de saídas, manifestos/geração incremental compartilhada.
3. #44/#47: base de regressões e distribuição de runtime modular.
4. #48/#49/#53/#54: renderer, colisão, entrada e estados; depois mundo/câmera/áudio.
5. #45: desenho revisável do workspace, migração gradual do layout.
6. Seguir dependências das issues e critérios completos até #65.

Transações: smoke cobre falhas, alterações externas, originais, Unicode, ledger
inválido e encerramento abrupto em processo filho. Snapshots ainda sem retenção.

Suíte anterior: 64/64 passaram; Python real exporta BG/FG/staging corretamente.
Build da IDE passou; ponte world-sgdk compilou para 68000 e ROM diagnóstica
revisada gerou 655360 B, sem executar emulador. Artefatos isolados em
`/tmp/retro-world-palette-budget-20261010/` nesta máquina, com mapas TMX reais
passando pelo compilador distribuído e serviço de publicação da IDE.
Build com mapas transacionais passou; build da IDE com Mapas/Cenas centrais passou.
Reviews secundários apontaram autosave, crash preparing e metadata; corrigidos.

#46: batches inteiramente idênticos não criam novos journals/snapshots. Novos
skeletons ignoram scratch/backups/quarentena no Git, mantendo registros estáveis.

#46: staging agora confere entradas declaradas/script/config/mapas e rejeita
alterações durante exportação. Inputs dinâmicos não declarados ainda fora garantia.

Empacotamento: módulos puros de contrato/input em shared/retro, incluídos no
pacote raw Electron; facades no frontend preservam imports. Fixture sem src
verifica runtime/configuração na distribuição. Sem dependências novas.
Tentativa de inspeção visual via Browser em 2026-10-09 não iniciou: plugin
referenciou browser-service.mjs ausente (versão 26.908.61612); nenhuma tela
foi inspecionada. Não contar isso como validação manual.

Outra tentativa pela skill Computer Use iniciou Orca, mas o comando escolhido
orca-ide deixou de resolver (command not found) antes da inspeção do app.
Nenhuma tela validada nessa tentativa. O teste hardware-dialog usa o script
real do SFC com host/template mínimo Vue para lifecycle/watchers; comprova
reset de ABI por projeto, descarte de resposta tardia e close antes de remover
dialog. Não comprova apresentação/foco no navegador.


#46 — integração terminal/skeleton: compilador e transação portáveis distribuídos
pelo runtime v2, compartilhados com a IDE. Make prepara os fontes antes do grafo
filho único; dependências incluem ledger, dados de mapas, listagens e assembly
ResComp (com ciclo intermediário preservado). Regressão instalada fora da IDE
verifica múltiplos objetivos paralelos. Builds reais SGDK 1.81 confirmam mudanças
na ROM após editar só cena JSON, só colisão TMX e só imagem com `.rs` cacheado.
Limpeza de objetos reconhece apenas cópias exatas das ferramentas distribuídas;
customizações continuam preservando recursos incertos. Sem migração automática
de Makefiles customizados e sem comprovação visual no emulador nesta etapa.

## Sessão de 2026-10-10
Última suíte: 68/68 (repetida após as correções da revisão) ao incluir runtime-camera, camera-configuration,
camera-preview e camera-editor; build da IDE (electron-vite) passou.

Execução real em emulador passou a ser possível nesta máquina:
`scripts/capture-rom.sh` roda uma ROM diagnóstica temporária no Genesis Plus GX
(`~/.retrostudio/emulators/md/gen_sdl2`) sob Xvfb, envia teclas com xdotool e
salva capturas. PicoDrive também exibe as ROMs, mas não recebeu as teclas;
BlastEm não desenhou nada sob Xvfb. `scripts/inspect-fixture.mjs` dirige
fixtures de UI no Chrome headless local pelo protocolo DevTools (os navegadores
automatizados da sessão rodam em outra máquina e não alcançam 127.0.0.1 daqui).

Com isso, ROMs diagnósticas já existentes foram executadas pela primeira vez:
- #58 movimento: sala, corpo, trajetória tracejada, HUD de métricas, pulo,
  dash, rampa e estados GROUND/AIR/DASH visíveis e coerentes.
- #49 colisão: corpo/hurtbox, plataforma, rampa, alvo, contatos F/R e VY no HUD.
- #55 mundo (roteiro `runtime-world-sgdk.steps.sh`): HALL com camada da frente,
  herói andando/pulando, scroll, chave+checkpoint, saída para CAVE com cenário,
  retorno e respawn no checkpoint. A primeira execução revelou dois defeitos
  da própria fixture, corrigidos: a imagem da camada da frente não declarava
  transparência (cobria o cenário do HALL de preto; o exportador estava certo)
  e o texto do HUD usava cor escura. Capturas finais mostram cenário, piso,
  camada da frente à frente do herói, HUD legível e status 0/0.
Isso é inspeção de capturas, não medição de cadência, áudio, DMA nem hardware.
Evidências desta máquina em `/tmp/retro-studio-epic-evidence-20261010/`.

### #60 progresso/SRAM — critérios comprovados nesta máquina
- Módulo C `progress` v1 (`assets/toolkit/lib/runtime/progress/`, no manifesto):
  checkpoint, flags e campos; duas cópias de 128 B por slot com CRC-16 e
  sequência; migração por histórico de layouts; save mais novo desconhecido é
  recusado em vez de trocado por cópia antiga; adaptador SGDK de SRAM.
- IDE: `progress/progress.json` → `src/generated/progress_config.h` em
  transação; disciplina de versões (mudar espaço reservado, bit ou posição exige
  nova versão; histórico não some sem confirmação); gate de build (header
  desatualizado/personalizado e SRAM ativa com rom_head.c sem "RA"); editor em
  Recursos → Runtime → Progresso e save.
- Projetos sem `progress/progress.json` não são afetados; sem SRAM o mesmo
  código roda só em RAM (slots 0 → NO_STORAGE, sem tocar hardware).
- Verificado: suíte 71/71 (runtime-progress, progress-configuration,
  progress-editor novas), build da IDE, módulo compilado para 68000, ROM SGDK
  1.81. No Genesis Plus GX: vazio → salvar → novo jogo → continuar → dano na
  cópia mais nova (volta o save anterior, REC 1) → dano nas duas (CORRUPT) →
  reparo → apagar → save da versão 1 migrado (MIG 1) → salvar na versão 2;
  segunda execução com o game.srm (persistência após reinício) e terceira com
  um byte do arquivo danificado fora do emulador (REC 1). O .srm foi
  decodificado pelo espelho JS do formato. Editor inspecionado no Chrome
  headless em 1280/720/560 sem erros de página.
- A primeira execução no emulador revelou defeito da fixture (danificar as duas
  cópias desfazia o dano anterior); corrigido, módulo inalterado.
- `scripts/capture-rom.sh` agora roda o emulador em `<saída>/home` e tem `quit`
  (saída limpa grava o game.srm lá); exercitado nas três rodadas.
- Não comprovado: hardware real (roteiro previsto em PROGRESS_RUNTIME.md), ROM
  acima de 2 MiB, mensagens de validação do editor em pt-BR (aparecem em inglês).
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/progresso-emulador/` e
  `progresso-editor/`. Doc: docs/PROGRESS_RUNTIME.md.
- Existe `~/.retrostudio/emulators/md/game.srm` (65536 B, todo 0xFF, criado
  2026-10-10 00:13), provavelmente das capturas da #59 antes do isolamento do
  diretório; não foi apagado.

Revisão independente da #60 (sem bloqueadores; fuzz ASan/UBSan de 8 M de
iterações e diferencial C × JS limpos). Corrigido com regressão: salvar não
sobrescreve mais slot cujo save mais novo é de versão desconhecida; mudar o
primeiro byte ou reduzir slots exige confirmação; adaptador SGDK desliga
interrupções enquanto a SRAM está mapeada; orçamento de pilha corrigido para
448 B; rom_head.c ilegível vira "desconhecido" em vez de erro; resposta tardia
A→B→A não recria rascunho (também na câmera); mapa de bytes limitado.
Documentado, não corrigido: reuso de bit/byte de item removido em salvamento
anterior na mesma versão; conferência textual de "RA".
ROM de progresso reexecutada no emulador após as correções: mesmos resultados.
Issue #60 fechada no GitHub em 2026-10-10.

### #50 áudio — FECHADA no GitHub em 2026-10-10
- Módulo C `audio` v1 (política pura: música de sala/cena, pausa, canais por
  prioridade com reserva de 2 quadros) + `retro_audio_sgdk.h` (XGM 1.81).
- Catálogo `audio/audio.json` → `res/audio_resources.res`,
  `src/generated/audio_config.h` e `audio_sgdk.h` em uma transação;
  `res/resources.res` nunca é reescrito. Gate de build e relatório (formatos,
  driver no toolkit, tamanho, conflitos, vocabulário de cutscenes).
- Editor em Recursos → Runtime → Áudio, com prévia que usa o espelho JS da
  política (paridade com o C em 4000 decisões).
- Corrigido defeito existente: importação de som gravava `SOUND … 0`, que o
  rescomp não tem.
- Makefile do skeleton: todos os objetos esperam todos os headers do rescomp.
  Projetos antigos precisam dessa regra para usar `audio_resources.h`.
- Verificado: suíte 74/74, build da IDE, 68000, ROM SGDK 1.81 com VGM e WAV
  sintetizados pelo teste. No Genesis Plus GX com o som gravado (driver de
  disco do SDL) e medido por passo: silêncio; música da sala 0 (502 Hz); sala 1
  (251 Hz); efeitos de 880 e 1200 Hz sobre a música; música de cena troca para
  502 Hz e o fim da cena volta a 251 Hz; pausa silencia; retomar volta.
- O emulador revelou um defeito real do módulo, corrigido: efeitos disparados
  no mesmo quadro iam todos para o canal 1, porque o XGM só informa canal
  ocupado um quadro depois. Daí o `retroAudioTick` e a reserva.
- Editor inspecionado no Chrome headless em 1280/720/560, sem erros de página.
- Não comprovado: hardware real; qualidade sonora (só nível e tom medidos);
  XGM2; a prévia não sintetiza VGM.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/audio-emulador/`
  (inclui `analise.json`) e `audio-editor/`. Doc: docs/AUDIO_RUNTIME.md.
- Revisão independente sem bloqueadores (fuzz e diferencial C × JS limpos, ROM
  real com `make -j4`). Corrigido com regressão: ID de música `count` corrompia
  MUSIC_COUNT; trocar um WAV/VGM não entrava na ROM (agora o .res leva o resumo
  dos originais e o gate avisa); player de música vazava na prévia; troca de
  música durante a pausa tocava na hora (C e JS); mundo ilegível virava "salas
  órfãs"; consulta dupla ao driver; linhas .res sem aspas; limite de 256 KiB.
  Documentado, não corrigido: canal 1 disputado com 4 canais de efeitos; driver
  sem `busy`; renomear ID de música não atualiza salas; relatório lê os
  originais inteiros; `driver-unavailable` não bloqueia o build.
- Som regravado no emulador após as correções: mesmos resultados.

### #63 adaptador de cutscenes — FECHADA no GitHub em 2026-10-10
- Módulo C `cutscene-host` v1 (`assets/toolkit/lib/runtime/cutscene/`): CutsceneHost
  de referência ligado a camera, audio e progress; tabela de atores do jogo;
  regra de controle por quadro; música da sala e câmera devolvidas ao fim de
  toda cena; flags e cenas vistas salvas no progresso. Compila vazio sem o
  runtime de cutscenes. `retro_cutscene_sgdk.h`: caixa de texto no WINDOW,
  escolha, fade e leitura do controle.
- Exportação derivada `src/generated/cutscene_adapter.h` (gatilhos dos TMX das
  salas + ligações de flags), com validação de referências, gate de build
  opcional e painel em Recursos → Runtime → Cutscenes. O exportador de mapas do
  skeleton aceita gatilhos depois da primeira exportação.
- Runner, bytecode e headers de cutscene NÃO foram alterados.
- Verificado: suíte 77/77 (runtime-cutscene-host, cutscene-adapter,
  cutscene-adapter-panel novas), build da IDE, 68000, projeto de exemplo SGDK
  1.81. No C nativo, pular em cada quadro da cena leva ao mesmo estado final de
  tocar com a opção padrão. No Genesis Plus GX: gatilho de entrada, gatilho por
  toque (câmera, música de cena, movimento, diálogo, escolha, fade, flags),
  retorno do controle, gatilho por interação com flag exigida; reinício com o
  save (flags e cenas vistas voltam, "once" não repete); START pula a cena.
- Não comprovado: hardware real; retratos; objetos TMX em grupos/templates.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/cutscene-emulador/`.
  Doc: docs/CUTSCENE_HOST.md.
- Revisão independente sem bloqueadores. Corrigido com regressão: mapa único
  com sourceMaps diferente de maps/map.tmx perdia gatilhos em silêncio; gatilho
  enter perdido quando outro disparava no mesmo quadro; colisão de macros entre
  cena e flag e com nomes do runtime; gatilhos ilegíveis pelo leitor textual
  viram erro; mapa de sala ausente vira erro; Start permitido no callback
  finished. Documentado: tocar × pular diverge com movimento sem espera (runner);
  cutscenes_played indexado pela ordem das cenas; fade escurece o texto.
- ROM de cutscenes reexecutada no emulador após as correções: mesmos resultados.

### #61 toolchain e projeto inicial — FECHADA no GitHub em 2026-10-10
- `retro-studio.toolchain.json` (SDK, compilador, módulos instalados, geradores,
  IDE); painel Recursos → Runtime → Base técnica, com problemas de ambiente e de
  projeto em listas separadas; falha de build classificada (ambiente/jogo/indefinido).
- Criação de projeto: seleção opcional de módulos (validada antes de criar a
  pasta) e registro automático da base técnica quando o SGDK existe.
- Template `assets/toolkit/examples/sgdk-starter` (só fontes de autoria, sobre o
  skeleton via template.json) + `electron/retro/starterProject.js`, que exporta
  personagem, salas/mapas, câmera e áudio na criação. Gerador:
  `scripts/build-starter-template.mjs` (arte e som sintetizados).
- Correção de integração: a assinatura de entradas dos mapas do mundo incluía
  qualquer .json/.res do projeto; salvar câmera/áudio/progresso depois dos
  mapas bloqueava o build. Esses domínios saíram da assinatura.
- Verificado: suíte 80/80 (toolchain, toolchain-panel, starter-project novas),
  build da IDE, toolkit real detectado (SGDK 1.81, gcc 13.1.0), build limpo do
  projeto inicial com SGDK. No Genesis Plus GX com som gravado: salão (251 Hz),
  pulo, travessia para a caverna (150 Hz), checkpoint, START volta ao
  checkpoint, retorno ao salão (251 Hz).
- Revisão independente achou um BLOQUEADOR, corrigido com regressão: abrir o
  projeto na IDE regrava retro-studio.json (assets) e isso invalidava o gate
  dos mapas; agora só mapExport/retroStudio contam na assinatura. Também
  corrigido: mensagens reais de make/sh/Windows para ferramenta ausente; texto
  do jogo classificado como ambiente; modules:[] e falhas no meio deixavam
  projeto pela metade; pendências do preparo avisadas no diálogo; template.json
  ganhou `requires`; salas com cutscene_trigger eram sempre recusadas na
  exportação do mundo (a cópia de trabalho não levava o registro do adaptador).
- Painéis de base técnica e de cutscenes inspecionados no Chrome headless
  (`scripts/preview-runtime-panels.mjs`). NÃO exercitado: Electron real,
  Windows/macOS, diálogo de novo projeto.

### #56 diagnóstico em jogo — FECHADA no GitHub em 2026-10-10
- Módulo C `debug` v1 (amostra com máscara do que foi medido, picos, linhas de
  texto, registro RSD1) + `retro_debug_sgdk.h` (SYS_getCPULoad, FPS, fila de
  DMA, sprites; VRAM só de região do jogo; sobreposição no WINDOW uma linha por
  quadro; caixas com cantoneiras por fora; KDebug).
- `debug/debug.json` → `src/generated/debug_config.h` (RETRO_PROJECT_DEBUG*,
  identificação por exportação); painel Recursos → Runtime → Diagnóstico em
  jogo, com associação à última ROM pelo recibo de build. Produção é o padrão e
  o módulo compila vazio.
- O projeto inicial tem a integração completa em blocos #if RETRO_PROJECT_DEBUG.
- Verificado: suíte 83/83 (runtime-debug, debug-configuration, debug-panel),
  build da IDE, 68000; mesmo fonte gera ROM de diagnóstico (com identificação)
  e ROM de produção sem nenhum texto do diagnóstico. No Genesis Plus GX: CPU
  ~81%, 60 FPS, DMA, sprites, estado/animação/posição/velocidade/contatos e
  caixas do herói, das saídas e do checkpoint.
- O emulador revelou dois defeitos, corrigidos: redesenhar as 4 linhas a cada
  quadro derrubava o jogo para 30 FPS (CPU 123%); a caixa do herói ficava
  escondida atrás do sprite.
- NÃO comprovado: recepção dos registros KDebug (Genesis Plus GX não mostra;
  BlastEm sob Xvfb não imprimiu); a IDE não lê os registros sozinha (#64);
  inspeção visual do painel; hardware real.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/diagnostico-emulador/`.
  Doc: docs/DEBUG_RUNTIME.md.
- Revisão independente achou um BLOQUEADOR, corrigido e confirmado no emulador
  com ROM de 3 sprites (um fora da tela): as caixas usavam
  SPR_getUsedVDPSprite (máximo reservado) em vez do fim real da cadeia de
  sprites. Também corrigido com regressão: associação com a ROM só é afirmada
  com recibo + hash da ROM em disco + header exportado + identificação nos
  bytes; semente por projeto; campos atômicos nas linhas (sem número cortado);
  registro RSD1 com terminador obrigatório; CPU/FPS não medidos nos 32
  primeiros quadros; SPR mostrado como "a<=b"; debug/ de outra ferramenta não
  bloqueia o build; botão de recarregar no painel.

### Fechamento de issues parciais antigas (2026-10-10)
Fechadas com comentário de evidências, depois de suíte 84/84 e build:
- #47 runtime modular: faltava o exemplo documentado de adaptador próprio →
  seção em MODULAR_RUNTIME.md + `assets/toolkit/fixtures/custom-adapter-example.c`
  + regressão `custom-adapter`.
- #53 entrada: ROM diagnóstica refeita com contadores por ação e executada no
  emulador (`runtime-input-sgdk.steps.sh`); editor inspecionado. Só P1/3 botões
  foi exercitado no emulador.
- #54 controlador de estados: evento por quadro (som do passo) no projeto
  inicial, comprovado pelo áudio gravado (330 Hz só ao andar).
- #58 física, #55 grafo de salas, #49 colisões: critérios já implementados nas
  sessões anteriores; faltava prova em emulador/visual, agora feita (projeto
  inicial a 60 FPS medidos, transições, caixas em jogo; editores de salas e de
  física inspecionados no Chrome headless).
Fixtures de inspeção: `scripts/preview-runtime-panels.mjs` (toolchain,
cutscenes, debug, input), `preview-world-editor.mjs`, `preview-movement-lab.mjs`.

- #48 cenas/objetos: ao conferir a evidência, os objetos de cenário da ROM do
  mundo NUNCA tinham aparecido: a fixture passava pixels onde `toTMX` espera
  tiles (objetos em 768,1216, fora da sala). Fixture corrigida, exportador
  passa a recusar visual inteiro fora do mapa (regressão em map-objects), ROM
  reexecutada: objetos visíveis, acompanham a câmera e são liberados na troca
  de sala. O gerador do projeto inicial tinha o mesmo erro no player_spawn.
- #44 regressões: projeto inicial executado também como ROM somente PAL
  (região E): 50 FPS, CPU ~50%. Guia de validação com jogos existentes em
  AUTHORING_REGRESSIONS.md (NÃO executado contra Alice/Tempo). O template do
  projeto inicial compara PNG por pixels decodificados (independe do Pillow).

- #41 contratos: AUTHORING_FORMATS e PROJECT_CONTRACT.md alinhados com os
  formatos reais (retro-studio.world/camera/progress/debug); fechada.

- #46 exportações: faltava mostrar o estado em um só lugar →
  `electron/retro/exportOverview.js` + `ExportOverviewPanel.vue` (Recursos →
  Runtime → Estado das exportações), regressão `export-overview`; fechada.
- #51 orçamento de hardware: faltavam ações sugeridas → `resourceSuggestions`
  em compiledResources.js (só dados compilados), XGM/WAV com custo em ROM como
  limite superior, textos nos 4 idiomas, relatório inspecionado com dados reais
  (`preview-runtime-panels.mjs --hardware-report`); fechada.

Abertas em 2026-10-10: #40 (épico), #42, #43, #45, #57 (parciais, ainda não
reavaliadas) e #52, #62, #64, #65 (não iniciadas). Última suíte: 85/85.
Evidências novas: `/tmp/retro-studio-epic-evidence-20261010/` → entrada-emulador,
pal-emulador, mundo-emulador (refeito), paineis.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/inicial-emulador/`.
  Doc: docs/TOOLCHAIN_AND_STARTER.md.

Issue #59 fechada no GitHub em 2026-10-10 com comentário de evidências.
Permissões desta sessão: o operador liberou `node scripts/` e o fechamento de
issues concluídas; gravar `.claude/settings.local.json` pelo agente é recusado.

## #43 — contexto de hardware e de SDK da IA (fechada em 2026-10-10)
- Sugestões do editor: autocompletar, snippets, hover e ajuda tinham dezenas de nomes que não
  existem em nenhum SGDK instalado (`SYS_init`, `VDP_drawIntEx`, `SND_play`, `F16_*`, `FMUL`,
  `VDP_PLANE_A`, `SPRITE_SIZE_2x2`, `SPR_setVisible`…), funções aposentadas
  (`VDP_setPaletteColor`) e chamadas com aridade ou retorno errados. Tudo trocado por APIs do
  SGDK 1.81; `XGM2_*` marcado como exclusivo do 2.x.
- Regressão `smoke-sdk-suggestions` + índice `scripts/data/sgdk-symbol-index.json` gerado dos
  headers reais (1.81 e 2.00): reprova nome inexistente/aposentado, duplicata, aridade,
  retorno e função desconhecida em snippet. Teste de mutação com três erros reintroduzidos: os
  três reprovados.
- Compilação real (`m68k-elf-gcc -fsyntax-only -Wall -Wextra -Werror`) dos trechos reescritos
  com o SGDK 1.81 e dos `XGM2_*` com o 2.00: sem erros; os `XGM2_*` falham no 1.81, como marcado.
- Bloco de contexto: SDK (inclusive `inc/snd/` do 2.x), adaptador, módulos instalados
  (ausente/vazio/ilegível distintos), recibo do último build (sem afirmar o que o disco não
  confirma), natureza dos números (estimativa/dado compilado/medição). Recibo real de
  `buildSnapshot.js` conferido no bloco. `list_assets` aceita `XGM2` e só repassa identificadores.
- Revisão independente: 2 P1 e 6 P2 corrigidos com regressões. Ficam como limites
  documentados em `docs/AI_HARDWARE_CONTEXT.md`: tipos dos argumentos não são conferidos
  automaticamente; bloco sem cache; tutoriais de `docs/content/` seguem a wiki mais recente.
- Não comprovado: comportamento do modelo diante do bloco, chat na IDE Electron real, cadeia ACP
  externa, consulta direta ao manual da Sega (números conferidos nos headers e pela revisão).
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/ia-contexto/`. Suíte: 88/88; build passando.

## #42 — recursos, dependências e limpeza (fechada em 2026-10-10)
- Importação: “Importar”, arrastar/colar, fundo de mapa, mapa em imagem de kit, arrastar para
  a árvore e pacotes da loja não sobrescrevem conteúdo diferente e reaproveitam conteúdo
  igual. O mapa em imagem de kit deixou de usar nome com timestamp (era o problema citado na
  issue). `resources.res` ganha uma linha por arquivo, sem trocar a linha de outro arquivo.
- Catálogo (Recursos → Uso dos recursos): papel, dono, origem (`.retrostudio/asset-origins.json`),
  usos e destino na limpeza por arquivo; lista de caminhos que não funcionam em outra máquina.
- Limpeza: originais, folhas e saídas de personagem nunca são oferecidos; qualquer arquivo que
  a leitura não entende impede o veredito automático; prévia nativa com caminhos e tamanhos.
- Portabilidade: charsets guardam a folha relativa ao projeto; projetos antigos (inclusive
  copiados de outra máquina) continuam abrindo.
- Revisão independente: 1 P1 e 9 P2 corrigidos com regressões que reproduzem as evidências
  da revisão; P3 restantes documentados em `docs/ASSET_LIFECYCLE.md` (“Limites desta etapa”).
- Não comprovado: IDE Electron real e diálogo nativo; Windows/macOS reais; fluxo da loja com
  download real; concorrência entre duas importações.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/recursos/`. Suíte: 88/88; build passando.

## #57 — paletas, composição, ciclos e fades (fechada em 2026-10-10)
- Editor “Paletas e composição” (Recursos → Runtime): PAL0–PAL3, transparência e cor de fundo,
  paleta a partir de imagem com quantização, atribuição de imagens com conflitos e
  antes/depois, cópia indexada sem tocar no original, prévia composta com a ordem do VDP e
  prioridade por tile (mouse e teclado), ciclos e fades com custo e limitações, e paletas
  lidas do ELF do último build.
- Módulo de runtime `palette` (C99 + adaptador SGDK 1.81), header gerado
  `src/generated/palette_config.h` com portão de build e linha na visão de exportações.
- Verificado: núcleo C com sanitizadores e 6000 passos de paridade C/JS; header compilado em C
  com paridade quadro a quadro com a prévia; ROM real no Genesis Plus GX (barras, ciclos,
  fade de/para o preto só nas paletas pedidas); paletas de um ELF real; cópia indexada e
  quantização conferidas com o `rescomp` real; tela no Chrome headless com PNGs reais.
- Revisão independente: 1 P1 (quantização diferente da do rescomp) e 7 P2 corrigidos
  (PNG de 4 bits, fila de DMA cheia, estouro em tabela escrita à mão, fade a partir do brilho
  atual, custo com código/CPU, prioridade por teclado, mensagens em português).
- Não comprovado: console real, outros emuladores, SGDK 2.x, tempo de CPU dos efeitos na ROM,
  IDE Electron real para esta tela. Trocar de projeto com o editor aberto descarta
  alterações não exportadas (como nos demais painéis de Runtime).
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/paletas/` e `paletas-emulador/`.
  Doc: `docs/PALETTE_RUNTIME.md`. Suíte: 91/91; build passando.

## #45 — workspace por modos (fechada em 2026-10-10)
- Modos Código, Mapas, Personagens, Cenas e Executar (Alt+1…5), com Construir/Jogar/Parar
  persistentes. Modo Executar: pendências que impedem o build, último jogo compilado e
  problemas com link para o arquivo. Painel inferior único com Terminal, Problemas e a aba do
  modo (linha do tempo, áudio, diagnóstico); aba por modo guardada no layout do projeto.
- Primeira verificação na IDE Electron real: `scripts/inspect-electron.sh` abre uma instância
  isolada (HOME e dados próprios, Xvfb) e `scripts/electron-reference-flow.steps.mjs` executa
  criar projeto → editar código → construir → erro proposital → corrigir pelo link →
  editar/exportar personagem → construir → jogar (Genesis Plus GX) → parar.
- Defeitos reais achados por essa verificação e corrigidos, com regressões: build com erro
  deixava a barra presa em “Em andamento…”; projeto novo herdava ROM/registros de um modelo
  já compilado; personagem do projeto inicial não abria no editor (faltava `region`);
  exportar um personagem deixava o mundo “desatualizado” e bloqueava o build; erro de
  clonagem ao salvar o inventário; estado “Pronto” com o emulador aberto; avisos do módulo de
  progresso e do jogo inicial em todo build; botão de atualizar Git sempre desabilitado.
- Revisão independente: perda silenciosa nos editores do painel inferior, comando de terminal
  que sumia, avisos de build apagados, atalhos sem guarda, textos fora dos idiomas e tema do
  editor de personagens corrigidos.
- Limites (em `docs/WORKSPACE_LAYOUT.md`): sem inspetor único entre domínios; colunas internas
  dos editores com largura fixa; modo ativo não é guardado por projeto; editores de autoria
  continuam só em português; Windows, macOS, telas pequenas e leitor de tela não exercitados.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/workspace-electron/`. Suíte: 92/92.

## #52 — desfazer, recuperação e segurança da edição (fechada em 2026-10-10)
- Desfazer/refazer por documento no editor de personagens (recortes, quadros, tempos, caixas,
  propriedades, remoções) e nos editores de áudio, câmera, progresso, mundo, física, paletas e
  diagnóstico; mapas já tinham. Histórico novo a cada documento aberto; salvar e aplicar um
  passo não criam passos; nada de fora do editor entra no histórico.
- Rascunhos duráveis em `.retrostudio/drafts/` (um por editor e um por mapa), oferecidos ao
  reabrir; nunca substituem um arquivo de autoria sozinhos; rascunho sobre versão antiga
  bloqueia a exportação até decisão.
- Gravação atômica de arquivos de texto; fechamento da janela por qualquer caminho passa pelas
  guardas; exclusões vão para a lixeira do sistema.
- Verificado na IDE Electron real: três edições de um personagem desfeitas/refeitas por botão e
  teclado com o arquivo acompanhando, sem regravação em repouso; desfazer depois de exportar
  preserva a posse dos arquivos; rascunho de paleta recuperado depois de recarregar a janela
  e apagado ao descartar; janela fecha em menos de 1 s pelo fluxo novo.
- Revisão independente: 2 P1 (desfazer após exportar apagava o registro de exportação;
  rascunho antigo de paletas exportável sem aviso) e 8 P2 corrigidos com regressões.
- Limites (em `docs/EDITOR_RECOVERY.md`): cenas, kits, controles e orçamento sem desfazer nem
  rascunho novos; histórico não persiste entre sessões; recuperação de mapa verificada por
  teste da lógica, não pintando um mapa na IDE real; Windows/macOS e queda de energia real
  não exercitados.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/desfazer-electron/`. Suíte: 95/95.

## #64 — depuração da ROM com emuladores (fechada em 2026-10-10)
- Seção **Depurar o jogo** no modo Executar (`RomDebugger.vue`), com a lista de capacidades de
  cada backend; o que o backend não faz fica desabilitado e escrito como “não disponível”.
- Backends comprovados com o BlastEm 0.6.3: depurador nativo (passo, continuar, avanço por
  quadros, breakpoints, registros, memória, registros do VDP e lista de sprites, mensagens
  KDebug) e protocolo remoto do GDB (passo, continuar, breakpoints, registros, memória).
  Genesis Plus GX e PicoDrive aparecem como “sem depuração”.
- Declarado indisponível em todos: pausa com o jogo rodando e gravação/reprodução de entradas
  (o `bindown` desta versão do BlastEm não funciona). VRAM e CRAM não são lidas pela IDE.
- Símbolos: build comum já dá função+deslocamento e variáveis globais; **Construir para
  depurar** (`make debug`) dá linhas de C. O link para o código só aparece com recibo de build
  conferindo e fontes inalterados, reavaliado a cada parada. Trocar de tipo de build limpa
  antes; um build por projeto; Makefile sem alvo `debug` não perde a ROM; Empacotar recusa a
  ROM de depuração.
- Verificado: integração dos dois backends contra o BlastEm real (parada em 0x200, memória,
  breakpoint em `main`, VDP antes/depois da inicialização, 39 mensagens KDebug — o que também
  quita a recepção de KDebug que tinha ficado sem prova na #60); fluxo inteiro na IDE Electron
  real (construir para depurar → parar em `main` → abrir `src/main.c:107` → memória → VDP →
  90 quadros → aviso antes de rodar sem breakpoint → emulador fechado por fora).
- Revisão independente: 3 P1 (linhas de C ausentes/trocadas em fontes sem inline e nomes
  repetidos; builds concorrentes misturando objetos; Makefile sem `debug` perdia a ROM), 8 P2
  e parte dos P3 corrigidos com regressões (`smoke-build-flavor`, casos de linhas com o
  compilador real, ruído no protocolo, sessão órfã, estados presos).
- Também corrigido: abrir um arquivo em uma linha vindo de outro modo às vezes ficava no topo.
- Limites (em `docs/ROM_DEBUGGING.md`): textos do processo principal só em pt-BR; leitura de
  símbolos síncrona; Windows/macOS, outras versões do BlastEm e `make debug` em Alice/Tempo
  não exercitados; sob Xvfb o BlastEm exige confirmar uma caixa de vsync.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/depurador-electron/`. Suíte: 99/99.

## #62 — panoramas e streaming (fechada em 2026-10-10)
- Runtime: `scenery` (C portátil: janela de células + padrões de tiles em uma faixa de VRAM,
  com orçamento por quadro; a câmera para na borda do que já foi enviado) e `scenery-sgdk`
  (BG_A cenário por streaming, BG_B panoramas em até 8 faixas com velocidade 8.8). A ponte
  `world-sgdk` foi para a versão 3 com um renderizador opcional por sala; salas sem
  panoramas seguem no caminho antigo.
- Exportador: salas do mundo com panoramas saem como `TILEMAP`/`TILESET` sem compressão mais
  a imagem do plano de panoramas (512 × 256, já repetida). Combinações que não cabem em dois
  planos são recusadas com o motivo (11 casos testados). A IDE publica pelo exportador que
  vem com ela.
- Editor: a seção Parallax mostra o arranjo de planos e os problemas que não dependem de
  pixels, com as mesmas frases do exportador.
- Verificado: núcleo e ponte+adaptador contra VDP simulado (tela conferida célula a célula
  por milhares de quadros, velocidades das faixas, VRAM de terceiros intacta, recusas antes
  de a sala aparecer); ROM de referência construída com o SGDK real a partir do projeto
  publicado pela IDE e rodada no Genesis Plus GX (percurso, troca de sala nos dois sentidos,
  sentinela de VRAM intacta).
- Limites (em `docs/SCENERY_RUNTIME.md`): uma camada de mapa por sala com panoramas; reserva de
  cenário só em `retro-studio.json`; H32 e 240 linhas só no simulador; sem hardware real.
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/cenario-emulador/`.
- Revisão independente: nenhum P1; 4 P2 corrigidos com regressões (sala com mais de 2048
  tiles aceita na exportação e recusada em jogo; exportação sem exigir o módulo de cenário;
  prévia do editor usando a área visível em vez da tela do console; câmera descartada quando
  os tiles acabam no meio do caminho) e os P3 de cálculo (dimensões ímpares, mínimos de
  orçamento, modo de vídeo do contrato, regra das faixas). O restante virou limite documentado.
- Depois da revisão: suíte 105/105; ROM reconstruída e recapturada.

## #65 — HUD, fonte, menus e diálogos (fechada em 2026-10-10)
- Editor **HUD e textos** (Recursos → Runtime): layout em pixels com nove âncoras e área segura,
  elementos (texto, número, barra, ícones) em plano ou em sprites, fonte importada de PNG com
  mapa de caracteres (ou a fonte de exemplo com acentos), menus, caixa de diálogo, valores do
  jogo, custo e trecho de integração; prévia com as regras do runtime.
- Runtime `hud` (C portátil) e `hud-sgdk`: células escritas só quando mudam, janela em uma
  faixa (HUD) que passa a cobrir só o menu/diálogo aberto, sprites para posição livre, ponte
  `retroHudCutscenePresent` para as falas das cenas. A fonte importada ocupa o lugar da fonte
  do SGDK (nenhum tile a mais).
- Serviço: `hud/hud.json` → `src/generated/hud_config.h` (+ planilha de glifos e `.res` quando
  há sprites), com trava de build e linha no panorama de exportações; arquivo de outra
  ferramenta e header personalizado são preservados.
- Verificado: paridade C × prévia em 28 passos; 27 recusas com o motivo; ROM de diagnóstico
  construída com o SGDK real e rodada no Genesis Plus GX (HUD com acentos, relógio em sprites,
  menu de pausa, diálogo e escolha); editor aberto na página de prévia (capturas).
- Evidências: `/tmp/retro-studio-epic-evidence-20261010/hud-emulador/` e `hud-editor/`.
- Revisão independente: 2 P1 (salvar o HUD deixava o mundo “desatualizado” e bloqueava o
  build; varredura de todas as células a cada quadro com a tela parada) e 8 P2 corrigidos com
  regressões — fonte sem transparência, planilha de sprites com índices deslocados, HUD em
  plano de cenário apagando a arte, paleta gravada só uma vez, escolhas com mais opções que
  linhas, avisos de cenas incompletos, prévia mostrando HUD que o console esconde, “Recarregar”
  sem avisar do descarte — mais os P3 de constantes repetidas, área segura, 240 linhas e
  profundidade dos sprites. O que ficou como limite está em `docs/HUD_RUNTIME.md`.
- Depois da revisão: suíte 106/106; ROM reconstruída e recapturada (escolha de quatro opções
  rolando pela ponte de cenas).

## Estado do épico em 2026-10-10 (fim da sessão)
- Todas as issues filhas (#41 a #65) estão fechadas, cada uma com comentário de evidências e
  limites. O épico #40 continua aberto: nada foi commitado nem enviado (aguarda autorização do
  operador para commit/PR), e as issues de contexto #34, #35, #36, #38 e #39 ainda precisam
  ser validadas antes de fechá-lo.
- Suíte: 106/106 (`node scripts/run-authoring-regressions.mjs`); `npm run build` passa.
- Sem prova em nenhuma issue: hardware real, Windows/macOS, CI no GitHub, validação em Alice e
  Tempo.
