# Análise: Sistema de IA do Editor vs. Sugestões (Cursor-like)

Comparação entre o que a outra IA sugeriu e o que **já existe** no Retro Studio, e o que **falta implementar** para melhorar desempenho e usabilidade.

---

## 1. Contexto / Montagem do prompt

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| O modelo só vê o texto enviado no prompt | **Implementado** – O agente envia apenas system prompt + histórico de conversa (e resultados de tools no histórico). |
| Context Builder: montar o contexto correto | **Parcial** – Não há “context builder” separado. O contexto é: (1) system prompt fixo com lista de tools, (2) `getRecentHistory()` (histórico truncado por tokens). Não há injeção automática de “arquivos relevantes” nem de “estrutura do projeto” no início do prompt. |

**Conclusão:** Falta um **Context Builder** que, antes de cada chamada ao LLM, injete no prompt (por exemplo): estrutura resumida do projeto, arquivo atual aberto e/ou arquivos relevantes (via RAG ou ranking).

---

## 2. Indexação do projeto (RAG)

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| Escanear todos os arquivos | **Não** – Não há indexação em background. |
| Dividir em chunks | **Não** – Não existe. |
| Criar embeddings | **Não** – Nenhum uso de embeddings. |
| Salvar em banco vetorial (Qdrant, Chroma, etc.) | **Não** – Nenhum vector DB. |

**Conclusão:** **Não implementado.** Toda a “descoberta” de código depende da IA chamar tools (`get_project_structure`, `read_file`, `grep_code`, `search_codebase`) durante a conversa. Para “parecer que entende o projeto inteiro” e responder mais rápido, faria diferença ter RAG (indexação + embeddings + busca vetorial) e injetar os trechos relevantes no prompt.

---

## 3. Busca de contexto relevante (vector search)

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| Query → embedding → vector search → arquivos relevantes | **Não** – Não existe. |
| Incluir só arquivos relevantes no prompt | **Não** – O prompt não é montado com “relevant files” pré-buscados. |

**Conclusão:** **Não implementado.** É um dos maiores gaps em relação a Cursor/Copilot: hoje o modelo só “vê” o que ele mesmo pediu via tools (e o que couber no histórico).

---

## 4. Construção do prompt (estrutura rica)

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| System: “You are an expert…” | **Implementado** – `PROMPTS.agent` / `MEGADRIVE_IDENTITY` com papel e regras. |
| Project structure no prompt | **Não** – Estrutura do projeto não é injetada automaticamente; a IA obtém via tool `get_project_structure` se chamar. |
| “Relevant files” com código no prompt | **Não** – Não há bloco “Relevant files: File: x, <código>”. |
| User request no final | **Implementado** – A última mensagem do usuário está no histórico. |

**Conclusão:** **Parcial.** Falta enriquecer o prompt com: (1) estrutura do projeto (resumida) e (2) conteúdo de arquivos relevantes (aberto atual + resultado de RAG ou de ranking).

---

## 5. Memória da sessão (histórico)

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| Manter histórico da conversa | **Implementado** – `conversationHistory` em `agent.js`. |
| User / AI alternados no contexto | **Implementado** – Histórico inclui user, assistant e tool results. |
| Limite de tamanho (tokens) | **Implementado** – `trimHistory()`, `getRecentHistory()` com `contextWindow` e `reserveForResponse` por modelo. |

**Conclusão:** **Implementado.** Memória da sessão e truncamento por tokens já existem.

---

## 6. Ferramentas (Tool Use)

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| read_file(path) | **Implementado** – `read_file` com path, start_line, end_line. |
| write_file(path, content) | **Implementado** – `write_file`. |
| search_code(query) | **Implementado** – `grep_code` (texto/regex) e `search_codebase` (função/classe/texto). |
| run_tests / run_command | **Implementado** – `run_command`, `run_persistent_command`, terminal persistente. |
| list_directory, get_project_structure | **Implementado** – `list_directory`, `get_project_structure`. |
| create_file_or_folder, delete, rename | **Implementado** – `create_file_or_folder`, `delete_file_or_folder`, `rename_file`. |
| Git (status, diff, commit, etc.) | **Implementado** – Várias tools de git. |

**Conclusão:** **Implementado.** O conjunto de tools cobre leitura, escrita, busca, terminal e git.

---

## 7. Loop de raciocínio (agent loop)

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| while task_not_finished → LLM decide → executar tool → repetir | **Implementado** – Em `agent.js`, `chat()`: loop com `MAX_TOOL_ITERATIONS`, chamada a `callLLM()`, tratamento de `tool_calls`, execução via `toolExecutor.execute()`, resultado colocado no histórico e nova iteração. |
| Resposta final quando não há tool_calls | **Implementado** – Quando não há `tool_calls`, `finalResponse` é definida e o loop termina. |

**Conclusão:** **Implementado.** O agent loop está implementado.

---

## 8. Diff em vez de gerar arquivo inteiro

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| Preferir edições em formato diff / search-replace | **Implementado** – `edit_file` com blocos `<<<<<<< ORIGINAL / ======= / >>>>>>> UPDATED` (search/replace). `patch_file` para substituição simples. O system prompt diz “Para editar, use edit_file com blocos SEARCH/REPLACE (PREFERIDO)”. |
| write_file para arquivo novo | **Implementado** – `write_file` para criar/sobrescrever; usado quando não há “arquivo antigo” para diff. |

**Conclusão:** **Implementado.** Já se incentiva edição por diff/search-replace em vez de reescrever o arquivo inteiro.

---

## 9. AST parsing

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| Parser de código (tree-sitter, acorn, babel) | **Parcial** – `search_codebase` usa **regex** para achar funções, classes, variáveis, imports (padrões para JS/TS/Vue, etc.). Não há AST real (tree-sitter, acorn, babel parser) no pipeline de IA. |
| Saber funções, classes, imports, dependências | **Parcial** – Só via regex em `search_codebase` e `detectType()`; sem grafo de dependências nem análise estrutural. |

**Conclusão:** **Parcial.** Há “busca inteligente” por padrões de código, mas não AST nem code graph. Para C/SGDK, um parser (ex.: tree-sitter para C) melhoraria precisão de “onde está X” e “o que importa para este arquivo”.

---

## 10. Context ranking

| Sugestão | Status no Retro Studio |
|----------|------------------------|
| Prioridade: arquivo aberto → imports → dependências → busca vetorial | **Parcial** – Arquivo aberto é injetado no system prompt (`buildEditorContextBlock`). Includes locais de `.c`/`.h` entram com trecho limitado. RAG/ranking completo ainda evolutivo. |
| Injetar “arquivo atual” no prompt | **Implementado** – `AIChat.vue` envia `options.context = { currentFilePath, currentFileContent }`; `App.vue` expõe conteúdo via Monaco (`getCurrentFileContent`); chip na UI mostra o arquivo ativo. |

**Conclusão:** Arquivo atual no prompt está implementado (com limite de linhas/chars e includes locais seguros no workspace).

---

## Resumo: já tem vs. falta

| Técnica | Status | Prioridade sugerida |
|--------|--------|----------------------|
| **1. Context Builder** (montagem do prompt) | Parcial (só system + history) | Alta – enriquecer com estrutura + arquivos relevantes |
| **2. RAG (indexação + embeddings + vector DB)** | Não | Média–Alta – maior impacto, mais esforço |
| **3. Vector search / “relevant files”** | Não | Média–Alta – depende de RAG ou alternativa simples |
| **4. Prompt rico (estrutura + relevant files)** | Parcial | Alta – pode ser feita sem RAG (ex.: arquivo atual + get_project_structure) |
| **5. Memória da sessão** | Implementado | – |
| **6. Tool Use** | Implementado | – |
| **7. Agent loop** | Implementado | – |
| **8. Diff / search-replace** | Implementado | – |
| **9. AST parsing** | Parcial (regex) | Média – tree-sitter para C/SGDK |
| **10. Context ranking (arquivo aberto primeiro)** | Implementado (mínimo: arquivo atual + includes locais) | – |

---

## Ordem sugerida de implementação

1. ~~**Context ranking mínimo (arquivo aberto)**~~ **Feito** (`AIChat` → `options.context` → `buildEditorContextBlock`).

2. **Context Builder sem RAG**  
   - Antes de chamar o LLM, opcionalmente chamar `get_project_structure` (ou usar cache) e colocar uma “Structure: …” no prompt.  
   - Incluir 1–3 arquivos “relevantes”: arquivo atual + (futuro) imports ou arquivos mencionados na conversa.  
   - **Impacto:** modelo entende melhor o projeto sem depender só de tools no meio da conversa.  
   - **Esforço:** médio.

3. **RAG (indexação + embeddings + vector search)**  
   - Indexar projeto (ex.: ao abrir workspace), chunk por arquivo/função, gerar embeddings, guardar em SQLite + vetores ou Chroma/Qdrant.  
   - Na pergunta do usuário: embedding da query → buscar top‑k chunks → injetar “Relevant files” no prompt.  
   - **Impacto:** grande (“parece que entende o projeto inteiro”).  
   - **Esforço:** alto.

4. **AST / tree-sitter para C (SGDK)**  
   - Usar tree-sitter (ou similar) para C para extrair funções, macros, includes.  
   - Usar isso em `search_codebase` e/ou no Context Builder para “funções/arquivos relacionados ao arquivo atual”.  
   - **Impacto:** médio para precisão e contexto em projetos C/SGDK.  
   - **Esforço:** médio.

---

## Conclusão

- **Já está sólido:** memória de sessão, agent loop, tool use (incl. read/write/search/terminal/git), edição por diff/search-replace.  
- **Melhorias de alto impacto e relativamente baratas:** (1) enviar e usar o **arquivo atual** no prompt e (2) um **Context Builder** que inclua estrutura do projeto e, quando possível, “relevant files” (mesmo sem RAG no início).  
- **Próximo passo mais pesado:** RAG (indexação + embeddings + vector search) para realmente aproximar do comportamento “entende o código inteiro” dos IDEs modernos.

Este documento pode ser usado como referência para planejar as próximas sprints do sistema de IA do editor.

---

## Ideia futura: análise assistida do assembly SGDK

**Status: proposta registrada; não implementada.** Após um build SGDK/MarsDev bem-sucedido, oferecer uma ação opcional para a IA examinar o assembly/listagens gerados e apontar trechos que talvez mereçam otimização. O build normal deve continuar igual e a análise nunca deve editar o código automaticamente.

### Fluxo sugerido

1. O usuário escolhe **Analisar eficiência com IA** depois do build.
2. O Retro Studio coleta as listagens assembly e os arquivos-fonte correspondentes, limitando a análise às funções selecionadas ou a arquivos relevantes para evitar enviar o projeto inteiro.
3. A IA explica os padrões que encontrou, liga cada observação ao arquivo/função e informa incerteza e possível impacto. O programador decide se a sugestão faz sentido.
4. Qualquer mudança é feita e medida separadamente no jogo/emulador; a IA não substitui profiling nem validação do programador.

### Viabilidade e limites técnicos

- O SGDK documenta um perfil `asm` que gera listagens a partir dos fontes C. O `makefile.gen` oficial grava os arquivos `.lst` em `out/asm/` nesse perfil ([guia de uso do SGDK](https://github.com/Stephane-D/SGDK/wiki/SGDK-Usage), [makefile.gen](https://github.com/Stephane-D/SGDK/blob/master/makefile.gen)).
- O `makefile.gen` do MarsDev usado no ambiente do projeto também declara o alvo `asm` e a geração de `out/*.lst`. Isso permite um protótipo sem mudar o build padrão.
- O perfil de listagem pode usar opções diferentes do build de release. No MarsDev verificado, o alvo `asm` compila C com `-S` e sem o `-flto` presente no alvo release. Portanto, essas listagens são úteis para inspeção, mas não devem ser apresentadas como uma reprodução exata do código final linkado da ROM.
- Para uma análise mais fiel ao executável final, uma etapa posterior pode desassemblar o ELF de saída do build, quando disponível, usando o `objdump` da toolchain e cruzar símbolos/fontes. Isso também precisa ser identificado claramente na interface.
- Assembly isolado não informa quais funções são realmente quentes durante o jogo nem todos os custos de hardware/VDP. A IA pode identificar candidatos — por exemplo, operações caras em loops ou chamadas repetidas —, mas o ganho deve ser confirmado com profiling ou testes de desempenho no jogo.
- A análise adiciona uma compilação ou etapa de desassemblagem e uma chamada de IA; por isso deve ser manual e opcional, nunca executada automaticamente a cada build.

### Critérios para uma implementação futura

- Separar claramente **build**, **geração de listagens** e **análise da IA**.
- Exibir observações como hipóteses revisáveis, com referência a arquivo/função e justificativa legível para quem ainda não domina assembly.
- Não prometer melhoria de velocidade sem medição; considerar também tamanho do código, legibilidade, comportamento e requisitos de hardware.
- Não aplicar otimizações automaticamente. O programador deve revisar a mudança e comparar o resultado antes/depois.
