# Políticas compartilhadas — Retro Studio

Este arquivo é **obrigatório** para todos os agentes em `agents/`.  
Antes de executar qualquer tarefa, o agente deve ler este documento e o `AGENTS.md` na raiz.

---

## 1. Hierarquia de conflito

Quando instruções conflitarem, aplicar nesta ordem (maior prioridade primeiro):

1. Segurança
2. Autorização explícita do operador
3. Integridade do projeto
4. Testes / verificação mínima disponível
5. Observabilidade (sem secrets)
6. Qualidade / lint
7. Performance
8. Convenções do repositório

Nunca resolver conflito removendo silenciosamente uma regra de prioridade superior.

---

## 2. Escopo do produto

**Retro Studio** é uma IDE desktop (Electron + Vue 3 + Monaco) para jogos Sega Mega Drive / Genesis com SGDK e MarsDev.

Stack verificada (`package.json`):

| Camada | Tecnologia |
|--------|------------|
| Desktop | Electron `^32`, electron-vite `^2` |
| UI | Vue `^3.5`, vue-i18n `^9` |
| Editor | monaco-editor `^0.52` |
| Terminal | node-pty, xterm |
| Build app | electron-builder |
| Lint script | `npm run lint` (dependência `eslint` presente) |

Caminhos críticos:

- `electron/main.js` — processo main + IPC
- `electron/preload.cjs` / `electron/preload.js` — bridge `window.retroStudio`
- `electron/ai/` — agente LLM, tools, autocomplete, RAG/AST/SDK
- `electron/retro/` — projeto, build, emulador, cartucho, store
- `src/` — renderer Vue
- `assets/toolkit/examples/` — skeletons SGDK

---

## 3. Ferramentas e scripts verificados neste repositório

### Disponíveis e utilizáveis

| Recurso | Status | Como usar |
|---------|--------|-----------|
| `npm run dev` | Verificado | desenvolvimento Electron + Vite |
| `npm run build` | Verificado | build electron-vite |
| `npm run build:linux` / `:win` / `:mac` | Verificado | pacotes de distribuição |
| `npm run lint` | Script verificado | ESLint listado em `devDependencies`; **arquivo de config ESLint não encontrado** no repo — se lint falhar por falta de config, reportar e parar (não inventar config sem autorização) |
| `gh` (GitHub CLI) | Esperado no ambiente do operador | issues, PRs, checks |
| Git | Verificado | fluxo Issue → branch → PR |

### Skills verificadas no ambiente do operador (Cursor)

| Skill | Caminho | Quando usar |
|-------|---------|-------------|
| design-motion-principles | `~/.agents/skills/design-motion-principles/SKILL.md` | UI motion / animações |
| web-design-guidelines | `~/.agents/skills/web-design-guidelines/SKILL.md` | auditoria de acessibilidade/UX web |
| frontend-design | `~/.agents/skills/frontend-design/SKILL.md` | design visual de UI nova |
| review-bugbot | `~/.cursor/skills-cursor/review-bugbot/SKILL.md` | review Bugbot quando pedido |
| review-security | `~/.cursor/skills-cursor/review-security/SKILL.md` | security review quando pedido |

Se a Skill não existir no ambiente da sessão, marcar:

```text
Ferramenta/Skill: <nome>
Status: NÃO VERIFICADA
Não foi possível confirmar disponibilidade. Não tratar como obrigatória.
```

### NÃO presentes neste repositório (não exigir; não instalar sem autorização)

| Recurso | Status |
|---------|--------|
| Vitest / Jest / Playwright | Ausentes de `package.json` |
| Biome / Knip / Stryker | Ausentes |
| OpenTelemetry / Sentry / Datadog / New Relic | Ausentes de `package.json` |
| TypeScript (projeto principal em JS) | Sem `tsc` de app; não converter para TS sem autorização |
| CI de testes | Só workflow de release em `.github/workflows/release.yml` |

---

## 4. Política de dependências externas (obrigatória)

Um agente **NÃO** pode adicionar dependência externa sem autorização explícita do operador.

Antes de recomendar instalação:

1. Analisar nome, versão, objetivo, licença, repo oficial, atividade, CVEs, transitivas, scripts de install, risco de supply chain.
2. Apresentar o relatório no formato:

```text
Pacote:
Versão:
Motivo:
Alternativas consideradas:
Vulnerabilidades conhecidas:
Dependências transitivas:
Licença:
Riscos:
Classificação: LOW / MEDIUM / HIGH / CRITICAL
```

3. **PARAR** e aguardar autorização.

Sem autorização, proibido: `npm install <pkg>`, alterar `package.json` / lockfile, ou redesenhar a arquitetura só para acomodar a dependência.

---

## 5. Política de GitHub

Toda alteração relevante no código deve seguir:

```text
Issue → Implementação → Verificação → Pull Request → Review → Merge
```

- Criar ou referenciar Issue antes de implementar (bug, feature, melhoria, refatoração relevante, segurança, deps).
- PR deve citar a Issue (`Closes #N` ou `Resolves #N`).
- Não fazer deploy direto; release é via tags/`workflow_dispatch` (ver `.github/workflows/release.yml`).
- Não fazer force-push em `main`.
- Não commitar secrets (`.env`, tokens, chaves de API).
- Commits e PRs só quando o operador pedir explicitamente (ou quando a Issue/tarefa autorizar o fluxo completo).

---

## 6. Segurança e menor privilégio

Proibido sem autorização explícita:

- Comandos destrutivos (`rm -rf`, `git reset --hard`, `git push --force` em main)
- Alterar secrets, credenciais, ou expor tokens em logs/UI/docs
- Desativar validações de segurança no preload/IPC
- Modificar arquivos fora do escopo da tarefa
- Remover ou enfraquecer `contextBridge` / isolation Electron
- Executar código remoto não confiável no main process

IPC e preload: qualquer mudança em `electron/preload.*` ou handlers IPC deve preservar o princípio de superfície mínima (`window.retroStudio` só com APIs necessárias).

Logs: nunca registrar API keys, tokens, conteúdo completo de prompts com secrets, ou credenciais de store.

---

## 7. Qualidade e verificação mínima

Quando modificar código:

1. Preferir mudanças mínimas e alinhadas ao estilo existente.
2. Rodar `npm run lint` se aplicável ao escopo; se a config estiver ausente/quebrada, reportar — não inventar config.
3. Validar manualmente o caminho crítico afetado (ex.: abrir chat IA, build ROM, abrir arquivo).
4. Não desabilitar lint/testes para “passar CI”.
5. Não reduzir cobertura existente (quando houver testes).

Observabilidade neste projeto: usar `console`/`log` já existentes no main com cuidado; não adicionar APM externo sem autorização.

---

## 8. UX / Motion (quando a tarefa for UI)

- Consultar a Skill `design-motion-principles` **antes** de implementar animações, se disponível.
- Motion só com finalidade (feedback, hierarquia, continuidade) — não animar por estética vazia.
- Respeitar `prefers-reduced-motion`.
- Considerar: loading, empty, error, partial; skeleton/lazy quando fizer sentido.
- Retro Studio é ferramenta de produtividade: preferir motion rápida e contida (perspectiva Emil/Jakub da skill).

---

## 9. Critérios de parada (globais)

Parar e solicitar o operador quando:

- Nova dependência for necessária
- Risco de perda de dados ou mudança destrutiva
- Migração irreversível / infra crítica
- Acesso a credenciais
- Vulnerabilidade crítica descoberta
- Conflito de requisitos ou ambiguidade relevante
- Tarefa sair do escopo do agente
- Ferramenta/Skill citada não puder ser verificada e for essencial à tarefa

---

## 10. Anti-alucinação de ferramentas

Não inventar Skills, MCPs, APIs, flags, arquivos de config ou comandos.

Prioridade de verificação: documentação oficial → repo oficial → docs do fornecedor → registros do ecossistema.

É preferível um agente com uma capacidade a menos do que instruir uso de ferramenta inexistente.
