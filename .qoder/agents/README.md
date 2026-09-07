# Agentes Qoder — Retro Studio

Espelho operacional das specs em `agents/`.

**Fonte de verdade:** `agents/*.md` + `AGENTS.md`  
Ao editar regras, altere primeiro `agents/` e recopie para cá:

```bash
cp agents/_shared-policies.md agents/ai-agent.md agents/developer.md \
   agents/frontend.md agents/sgdk-specialist.md agents/reviewer.md \
   agents/security.md agents/documentation.md .qoder/agents/
```

| Arquivo | Função |
|---------|--------|
| `_shared-policies.md` | Políticas obrigatórias |
| `ai-agent.md` | IA interna |
| `developer.md` | Electron/Vue geral |
| `frontend.md` | UI / motion |
| `sgdk-specialist.md` | SGDK / Mega Drive |
| `reviewer.md` | Review |
| `security.md` | Segurança |
| `documentation.md` | Docs |

Antes de qualquer tarefa: `AGENTS.md` → `_shared-policies.md` → agente escolhido.
