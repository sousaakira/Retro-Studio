# API de controle do Retro Studio por IA

Proposta aprovada em 15/10/2026 (issue #77). Status: **fase 1 implementada**; fases 2 a 4 pendentes.

## Fase 1 — o que existe

| Arquivo | Papel |
|---------|-------|
| `electron/control/commands.js` | Camada única de comandos (sem Electron): nome, descrição, tipo, schema, quem usa (`acp`, `internal`) e `run` |
| `electron/control/server.js` | Socket local: `~/.retrostudio/run/control-<pid>.sock` (pasta `0700`, socket `0600`; com HOME longo, pasta privada em `/tmp/retro-studio-<uid>/`), token por sessão ACP, recusa se o projeto aberto mudar |
| `electron/control/mcp-bridge.mjs` | Servidor MCP `retro-studio` sem estado; o agente o inicia com o executável do Retro Studio e `ELECTRON_RUN_AS_NODE=1`. Fica fora do `app.asar` (`asarUnpack`) |
| `electron/control/index.js` | Liga tudo no processo principal: sobe o socket, registra a fábrica do MCP no `acpSessionManager` e as tools extras do agente interno |
| `scripts/smoke-control-api.mjs` | Teste na bateria (`control-api`) com a ponte MCP real em processo filho |

Comandos (nomes com `_`, exigência do MCP: `^[a-zA-Z0-9_-]{1,64}$`):

| Comando | Tipo | Agentes ACP | Agente interno |
|---------|------|-------------|----------------|
| `project_info` | read | sim | sim |
| `project_tree` | read | sim | não (já tem `list_directory`) |
| `file_read` | read | sim | não (já tem `read_file`) |
| `ide_state` | read | sim | sim |
| `ide_notifications` | read | sim | sim |
| `ide_screenshot` | read | sim | não (imagem) |
| `build_run` | write | sim | não (já tem `build_rom`) |
| `build_errors` | read | sim | sim |
| `build_rom`, `run_emulator` | write | sim (nomes da versão 0.8) | já existiam |
| `music_guide` | read | sim | sim |
| `music_list` | read | sim | sim |
| `music_read` | read | sim | sim |
| `music_write` | write | sim | sim |
| `music_open` | write | sim | sim |

Comandos `music_*` (issue #89): a IA compõe para o modo Música em tempos e nomes de nota (`shared/retro/songAuthoring.js`), recebe a análise do que o YM2612/PSG consegue tocar e pode exportar para o jogo. Substituir uma música exige a revisão lida em `music_read`; o editor aberto recarrega só se não tiver alterações. Detalhes em `docs/COMPOSITOR.md`.

O registro `.retrostudio/last-acp-build.json` (lido pelo painel ACP) continua sendo gravado por `build_run`/`build_rom`/`run_emulator`. Permissão de escrita nesta fase: o build só grava na pasta de saída, e os agentes (Claude, Codex) já pedem aprovação para ferramentas MCP conforme a configuração de cada um; a confirmação própria da IDE entra com os comandos de edição (fase 3).

Verificado na IDE real e no pacote (`electron-builder --dir`) com um agente ACP falso que inicia o MCP recebido no `session/new` e usa todas as ferramentas, incluindo build real de um projeto.

## Objetivo

Permitir que um agente de IA (o agente interno ou um agente externo via ACP — Codex, Claude, OpenCode) **use o Retro Studio como uma pessoa usa**: abrir o projeto, editar mapas, personagens e cenas, compilar, rodar o jogo, olhar a tela e apertar botões — e não só editar arquivos de texto.

O ganho principal é o ciclo fechado: a IA muda algo, compila, joga, confere a tela e corrige, sem o usuário servir de intermediário.

## Situação atual

| Peça | Onde | O que faz | Limitação |
|------|------|-----------|-----------|
| Ferramentas do agente interno | `electron/ai/tools.js` | ~30 ferramentas: arquivos, busca, terminal, git, `build_rom`, `run_emulator`, `create_project`, `list_assets` | Só vale para o agente interno; não mexe nos editores |
| Servidor MCP para agentes ACP | `scripts/retro-studio-mcp.mjs`, registrado em `electron/ai/acp/manager.js` (`buildRetroMcpServers`) | `build_rom`, `run_emulator` | Processo separado, sem contato com a IDE aberta |
| IPC da IDE | `electron/main.js` e módulos em `electron/retro/` | ~140 canais `retro:*`, 22 `tilemap:*`, 20 `fs:*` etc. | Feitos para a interface, não expostos a agentes |
| Captura do emulador | `scripts/capture-rom.sh` | Roda a ROM sob Xvfb, envia teclas (`xdotool`) e salva telas (`import`) | Ferramenta de desenvolvimento; verificada com Genesis Plus GX (`gen_sdl2`) |

### Defeito encontrado: o MCP não existe na versão instalada

`MCP_SCRIPT` aponta para `scripts/retro-studio-mcp.mjs` relativo à raiz do repositório. No pacote:

- `scripts/` não está em `build.files` do `package.json`, então o arquivo não é empacotado;
- mesmo empacotado, o `node` do sistema não executa arquivos dentro do `app.asar`.

Resultado: `existsSync(MCP_SCRIPT)` é falso e os agentes ACP iniciam **sem** as ferramentas do Retro Studio na versão instalada. A fase 1 corrige isso.

## Arquitetura

```text
 Agente ACP (Codex/Claude/OpenCode)        Agente interno (electron/ai)
        │ stdio (MCP)                                │ chamada direta
        ▼                                            ▼
 electron/control/mcp-bridge.mjs  ── socket local ──►  Camada de comandos (processo principal)
 (processo filho, sem estado)        + token             electron/control/commands/*.js
                                                          │
                                       ┌──────────────────┼────────────────────┐
                                       ▼                  ▼                    ▼
                               módulos electron/retro  renderer (editores)  emulador
                               (build, export, fs)     via IPC request/reply  (janela X11)
```

### 1. Camada única de comandos

Cada comando é um módulo com:

- `name` (ex.: `map.setTiles`), `description` em pt-BR;
- `input`/`output` em JSON Schema (o mesmo formato do MCP);
- `kind`: `read`, `write` ou `destructive`;
- `run(args, context)`, que chama o código que a interface já usa — nada de lógica duplicada;
- `dryRun(args, context)` para comandos de escrita: devolve o que mudaria sem gravar.

O agente interno e o MCP leem **a mesma lista**. `electron/ai/tools.js` passa a ser montado a partir dela (as ferramentas atuais migram aos poucos, mantendo os nomes antigos como apelidos durante a transição).

### 2. Ponte com a IDE aberta

O MCP continua sendo um processo filho iniciado pelo agente (é assim que o ACP funciona), mas vira só uma ponte:

- a IDE abre um socket Unix em `~/.retrostudio/run/control-<pid>.sock` com permissão `0600`;
- cada sessão ACP recebe um token aleatório por variável de ambiente; sem o token correto a conexão é recusada;
- o socket só aceita comandos do workspace aberto naquela janela;
- o token nunca é registrado em log.

Para rodar fora do `asar`, a ponte vai para `electron/control/` com `asarUnpack` e é iniciada com `process.execPath` + `ELECTRON_RUN_AS_NODE=1` — assim não depende de existir `node` no PATH do usuário.

### 3. Comandos que dependem da interface

Mapas, personagens e cenas têm estado vivo no renderer (seleção, desfazer, alterações ainda não salvas). Esses comandos fazem um pedido/resposta ao renderer pelo IPC, para que a edição:

- entre no histórico de desfazer do editor;
- apareça na tela na hora;
- não sobrescreva alterações não salvas do usuário.

Quando o editor correspondente não está aberto, o comando trabalha direto no arquivo, com as mesmas validações e `.bak-*` que a interface usa.

## Catálogo de comandos

Nomes provisórios das fases seguintes; na implementação o ponto vira `_` (ex.: `map.setTiles` → `map_set_tiles`), e o formato exato de cada um é definido junto com o teste.

### Projeto e IDE (fase 1)

| Comando | Tipo | Descrição |
|---------|------|-----------|
| `project.info` | read | Workspace aberto, versão do projeto, toolkit, kit/runtime instalado |
| `project.tree` | read | Árvore de arquivos (ignorando `out/`, `.git/`) |
| `file.read` / `file.write` / `file.patch` | read/write | Equivalentes às ferramentas atuais, com caminho confinado ao workspace |
| `ide.state` | read | Editor ativo, arquivo aberto, alterações não salvas |
| `ide.open` | write | Abre arquivo, mapa, personagem ou cena no editor certo |
| `ide.screenshot` | read | PNG da janela da IDE |
| `ide.notifications` | read | Avisos, erros e toasts mostrados recentemente |

### Jogo e emulador (fase 2)

| Comando | Tipo | Descrição |
|---------|------|-----------|
| `build.run` | write | Compila; devolve ROM, tempo e erros estruturados (arquivo, linha, mensagem) |
| `build.errors` | read | Erros do último build |
| `game.start` / `game.stop` | write | Roda a ROM no emulador configurado, em sessão controlada |
| `game.screenshot` | read | PNG da tela do jogo |
| `game.input` | write | Sequência de botões do controle (cima, baixo, A, B, C, Start) com duração |
| `game.script` | write | Roteiro: esperar, apertar, capturar — devolve as capturas |
| `game.report` | read | Relatório de hardware/limites já gerado pela IDE (VRAM, sprites, DMA) |

Modo padrão: emulador sob Xvfb invisível, como em `scripts/capture-rom.sh`, para a IA não roubar o foco do usuário. Opção de rodar na tela quando o usuário pedir. Leitura de memória/RAM do jogo fica fora até verificarmos o suporte no emulador.

### Mapas (fase 3)

| Comando | Tipo | Descrição |
|---------|------|-----------|
| `map.list` / `map.read` | read | Mapas do projeto; camadas, dimensões, tilesets, objetos, propriedades |
| `map.setTiles` | write | Pinta região/lista de células numa camada |
| `map.objects` | write | Cria, move e remove objetos, gatilhos, spawn e pontos |
| `map.properties` | write | Música (`retroStudio.musicTrack`), deslocamento de camadas etc. |
| `map.export` | write | Exporta para o jogo (mesmo caminho do "exportar ao salvar") |
| `map.render` | read | PNG do mapa com camadas escolhidas |

### Personagens (fase 3)

| Comando | Tipo | Descrição |
|---------|------|-----------|
| `character.list` / `character.read` | read | Personagens em `charsets/` e suas animações |
| `character.create` | write | Novo personagem a partir de uma folha do projeto |
| `character.animations` | write | Cria/edita animações: recortes, quadros, tempos, apoio, caixas |
| `character.export` | write | Exporta para o SGDK (folha, `.res`, cabeçalho) |
| `character.preview` | read | PNG/GIF de uma animação |

### Cenas (fase 3)

| Comando | Tipo | Descrição |
|---------|------|-----------|
| `scene.list` / `scene.read` | read | Cenas e passos |
| `scene.edit` | write | Adiciona, altera e reordena passos, rotas e encerramento |
| `scene.compile` | write | Compila para bytecode e informa erros |
| `scene.preview` | read | Quadros da prévia (`cutscenePreview.js`) |

### Recursos (fase 3)

| Comando | Tipo | Descrição |
|---------|------|-----------|
| `asset.import` | write | Importa imagem para `res/` |
| `asset.convert` | write | Converte para paleta/limites do Mega Drive, com relatório |
| `asset.register` | write | Registra no `resources.res` |

## Regras de segurança

1. **Confinamento:** todo caminho passa por `assertPathInsideWorkspace` (com `realpath`); nada fora do workspace aberto.
2. **Permissão:** comandos `write` seguem a política de permissões do agente (o fluxo `acp:permission` que já existe); comandos `destructive` (apagar, sobrescrever exportação, `git` destrutivo) **sempre** pedem confirmação na interface.
3. **Simulação:** todo `write` aceita `dryRun: true`.
4. **Edição concorrente:** se o arquivo tem alterações não salvas na tela, o comando recusa e explica, a menos que vá pelo editor (que integra ao desfazer).
5. **Backups:** gravações em arquivos de projeto reutilizam o `.bak-*` e as transações de exportação já existentes (`docs/EXPORT_TRANSACTIONS.md`).
6. **Socket:** `0600`, token por sessão, um socket por janela, apagado ao fechar; nenhum token ou segredo em log.
7. **Limites:** tamanho máximo de entrada/saída por comando, tempo máximo por chamada, quantidade máxima de capturas por roteiro.
8. **Sem dependências novas** sem autorização: o MCP continua com o JSON-RPC escrito à mão que já existe em `scripts/retro-studio-mcp.mjs`; Xvfb, `xdotool` e `import` são ferramentas do sistema, detectadas em tempo de execução, com mensagem clara quando faltarem.

## Fases

### Fase 1 — fundação

- Mover o servidor MCP para `electron/control/`, empacotar (`asarUnpack`) e iniciar com `ELECTRON_RUN_AS_NODE`.
- Camada de comandos + socket com token.
- Comandos de projeto e IDE (leitura) e `build.run`/`build.errors`.
- `tools.js` passa a ler a camada para os comandos migrados.
- Testes: smoke do protocolo MCP (`initialize`, `tools/list`, `tools/call`), recusa sem token, recusa fora do workspace, e verificação no **pacote instalado** (não só em dev).

### Fase 2 — ciclo do jogo

- `game.*` sobre Xvfb + `xdotool` + `import` (já verificado com `gen_sdl2`).
- Teste: ROM de diagnóstico temporária (nunca ROM original), roteiro de botões, comparação de capturas.

### Fase 3 — editores

- Mapas, personagens, cenas e recursos, um domínio por PR, cada um com dry-run, integração ao desfazer e smoke próprio na bateria (`scripts/run-authoring-regressions.mjs`).

### Fase 4 — documentação

- Guia de uso para o usuário e referência gerada a partir dos schemas.

## Fora do escopo (por ora)

- Acesso remoto (rede); o socket é só local.
- Leitura/escrita de RAM do jogo e depuração passo a passo no emulador.
- Wayland: o controle do emulador depende de X11/Xvfb; em Wayland o modo invisível sob Xvfb continua funcionando, o modo na tela não.

## Questões em aberto

- Se o agente deve poder abrir/fechar workspaces ou só trabalhar no que está aberto (proposta: só no aberto).
- Nível de permissão padrão para `write` em agentes externos (proposta: perguntar uma vez por sessão por domínio).
