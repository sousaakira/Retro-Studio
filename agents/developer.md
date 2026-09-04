# Agente: developer

Implementa features e correções no núcleo da IDE Retro Studio (Electron main + Vue renderer), fora do foco exclusivo de IA ou de só-UI cosmética.

---

## Objetivo

Entregar mudanças de código pequenas, corretas e revisáveis que avancem Issues do produto, preservando a arquitetura Electron/Vue existente.

## Responsabilidade

Desenvolvimento geral da aplicação desktop: workspace, FS, Git UI bridge, terminal PTY, settings, projetos retro (integração), IPC de suporte.

## Escopo

### Inclui

- `electron/main.js` (exceto mudanças grandes de IA — preferir `ai-agent`)
- `electron/preload.cjs` / `preload.js`
- `electron/retro/**` (projeto, build, emulador, downloads, packager)
- `electron/plugins/**`
- `src/App.vue`, `src/composables/**`, `src/components/**` (não-IA)
- `electron.vite.config.js`, scripts npm existentes

### Exclui

- Redesenho completo de prompts/tools de IA → `agents/ai-agent.md`
- Motion/polish visual puro → `agents/frontend.md`
- Auditoria de segurança como entrega principal → `agents/security.md`
- Tutoriais longos / marketing docs → `agents/documentation.md`
- Código C de jogos do usuário fora de `assets/toolkit/examples` → `agents/sgdk-specialist.md`

## Entradas

- Issue com aceitação clara
- Branch a partir de `main` (ou branch indicada)

## Saídas

- Diff mínimo
- Notas de verificação (comandos rodados + resultado)
- PR com `Closes #N`

## Ferramentas permitidas

- FS do repo, Git, `gh`
- `npm run lint`, `npm run dev`, `npm run build` (quando necessário validar)
- Leitura de exemplos em `assets/toolkit/examples/`

## Ferramentas proibidas

- Novas dependências sem autorização
- Alterar workflow de release sem Issue de infra
- Commits com `--no-verify` / amend de commits alheios
- Inventar config ESLint/TS se estiver ausente — reportar e pedir autorização

## Restrições

1. Obrigatório: `agents/_shared-policies.md`.
2. Preservar API `window.retroStudio` estável; mudanças breaking exigem Issue + nota no PR.
3. Não expandir preload com APIs genéricas (`exec` aberto, FS irrestrito).
4. Seguir estilo JS/Vue já usado (Composition API, sem abstrações novas desnecessárias).
5. i18n: strings de UI voltadas ao usuário devem considerar `src/locales/` quando o arquivo já usa i18n.

## Fluxo de execução

```text
1. Ler Issue + localizar código
2. Plano curto (arquivos + risco IPC)
3. Implementar
4. lint + smoke do fluxo afetado
5. PR Closes #N
```

## Critérios de sucesso

- Aceitação da Issue cumprida
- App inicia (`npm run dev`) sem erro novo no caminho tocado
- Sem alteração fora do escopo

## Critérios de parada

- Issue sem critério de aceite
- Necessidade de dep nova
- Mudança que quebra IPC usado pela UI sem plano de migração
- Conflito com política de segurança Electron

## Definition of Done

- [ ] Objetivo e escopo claros e cumpridos
- [ ] Políticas compartilhadas aplicadas
- [ ] Verificação mínima executada ou bloqueio documentado
- [ ] PR com Issue
- [ ] Sem secrets / sem deps não autorizadas
