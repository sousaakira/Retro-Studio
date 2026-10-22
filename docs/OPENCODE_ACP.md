# Agentes ACP no Retro Studio

Integração com o [Agent Client Protocol](https://agentclientprotocol.com) (mesmo mecanismo do Zed Agent Panel).

## Provedores suportados

### OpenCode

- OpenCode CLI instalado (`opencode --version`)
- Auth do OpenCode já configurada (`opencode auth login` se necessário)

### Codex

- Codex ACP instalado globalmente: `npm install -g @agentclientprotocol/codex-acp`
- O Retro Studio detecta `codex-acp` no `PATH`; também é possível informar o caminho nas configurações ⚙ do painel.
- Aberta pelo menu do sistema (AppImage, .deb, atalho), a IDE não herda o `PATH` do terminal. Por isso, ao iniciar, ela lê o `PATH` do seu shell de login (`$SHELL -ilc`) e acrescenta as pastas comuns de comandos globais (`~/.asdf/shims`, mise, Volta, nvm, `~/.npm-global/bin`, `~/.local/bin`, `~/.bun/bin`, `/usr/local/bin`). Assim `codex-acp`, `claude-agent-acp`, `claude` e `node` instalados por asdf, nvm ou npm global são encontrados sem configurar caminho (`electron/shellPath.js`).
- Se o adaptador não for encontrado, o painel mostra o comando de instalação, permite copiá-lo e oferece nova verificação após a instalação. A IDE não instala o pacote automaticamente.
- Login iniciado pelo botão de autenticação do painel, usando o método ACP anunciado pelo adaptador. Alternativamente, configure a autenticação do Codex CLI antes de abrir o painel.
- O pacote é executado como programa externo. O Retro Studio não baixa nem instala o adaptador automaticamente.

O adaptador `@agentclientprotocol/codex-acp` tem licença Apache-2.0 e anuncia suporte a sessões, permissões, ferramentas MCP, alterações de arquivos e autenticação ChatGPT/API key. Alguns detalhes dependem da versão instalada do adaptador.

## Uso

1. Abrir o painel **IA** (`Ctrl+L`)
2. Escolher OpenCode ou Codex em ⚙ (sessões isoladas por projeto e agente)
3. Conversar no painel ACP (modelos/modos no rodapé)

### Imagens e capturas de tela

Com um agente que anuncie `agentCapabilities.promptCapabilities.image: true`,
copie uma captura de tela pelo sistema e cole no campo da mensagem com **Ctrl+V**
(**⌘V** no macOS). Também é possível usar o botão **Anexar imagem** para selecionar
arquivos PNG, JPEG ou WebP. Texto colado continua funcionando normalmente.

As miniaturas aparecem antes do envio: clique para ampliar ou use **×** para
remover. É possível enviar somente a imagem ou escrever uma instrução junto.
São permitidas até quatro imagens por mensagem, com até 8 MiB por imagem,
20 MiB no total e 40 megapixels por imagem. Se o envio falhar, o texto e os
anexos continuam disponíveis para tentar novamente.

O suporte é consultado no handshake ACP, sem presumir capacidades pelo nome
do provedor. Sem essa capacidade anunciada, o painel informa a limitação e o
cliente bloqueia imagens antes de chamar `session/prompt`. O modelo escolhido
no agente também precisa aceitar imagens; rejeições do provedor aparecem no chat.

Os anexos seguem como blocos `image` com `mimeType` e `data` em base64, junto
com o texto e os chips de contexto. As imagens pendentes ficam na memória do
painel; o Retro Studio não grava os prints no projeto nem no rascunho de texto.
Trocar de projeto ou fechar a IDE descarta anexos ainda não enviados.
O agente externo pode manter as imagens enviadas no próprio histórico e
encaminhá-las ao provedor configurado. Na retomada, o painel exibe os blocos de
imagem que o agente devolver pelo replay da sessão.

Contrato: [ACP v1 — Image Content](https://agentclientprotocol.com/protocol/v1/content#image-content).

O caminho do binário OpenCode pode ser definido em **⚙** no header do painel.

## Arquitetura

```text
Renderer (AcpAgentPanel.vue)
    ↓ IPC acp:*
    Main (acpSessionManager)
    ↓ spawn
opencode acp ou codex-acp  ←→  NDJSON JSON-RPC (AcpClient.js)
    ↓ mcpServers
<executável do Retro Studio> electron/control/mcp-bridge.mjs   (ELECTRON_RUN_AS_NODE=1)
    ↓ socket local + token da sessão
Main (electron/control: camada de comandos da API de controle)
```

Métodos suportados no cliente:

- Agent: `initialize`, `session/new`, `session/list`, `session/load`, `session/resume`, `session/prompt`, `session/cancel`, `session/close`, `session/set_config_option`
- Client: `fs/read_text_file`, `fs/write_text_file`, `session/request_permission`

## Sessões por projeto (game)

Ao abrir o painel IA:

1. Cria uma conversa nova (`session/new`). Retomar a anterior faria o agente reler todo o
   histórico a cada mensagem, o que gasta muito mais tokens.
2. Lista as sessões do agente selecionado para o `cwd` do workspace (`session/list`); as
   conversas antigas continuam no seletor e reabrem com `session/load` (histórico no chat).

A última sessão usada fica em `aiTerminal.acp.sessionsByWorkspace[cwd]`; o **↻** a recarrega.

Na UI:

- Seletor de sessões do projeto
- **＋** nova sessão
- **↻** reinicia o processo ACP e **recarrega a mesma sessão**

## Review de writes no Monaco

Quando o agente grava um arquivo (`fs/write_text_file`):

1. O conteúdo anterior é capturado (disco / override do editor)
2. O write é aplicado no disco
3. A UI abre o arquivo, destaca linhas **novas/alteradas** (glyph `+`, overview) e mostra banner **Aceitar / Rejeitar** (+/− stats)
4. **Aceitar** mantém o arquivo (já no disco)
5. **Rejeitar** restaura o conteúdo anterior (ou apaga se o arquivo era novo)

Vários writes em sequência entram em fila; Enter/Esc no editor aceitam/rejeitam (não roubam Enter do composer do painel).

## Permissões

`session/request_permission` mostra banner com:

- Tipo da ferramenta (read/edit/execute/…)
- Título e arquivos afetados
- Botões i18n: **Permitir uma vez**, **Permitir sempre**, **Negar**, **Negar sempre**

**Permitir/Negar sempre** fica na memória da sessão e auto-responde pedidos parecidos. Cancelar o turno resolve as permissões pendentes como `cancelled`. Timeout (5 minutos) não auto-aprova.

- **Pedidos simultâneos:** quando o agente pede várias permissões ao mesmo tempo, elas aparecem uma de cada vez, e cada clique responde ao pedido mostrado. Antes, o segundo pedido apagava o primeiro, que ficava sem resposta, e o agente esperava até o fim do prazo.
- **Pedido expirado:** sai da tela com um aviso.
- **Resposta que não chega ao agente:** vira aviso no chat.
- **Pedido número 0:** o SDK do Claude ACP numera os pedidos a partir de 0, e o clique no primeiro pedido de cada conversa era ignorado (o painel tratava 0 como "sem pedido"). Teste: `smoke-acp-permissions`.

## Build / Play (UI + agente)

- Chat: comandos `/build`, `/play` e `/stop`.
- Agente: MCP `retro-studio` injetado em `session/new|load|resume`. É a ponte da API de controle (`docs/API-CONTROLE-IA.md`): `build_run`, `build_errors`, `run_emulator`, `ide_state`, `ide_screenshot`, `ide_notifications`, `project_info`, `project_tree`, `file_read`, `map_notes`, `map_note_image`, `map_note_update` (e `build_rom`, nome antigo de `build_run`). Roda com o próprio executável do Retro Studio, então funciona na versão instalada sem `node` no PATH. `scripts/retro-studio-mcp.mjs` só é usado se a API de controle não subir (modo dev)
- Resultado MCP em `.retrostudio/last-acp-build.json` → chat; erros clicáveis alimentam o painel de compilação

## Limitações atuais

- Sem `terminal/*` ACP (shell fica a cargo do OpenCode; preferir MCP `build_run` para SGDK)
- Writes do agente vão ao disco imediatamente; Accept/Reject restaura o conteúdo anterior
- Root de FS do ACP = workspace aberto na IDE (não CWD do terminal)

## Autenticação

Ao abrir o painel, a IDE verifica credenciais do provedor selecionado sem ler/expor tokens ao renderer.

- OpenCode: procura `auth.json` no data dir XDG e oferece `opencode auth login` no terminal.
- Codex: verifica a existência de `~/.codex/auth.json` ou variável de ambiente de API key. Sem credenciais, mantém o processo ACP aberto e chama `authenticate` pelo método anunciado pelo adaptador.
- Erro de autenticação detectado: banner com login / copiar comando / verificar novamente.
- Também disponível em ⚙ Configurações
- Conteúdo e caminho de arquivos de credenciais **não** são expostos ao renderer

## Chips de contexto SGDK

No composer do painel ACP:

- **Arquivo** — manda o arquivo aberto como `resource_link` (só o caminho; o agente lê quando
  precisar). O conteúdo só vai junto quando há alteração não salva, até 32 mil caracteres, e uma
  vez por versão: como `resource` se o agente anunciar `embeddedContext`, senão como texto (desligável)
- **Build** — erros de compilação atuais
- **Tilemap** — mapa aberto no editor e as notas para a IA não resolvidas (ver `docs/EDITOR-DE-MAPAS.md`)
- **ROM** — última ROM de build (`getCurrentRomInfo` / evento de build)

### Consumo de tokens

O histórico da sessão guarda tudo o que foi enviado, e o agente relê esse histórico a cada
mensagem. Por isso o painel não repete contexto numa mesma sessão:

- a nota de ferramentas e as notas dos chips seguem uma vez; voltam só quando mudam (por exemplo,
  outra lista de erros de build);
- o arquivo aberto vai como link, e o conteúdo não salvo segue uma vez por versão;
- se o envio falhar, o contexto segue de novo na mensagem seguinte;
- as respostas da ponte MCP vão em JSON compacto.

Antes, cada mensagem levava o arquivo aberto inteiro (até 80 mil caracteres), que se acumulava no
histórico. Pelo mesmo motivo, abrir o painel começa uma conversa nova; as anteriores ficam no
seletor de sessões.

## Ctrl+K → ACP

O widget Ctrl+K coleta a instrução e encaminha para o painel OpenCode (`retroStudio:acp-edit-selection`). Writes do agente passam pelo banner Accept/Reject.

## Onboarding / smoke

- Empty state lista instalação, login, Ctrl+L, Ctrl+K e MCP; dismiss persiste `aiTerminal.acp.onboardingSeen`
- Smoke: `npm run smoke:acp` (initialize → session → prompt → write confinado → deny fora do workspace)
- Imagens: `node scripts/smoke-acp-images.mjs` (agente de teste por stdio, capacidades,
  texto + imagens + contexto, envio só de imagem, limites e entradas inválidas; sem rede ou credenciais)

## Referências

- Issues #7, #9–#16
- Zed: External Agents / ACP
- `opencode acp --help`
- [ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)


## Claude Agent ACP

O seletor do painel ACP oferece OpenCode, Codex e Claude. Cada agente tem
caminho de executável e histórico separados por workspace. Claude usa a mesma
conexão ACP para mensagens, pedidos de permissão, configuração de modelo e MCP
do Retro Studio; os recursos disponíveis dependem das capacidades do adaptador.

### Preparação

- Node.js 22 ou superior para o adaptador atual.
- Adaptador externo: npm install -g @agentclientprotocol/claude-agent-acp.
- Login pelo Claude CLI: claude auth login. Credenciais existentes do Claude
  ou variáveis de ambiente compatíveis são usadas pelo adaptador.
- A IDE não instala o pacote automaticamente e não copia chaves para suas configurações.

Em **Configurações do agente**, selecione **Claude**. Deixe o caminho vazio
para procurar claude-agent-acp no PATH ou configure o caminho completo do
adaptador. O binário claude sozinho não fala ACP e não substitui o adaptador.
A preferência é armazenada em aiTerminal.claudeAcp.commandPath.

Após login no terminal, reconecte o agente. O botão de login do Claude abre o
fluxo do CLI; ele não usa o método de autenticação específico do Codex. Status
de autenticação indisponível em versões antigas do CLI não bloqueia a tentativa
de conexão. Nome/email/chaves da conta não são enviados ao painel pela consulta.

Depois de atualizar a IDE, feche e reabra o aplicativo para atualizar também o
processo principal. Trocar apenas o provedor no painel não recarrega esse processo.

Referências:
- https://github.com/agentclientprotocol/claude-agent-acp
- https://code.claude.com/docs/en/cli-reference
