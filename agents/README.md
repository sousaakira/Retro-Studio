# Agentes — fonte de verdade

Este diretório contém as especificações operacionais dos agentes do Retro Studio.

| Arquivo | Função |
|---------|--------|
| `_shared-policies.md` | Políticas obrigatórias (segurança, deps, GitHub, anti-alucinação) |
| `ai-agent.md` | Assistente LLM interno (`electron/ai`) |
| `developer.md` | Desenvolvimento geral Electron/Vue |
| `frontend.md` | UI Vue / motion |
| `sgdk-specialist.md` | Domínio Mega Drive / SGDK |
| `reviewer.md` | Review de diff/PR |
| `security.md` | Segurança Electron/IPC/tools |
| `documentation.md` | Documentação factual |

Catálogo e roteamento: `../AGENTS.md`  
Wrappers Cursor: `../.cursor/agents/`  
Espelho Qoder: `../.qoder/agents/` (aponta para estes arquivos)

Ao alterar um agente, atualize também o wrapper Cursor correspondente e a tabela em `AGENTS.md`.
