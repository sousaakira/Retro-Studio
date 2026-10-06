# AGENTS.md — Retro Studio

Instruções para agentes de IA que trabalham neste repositório.

**Fonte de verdade das políticas:** `agents/_shared-policies.md`  
**Agentes especializados:** `agents/*.md`  
**Wrappers Cursor:** `.cursor/agents/*.md` (delegação via subagents)

Este arquivo não executa tarefas. Ele orquestra **quem** deve executar e sob quais regras.

---

## Missão do projeto

IDE desktop para desenvolvimento Sega Mega Drive / Genesis (SGDK + MarsDev), com editor Monaco, tilemap, build/emulador, Git e assistente de IA.

Versão atual: ver `package.json` (`name: retro-studio`).

---

## Como escolher o agente

| Situação | Agente | Arquivo |
|----------|--------|---------|
| Melhorar o agente LLM interno (`electron/ai/`), tools, RAG, prompts, autocomplete | **ai-agent** | `agents/ai-agent.md` |
| Feature/bug geral Electron + Vue (fora de IA e fora de só-UI) | **developer** | `agents/developer.md` |
| UI Vue, painéis, motion, acessibilidade visual | **frontend** | `agents/frontend.md` |
| Código C/SGDK, skeletons, build ROM, APIs Genesis | **sgdk-specialist** | `agents/sgdk-specialist.md` |
| Revisão de diff / PR / qualidade | **reviewer** | `agents/reviewer.md` |
| IPC, preload, secrets, supply chain, superfícies de ataque | **security** | `agents/security.md` |
| Docs, README, guias em `docs/` | **documentation** | `agents/documentation.md` |

Se a tarefa cruzar dois domínios: o agente primário executa; o secundário só é acionado para review no fim (ex.: `ai-agent` implementa → `security` revisa IPC novo).

Evitar agente “faz tudo”. Não inventar novos agentes neste arquivo sem atualizar também `agents/` e `.cursor/agents/`.

---

## Fluxo padrão de trabalho

```text
1. Ler AGENTS.md + agents/_shared-policies.md + agents/<agente>.md
2. Confirmar Issue existente ou criar Issue (gh)
3. Implementar no menor escopo possível
4. Verificar (lint / smoke do caminho afetado)
5. Abrir Pull Request citando a Issue (Closes #N)
6. Aguardar review / autorização de merge
```

Deploy/release: **não** é responsabilidade dos agentes de desenvolvimento. Release via tag/`workflow_dispatch` (`.github/workflows/release.yml`).

---

## Regras globais (resumo)

Detalhes obrigatórios em `agents/_shared-policies.md`.

1. Segurança > autorização do operador > integridade > verificação > qualidade.
2. Sem dependência nova sem autorização + relatório de risco.
3. Sem inventar ferramentas, Skills, APIs ou configs.
4. Sem commits/PRs/push a menos que o operador peça (ou a Issue autorize o fluxo completo nesta sessão).
5. UI motion: consultar Skill `design-motion-principles` quando disponível.
6. Não registrar secrets em logs ou docs.

---

## Definition of Done (orquestração)

- [ ] Agente correto selecionado pelo escopo
- [ ] Políticas compartilhadas aplicadas
- [ ] Issue referenciada quando houver mudança de código
- [ ] Nenhum arquivo fora de escopo alterado
- [ ] Critérios de parada respeitados
- [ ] Documentação de agentes atualizada se as regras de operação mudaram

---

## Manutenção deste catálogo

Quem alterar comportamento operacional de um agente deve:

1. Atualizar o `.md` correspondente em `agents/`
2. Atualizar o wrapper em `.cursor/agents/` se a `description`/nome mudar
3. Atualizar a tabela “Como escolher o agente” neste arquivo
4. Manter cópia ou referência em `.qoder/agents/` se o time usar Qoder

Última revisão estrutural: 2026-09-03.

- Música por mapa: Retro Studio salva o ID em `retroStudio.musicTrack` no TMX. A sidebar lê catálogo JSON ou `XGM` em `res/resources.res`; string vazia preserva música padrão. `export-playable-map.py` valida ID, gera `*_MUSIC_TRACK`; `RoomDefinition.musicTrack` e `gameMusicSelectRoom` aplicam o índice da sala. Ao adicionar faixas, atualizar os catálogos JSON gerados e reexportar. Ver `docs/MUSICA.md`.
- Cenas programadas (cutscenes): biblioteca distribuída em `assets/toolkit/lib/cutscene/` (runtime C puro `cutscene_runner.c`, compilador `cutscene-compiler.mjs`, `docs/CUTSCENES.md`, schema, `manifest.json`). Projetos novos recebem o runtime em `retro:create-project`/`createProjectFromTemplate`; projetos existentes instalam pelo editor (IPC `tilemap:install-cutscene-runtime`, confinado ao workspace; arquivos alterados ganham `.bak-*`; `cutscene-config.json` nunca é sobrescrito). Editor: `TilemapCutsceneEditor.vue` + `useCutsceneAuthoring.js`; prévia em `src/utils/retro/cutscenePreview.js` deve acompanhar a semântica do runtime C. Bytecode/opcodes: manter `OP_SIZE` do compilador igual a `opSize` do runtime e incrementar `CUTSCENE_RUNTIME_VERSION` ao mudar o formato. Testes: `npm run smoke:cutscene-runtime` e `npm run smoke:cutscene-editor`. Guia: `docs/CENAS-PROGRAMADAS.md`.
