# Regressões de autoria — issue #44
Execute `node scripts/run-authoring-regressions.mjs` na raiz da IDE.
A suíte usa fixtures temporárias, sem escrever nos projetos Tempo/Alice ou ROMs
originais. Cada teste tem limite de 60 segundos e registra PASS/FAIL; a suíte
termina com falha se qualquer teste falhar.

A suíte inclui 64 verificações. `smoke-world-editor.mjs` executa o script Vue
do grafo, com drafts/revisões/remoções/erro e recarga após save.
`smoke-world-configuration.mjs` cobre também orçamento do catálogo, oversized
antes de leitura, diretórios inacessíveis e exclusão de links externos.
`smoke-world-build.mjs` executa make real pelos caminhos de produção IDE/IA,
com grafo inválido antes da compilação e alterações de mapa durante make:
confere erros, retenção do recibo anterior, guarda do emulador e legado. Também
recusa gerações mundiais desatualizadas e imagens alteradas durante o Make.
`smoke-world-refresh.mjs` cobre salvamento de salas fora de `sourceMaps`,
regeneração integral, imagens novas, recursos compartilhados e registros v1/v2.

Abrange contratos legados/versões, SDK local simulado, recursos, duplicatas,
ledger, quarentena/restauração, publicação/rollback, quedas na exportação e recuperação, concorrência,
Charset Maker/autosave/frames, serialização de mapas, exportador Python,
biblioteca/kits, prévias e compilador/runtime C de cutscenes no host.

`smoke-map-save.mjs` verifica também dirty por serialização, flags de tiles e
colisões, exclusão do clock da prévia, cancelamento/falha de SaveAs, abertura
concorrente e resultados tardios do seletor. Executa o composable inteiro em um
host Vue mínimo, com carga de mapa JSON, save TMX, grade inicial limpa e retenção
após falha de escrita. Os checks de `inert` são estáticos; não comprovam bloqueio
visual ou foco na janela real.
O teste também executa o watcher síncrono e os commits de arraste do Canvas,
verificando cancelamento ao entrar em carga/save e recusa de mouseup tardio.

Requisitos: Node 22, dependências existentes do package-lock, Python 3 com Pillow (já usado pelo exportador de imagens) e
compilador C (`cc`). Nenhum pacote novo foi adicionado.
O workflow `authoring-regressions.yml` roda a suíte e build da IDE em PR/main,
com permissão somente de leitura. Não publica release.

Não comprova fidelidade gráfica da ROM ou funcionamento em hardware. Fixtures
de ROM, medições SGDK/VDP, screenshots e verificação manual ainda são necessários
para concluir #44. Os testes do runtime de cutscenes compilam no host, não no 68000.

Ações de controle incluem paridade prévia JS/C e build opcional de ROM SGDK
com smoke-input-mapping.mjs --sgdk (ver INPUT_ACTIONS.md). Essa ROM diagnóstica
compilou com MarsDev/SGDK 1.81; renderização e controles reais ainda pendentes.

Objetos do kit têm roundtrip TMX/PNG/header/recursos e proteção de consumidores
compartilhados em smoke-map-objects. A opção --sgdk compila uma ROM temporária
com o main do skeleton e sprites processados pelo ResComp.

A regressão map-composition verifica composição normal de prioridade em uma
fixture Canvas2D de software, sem instalar biblioteca de canvas/browser.
Ela não substitui screenshots de browser/ROM, ainda pendentes na issue #44.

compiled-resources verifica o leitor limitado de ELF32/68000, RAM estática,
escolha explícita de ABI e orçamento por consumidor. --sgdk permite comparar
com um build real ResComp sem alterar jogos do usuário. Empacotamento verifica
também a importação deste relatório sem depender de src.

hardware-dialog usa os compiladores/renderer Vue já presentes para testar
o script real do SFC com host mínimo: reset do leitor por projeto, resposta
tardia e fechamento nativo antes da remoção. Sem nova dependência, sem prova
de apresentação/foco no browser.

`smoke-map-workspace.mjs` verifica invalidar configuração imediatamente na
troca de raiz, descartar respostas/erros obsoletos, recusar abertura atrasada
e impedir saída com rascunhos ou falha de salvamento no editor central.
O teste executa também o ticket de troca do App: falha no mapa libera apenas
o personagem preparado; pedidos concorrentes não soltam locks. A edição de
vocabulário digitada durante save adiado permanece marcada como pendente.

Cutscene-editor também cobre retorno de save/erro de compilação, baseline dos
bytes escritos, falha de disco, edição durante save e operações concorrentes
com leitura/criação/recompilação adiadas. SSR verifica modalidade legada e
renderização central sem dialog teletransportado. Não valida foco visual.
Map-workspace verifica salvar cenas/vocabulário pelo guard e reter o projeto
quando essa publicação falha.

`smoke-cutscene-export` compila fontes salvas pelo serviço main em fixtures:
provenance, no-op, rollback entre headers, alteração concorrente de fonte/header,
reconciliação de caminhos, adoção legada exata, preservação de manual, JSON
malformado sem outputs e confinamento de caminhos/links. Cutscene-editor usa
esse serviço real por bridge simulada. Packaged-shared importa o exportador
sem `src/`, incluindo o compilador distribuído. Não prova recuperação de
interrupção real do sistema neste novo caminho; o journal usa a infraestrutura
já exercitada por export-transaction. Scripts customizados legados continuam fora desta cobertura.

`smoke-cutscene-cli` instala o runtime em projeto temporário fora da IDE e
exercita validação sem escrita, publicação, no-op, conflitos manuais e backups.
O fixture Make comprova atualização de consumidores separados após alterações
somente de cena ou mapa e um único make filho para múltiplos objetivos paralelos.
`node scripts/smoke-cutscene-cli.mjs --sgdk <raiz-do-SGDK>` executa builds
68000: inicial, mudança somente de cena JSON, mudança somente de colisão TMX
e mudança apenas de imagem com assembly ResComp já existente;
compara o objeto consumidor e a ROM, sem usar o emulador. Essa opção é adicional
à suíte padrão e não comprova apresentação visual ou física no jogo.


`smoke-character-runtime` executa o controlador C real e os dados opcionais do
header gerado pelo Charset Maker: sequência finita, loops, transições por
prioridade/condições/interrupção, idade e duração exatas, poses/eventos, validação
e reentrada. `--m68k-cc` compila o módulo para 68000. Ainda não verifica personagem
renderizado ou inspeção visual da interface.

`smoke-character-controller` verifica dados de autoria, referências após
renomear/reordenar, geração C de transições/eventos, configuração inválida e
roundtrip. Executa os métodos reais de edição da timeline e de save do SFC
com host VM: eventos acompanham poses, exclusão remove eventos e inválidos não
substituem o fonte salvo. Não comprova foco/apresentação no Electron.

`smoke-character-preview` compara 80 ticks de estado, frame, tempo e eventos
com o controlador C e header efetivamente gerado. Predicados reentrantes são
recusados como no C. O host VM executa controles reais da prévia: pause,
callback obsoleto, editor oculto, movimento reduzido e entrada inválida.
Dados autorais não mudam. Canvas/foco real no Electron continuam pendentes.

`smoke-character-sprite` executa o adaptador SGDK com host C: propriedade
emprestada, callbacks/contextos preservados, timer manual, pivô/flips/câmera,
clipping, validação e detach com alterações parciais do host. A opção
`--sgdk <raiz-do-SGDK>` compila o módulo com os headers reais para 68000 e
gera uma ROM temporária a partir de header Charset Maker e sprite ResComp.
Isso valida a cadeia de build, sem executar emulador ou comprovar aparência.

`smoke-character-geometry` consome metadados efetivamente exportados em C,
com controlador, colisão e combate: corpo local independente da arte, janela
por frame, flips, Q8 negativo, alias, preservação em falhas e legado sem módulos.
`--m68k-cc <compilador>` verifica o helper para 68000. A fixture SGDK de sprite
também compila os dados de geometria; não comprova colisão real no emulador.
O teste de geometria cobre também a hurtbox independente, padrão seguindo o
corpo, métodos reais de save/restore v6 e backup da migração v5. Character-export
verifica publicação/rollback de metadata v6 preservando a caixa de dano.

`smoke-runtime-slopes` verifica rampas de piso no C real: interpolação Q8,
pouso vertical rápido, subir/descer e snap, pulo/drop, grupos, sólidos,
ordem das superfícies e extremos numéricos. `--m68k-cc` compila para 68000.
O teste não comprova autoria de rampas no mapa nem sweep diagonal/hardware.

`smoke-map-terrain` verifica autoria/redimensionamento em métodos reais,
TMX preciso, exportação Python e consumo C de grade/recortes/grupos/faces,
plataforma e rampa. Falhas de alturas ou recortes incompatíveis preservam
geometria publicada. `--sgdk <raiz>` compila uma ROM temporária com consumidor
dos arrays; não comprova controle/apresentação no emulador.

`smoke-collision-diagnostic` inclui o fonte da ROM diagnóstica em host C e
verifica contatos, paredes em ambos os sentidos, movimento rápido, piso/teto,
pulo, plataforma/drop, rampa, janela de ataque, invulnerabilidade, derrota,
espelhamento e pixels de overlay. Simulação VDP verifica clipping, remoção de
poses antigas e até 64 entradas DMA com fonte preservada até VBlank.
`--sgdk <raiz>` compila esse mesmo fonte para 68000 e gera ROM temporária;
`--artifacts <pasta-nova>` mantém ROM/fonte fora dos jogos. Não executa emulador.

`smoke-runtime-movement` executa controlador C de física: aceleração, pulo/cut,
paredes, dash, tolerâncias, plataformas/rampas, flip exclusivo da escorregada,
DROP mantendo chão sólido e preservação em entradas inválidas. `--m68k-cc`
verifica compilação 68000. `smoke-movement-configuration` publica perfis
PAL/NTSC e consome o header real em C; cobre precisão, isolamento, revisões e
customizações preservadas. `--sgdk <raiz>` compila consumidor em ROM temporária;
HUD de estado não comprova sala visual completa nem operação no emulador.

`smoke-movement-lab` compara o C nativo com o WebAssembly efetivamente incluído
na IDE em 600 ticks, verifica hashes de fonte/receita/header/binário e métricas
independentes antes/depois do pulo. `smoke-movement-editor` executa o script Vue
e o WASM reais com host mínimo: reprodução explícita, pausa, reduced motion,
falha de save, conflito de revisão, respostas tardias e rascunhos por projeto.

A suíte padrão contém 64 regressões. A fixture `preview-movement-lab.mjs`
também foi inspecionada no navegador em 1280×900 e 720×720: layout, foco interno,
pausa da janela e erro/retry de save. Esse caminho usa IPC em memória e não
valida a aplicação Electron completa nem substitui verificação SGDK/emulador.

`smoke-movement-diagnostic` executa o fonte real da sala SGDK no host: terreno
e wrapper canônicos, métricas, perfis, paredes dos dois lados, dash/drop/rampa,
reset, pixels e trajetória limitada a 512 posições. Simula fila DMA com limite
de 64 tiles e confere fontes estáveis até VBlank. Caminhada/pulo de referência
não exigem VBlank extra, sem afirmar cadência de hardware para todos os perfis.
`--sgdk <raiz>` compila 68000/ROM; `--configuration <movement.json>` fornece
perfis salvos somente ao projeto temporário; `--artifacts <pasta-nova>` mantém
os resultados. Configuração alternativa exportou intacta e mudou a ROM.
Nenhuma execução no emulador foi comprovada nesta etapa.

`smoke-movement-diagnostic-service` testa backend isolado: fontes distribuídas,
projeto imutável, revisões salvas, tokens estrangeiros, ROM alterada, geração
concorrente/obsoleta, falhas, limite de receipts e descarte no encerramento.
`--sgdk <raiz-SGDK-ou-MarsDev>` compila usando o próprio serviço da interface.
Packaged-shared prepara uma sala sem `src/scripts` da IDE, com build simulado.
Movement-editor cobre geração duplicada/falha, pausa antes de open, falha de
emulador e retorno de ROM após troca de projeto. Browser real da fixture
confirmou geração, erro/retry de open e estado pausado; seu emulador é simulado.

`smoke-runtime-world` executa o C de salas: condições, falhas de preparação,
cleanup de handle novo, alias com ativo, callback/reentrada, checkpoint, respawn
e restore. `--m68k-cc` compila para 68000. `smoke-world-configuration` publica
fonte/header, consome o C gerado e verifica IDs/destinos/coordenadas, mapas
confinados, TMX legado preservado, revisão/customizações e alteração durante
exportação. Caminho com trigraph é compilado/verificado, com cross opcional.
Esses testes não comprovam lifecycle de mapas/VRAM no hardware.

`smoke-runtime-world-sgdk` executa a ponte C com spies de MAP/DMA/VDP:
preparação falha, alocação/liberação própria, VRAM, slots de paleta, remoção da
frente, checkpoint, câmera e rejeição de reentrada durante VBlank. `--sgdk`
compila com headers SGDK reais. `smoke-world-diagnostic` gera fontes e imagens
de uma fixture de duas salas e executa a física C nativa com caixas distintas,
queda/chão/salto sobre terreno exportado, com controlador de personagem gerado
pelo Charset Maker: idle/walk/jump/fall, pouso, timers e reset. Atlas/header/
projeto passam pelo serviço de exportação transacional antes dos mapas. `--sgdk <raiz>` também gera ROM com ResComp e
`--artifacts <pasta-nova>` conserva resultados. A variante SGDK também reexporta
sem objetos e recompila o mesmo host; o lookup nativo usa callbacks simulados
para conferir tipos/IDs/contagem e salas vazias, sem comprovar renderização. A suíte padrão não compila a
ROM nem executa emulador. Exportação integrada dos mapas do grafo permanece
disponível pelo backend; a fixture passa TMX reais pelo compilador distribuído
e usa seus bindings/imagens. `smoke-world-maps` compila geometria de duas salas
no mesmo C, com hitboxes distintas, e verifica preservação de fontes/legado,
ordem de declaração, estágio existente, dimensões/IDs inválidos e links em
world/config/recursos/manifesto. Não comprova emulação. `smoke-world-map-export` exercita o serviço real e a
transação combinada com fonte/header/recursos: no-op, rollback, concorrência,
manual/duplicados, comentários, dependências, scripts do projeto ignorados,
ledger cheio e 64 salas. Packaged-shared exporta usando apenas fontes
distribuídos, sem src/scripts da IDE. UI/Electron e emulação reais continuam
fora da prova de publicação pelo serviço.

Câmera (#59): `smoke-runtime-camera` executa o controlador C e o runner real de
cutscenes no host (`--m68k-cc` compila para 68000); `smoke-camera-configuration`
cobre validação, vínculo com o mundo, transação, gate de build e header → C
(`--sgdk <raiz>` gera a ROM diagnóstica, `--keep-rom <arquivo>` a preserva);
`smoke-camera-preview` compara 6000 ticks da prévia com o C nativo;
`smoke-camera-editor` executa o script real do componente Vue.
`scripts/inspect-fixture.mjs` dirige fixtures de UI no Chrome headless local e
`scripts/capture-rom.sh` executa ROMs diagnósticas temporárias em um emulador
instalado sob Xvfb, com roteiro de teclas e capturas. Essas duas ferramentas
dependem do ambiente (Chrome, Xvfb, xdotool, ImageMagick, emulador) e por isso
ficam fora da suíte automática.

Progresso (#60): `smoke-runtime-progress` executa o módulo C no host com
ASan/UBSan (gravação interrompida em cada posição, erro em cada bit, reparo,
migração e paridade do formato em JS; `--m68k-cc` compila para 68000);
`smoke-progress-configuration` cobre validação, disciplina de versões,
transação, gate de build, cabeçalho da ROM e header → C (`--sgdk <raiz>` gera a
ROM diagnóstica; `--inspect-srm` decodifica a SRAM gravada por um emulador);
`smoke-progress-editor` executa o script real do componente Vue.

Áudio (#50): `smoke-runtime-audio` executa a política de música e canais em C
com ASan/UBSan, o runner real de cutscenes e 4000 decisões comparadas com a
prévia em JS (`--m68k-cc` compila para 68000); `smoke-audio-configuration`
cobre catálogo, transação, relatório, gate de build e header → C (`--sgdk`
gera a ROM com VGM e WAV sintetizados pelo teste); `smoke-audio-editor` executa
o script real do componente Vue. `scripts/analyze-audio-capture.mjs` mede o som
gravado de um emulador e fica fora da suíte automática.

Cutscenes (#63): `smoke-runtime-cutscene-host` executa o adaptador de
referência com o runner real e os módulos de câmera, áudio e progresso em C
nativo, comparando o estado final ao pular em cada quadro (`--m68k-cc` compila
para 68000); `smoke-cutscene-adapter` cobre a leitura de gatilhos dos TMX, a
validação de referências, a exportação transacional e o gate de build
(`--sgdk` gera o projeto de exemplo); `smoke-cutscene-adapter-panel` executa o
script real do painel Vue.

Base técnica e projeto inicial (#61): `smoke-toolchain` cobre detecção com um
toolkit falso e sondas injetadas, o registro, a separação ambiente/projeto, os
caminhos de atualização e a classificação de falhas de build (`--toolkit`
confere o toolkit real); `smoke-toolchain-panel` executa o script real do
painel; `smoke-starter-project` confere o template contra o gerador, cria um
projeto pelos mesmos passos da IDE, passa pelos gates de build e, com
`--sgdk`, faz o build limpo. Precisa de python3 com Pillow.

Diagnóstico (#56): `smoke-runtime-debug` confere a formatação em C nativo
(valores não medidos, picos, limites das linhas, registros) e o leitor da IDE
(`--m68k-cc` compila para 68000); `smoke-debug-configuration` cobre o padrão de
produção, a identificação por exportação, a associação com a ROM, o gate de
build e, com `--sgdk`, as duas ROMs do mesmo fonte; `smoke-debug-panel`
executa o script real do painel.

## Validação com jogos existentes (Alice, Tempo e outros)

A suíte nunca abre nem escreve nesses projetos. Para conferir que uma versão
nova da IDE preserva um jogo com adaptador próprio, trabalhe sempre em uma
cópia e nunca rode exportadores no original:

1. Copie o projeto para uma pasta temporária (sem `out/`).
2. Na cópia, confira que os recursos opcionais continuam desligados: abrir o
   projeto não deve criar `world/`, `camera/`, `audio/`, `progress/`, `debug/`
   nem `retro-studio.toolchain.json`, e o build não deve acusar nenhuma
   “Validação de …” (cada gate responde “não configurado” sem a sua fonte).
3. Faça o build da cópia pela IDE ou com o Makefile do próprio jogo e compare o
   tamanho e o hash da ROM com um build do original feito antes da atualização.
4. Em modo Jogo → Base técnica, confira que o diagnóstico só informa
   “base ainda não registrada” e o estado das ferramentas; não registre.
5. Se o jogo usa o runtime de cutscenes, rode `node tools/compile-cutscenes.mjs`
   na cópia: os headers gerados devem sair idênticos.

Nenhuma ROM original ou privada é necessária: as regressões usam só fixtures
geradas e as ROMs diagnósticas compiladas na hora. Este roteiro não foi
executado contra Alice ou Tempo na sessão de 2026-10-10.

## ROMs de referência executadas em emulador

`scripts/capture-rom.sh` roda uma ROM diagnóstica no Genesis Plus GX sob Xvfb
com um roteiro de teclas (`assets/toolkit/fixtures/*.steps.sh`). Cenários com
roteiro: câmera, mundo (salas, objetos de cenário, arena, checkpoint),
progresso em SRAM (com reinício e arquivo danificado), áudio (com o som gravado
e medido por `scripts/analyze-audio-capture.mjs`), cutscenes, entrada e o
projeto inicial jogável. O projeto inicial também foi executado como ROM
somente PAL (região `E`): 50 quadros por segundo e o mesmo comportamento.
Essas execuções dependem de ferramentas da máquina e ficam fora da suíte.
