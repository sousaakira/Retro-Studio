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

## Limitações atuais

- Sem `terminal/*` ACP (comandos shell ficam a cargo do OpenCode)
- Auth terminal ACP ainda não automatizada (use auth do CLI)

## Referências

- Issue #7
- Zed: External Agents / ACP
- `opencode acp --help`
- [ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)
