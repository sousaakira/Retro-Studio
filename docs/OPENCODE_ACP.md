# OpenCode ACP no Retro Studio

Integração **Fase 2** com o [Agent Client Protocol](https://agentclientprotocol.com) (mesmo mecanismo do Zed Agent Panel).

## Requisitos

- OpenCode CLI instalado (`opencode --version`)
- Auth do OpenCode já configurada (`opencode auth login` se necessário)

## Uso

1. Abrir **Terminal IA** (painel lateral)
2. Aba **ACP** (padrão) — painel de agente
3. Aba **OpenCode TUI** — terminal embutido (Fase 1)

## Arquitetura

```text
Renderer (AcpAgentPanel.vue)
    ↓ IPC acp:*
Main (acpSessionManager)
    ↓ spawn
opencode acp  ←→  NDJSON JSON-RPC (AcpClient.js)
```

Métodos suportados no cliente:

- Agent: `initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/close`
- Client: `fs/read_text_file`, `fs/write_text_file`, `session/request_permission`

## Limitações atuais

- Sem `terminal/*` ACP (comandos shell ficam a cargo do OpenCode)
- Sem seletor completo de modelos na UI (usa configOptions do `session/new`)
- Auth terminal ACP ainda não automatizada (use auth do CLI)

## Referências

- Issue #7
- Zed: External Agents / ACP
- `opencode acp --help`
