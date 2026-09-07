# OpenCode ACP no Retro Studio

Integração com o [Agent Client Protocol](https://agentclientprotocol.com) (mesmo mecanismo do Zed Agent Panel).

## Requisitos

- OpenCode CLI instalado (`opencode --version`)
- Auth do OpenCode já configurada (`opencode auth login` se necessário)

## Uso

1. Abrir o painel **IA** (`Ctrl+L`)
2. Conversar no painel ACP (sessão por projeto, modelos/modos no rodapé)

O caminho do binário OpenCode pode ser definido em **⚙** no header do painel.

## Arquitetura

```text
Renderer (AcpAgentPanel.vue)
    ↓ IPC acp:*
Main (acpSessionManager)
    ↓ spawn
opencode acp  ←→  NDJSON JSON-RPC (AcpClient.js)
    ↓ mcpServers
node scripts/retro-studio-mcp.mjs  (build_rom / run_emulator)
```

Métodos suportados no cliente:

- Agent: `initialize`, `session/new`, `session/list`, `session/load`, `session/resume`, `session/prompt`, `session/cancel`, `session/close`, `session/set_config_option`
- Client: `fs/read_text_file`, `fs/write_text_file`, `session/request_permission`

## Sessões por projeto (game)

Ao abrir o painel IA:

1. Lista sessões OpenCode do `cwd` do workspace (`session/list`)
2. Retoma a última usada nesse projeto (`session/load` — reconstrói o histórico no chat)
3. Se não houver sessão, cria uma nova (`session/new`)

Preferência persistida em `aiTerminal.acp.sessionsByWorkspace[cwd]`.

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

**Permitir/Negar sempre** fica na memória da sessão e auto-responde pedidos parecidos. Cancelar o turno resolve a permissão pendente como `cancelled`. Timeout não auto-aprova.

## Build / Play (UI + agente)

- UI: botões ⚒ / ▶ / ■ ou `/build` `/play` `/stop`
- Agente: MCP `retro-studio` (`scripts/retro-studio-mcp.mjs`) com `build_rom` / `run_emulator`, injetado em `session/new|load|resume`
- Resultado MCP em `.retrostudio/last-acp-build.json` → chat; erros clicáveis alimentam o painel de compilação

## Limitações atuais

- Sem `terminal/*` ACP (shell fica a cargo do OpenCode; preferir MCP `build_rom` para SGDK)
- Writes do agente vão ao disco imediatamente; Accept/Reject restaura o conteúdo anterior
- Root de FS do ACP = workspace aberto na IDE (não CWD do terminal)

## Auth OpenCode

Ao abrir o painel, a IDE verifica se existem credenciais OpenCode (`auth.json` no data dir XDG).

- Sem credenciais (ou erro de auth detectado): banner com **Abrir login no terminal** / copiar `opencode auth login` / verificar de novo
- Também disponível em ⚙ Configurações
- O path de `auth.json` **não** é exposto ao renderer

## Chips de contexto SGDK

No composer do painel ACP:

- **Arquivo** — injeta o buffer aberto como `resource` (desligável)
- **Build** — erros de compilação atuais
- **Tilemap** — último tilemap aberto no editor
- **ROM** — última ROM de build (`getCurrentRomInfo` / evento de build)

## Ctrl+K → ACP

O widget Ctrl+K coleta a instrução e encaminha para o painel OpenCode (`retroStudio:acp-edit-selection`). Writes do agente passam pelo banner Accept/Reject.

## Onboarding / smoke

- Empty state lista instalação, login, Ctrl+L, Ctrl+K e MCP; dismiss persiste `aiTerminal.acp.onboardingSeen`
- Smoke: `npm run smoke:acp` (initialize → session → prompt → write confinado → deny fora do workspace)

## Referências

- Issues #7, #9–#16
- Zed: External Agents / ACP
- `opencode acp --help`
- [ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)
