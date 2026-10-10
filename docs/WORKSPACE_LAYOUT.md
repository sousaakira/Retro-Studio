# Workspace de autoria — issue #45

## Desenho do workspace (para revisão)

Inspirado na organização da Godot — modos no topo, lista à esquerda, editor ao centro,
propriedades à direita e um painel inferior compartilhado —, sem copiar nada de 3D e sem
tirar o fluxo de código da IDE. Referência:
https://docs.godotengine.org/en/stable/getting_started/introduction/first_look_at_the_editor.html

```text
┌ barra de título: projeto, abrir, buscar, salvar, emulador ───────────────────────────────┐
├ barra de trabalho: [Código][Mapas][Personagens][Cenas][Executar] [Recursos] │ Construir   │
│                                                    Jogar Parar │ painéis │ restaurar     │
├──────┬──────────────┬──────────────────────────────────────────────┬─────────────────────┤
│ ativ.│ painel       │ editor central do modo                        │ IA (opcional)       │
│      │ lateral      │ (lista/propriedades do modo ficam dentro dele)│                     │
│      │ (arquivos,   ├───────────────────────────────────────────────┤                     │
│      │ busca, Git,  │ painel inferior: Terminal │ Problemas │ aba    │                     │
│      │ recursos)    │ do modo                                       │                     │
└──────┴──────────────┴───────────────────────────────────────────────┴─────────────────────┘
```

| Modo (atalho) | Centro | Lista | Propriedades | Aba do modo no painel inferior |
|---|---|---|---|---|
| Código (Alt+1) | Editor de texto com abas | Arquivos, busca e Git no painel lateral | — | — |
| Mapas (Alt+2) | Editor de mapas | Kits, tilesets e objetos no próprio editor | Propriedades do mapa/objeto | Áudio (músicas, efeitos, música por sala) |
| Personagens (Alt+3) | Folha de sprites e prévia | Movimentos | Recorte, corpo, ataque, comportamento | Linha do tempo do movimento |
| Cenas (Alt+4) | Roteiro e mapa da cena | Cenas do projeto | Inspetor do passo | Áudio |
| Executar (Alt+5) | Construir e jogar: pendências, último jogo compilado, problemas | — | — | Diagnóstico em jogo |

Regras do desenho:

- **Construir, Jogar e Parar** ficam na barra de trabalho em todos os modos, com o progresso ao
  lado. Um build que falha encerra o estado “em andamento”; enquanto o emulador está aberto o
  modo Executar mostra “Jogo em execução no emulador”.
- **Painel inferior** é um só, redimensionável e recolhível. Terminal e Problemas existem em
  todos os modos; a terceira aba muda com o modo. A aba escolhida em cada modo é guardada com
  o layout do projeto. Erros de build abrem o painel em Problemas; avisos de um build que deu
  certo ficam listados sem roubar a aba. Abrir o terminal (botão, Ctrl+`, paleta ou um comando
  enviado pelo assistente) mostra a aba Terminal. Setas, Home e End trocam de aba pelo teclado.
- **Editores no painel inferior** (Áudio, Diagnóstico) são os mesmos de Recursos → Runtime.
  Escondidos, param a prévia de som; ao reaparecerem sem alterações, releem o arquivo.
  Alterações não exportadas impedem trocar de projeto ou fechar a janela até serem exportadas
  ou descartadas, e ficam guardadas como rascunho (issue #52).
- **Atalhos de modo**: Alt+1…5 (Ctrl+1…5 no macOS), anunciados nos botões. Não agem com um
  diálogo modal aberto nem com o foco no terminal.
- **Tema**: embutido no workspace, o editor de personagens usa as cores da IDE; aberto como
  janela própria, mantém as cores originais.
- **Textos**: barra, painel inferior e modo Executar estão nos quatro idiomas da IDE. Os
  editores de autoria (mapas, personagens, cenas, áudio…) continuam em português.
- **Lista e propriedades** de cada domínio continuam dentro do editor do modo (não há um
  inspetor único entre domínios nesta etapa; ver limites).
- **Painéis** lateral, inferior e de IA são recolhíveis/redimensionáveis, com estado por
  projeto e “Restaurar layout do projeto”.
- **Estados vazios e de erro** dizem o que fazer (“Ainda não há ROM neste projeto. Use
  Construir.”, “Abra um personagem e escolha um movimento…”).
- **Git, IA e terminal** permanecem onde estavam; nada deles foi removido.

### Fluxo de referência

Criar projeto → Código (editar e salvar) → Construir → Executar (pendências, ROM, problemas)
→ corrigir pelo link do problema → Jogar → Parar. O fluxo foi executado na IDE Electron real
(instância isolada) com `scripts/inspect-electron.sh` e os passos de
`scripts/electron-reference-flow.steps.mjs`: projeto inicial criado pelo modal, `src/main.c`
editado no editor e salvo com Ctrl+S, ROM de 640 KiB construída, erro proposital listado em
Problemas e aberto pelo link, build corrigido, jogo inicial exibido no Genesis Plus GX e
encerrado com Parar. A verificação achou e corrigiu: build com erro que deixava a barra
presa em “Em andamento…”, ROM e registros de um modelo já compilado copiados para o projeto
novo, erro de clonagem ao salvar o inventário e o estado “Pronto” com o emulador aberto.

### Limites desta etapa

- Não há inspetor único entre domínios: cada editor mantém a própria lista e as próprias
  propriedades, em colunas de largura fixa (só os painéis lateral, inferior e de IA são
  redimensionáveis e guardados por projeto). O modo ativo não é guardado: um projeto abre em
  Código.
- Com o emulador aberto, trocar de projeto não o encerra; use Parar antes. Um emulador que se
  desprende do processo que o iniciou aparece como “Pronto”. A aba “Áudio” hospeda o editor de áudio inteiro, não um mixer resumido.
- O campo de pasta do “Novo projeto” e “Abrir pasta” usam o seletor nativo; na verificação
  automática o caminho foi preenchido direto no campo.
- Layout verificado em 1440×900 no Linux (Xvfb). Windows, macOS, telas pequenas, leitor de
  tela e temas claros não foram exercitados.
- A linha do tempo no painel inferior usa o espaço disponível do painel; com o painel baixo é
  preciso rolar.

Com um projeto aberto, a barra sob o título oferece os modos **Código**, **Mapas**,
**Personagens**, **Cenas** e **Executar**, o atalho **Recursos**, as ações **Construir**,
**Jogar** e **Parar**, os controles dos painéis e **Restaurar layout do projeto**. Os comandos usam as ações existentes da IDE;
Mapas abre o editor na área central. Os controles retro ficam desabilitados
em pastas sem projeto retro. Parar usa o processo de build/emulador da própria
IDE, inclusive depois que a compilação termina; não encerra processos externos.

O progresso de build fica na barra. O overlay de empacotamento e as entradas
existentes de menus, Git, IA e terminal são preservados. Os cinco modos ocupam a área
central; o que ainda não foi unificado está em “Limites desta etapa”, acima.

## Personagens na área central

**Personagens** abre o Charset Maker no workspace, com movimentos à esquerda,
folha de sprites/prévia/timeline ao centro e propriedades à direita. O botão
Charset Maker em Recursos encaminha para essa mesma área; o modal permanece
disponível para hosts sem o workspace integrado. A barra indica o modo ativo, e todos os
modos podem ser abertos pela paleta de comandos ou por Alt+1…5 (Ctrl+1…5 no macOS).

Alternar para Código mantém o editor de personagens montado e suspende sua
reprodução. Todos os modos compartilham o painel inferior; em Personagens a aba do modo é a
linha do tempo do movimento selecionado.
Ctrl+S, o botão Salvar da barra e Salvar na paleta atuam no editor atual. Salvar Tudo na
paleta salva o personagem aberto antes dos arquivos de código e para se o
personagem não puder ser salvo. Exportar atualiza Recursos e a árvore do projeto.
O botão Salvar também fica disponível no modo Personagens sem abas de código
alteradas. Ctrl+F e Buscar na paleta/menu focam o filtro de movimentos; entrar
no modo Personagens também coloca o foco nesse filtro.

Antes de trocar de projeto, a IDE salva o personagem atual e bloqueia a troca
durante carregamento/exportação ou se o salvamento falhar. A seleção de pasta
apenas escolhe o destino; a ativação ocorre depois desse salvamento. Os controles
do personagem ficam bloqueados durante a troca, e pedidos concorrentes são
recusados. Falhas liberam a edição do projeto anterior. O botão de fechar a
janela também verifica o salvamento. Encerramento externo, crash e recuperação
durável continuam no escopo da issue #52.

## Mapas na área central

Alternar entre Código, Mapas e Personagens preserva os editores montados; a prévia
e a música dos mapas param quando o modo fica oculto. Salvar atua no modo atual;
Salvar Tudo verifica os dois editores antes dos arquivos de código. O estado
do editor informa `mapDirty`, `loadingMap` e `selectingMapPath`, e Salvar /
Salvar como retornam sucesso ou falha. A comparação de alterações usa a mesma
serialização TMX da gravação, incluindo colisões, objetos, camadas e atributos;
tempo de animação da prévia não conta como edição.

Carga e gravação bloqueiam a interação, inclusive nos editores de kit/cenas.
Gestos de arraste pendentes são cancelados antes da operação; soltar o mouse
depois não aplica uma seleção ou objeto antigo ao mapa carregado.
Uma abertura concorrente ou um resultado tardio do seletor não troca o caminho
durante outra carga/gravação. Falha de escrita mantém o nome e a referência salva
anteriores; falha de exportação permanece no diagnóstico e retorna falha ao
chamador, mesmo que o TMX tenha sido gravado. Mapas existentes continuam salváveis
depois de remover a última imagem. Importações JSON seguem para Salvar como em
TMX, sem gravar XML automaticamente no JSON original.

Trocar de projeto ou fechar a janela verifica os dois editores. Kits em
edição e rascunhos de objetos/peças pendentes impedem a troca; conclua e salve
essas edições no kit. Cenas e vocabulário no host central são salvos pelo guard;
falhas de escrita/compilação impedem a troca. Falha no mapa libera o
personagem já preparado para continuar editando. Respostas atrasadas de outro
projeto não substituem a configuração ou abrem mapas na nova raiz. Hosts fora
do workspace integrado continuam usando a janela dedicada.

## Layout por projeto

Visibilidade e tamanho de sidebar, terminal e IA são guardados por caminho do
workspace no armazenamento local da IDE (`retro-studio.workspace-layouts.v1`).
Nenhum arquivo do jogo é criado/modificado. Preferências globais existentes
servem de padrão para projetos sem layout salvo. Restaurar layout volta a esse
padrão e salva o resultado apenas para o projeto atual.

As medidas são limitadas: sidebar 180–600 px, terminal 100–600 px e IA
300–800 px. São mantidos até 100 projetos/128 KiB de preferências. Configurações
inválidas usam padrões; indisponibilidade do armazenamento mantém os layouts
somente na memória da janela. O caminho do projeto é a identidade do layout;
renomear/mover o projeto cria uma entrada diferente.

Recolher a sidebar usa `v-show`, preservando seus formulários. Terminal e ACP
montam no primeiro uso e permanecem montados ao esconder o dock. Isso evita
destruir sessões de terminal, parar a sessão de IA ou perder o prompt local.
ACP recebe a visibilidade real para suspender foco/menus/polling visual. Ao
fechar a aplicação, o cleanup normal dos componentes continua funcionando.
Trocar de workspace recria o host ACP e encerra a sessão do projeto anterior;
rascunhos de prompts ficam separados por projeto na memória (até 50 entradas).
O processo principal valida o workspace da sessão antes de enviar um prompt.
Limpeza atrasada de um painel antigo só encerra uma sessão do mesmo workspace;
callbacks de preferências/autenticação não reiniciam um painel já desmontado.
Essa persistência de componentes não é recuperação durável de prompts ou
comandos após encerrar a aplicação (issue #52).

## Verificação e trabalho restante

`node scripts/smoke-workspace-layout.mjs` verifica o composable real em Vue:
troca de projeto, restauração, defaults após settings, limites, reset,
persistência e fallback. As verificações de `v-show` e colunas são estáticas;
não comprovam apresentação visual, processo PTY ou sessão ACP externa.
O teste compila o script real do ACP em um host Vue mínimo e verifica que
respostas de preferências após desmontagem não iniciam sessões nem reinscrevem
eventos. Também executa o guard de prompt com workspaces diferentes e a fila
real do manager com clientes simulados: limpeza de A não encerra B.
O smoke ACP existente passou com OpenCode real em pasta temporária:
initialize, nova sessão, prompt, escrita confinada e rejeição fora da pasta.
Isso verifica o cliente/provedor disponível, sem validar visualmente a troca
de docks nem afirmar suporte testado de outros provedores nesta entrega.
Build e suíte de autoria também devem passar após alterações.

`node scripts/smoke-character-workspace.mjs` executa o guard de salvamento,
o composable de troca de projeto, o picker real com diálogo simulado e os
comandos da paleta. Cobre falha/exportação em curso, bloqueio durante save,
concorrência, Salvar Tudo e preservação da raiz anterior. Checks de embedding,
montagem e indicação do modo são estáticos; não substituem inspeção visual.

A interface foi inspecionada na IDE Electron real (ver “Fluxo de referência”). O que continua
fora desta etapa está em “Limites desta etapa”.

`smoke-map-workspace.mjs` cobre respostas/configurações obsoletas com Vue real,
roteamento central e guards de rascunhos/salvamento. Não comprova apresentação
visual ou foco na janela Electron.

## Cenas na área central

Cenas abre a lista do projeto, roteiro/ramificações e inspector existentes no
mesmo host de Mapas. A prévia, vocabulário e diagnóstico do runtime permanecem
em abas. A janela modal continua disponível para hosts nativos antigos.
Escolher uma posição mostra o mapa e retorna ao roteiro após clique/cancelar.
Fechar Cenas retorna a Mapas; trocar modo preserva os rascunhos e para a prévia.
Ctrl+S/Salvar usa cena/vocabulário; Salvar Tudo verifica também esses dados.
Abertura, criação, salvamento e recompilação são serializados. Cenas não usa os
atalhos de pintura do mapa enquanto o roteiro está visível. O foco é solicitado
após o carregamento e somente se o modo continuar ativo.

A baseline da cena corresponde ao JSON efetivamente gravado. Edição programática
durante uma gravação não fica marcada como salva nem é publicada nos headers.
Falha de compilação retorna falso e exige correção/recompilação antes da saída.
Os dois headers e seu registro são publicados pela mesma transação, com
rollback em falha e journal para recuperação. Renames múltiplos não equivalem
a uma única operação atômica do filesystem; builds externos devem aguardar
a conclusão e respeitar o lock de exportação.
Os testes executam o composable real com arquivos temporários, operações
adiadas, falhas de disco, compilação inválida e SSR do modal/host central.
SSR não comprova layout, navegação por teclado ou foco no Electron real.

## Publicação das cenas

A IDE compila as fontes salvas no processo principal, pelo IPC restrito
`tilemap:export-cutscenes` (`prepare`/`publish`, raiz igual ao workspace atual).
O renderer não envia conteúdo de headers. `prepare` reconhece somente saídas
legadas exatamente iguais à compilação das fontes atuais, antes de alterá-las.
Headers sem esse vínculo ou modificados externamente são preservados.
Fontes inválidas sem saídas geradas podem ser reparadas pelo salvamento; isso
não concede propriedade sobre headers existentes.

O registro `.retrostudio/cutscene-export.json` guarda versão, gerador,
fontes/hashes e dois headers/hashes. As saídas devem ser `.h` sob `src/`, com
caminhos diferentes. Mudanças de caminho removem somente saídas registradas
que continuam iguais ao hash original. Fontes/catalogo são revalidados durante
a publicação; alteração externa aborta e restaura os outputs já publicados.
Saídas idênticas não são regravadas. Limites: 64 cenas, 512 entradas, profundidade
16, 2 MiB por fonte e 8 MiB no total; links simbólicos não são fontes aceitas.

O rodapé informa publicação desconhecida, rascunhos pendentes, falha ou última
publicação concluída. Este último estado não é monitoramento contínuo de
alterações externas. O CLI distribuído `tools/compile-cutscenes.mjs` usa a mesma
implementação de publicação da IDE; `--check` valida sem escrever. O runtime
v2 instala os módulos portáveis e preserva a configuração. Ferramentas alteradas
ganham backup ao atualizar. Headers legados divergentes exigem reconciliação
explícita; não são adotados pelo marker.

O Makefile do skeleton gera mapas/cenas antes de iniciar um único make filho
com todos os objetivos solicitados. Os objetos dependem do ledger de cenas e
dos headers/recursos gerados do mapa, inclusive em SGDK sem inclusão de `.d`.
Exige Node (`NODE` pode definir o executável). Makefiles e exportadores
customizados de projetos existentes não são reescritos automaticamente;
a integração desses caminhos continua pendente em #46. O exportador de mapas
invocado diretamente no terminal ainda não usa a transação de staging da IDE.

Conflitos de adoção/publicação não impedem gravar o JSON de autoria: o fonte
fica salvo, os headers manuais permanecem intactos e a exportação retorna falha.
O guard de troca continua exigindo resolver a publicação antes de sair.

## Uma barra só (issue #67)

A barra de modos mora dentro da barra principal da janela; não há segunda linha.

- **À esquerda**: controles da janela, novo projeto, abrir pasta.
- **No meio** (com um projeto aberto): nome do projeto · modos (Código, Mapas, Personagens,
  Cenas, Executar) e Recursos · Construir, Jogar, Parar · painel lateral, painel inferior, IA,
  restaurar layout.
- **À direita**: ajuda, atualizações, paleta de comandos, busca, salvar, emulador, empacotar,
  cartucho, conta.
- Cada ação aparece uma vez e cada ícone tem um significado só (Executar é um controle de
  jogo, o chip é do cartucho; Personagens é um boneco de corpo inteiro, a conta é um boneco em
  um círculo; restaurar layout não usa as setas circulares das atualizações).
- Janela estreita: somem primeiro os rótulos de Construir/Jogar/Parar (abaixo de 1700 px),
  depois os dos modos, menos o do modo atual (1515 px), depois o nome do projeto (1280 px) e os
  rótulos restantes (1180 px). Nenhum botão some: ficam o ícone, a dica e o nome acessível;
  abaixo de cerca de 1100 px o que não couber rola na horizontal.
- Sem projeto aberto, o meio mostra o título da janela e terminal e IA aparecem à esquerda.
- Construir, terminal e os modos continuam com atalho de teclado e na paleta de comandos.
