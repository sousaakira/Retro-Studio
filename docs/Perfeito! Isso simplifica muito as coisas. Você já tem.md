Perfeito! Isso simplifica muito as coisas. Você já tem:

- **vLLM** rodando (ótimo para performance)
- **API compatível com OpenAI** (facilita integração)
- **Modelo focado em código** (Qwen2.5-Coder é excelente)

## Arquitetura que Vamos Usar

```
┌─────────────────────────────────────────────────────────────┐
│                      MONARCO IDE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │   AIChat     │ ───▶ │   AI Agent   │                     │
│  │  (Frontend)  │      │  (Backend)   │                     │
│  └──────────────┘      └──────┬───────┘                     │
│                               │                             │
│         ┌─────────────────────┼─────────────────────┐       │
│         │                     │                     │       │
│         ▼                     ▼                     ▼       │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐  │
│  │  read_file  │      │ list_dir    │      │ grep_code   │  │
│  └─────────────┘      └─────────────┘      └─────────────┘  │
│         │                     │                     │       │
│         └─────────────────────┼─────────────────────┘       │
│                               │                             │
│                               ▼                             │
│                     ┌─────────────────┐                     │
│                     │   File System   │                     │
│                     └─────────────────┘                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   vLLM (Local)      │
                    │   192.168.1.18:8000 │
                    └─────────────────────┘
```

## Plano de Implementação

### Fase 1 - Infraestrutura Base
| Tarefa | Descrição |
|--------|-----------|
| 1.1 | Criar cliente HTTP para vLLM no Electron |
| 1.2 | Criar sistema de Tools (executor) |
| 1.3 | Configurar URL do vLLM nas settings |

### Fase 2 - Tools de Leitura
| Tool | O que faz |
|------|-----------|
| `read_file` | Lê conteúdo de arquivo |
| `list_directory` | Lista arquivos/pastas |
| `search_files` | Busca por nome (glob) |
| `grep_code` | Busca texto no código |
| `get_project_structure` | Árvore do projeto |

### Fase 3 - Loop do Agente
O agente funciona assim:

```
Usuário: "Como funciona o FileTree?"
         │
         ▼
┌─────────────────────────────────────────┐
│ 1. LLM analisa a pergunta               │
│ 2. LLM decide usar: search_files        │
│    → Encontra: FileTree.vue             │
│ 3. LLM decide usar: read_file           │
│    → Lê o conteúdo                      │
│ 4. LLM gera resposta com contexto       │
└─────────────────────────────────────────┘
         │
         ▼
IA: "O FileTree é um componente Vue que..."
```

---

## Vamos Começar?

Sugiro criarmos nesta ordem:

1. **Configuração do vLLM** - Salvar URL nas settings
2. **Cliente de IA** - Fazer chamadas ao vLLM
3. **Sistema de Tools** - Estrutura para executar ferramentas
4. **Tools básicas** - read_file, list_directory, grep_code
5. **Integrar no AIChat** - Conectar tudo

Quer que eu comece implementando? Vou criar a estrutura base primeiro.