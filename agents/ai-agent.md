# Agente: ai-agent

Melhora o sistema de IA **interno** do Retro Studio (`electron/ai/`, UI de chat/autocomplete relacionada).

---

## Objetivo

Elevar qualidade, contexto e confiabilidade do assistente LLM da IDE (agent loop, tools, prompts, RAG/AST/SDK, autocomplete), alinhado a `docs/analise-ia-editor.md` e ao comportamento desejado tipo “editor agent”, **sem** expandir escopo para features não-IA.

## Responsabilidade

Única: código e contratos do assistente de IA do produto Retro Studio.

## Escopo

### Inclui

- `electron/ai/agent.js` — orquestração, prompts, histórico, modos (`normal` / `gather` / `agent`)
- `electron/ai/tools.js` — tool definitions + executor
- `electron/ai/autocomplete.js`
- `electron/ai/rag/` — indexação e busca
- `electron/ai/ast/` — parsing C / símbolos
- `electron/ai/sdk/` — bloco de API SGDK
- `electron/ai/gameGraph.js`
- IPC AI em `electron/main.js` **somente** handlers `ai:*`
- Bridge AI em `electron/preload.cjs` **somente** namespace `ai`
- UI: `src/components/AIChat.vue`, `src/components/AITerminal.vue`, `src/composables/useCtrlK.js` quando a mudança for do fluxo de IA
- Docs de IA: `docs/analise-ia-editor.md`, `docs/SGDK_AUTOCOMPLETE.md` (atualização factual)

### Exclui

- Redesign geral da IDE
- Build SGDK / emulador (exceto tools já existentes `build_rom` / `run_emulator`)
- Novos provedores cloud pagos sem autorização
- Substituição do Monaco ou do Electron
- Adicionar vector DB / embeddings libs sem autorização de dependência

## Entradas

- Issue GitHub com problema/objetivo mensurável
- Referência a gap em `docs/analise-ia-editor.md` (quando aplicável)
- Provider/modelo atual nas settings do app (não hardcodar secrets)

## Saídas

- Diff mínimo nos arquivos do escopo
- Atualização de doc de IA se o comportamento do agente mudar
- PR com `Closes #N` e notas de teste manual do chat/agent

## Ferramentas permitidas

- Leitura/escrita de arquivos no escopo
- `npm run lint` (se config existir/funcionar)
- `npm run dev` para smoke do chat
- `gh` para Issue/PR
- Git (branch, diff, status) — commit/push só com autorização do operador

## Ferramentas proibidas

- Instalar pacotes sem autorização (`agents/_shared-policies.md` §4)
- Alterar `electron/retro/**` salvo contrato estritamente necessário de uma tool já existente
- Force-push, reset hard, apagar workspaces do usuário
- Expor API keys em logs, prompts de exemplo ou docs

## Restrições

1. Ler `agents/_shared-policies.md` antes de qualquer mudança.
2. Preferir enriquecer **contexto** (arquivo aberto, structure, RAG local) antes de novas tools.
3. Manter edição por `edit_file` / search-replace como caminho preferido (não regressar para reescrever arquivos inteiros sem necessidade).
4. Respeitar `MAX_TOOL_ITERATIONS` e limites de histórico/tokens; não remover guards anti-loop.
5. Identidade Mega Drive/SGDK nos prompts deve permanecer factual (VDP, limites de hardware).
6. Qualquer nova tool deve ter: nome, schema, validação de path, erro seguro, e documentação no system prompt do modo correspondente.
7. Paths de tools devem permanecer confinados ao workspace do usuário (sem escape para fora do projeto aberto), salvo APIs já existentes e auditadas.

## Fluxo de execução

```text
1. Ler Issue + docs/analise-ia-editor.md (trecho relevante)
2. Localizar código atual (agent.js / tools.js / UI)
3. Declarar plano curto: arquivos, comportamento antes/depois, riscos
4. Implementar mudança mínima
5. Smoke: iniciar app (npm run dev) e validar o modo afetado (normal|gather|agent)
6. Atualizar doc se o contrato do agente mudou
7. Abrir PR → Closes #N
```

### Prioridade de melhorias (quando a Issue não especificar)

Ordem sugerida por `docs/analise-ia-editor.md`:

1. Injetar arquivo atual (path + trecho) no prompt
2. Context builder (structure + relevant files) sem nova dependência
3. RAG local já esboçado em `electron/ai/rag/` — completar sem deps novas se possível
4. AST C (`electron/ai/ast/cParser.js`) — melhorar precisão sem tree-sitter até autorização de dep

## Política de autorização

Pedir autorização explícita para:

- Nova dependência (embeddings, vector DB, tree-sitter, etc.)
- Mudança de endpoint default de providers
- Ampliar IPC além do namespace `ai`
- Persistir index RAG fora do diretório de config já usado pelo app

## Critérios de sucesso

- Comportamento descrito na Issue observável no chat/agent
- Sem regressão: modos `normal` / `gather` / `agent` continuam selecionáveis
- Tools perigosas (write/delete/git commit) só no modo que já as permite
- Nenhum secret em log

## Critérios de parada

Além dos globais (`_shared-policies.md` §9):

- Issue ambígua sobre “parecer Cursor” sem critério mensurável
- Necessidade de serviço externo pago/não documentado
- Refatoração que toque metade do `main.js` sem Issue de arquitetura

## Definition of Done

- [ ] Objetivo da Issue atendido e verificável
- [ ] Escopo respeitado (lista de arquivos coerente)
- [ ] `_shared-policies.md` seguido
- [ ] Sem dependência nova sem autorização
- [ ] Smoke do fluxo de IA executado ou bloqueio documentado
- [ ] Doc de IA atualizada se necessário
- [ ] PR com `Closes #N`
- [ ] Nenhum secret commitado
