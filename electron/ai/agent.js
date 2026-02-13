/**
 * AI Agent - Orquestra as chamadas ao LLM e execução das tools
 * 
 * O agente recebe uma mensagem do usuário e:
 * 1. Envia para o LLM com as tools disponíveis
 * 2. Se o LLM pedir para executar uma tool, executa e retorna o resultado
 * 3. Repete até o LLM dar uma resposta final
 */

import { toolDefinitions, toolExecutor } from './tools.js'

const MAX_TOOL_ITERATIONS = 20 // Limite de iterações para evitar loops infinitos
const MAX_HISTORY_MESSAGES = 15 // Limite de mensagens no histórico
const MAX_TOOL_RESULT_LENGTH = 3000 // Limite de caracteres para resultado de tools

// Configurações de contexto por modelo (tokens)
const MODEL_CONTEXT_LIMITS = {
  // Modelos pequenos (padrão conservador)
  'default': { contextWindow: 4096, reserveForResponse: 1024 },
  // Modelos médios
  'Qwen/Qwen2.5-Coder-3B-Instruct': { contextWindow: 8192, reserveForResponse: 1024 },
  'Qwen/Qwen2.5-Coder-7B-Instruct': { contextWindow: 8192, reserveForResponse: 1024 },
  'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ': { contextWindow: 4096, reserveForResponse: 1024 },
  // Modelos grandes
  'gpt-4': { contextWindow: 8192, reserveForResponse: 2048 },
  'gpt-4-turbo': { contextWindow: 128000, reserveForResponse: 4096 },
  'gpt-3.5-turbo': { contextWindow: 16385, reserveForResponse: 2048 },
  'claude-3-opus': { contextWindow: 200000, reserveForResponse: 4096 },
  'claude-3-sonnet': { contextWindow: 200000, reserveForResponse: 4096 },
  'claude-3-haiku': { contextWindow: 200000, reserveForResponse: 4096 },
}

// Definição de modos de chat
export const CHAT_MODES = {
  normal: {
    name: 'Normal',
    description: 'Chat simples sem ferramentas',
    tools: [] // Sem tools
  },
  gather: {
    name: 'Gather',
    description: 'Apenas ferramentas de leitura para explorar o código',
    tools: [
      'read_file', 'list_directory', 'search_files', 'grep_code',
      'get_project_structure', 'get_file_info', 'search_codebase',
      'git_status', 'git_diff', 'git_log', 'git_branch'
    ]
  },
  agent: {
    name: 'Agent',
    description: 'Acesso completo a todas as ferramentas',
    tools: null // null = todas as tools
  }
}

/**
 * Prompts para cada modo de chat
 */
const PROMPTS = {
  // Modo Agent - Acesso completo
  agent: `Você é um assistente de código avançado do Monarco IDE com acesso total ao sistema.

PRINCÍPIOS:
- Seja preciso e eficiente
- Use ferramentas para explorar o código antes de fazer mudanças
- Confirme sempre o que vai fazer antes de modificar arquivos
- Após editar, verifique se há erros

FERRAMENTAS DISPONÍVEIS:

**LEITURA:**
- read_file: Lê arquivo {"path": "caminho"}
- list_directory: Lista diretório {"path": "caminho"}
- search_files: Busca arquivos {"pattern": "*.js"}
- grep_code: Busca texto {"query": "texto"}
- get_project_structure: Estrutura do projeto {}
- get_file_info: Info do arquivo {"path": "caminho"}
- search_codebase: Busca inteligente {"query": "termo", "type": "function|class|all"}

**ESCRITA:**
- write_file: Cria/sobrescreve arquivo {"path": "caminho", "content": "código"}
- edit_file: Edita com SEARCH/REPLACE (PREFERIDO para edições):
  {"path": "arquivo", "search_replace_blocks": "<<<<<<< ORIGINAL\ncódigo antigo\n=======\ncódigo novo\n>>>>>>> UPDATED"}
- patch_file: Edição simples {"path": "caminho", "search": "buscar", "replace": "substituir"}

**TERMINAL:**
- run_command: Executa comando {"command": "npm install"}
- open_persistent_terminal: Abre terminal para dev servers {"name": "Dev"}
- run_persistent_command: Executa em terminal persistente {"terminal_id": "id", "command": "npm run dev"}

**GIT:**
- git_status, git_diff, git_commit, git_stage, git_log, git_branch

**GERENCIAMENTO:**
- create_file_or_folder: Cria arquivo/pasta {"path": "pasta/"}
- delete_file_or_folder: Deleta {"path": "arquivo", "recursive": true}
- rename_file: Renomeia {"old_path": "antigo", "new_path": "novo"}

REGRAS:
1. Caminhos são SEMPRE relativos ao workspace (ex: "src/App.vue")
2. NUNCA use caminhos absolutos
3. Para editar, use edit_file com blocos SEARCH/REPLACE
4. Para usar ferramenta, responda APENAS:
\`\`\`tool
{"name": "ferramenta", "arguments": {}}
\`\`\``,

  // Modo Gather - Apenas leitura
  gather: `Você é um assistente de análise de código do Monarco IDE.

Você tem acesso APENAS a ferramentas de LEITURA para explorar e entender o código.
Você NÃO pode modificar arquivos - apenas analisar e explicar.

FERRAMENTAS DISPONÍVEIS:
- read_file: Lê arquivo {"path": "caminho"}
- list_directory: Lista diretório {"path": "caminho"}
- search_files: Busca arquivos {"pattern": "*.js"}
- grep_code: Busca texto {"query": "texto"}
- get_project_structure: Estrutura do projeto {}
- search_codebase: Busca inteligente {"query": "termo"}
- git_status, git_log, git_diff (apenas leitura)

COMO AJUDAR:
- Explore o código para responder perguntas
- Explique a arquitetura e estrutura do projeto
- Encontre onde funcionalidades estão implementadas
- Sugira melhorias (sem modificar)

Para usar ferramenta:
\`\`\`tool
{"name": "ferramenta", "arguments": {}}
\`\`\``,

  // Modo Normal - Chat simples
  normal: `Você é um assistente de programação do Monarco IDE.

Você é um especialista em programação que pode:
- Responder perguntas sobre código
- Explicar conceitos de programação
- Sugerir soluções e melhores práticas
- Ajudar a debugar lógica

Neste modo você NÃO tem acesso a ferramentas.
Responda com base no seu conhecimento e no contexto da conversa.

Seja conciso e prático nas respostas.`
}

// Prompt legado para compatibilidade
const SYSTEM_PROMPT = PROMPTS.agent

/**
 * Classe do Agente de IA
 */
export class AIAgent {
  constructor(settings = {}) {
    this.settings = {
      // endpoint: settings.endpoint || 'http://192.168.1.18:8000/v1/chat/completions',
      endpoint: settings.endpoint || 'https://ia.auth.com.br/v1/chat/completions',
      model: settings.model || 'Qwen/Qwen2.5-Coder-3B-Instruct',
      temperature: settings.temperature || 0.2,
      maxTokens: settings.maxTokens || 4096,
      ...settings
    }
    this.conversationHistory = []
    this.onToolCall = null // Callback para notificar frontend sobre tool calls
    this.onChunk = null // Callback para streaming (futuro)
    this.chatMode = 'agent' // Modo padrão: agent (todas as tools)
  }

  /**
   * Define o modo de chat
   */
  setMode(mode) {
    if (CHAT_MODES[mode]) {
      this.chatMode = mode
      return { success: true, mode: CHAT_MODES[mode].name }
    }
    throw new Error(`Modo inválido: ${mode}. Use: normal, gather, agent`)
  }

  /**
   * Retorna o modo atual
   */
  getMode() {
    return {
      mode: this.chatMode,
      ...CHAT_MODES[this.chatMode]
    }
  }

  /**
   * Retorna as tools disponíveis para o modo atual
   */
  getAvailableTools() {
    const modeConfig = CHAT_MODES[this.chatMode]
    if (!modeConfig) return toolDefinitions
    
    // null = todas as tools
    if (modeConfig.tools === null) return toolDefinitions
    
    // Array vazio = sem tools
    if (modeConfig.tools.length === 0) return []
    
    // Filtra tools pelo nome
    return toolDefinitions.filter(t => 
      modeConfig.tools.includes(t.function.name)
    )
  }

  /**
   * Retorna o system prompt para o modo atual
   */
  getSystemPrompt() {
    return PROMPTS[this.chatMode] || PROMPTS.agent
  }

  /**
   * Retorna os limites de contexto para o modelo atual
   */
  getContextLimits() {
    return MODEL_CONTEXT_LIMITS[this.settings.model] || MODEL_CONTEXT_LIMITS['default']
  }

  /**
   * Estima o número de tokens em uma string
   * Usa aproximação: ~4 caracteres = 1 token (conservador)
   * Pode ser substituído por tiktoken no futuro
   */
  estimateTokens(text) {
    if (!text) return 0
    // Aproximação: 1 token ~ 4 caracteres para inglês
    // Para português/código, usamos 3.5 para ser mais conservador
    return Math.ceil(text.length / 3.5)
  }

  /**
   * Estima tokens de uma mensagem (incluindo overhead de formato)
   */
  estimateMessageTokens(message) {
    let tokens = 4 // overhead por mensagem (role, etc)
    if (message.content) {
      tokens += this.estimateTokens(message.content)
    }
    if (message.tool_calls) {
      tokens += this.estimateTokens(JSON.stringify(message.tool_calls))
    }
    return tokens
  }

  /**
   * Calcula tokens totais de um array de mensagens
   */
  calculateTotalTokens(messages) {
    let total = 3 // overhead de início/fim de conversa
    for (const msg of messages) {
      total += this.estimateMessageTokens(msg)
    }
    return total
  }

  /**
   * Configura o workspace para as tools
   */
  setWorkspace(workspacePath) {
    toolExecutor.setWorkspace(workspacePath)
  }

  /**
   * Atualiza configurações
   */
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings }
  }

  /**
   * Limpa histórico de conversa
   */
  clearHistory() {
    this.conversationHistory = []
  }

  /**
   * Envia mensagem e processa resposta (com loop de tools)
   */
  async chat(userMessage, options = {}) {
    // Adiciona mensagem do usuário ao histórico
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    })

    // Limita o tamanho do histórico
    this.trimHistory()

    let iterations = 0
    let finalResponse = null

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++

      // Monta mensagens para o LLM (usando histórico limitado)
      const messages = [
        { role: 'system', content: this.getSystemPrompt() },
        ...this.getRecentHistory()
      ]

      // Chama o LLM
      const response = await this.callLLM(messages, options.useTools !== false)

      // Verifica se o LLM quer usar uma tool
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Processa cada tool call
        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name
          let toolArgs = {}
          
          try {
            toolArgs = JSON.parse(toolCall.function.arguments)
          } catch (e) {
            console.error('Erro ao parsear argumentos da tool:', e)
          }

          // Notifica frontend (se callback configurado)
          if (this.onToolCall) {
            this.onToolCall({
              name: toolName,
              arguments: toolArgs,
              status: 'executing'
            })
          }

          // Executa a tool
          let toolResult
          try {
            toolResult = await toolExecutor.execute(toolName, toolArgs)
          } catch (error) {
            toolResult = { error: error.message }
          }

          // Notifica conclusão
          if (this.onToolCall) {
            this.onToolCall({
              name: toolName,
              arguments: toolArgs,
              status: 'completed',
              result: toolResult
            })
          }

          // Adiciona resultado ao histórico (truncado)
          const resultStr = this.truncateResult(JSON.stringify(toolResult, null, 2))
          this.conversationHistory.push({
            role: 'assistant',
            content: null,
            tool_calls: [toolCall]
          })

          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultStr
          })
        }
      } else {
        // LLM deu resposta final
        finalResponse = response.content || ''
        
        // Verifica se o modelo quis usar uma tool mas não usou o formato correto
        const extractedToolCall = this.extractToolCallFromText(finalResponse)
        
        if (extractedToolCall) {
          // Executa a tool extraída do texto
          const { name: toolName, arguments: toolArgs } = extractedToolCall
          
          // Notifica frontend
          if (this.onToolCall) {
            this.onToolCall({
              name: toolName,
              arguments: toolArgs,
              status: 'executing'
            })
          }
          
          // Executa a tool
          let toolResult
          try {
            toolResult = await toolExecutor.execute(toolName, toolArgs)
          } catch (error) {
            toolResult = { error: error.message }
          }
          
          // Notifica conclusão
          if (this.onToolCall) {
            this.onToolCall({
              name: toolName,
              arguments: toolArgs,
              status: 'completed',
              result: toolResult
            })
          }
          
          // Formata o resultado para exibir diretamente ao usuário
          const resultStr = this.truncateResult(JSON.stringify(toolResult, null, 2))
          const formattedResult = this.formatToolResult(toolName, toolArgs, toolResult)
          
          // Adiciona ao histórico
          this.conversationHistory.push({
            role: 'assistant',
            content: formattedResult
          })
          
          // Retorna o resultado formatado diretamente
          finalResponse = formattedResult
          break
        }
        
        // Adiciona ao histórico
        this.conversationHistory.push({
          role: 'assistant',
          content: finalResponse
        })

        break
      }
    }

    if (!finalResponse && iterations >= MAX_TOOL_ITERATIONS) {
      finalResponse = 'Desculpe, atingi o limite de operações. Por favor, reformule sua pergunta.'
      this.conversationHistory.push({
        role: 'assistant',
        content: finalResponse
      })
    }

    return {
      content: finalResponse,
      iterations
    }
  }

  /**
   * Chama o LLM (compatível com API OpenAI)
   * Inclui gerenciamento dinâmico de tokens
   */
  async callLLM(messages, useTools = true, retryCount = 0) {
    const MAX_RETRIES = 2
    const { contextWindow, reserveForResponse } = this.getContextLimits()
    
    // Calcula tokens usados nas mensagens
    const messagesTokens = this.calculateTotalTokens(messages)
    
    // Calcula tokens para tools (se habilitadas)
    let toolsTokens = 0
    let availableTools = []
    if (useTools) {
      availableTools = this.getAvailableTools()
      if (availableTools.length > 0) {
        // Estima tokens das definições de tools
        toolsTokens = this.estimateTokens(JSON.stringify(availableTools))
      }
    }
    
    // Calcula total e verifica se cabe
    const usedTokens = messagesTokens + toolsTokens
    const availableForResponse = contextWindow - usedTokens - 50
    
    // Se tools ocupam muito espaço, desabilita tools
    if (toolsTokens > contextWindow * 0.6) {
      console.warn(`[AI Agent] ⚠️ Tools muito grandes (${toolsTokens} tokens). Desabilitando tools.`)
      useTools = false
      availableTools = []
      toolsTokens = 0
    }
    
    // Recalcula após possível remoção de tools
    const finalUsedTokens = messagesTokens + toolsTokens
    const finalAvailable = contextWindow - finalUsedTokens - 50
    
    // Garante um mínimo de tokens para resposta
    const minResponseTokens = 256
    let maxTokens = Math.max(minResponseTokens, Math.min(finalAvailable, reserveForResponse))
    
    // Se ainda não couber, trunca mensagens
    if (finalAvailable < minResponseTokens) {
      console.warn(`[AI Agent] ⚠️ Contexto cheio: ${finalUsedTokens}/${contextWindow} tokens`)
      maxTokens = minResponseTokens
    }
    
    console.log(`[AI Agent] Tokens: msgs=${messagesTokens}, tools=${toolsTokens}, max_resp=${maxTokens}, ctx=${contextWindow}`)
    
    const body = {
      model: this.settings.model,
      messages: messages,
      temperature: this.settings.temperature,
      max_tokens: maxTokens
    }

    // Adiciona tools se habilitado e couber
    if (useTools && availableTools.length > 0) {
      body.tools = availableTools
      body.tool_choice = 'auto'
    }

    try {
      // Opções para o fetch
      const fetchOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }

      // Se houver uma API Key nas configurações, adiciona o header
      if (this.settings.apiKey) {
        fetchOptions.headers['Authorization'] = `Bearer ${this.settings.apiKey}`
      }

      const response = await fetch(this.settings.endpoint, fetchOptions)

      if (!response.ok) {
        const errorText = await response.text()
        
        // Trata erro de contexto específico
        if (errorText.includes('maximum context length') || errorText.includes('too many tokens')) {
          if (retryCount >= MAX_RETRIES) {
            console.error('[AI Agent] Máximo de retries atingido. Abortando.')
            throw new Error('Contexto muito grande. Tente uma pergunta mais curta ou limpe o histórico.')
          }
          
          console.warn(`[AI Agent] Erro de contexto - retry ${retryCount + 1}/${MAX_RETRIES}`)
          
          // Estratégia de retry:
          // 1. Primeiro retry: desabilita tools
          // 2. Segundo retry: trunca histórico também
          const shouldDisableTools = retryCount === 0 && useTools
          const shouldTruncateHistory = retryCount >= 1
          
          if (shouldTruncateHistory) {
            const halfLength = Math.max(1, Math.floor(this.conversationHistory.length / 2))
            this.conversationHistory = this.conversationHistory.slice(-halfLength)
          }
          
          const retryMessages = [
            { role: 'system', content: this.getSystemPrompt() },
            ...this.getRecentHistory()
          ]
          
          return await this.callLLM(retryMessages, !shouldDisableTools && useTools, retryCount + 1)
        }
        
        throw new Error(`Erro na API: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      const choice = data.choices?.[0]

      if (!choice) {
        throw new Error('Resposta inválida do LLM')
      }

      return {
        content: choice.message?.content || null,
        tool_calls: choice.message?.tool_calls || null,
        finish_reason: choice.finish_reason
      }
    } catch (error) {
      console.error('❌ [AI Agent] Erro detalhado ao chamar LLM:', {
        message: error.message,
        code: error.code,
        cause: error.cause, // Importante para ver o erro real do fetch
        endpoint: this.settings.endpoint
      })
      throw error
    }
  }

  /**
   * Processa uma pergunta simples (sem tools)
   */
  async simpleChat(userMessage) {
    return await this.chat(userMessage, { useTools: false })
  }

  /**
   * Limita o tamanho do histórico para evitar estouro de contexto
   * Agora usa contagem de tokens ao invés de apenas número de mensagens
   */
  trimHistory() {
    const { contextWindow, reserveForResponse } = this.getContextLimits()
    const systemPromptTokens = this.estimateTokens(this.getSystemPrompt())
    const maxHistoryTokens = contextWindow - systemPromptTokens - reserveForResponse - 100 // margem
    
    // Remove mensagens antigas até caber no limite de tokens
    while (this.conversationHistory.length > 0) {
      const historyTokens = this.calculateTotalTokens(this.conversationHistory)
      if (historyTokens <= maxHistoryTokens) break
      
      // Remove a mensagem mais antiga (preserva a última do usuário se possível)
      if (this.conversationHistory.length > 2) {
        this.conversationHistory.shift()
      } else {
        // Se só sobraram 2 mensagens e ainda não cabe, trunca o conteúdo
        const oldestMsg = this.conversationHistory[0]
        if (oldestMsg && oldestMsg.content && oldestMsg.content.length > 500) {
          oldestMsg.content = oldestMsg.content.substring(0, 500) + '\n... [truncado]'
        }
        break
      }
    }
    
    // Limite máximo de mensagens como fallback
    if (this.conversationHistory.length > MAX_HISTORY_MESSAGES * 2) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_HISTORY_MESSAGES * 2)
    }
  }

  /**
   * Retorna histórico recente para enviar ao LLM
   * Garante que o total de tokens não ultrapasse o limite
   */
  getRecentHistory() {
    const { contextWindow, reserveForResponse } = this.getContextLimits()
    const systemPromptTokens = this.estimateTokens(this.getSystemPrompt())
    const maxHistoryTokens = contextWindow - systemPromptTokens - reserveForResponse - 100
    
    // Começa do fim e vai adicionando mensagens até atingir o limite
    const result = []
    let currentTokens = 0
    
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const msg = this.conversationHistory[i]
      const msgTokens = this.estimateMessageTokens(msg)
      
      if (currentTokens + msgTokens > maxHistoryTokens) {
        // Não cabe mais, para aqui
        break
      }
      
      result.unshift(msg)
      currentTokens += msgTokens
    }
    
    console.log(`[AI Agent] Histórico: ${result.length} msgs, ~${currentTokens} tokens (limite: ${maxHistoryTokens})`)
    return result
  }

  /**
   * Trunca resultado de tool se for muito grande
   */
  truncateResult(resultStr) {
    if (resultStr.length > MAX_TOOL_RESULT_LENGTH) {
      return resultStr.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n... [truncado - resultado muito longo]'
    }
    return resultStr
  }

  /**
   * Formata resultado de tool para exibição ao usuário
   */
  formatToolResult(toolName, toolArgs, result) {
    if (result.error) {
      return `**Erro ao executar ${toolName}:** ${result.error}`
    }
    
    switch (toolName) {
      case 'read_file':
        const content = result.content || ''
        const lines = result.lines || 0
        const ext = toolArgs.path.split('.').pop()
        return `**Arquivo:** \`${toolArgs.path}\` (${lines} linhas)

\`\`\`${ext}
${content}
\`\`\``
      
      case 'get_project_structure':
        const tree = result.structure || JSON.stringify(result, null, 2)
        return `**Estrutura do projeto:**

\`\`\`
${tree}
\`\`\``
      
      case 'list_directory':
        const files = result.entries || result.files || []
        if (Array.isArray(files) && files.length > 0) {
          const fileList = files.map(f => {
            const icon = f.type === 'directory' ? '📁' : '📄'
            return `${icon} ${f.name}`
          }).join('\n')
          return `**Conteúdo de \`${toolArgs.path || '.'}\`:**\n\n${fileList}`
        }
        return `**Diretório \`${toolArgs.path || '.'}\` está vazio.**`
      
      case 'search_files':
        const found = result.matches || result.files || []
        if (Array.isArray(found) && found.length > 0) {
          const foundList = found.map(f => `- \`${f.path || f.name || f}\``).join('\n')
          return `**Arquivos encontrados (padrão: \`${toolArgs.pattern}\`):**

${foundList}

*Total: ${found.length} arquivo(s)*`
        }
        return `**Nenhum arquivo encontrado com o padrão \`${toolArgs.pattern}\`**`
      
      case 'grep_code':
        const matches = result.results || result.matches || []
        if (Array.isArray(matches) && matches.length > 0) {
          const matchList = matches.map(m => {
            const filePath = m.path || ''
            const fileMatches = m.matches || []
            if (fileMatches.length === 0) return ''
            
            const lines = fileMatches.slice(0, 5).map(match => 
              `  Linha ${match.line}: \`${match.content}\``
            ).join('\n')
            const moreText = fileMatches.length > 5 ? `\n  *(+${fileMatches.length - 5} ocorrência(s))*` : ''
            
            return `**${filePath}**\n${lines}${moreText}`
          }).filter(Boolean).join('\n\n')
          
          const totalMatches = matches.reduce((sum, m) => sum + (m.matches?.length || 0), 0)
          return `**Busca por \`${toolArgs.query}\`:**

${matchList}

*Total: ${totalMatches} ocorrência(s) em ${matches.length} arquivo(s)*`
        }
        return `**Nenhum resultado para \`${toolArgs.query}\`**`
      
      case 'get_file_info':
        return `**Arquivo:** \`${toolArgs.path}\`
- **Nome:** ${result.name || 'N/A'}
- **Tamanho:** ${result.size_readable || result.size_bytes + ' bytes' || 'N/A'}
- **Linhas:** ${result.lines || 'N/A'}
- **Linguagem:** ${result.language || result.extension || 'N/A'}
- **Modificado:** ${result.modified ? new Date(result.modified).toLocaleString('pt-BR') : 'N/A'}`
      
      case 'write_file':
        return `✅ **Arquivo escrito com sucesso!**

- **Arquivo:** \`${result.path}\`
- **Linhas:** ${result.lines}
- **Bytes:** ${result.bytes}
- **Ação:** ${result.action === 'written' ? 'Criado/Sobrescrito' : result.action}`
      
      case 'patch_file':
        const lineDiff = result.new_lines - result.old_lines
        const diffStr = lineDiff > 0 ? `+${lineDiff}` : lineDiff < 0 ? `${lineDiff}` : '0'
        const matchInfo = result.matched ? `\n- **Texto encontrado:** \`${result.matched}\`` : ''
        return `✅ **Arquivo modificado com sucesso!**

- **Arquivo:** \`${result.path}\`
- **Linhas antes:** ${result.old_lines}
- **Linhas depois:** ${result.new_lines} (${diffStr})${matchInfo}
- **Ação:** Patch aplicado`
      
      case 'insert_at_line':
        return `✅ **Conteúdo inserido com sucesso!**

- **Arquivo:** \`${result.path}\`
- **Linha:** ${result.line}
- **Modo:** ${result.action.replace('inserted_', '')}
- **Total de linhas:** ${result.new_total_lines}`
      
      case 'search_codebase':
        const searchResults = result.results || []
        if (searchResults.length === 0) {
          return `**Busca por \`${result.query}\`:** Nenhum resultado encontrado.`
        }
        
        // Agrupa por arquivo
        const byFile = {}
        searchResults.forEach(r => {
          if (!byFile[r.file]) byFile[r.file] = []
          byFile[r.file].push(r)
        })
        
        let output = `**🔍 Busca por \`${result.query}\`** (${result.total} resultado(s))\n\n`
        
        Object.entries(byFile).slice(0, 10).forEach(([file, matches]) => {
          output += `**📄 ${file}**\n`
          matches.slice(0, 3).forEach(m => {
            const typeIcon = {
              'function': '⚡',
              'class': '🏛️',
              'variable': '📊',
              'import': '📦',
              'component': '🧩',
              'text': '📝'
            }[m.type] || '📝'
            
            output += `  ${typeIcon} Linha ${m.line}: \`${m.match}\`\n`
          })
          if (matches.length > 3) {
            output += `  *+${matches.length - 3} resultado(s)...*\n`
          }
          output += '\n'
        })
        
        if (Object.keys(byFile).length > 10) {
          output += `*+${Object.keys(byFile).length - 10} arquivo(s)...*\n`
        }
        
        return output
      
      // ===== Terminal Tools =====
      case 'run_command':
        const cmdStatus = result.success ? '✅' : '❌'
        const cmdOutput = result.output || '(sem output)'
        return `${cmdStatus} **Comando:** \`${result.command}\`

\`\`\`
${cmdOutput.substring(0, 2000)}
\`\`\`
${result.exit_code !== 0 ? `\n*Código de saída: ${result.exit_code}*` : ''}`
      
      case 'open_persistent_terminal':
        return `💻 **Terminal persistente criado!**

- **ID:** \`${result.terminal_id}\`
- **Nome:** ${result.name}
- **Diretório:** \`${result.cwd}\`

Use \`run_persistent_command\` com este ID para executar comandos.`
      
      case 'run_persistent_command':
        const pcOutput = result.output || '(aguardando output...)'
        const statusMsg = result.completed ? '(comando finalizado)' : '(comando rodando em background)'
        return `💻 **Terminal \`${result.terminal_id}\`** ${statusMsg}

\`\`\`
${pcOutput.substring(0, 2000)}
\`\`\``
      
      case 'kill_persistent_terminal':
        return `✅ **Terminal encerrado:** \`${result.terminal_id}\``
      
      case 'list_terminals':
        if (!result.terminals || result.terminals.length === 0) {
          return '**Nenhum terminal ativo.**'
        }
        const termList = result.terminals.map(t => 
          `- \`${t.id}\` - ${t.name} ${t.running ? '🟢' : '🔴'}`
        ).join('\n')
        return `**Terminais ativos (${result.count}):**\n\n${termList}`
      
      // ===== File Management =====
      case 'create_file_or_folder':
        const typeIcon = result.type === 'folder' ? '📁' : '📄'
        return `✅ ${typeIcon} **${result.type === 'folder' ? 'Pasta' : 'Arquivo'} criado:** \`${result.path}\``
      
      case 'delete_file_or_folder':
        return `✅ **${result.type === 'folder' ? 'Pasta' : 'Arquivo'} deletado:** \`${result.path}\``
      
      case 'rename_file':
        return `✅ **Renomeado:** \`${result.old_path}\` → \`${result.new_path}\``
      
      // ===== Fast Apply =====
      case 'edit_file':
        const editDiff = result.new_lines - result.old_lines
        const editDiffStr = editDiff > 0 ? `+${editDiff}` : editDiff < 0 ? `${editDiff}` : '0'
        let editOutput = `✅ **Arquivo editado:** \`${result.path}\`

- **Blocos aplicados:** ${result.blocks_applied}
- **Linhas:** ${result.old_lines} → ${result.new_lines} (${editDiffStr})`
        if (result.errors && result.errors.length > 0) {
          editOutput += `\n- **⚠️ Erros:** ${result.errors.length} bloco(s) não aplicado(s)`
        }
        return editOutput
      
      // ===== Git Tools =====
      case 'git_status':
        const filesStr = result.files.map(f => `\`${f.status}\` ${f.path}`).join('\n') || '(nenhuma mudança)'
        return `**🔀 Git Status (branch: \`${result.branch}\`):**

- Staged: ${result.staged}
- Unstaged: ${result.unstaged}
- Untracked: ${result.untracked}

${filesStr}`
      
      case 'git_log':
        const commits = result.commits || []
        if (commits.length === 0) return '**Nenhum commit encontrado.**'
        const commitList = commits.slice(0, 5).map(c => 
          `- \`${c.shortHash}\` ${c.subject} *(${c.author})*`
        ).join('\n')
        return `**📝 Últimos commits:**\n\n${commitList}`
      
      default:
        return `**Resultado:**

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\``
    }
  }

  /**
   * Retorna histórico formatado
   */
  getHistory() {
    return this.conversationHistory.filter(m => 
      m.role === 'user' || (m.role === 'assistant' && m.content)
    )
  }

  /**
   * Extrai chamada de tool do texto quando o modelo não usa o formato correto
   * Detecta padrões como: ```tool {"name": "tool_name", "arguments": {...}} ```
   */
  extractToolCallFromText(text) {
    if (!text) return null
    
    // Lista de nomes de tools válidas
    const validTools = [
      'read_file', 'list_directory', 'search_files', 'grep_code', 
      'get_project_structure', 'get_file_info',
      'write_file', 'patch_file', 'insert_at_line', 'edit_file',
      'create_file_or_folder', 'delete_file_or_folder', 'rename_file',
      'run_command', 'open_persistent_terminal', 'run_persistent_command',
      'kill_persistent_terminal', 'list_terminals',
      'search_codebase',
      'git_status', 'git_diff', 'git_commit', 'git_stage', 'git_log', 'git_branch'
    ]
    
    // Padrões para detectar chamadas de tool
    const patterns = [
      // Formato preferido: ```tool {...} ```
      /```tool\s*\n?([\s\S]*?)```/,
      // Formato alternativo: ```json {...} ```
      /```json\s*\n?([\s\S]*?)```/,
      // Formato simples: ``` {...} ```
      /```\s*\n?(\{[\s\S]*?\})\s*```/,
      // JSON solto com name e arguments
      /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/,
      // JSON com path, search, replace (patch_file)
      /\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"search"\s*:\s*"([^"]*?)"\s*,\s*"replace"\s*:\s*"([^"]*?)"\s*\}/,
      // JSON com path e content (write_file)
      /\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"([\s\S]*?)"\s*\}/
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        try {
          // Caso especial: patch_file com path, search, replace diretos
          if (match.length === 4 && match[0].includes('"search"')) {
            console.log('[AI Agent] Tool patch_file detectada (formato direto)')
            return {
              name: 'patch_file',
              arguments: {
                path: match[1],
                search: match[2],
                replace: match[3]
              }
            }
          }
          
          // Caso especial: write_file com path e content diretos
          if (match.length === 3 && match[0].includes('"content"')) {
            console.log('[AI Agent] Tool write_file detectada (formato direto)')
            return {
              name: 'write_file',
              arguments: {
                path: match[1],
                content: match[2]
              }
            }
          }
          
          let jsonStr = match[1]
          
          // Se o padrão já capturou name e arguments separados
          if (match[2]) {
            const toolName = match[1]
            if (validTools.includes(toolName)) {
              const args = JSON.parse(match[2])
              console.log(`[AI Agent] Tool detectada via regex: ${toolName}`, args)
              return { name: toolName, arguments: args }
            }
            continue
          }
          
          // Limpa o JSON
          jsonStr = jsonStr.trim()
          
          // Tenta parsear
          const parsed = JSON.parse(jsonStr)
          
          if (parsed.name && validTools.includes(parsed.name)) {
            console.log(`[AI Agent] Tool detectada: ${parsed.name}`, parsed.arguments)
            return { 
              name: parsed.name, 
              arguments: parsed.arguments || {} 
            }
          }
        } catch (e) {
          console.log('[AI Agent] Erro ao parsear JSON:', e.message)
          // Continua tentando outros padrões
        }
      }
    }
    
    // Tenta encontrar qualquer JSON com "name" de uma tool válida
    for (const toolName of validTools) {
      const simplePattern = new RegExp(`"name"\\s*:\\s*"${toolName}"`, 'i')
      if (simplePattern.test(text)) {
        // Tenta extrair o JSON completo
        const jsonMatch = text.match(/\{[\s\S]*?"name"[\s\S]*?"arguments"[\s\S]*?\{[\s\S]*?\}[\s\S]*?\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.name && parsed.arguments) {
              console.log(`[AI Agent] Tool detectada via busca: ${parsed.name}`, parsed.arguments)
              return { name: parsed.name, arguments: parsed.arguments }
            }
          } catch (e) {
            // Continua
          }
        }
      }
    }
    
    return null
  }
}

// Exporta instância singleton
export const aiAgent = new AIAgent()

export default AIAgent
