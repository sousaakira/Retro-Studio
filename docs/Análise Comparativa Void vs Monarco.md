Vou analisar o projeto Void para identificar melhorias que podemos aplicar ao Monarco. Vou explorar a estrutura de ambos os projetos.
Interessante! O projeto Void parece ser um fork do VS Code. Vou explorar a estrutura de fontes e a parte de IA:
Excelente! O Void é um fork do VS Code com recursos de IA. Vou explorar a pasta de contribuição do Void onde está o código específico de IA:
Vou explorar os arquivos chave do Void para entender as funcionalidades de IA:
Excelente! Agora vou comparar com o que temos no Monarco para identificar melhorias:
Analisei profundamente ambos os projetos. Baseado no Void, identifiquei diversas melhorias importantes para o Monarco. Vou criar um plano detalhado:
## Análise Comparativa: Void vs Monarco

Após analisar profundamente ambos os projetos, identifiquei várias melhorias significativas que podemos implementar no Monarco baseadas no Void:

---

### **1. Suporte a Múltiplos Provedores de IA** 
**O que o Void tem:**
- Suporte nativo a 15+ provedores: Anthropic, OpenAI, Gemini, DeepSeek, Ollama, vLLM, OpenRouter, Groq, xAI, Mistral, LM Studio, etc.
- Configuração dinâmica de modelos com capacidades detalhadas (contextWindow, tokenSpace, reasoning, FIM)
- Auto-detecção de modelos locais (Ollama, vLLM, LM Studio)

**O que o Monarco tem:**
- Apenas 1 endpoint configurável manualmente

---

### **2. Modos de Chat Inteligentes**
**O que o Void tem:**
- **Normal**: Chat simples, sem tools
- **Gather**: Apenas ferramentas de leitura (explorar código, buscar arquivos)
- **Agent**: Acesso completo a todas as ferramentas (editar, terminal, etc)

**O que o Monarco tem:**
- Apenas modo agent (sem distinção)

---

### **3. Ferramentas Avançadas**
**O que o Void tem mas Monarco não:**
| Ferramenta | Descrição |
|------------|-----------|
| `run_command` | Executa comando no terminal e espera resultado |
| `run_persistent_command` | Comando em terminal persistente (dev servers) |
| `open_persistent_terminal` | Abre terminal que roda em background |
| `kill_persistent_terminal` | Mata terminal persistente |
| `read_lint_errors` | Lê erros de lint de um arquivo |
| `get_dir_tree` | Estrutura de diretório em árvore |
| `search_in_file` | Busca dentro de arquivo específico |
| `create_file_or_folder` | Cria arquivo OU pasta |
| `delete_file_or_folder` | Deleta arquivo/pasta |
| Suporte MCP | Model Context Protocol para tools externas |

---

### **4. Sistema de Fast Apply (Muito Importante!)**
**O que o Void tem:**
```
<<<<<<< ORIGINAL
// código original
=======
// código novo
>>>>>>> UPDATED
```
- Permite edições precisas em arquivos grandes (1000+ linhas)
- Muito mais eficiente que reescrever o arquivo inteiro

**O que o Monarco tem:**
- `patch_file` com busca simples (funciona, mas menos robusto)

---

### **5. Prompts e System Messages Profissionais**
**O que o Void tem:**
- Prompts estruturados com contexto do sistema (OS, workspace, arquivos abertos)
- Informações de diretório do projeto automaticamente
- Regras específicas por modo (Agent vs Gather vs Normal)
- Detalhes sobre quando NÃO usar tools

---

### **6. Recursos de Reasoning (Raciocínio)**
**O que o Void tem:**
- Suporte a modelos de raciocínio (o1, o3, Claude 3.5 Sonnet, DeepSeek R1, Qwen QWQ)
- Configuração de "thinking budget" para modelos que suportam
- Parse automático de `<think>` tags

---

## Recomendações de Implementação (Prioridade)

### **Alta Prioridade:**
1. **Ferramentas de Terminal** - Permitir que a IA rode comandos (npm, git, build)
2. **Fast Apply** - Implementar blocos SEARCH/REPLACE para edições precisas
3. **Modos de Chat** - Gather (só leitura) vs Agent (tudo)

### **Média Prioridade:**
4. **Múltiplos Provedores** - Anthropic, OpenAI, Gemini (APIs pagas são melhores)
5. **Lint Errors** - Ler erros do Monaco Editor
6. **Melhores Prompts** - System message mais estruturado

### **Baixa Prioridade:**
7. **MCP Tools** - Extensibilidade via Model Context Protocol
8. **Reasoning** - Suporte a modelos de raciocínio

---

Quer que eu comece a implementar alguma dessas melhorias? Posso começar pelas ferramentas de terminal ou pelo sistema de Fast Apply, que são as mais impactantes para a experiência de desenvolvimento.