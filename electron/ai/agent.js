/**
 * AI Agent - Orquestra as chamadas ao LLM e execução das tools
 * 
 * O agente recebe uma mensagem do usuário e:
 * 1. Envia para o LLM com as tools disponíveis
 * 2. Se o LLM pedir para executar uma tool, executa e retorna o resultado
 * 3. Repete até o LLM dar uma resposta final
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { toolDefinitions, toolExecutor } from './tools.js'
import { searchRelevantChunks, formatRelevantFilesBlock } from './rag/search.js'
import { getSymbolsFromCFile } from './ast/cParser.js'
import { getSdkApiBlock, isSgdkProject } from './sdk/sgdkApi.js'
import { buildGameGraph, formatGameGraphBlock } from './gameGraph.js'

const MAX_TOOL_ITERATIONS = 20 // Limite de iterações para evitar loops infinitos
const MAX_HISTORY_MESSAGES = 15 // Limite de mensagens no histórico
const MAX_TOOL_RESULT_LENGTH = 3000 // Limite de caracteres para resultado de tools

// Configurações de contexto por modelo (tokens)
const MODEL_CONTEXT_LIMITS = {
  // Modelos pequenos (padrão conservador)
  'default': { contextWindow: 4096, reserveForResponse: 1024 },
  // Modelos médios (local)
  'Qwen/Qwen2.5-Coder-3B-Instruct': { contextWindow: 8192, reserveForResponse: 1024 },
  'Qwen/Qwen2.5-Coder-7B-Instruct': { contextWindow: 8192, reserveForResponse: 1024 },
  'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ': { contextWindow: 4096, reserveForResponse: 1024 },
  // DashScope/Qwen cloud
  'qwen-turbo': { contextWindow: 8192, reserveForResponse: 2048 },
  'qwen-plus': { contextWindow: 32768, reserveForResponse: 2048 },
  'qwen-max': { contextWindow: 32768, reserveForResponse: 4096 },
  'qwen-flash': { contextWindow: 8192, reserveForResponse: 2048 },
  'qwen-coder': { contextWindow: 32768, reserveForResponse: 2048 },
  'qwen3-8b': { contextWindow: 32768, reserveForResponse: 2048 },
  'qwen3-32b': { contextWindow: 32768, reserveForResponse: 4096 },
  // Modelos grandes
  'gpt-4': { contextWindow: 8192, reserveForResponse: 2048 },
  'gpt-4-turbo': { contextWindow: 128000, reserveForResponse: 4096 },
  'gpt-3.5-turbo': { contextWindow: 16385, reserveForResponse: 2048 },
  'claude-3-opus': { contextWindow: 200000, reserveForResponse: 4096 },
  'claude-3-sonnet': { contextWindow: 200000, reserveForResponse: 4096 },
  'claude-3-haiku': { contextWindow: 200000, reserveForResponse: 4096 },
  // Ollama
  'qwen2.5-coder:14b': { contextWindow: 32768, reserveForResponse: 2048 },
  'qwen2.5-coder:7b': { contextWindow: 32768, reserveForResponse: 2048 },
  'qwen2.5-coder:3b': { contextWindow: 8192, reserveForResponse: 1024 },
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
      'get_project_structure', 'get_file_info', 'search_codebase', 'get_file_symbols',
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
 * Identidade Mega Drive/SGDK
 */
const MEGADRIVE_IDENTITY = `Você é um especialista em desenvolvimento para Sega Mega Drive (Genesis) usando SGDK.

DOMÍNIO: C, SGDK, VDP (sprites, tilemaps, scroll, DMA), YM2612, PSG, m68k. Otimização para 7.6 MHz, 60 fps.
HARDWARE: Scroll apenas PLAN_A e PLAN_B. NÃO existem PLAN_C ou PLAN_D. Máx 80 sprites, 64 tiles/linha, 512 tiles VRAM
ESTRUTURA: Projetos SGDK têm Makefile na raiz, src/ para .c, res/ para assets (.res, .png, .bmp)
INCLUDES: Sempre use #include <genesis.h> (ângulos < >), NUNCA #include "genesis.h" (aspas). Headers do SGDK usam ângulos.`

/**
 * Prompts para cada modo de chat
 */
const PROMPTS = {
  // Modo Agent - Acesso completo
  agent: `${MEGADRIVE_IDENTITY}

Você é um assistente do Retro Studio IDE para jogos Mega Drive com acesso total ao sistema.

PRINCÍPIOS:
- Use ferramentas para explorar antes de editar
- Código SGDK em C: hardware-accurate, otimizado
- Confirme o que vai fazer antes de modificar

FERRAMENTAS DISPONÍVEIS:

**LEITURA:**
- read_file: Lê arquivo {"path": "caminho"}
- list_directory: Lista diretório {"path": "caminho"}
- search_files: Busca arquivos {"pattern": "*.c"} ou {"pattern": "*.res"}
- grep_code: Busca texto {"query": "texto"}
- get_project_structure: Estrutura do projeto {}
- get_file_info: Info do arquivo {"path": "caminho"}
- search_codebase: Busca inteligente {"query": "termo", "type": "function|class|all"}
- get_file_symbols: Símbolos de arquivo C (.c/.h) {"path": "src/main.c"} → funções, macros, includes
- list_assets: Lista sprites, tiles, paletas, mapas, sons dos .res {}

**ESCRITA:**
- write_file: Cria/sobrescreve arquivo {"path": "caminho", "content": "código"}
- edit_file: Edita com SEARCH/REPLACE (PREFERIDO). Exemplo:
\`\`\`tool
{"name": "edit_file", "arguments": {"path": "src/main.c", "search_replace_blocks": "<<<<<<< ORIGINAL\\nint x = 0;\\n=======\\nint x = 1;\\n>>>>>>> UPDATED"}}
\`\`\`
Use aspas normais no código C dentro do JSON. Não escape aspas desnecessariamente.
- patch_file: Edição simples {"path": "caminho", "search": "buscar", "replace": "substituir"}

**BUILD/EMULADOR:**
- build_rom: Compila projeto SGDK {"clean": false} - retorna stderr se falhar
- run_emulator: Executa emulador com ROM {"rom_path": "opcional"}

**TERMINAL:**
- run_command: Executa comando {"command": "make"}
- open_persistent_terminal: Abre terminal {"name": "Dev"}
- run_persistent_command: Executa em terminal persistente {"terminal_id": "id", "command": "make"}

**GIT:**
- git_status, git_diff, git_commit, git_stage, git_log, git_branch

**GERENCIAMENTO:**
- create_project: Cria projeto de template {"name": "meu-jogo", "path": ".", "template": "hello-world-sgdk"}
- create_file_or_folder: Cria arquivo/pasta {"path": "pasta/"}
- delete_file_or_folder: Deleta {"path": "arquivo", "recursive": true}
- rename_file: Renomeia {"old_path": "antigo", "new_path": "novo"}

REGRAS:
1. Caminhos relativos ao workspace (ex: src/main.c, res/image.res)
2. NUNCA use caminhos absolutos
3. Para editar, use edit_file com blocos SEARCH/REPLACE. No código C use aspas normais: VDP_drawText("texto", x, y). Não duplique escape de aspas no JSON.
4. Se o usuário pedir compilar/rodar: use build_rom. Se falhar, analise stderr (arquivo:linha:mensagem), leia o arquivo com read_file, corrija com edit_file e tente build_rom novamente.
4. Para usar ferramenta, responda APENAS:
\`\`\`tool
{"name": "ferramenta", "arguments": {}}
\`\`\``,

  // Modo Gather - Apenas leitura
  gather: `${MEGADRIVE_IDENTITY}

Assistente de análise de código SGDK. Apenas LEITURA - não modifica arquivos.

FERRAMENTAS DISPONÍVEIS:
- read_file: Lê arquivo {"path": "caminho"}
- list_directory: Lista diretório {"path": "caminho"}
- search_files: Busca arquivos {"pattern": "*.c"} ou {"pattern": "*.res"}
- grep_code: Busca texto {"query": "texto"}
- get_project_structure: Estrutura do projeto {}
- search_codebase: Busca inteligente {"query": "termo"}
- git_status, git_log, git_diff (apenas leitura)

COMO AJUDAR:
- Explore main.c, res/, Makefile
- Explique VDP, sprites, tilemaps, DMA
- Sugira melhorias (sem modificar)

Para usar ferramenta:
\`\`\`tool
{"name": "ferramenta", "arguments": {}}
\`\`\``,

  // Modo Normal - Chat simples
  normal: `${MEGADRIVE_IDENTITY}

Você é um especialista em Mega Drive/SGDK. Responda perguntas sobre VDP, sprites, tilemaps, DMA, som, otimização.
Sem acesso a ferramentas. Seja conciso e hardware-accurate.`
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
    this.workspacePath = null
    this._projectStructureCache = { path: null, text: '', ts: 0 }
    this._gameGraphCache = { path: null, text: '', ts: 0 }
    this._assetsBlockCache = null
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
   * Monta bloco com estrutura do projeto (com cache ~2 min)
   */
  async buildProjectStructureBlock() {
    if (!this.workspacePath) return ''
    const now = Date.now()
    const cache = this._projectStructureCache
    if (cache.path === this.workspacePath && (now - cache.ts) < 120000) {
      return cache.text
    }
    try {
      const result = await toolExecutor.get_project_structure({ max_depth: 2 })
      const structure = result?.structure || ''
      const block = structure ? `\n\n--- ESTRUTURA DO PROJETO ---\n${structure}--- FIM ESTRUTURA ---` : ''
      this._projectStructureCache = { path: this.workspacePath, text: block, ts: now }
      return block
    } catch (e) {
      console.warn('[AI Agent] buildProjectStructureBlock failed', e)
      return ''
    }
  }

  /**
   * Monta bloco Game Graph (entidades do jogo) - cache 2 min
   */
  async buildGameGraphBlock() {
    if (!this.workspacePath) return ''
    const now = Date.now()
    const cache = this._gameGraphCache
    if (cache.path === this.workspacePath && (now - cache.ts) < 120000) {
      return cache.text
    }
    try {
      const graph = await buildGameGraph(this.workspacePath)
      const block = formatGameGraphBlock(graph)
      this._gameGraphCache = { path: this.workspacePath, text: block, ts: now }
      return block
    } catch (e) {
      console.warn('[AI Agent] buildGameGraphBlock failed', e)
      return ''
    }
  }

  /**
   * Monta bloco de assets (sprites, tiles, etc.) - cache 2 min
   */
  async buildAssetsBlock() {
    if (!this.workspacePath) return ''
    const now = Date.now()
    const cache = this._assetsBlockCache
    if (cache?.path === this.workspacePath && (now - cache.ts) < 120000) return cache.text
    try {
      const result = await toolExecutor.list_assets()
      if (result.error) return ''
      const parts = []
      if (result.sprites?.length) parts.push(`sprites: ${result.sprites.join(', ')}`)
      if (result.tilesets?.length) parts.push(`tiles: ${result.tilesets.join(', ')}`)
      if (result.palettes?.length) parts.push(`paletas: ${result.palettes.join(', ')}`)
      if (result.maps?.length) parts.push(`mapas: ${result.maps.join(', ')}`)
      const block = parts.length ? `\n\n--- ASSETS DO PROJETO ---\n${parts.join('; ')}\n--- FIM ASSETS ---` : ''
      this._assetsBlockCache = { path: this.workspacePath, text: block, ts: now }
      return block
    } catch (e) {
      return ''
    }
  }

  /**
   * Resolve include local relativo ao arquivo atual, confinado ao workspace.
   */
  resolveLocalIncludePath(currentFilePath, incPath) {
    if (!this.workspacePath || !currentFilePath || !incPath) return null
    const workspaceRoot = path.resolve(this.workspacePath)
    const baseDir = path.isAbsolute(currentFilePath)
      ? path.dirname(currentFilePath)
      : path.resolve(workspaceRoot, path.dirname(currentFilePath))
    const fullPath = path.resolve(baseDir, incPath)
    const rel = path.relative(workspaceRoot, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null
    return fullPath
  }

  /**
   * Monta bloco de contexto do editor (arquivo atual + includes locais) para injetar no prompt
   */
  async buildEditorContextBlock(context) {
    if (!context?.currentFilePath && !context?.currentFileContent) return ''
    const parts = []
    if (context.currentFilePath) {
      parts.push(`Arquivo atual: ${context.currentFilePath}`)
    }
    const pathLower = (context.currentFilePath || '').toLowerCase()
    const isCFile = pathLower.endsWith('.c') || pathLower.endsWith('.h')
    if (isCFile && context.currentFileContent && typeof context.currentFileContent === 'string') {
      try {
        const sym = getSymbolsFromCFile(context.currentFileContent, context.currentFilePath)
        const fnList = sym.functions.map(f => f.name).join(', ')
        const macroList = sym.macros.map(m => m.name).join(', ')
        const symbolParts = []
        if (fnList) symbolParts.push(`funções: ${fnList}`)
        if (macroList) symbolParts.push(`macros: ${macroList}`)
        if (symbolParts.length) {
          parts.push(`Símbolos no arquivo atual: ${symbolParts.join('; ')}`)
        }
        const includeParts = []
        const maxIncludes = 3
        const maxLinesPerInclude = 50
        const localIncludes = (sym.includes || []).filter((inc) => inc?.path && !inc.system)
        for (const inc of localIncludes.slice(0, maxIncludes)) {
          const incPath = inc.path.trim()
          const fullPath = this.resolveLocalIncludePath(context.currentFilePath, incPath)
          if (!fullPath) continue
          try {
            const content = await fs.readFile(fullPath, 'utf8')
            const lines = content.split('\n')
            const excerpt = lines.length > maxLinesPerInclude
              ? lines.slice(0, maxLinesPerInclude).join('\n') + `\n... (${lines.length - maxLinesPerInclude} linhas omitidas)`
              : content
            includeParts.push(`#include "${incPath}":\n\`\`\`\n${excerpt}\n\`\`\``)
          } catch (_) { /* ignora */ }
        }
        if (includeParts.length) {
          parts.push(`Arquivos incluídos (trecho):\n${includeParts.join('\n\n')}`)
        }
      } catch (_) { /* ignora falha de parse */ }
    }
    if (context.currentFileContent && typeof context.currentFileContent === 'string') {
      const maxLines = 150
      const lines = context.currentFileContent.split('\n')
      const excerpt = lines.length > maxLines
        ? lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} linhas omitidas)`
        : context.currentFileContent
      parts.push(`Conteúdo do arquivo atual (trecho):\n\`\`\`\n${excerpt}\n\`\`\``)
    }
    return parts.length ? `\n\n--- CONTEXTO DO EDITOR ---\n${parts.join('\n\n')}\n--- FIM CONTEXTO ---` : ''
  }

  /**
   * Retorna os limites de contexto para o modelo atual
   * Ollama: usa limite maior por padrão quando modelo não está na lista
   */
  getContextLimits() {
    const limit = MODEL_CONTEXT_LIMITS[this.settings.model]
    if (limit) return limit
    if (this.isOllamaEndpoint()) {
      return { contextWindow: 32768, reserveForResponse: 2048 }
    }
    return MODEL_CONTEXT_LIMITS['default']
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
   * Trunca blocos de contexto para caber no orçamento de tokens (prioridade: editor > project > rag > game > assets)
   */
  truncateContextBlocks(blocks, maxTokens) {
    const order = ['editor', 'project', 'rag', 'sdk', 'game', 'assets']
    let used = 0
    const result = {}
    for (const key of order) {
      const text = blocks[key] || ''
      const tokens = this.estimateTokens(text)
      const remaining = maxTokens - used
      if (tokens <= remaining) {
        result[key] = text
        used += tokens
      } else if (remaining > 100) {
        const chars = Math.floor(remaining * 3.5)
        result[key] = text.slice(0, chars) + '\n... (truncado)'
        used += remaining
      }
    }
    return result
  }

  /**
   * Configura o workspace para as tools
   */
  setWorkspace(workspacePath) {
    this.workspacePath = workspacePath
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

    // Contexto do editor (arquivo aberto) para injetar no prompt
    this._currentChatContext = options.context || null
    if (options.mode && CHAT_MODES[options.mode]) {
      this.chatMode = options.mode
    }

    let iterations = 0
    let finalResponse = null

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++

      const projectBlock = await this.buildProjectStructureBlock()
      const gameGraphBlock = await this.buildGameGraphBlock()
      const assetsBlock = await this.buildAssetsBlock()
      const editorBlock = await this.buildEditorContextBlock(this._currentChatContext)
      const sdkBlock = (this.workspacePath && isSgdkProject(this.workspacePath)) ? getSdkApiBlock() : ''
      let ragBlock = ''
      if (this.workspacePath && iterations === 1 && this.conversationHistory.length > 0) {
        const lastUser = this.conversationHistory[this.conversationHistory.length - 1]
        const query = (lastUser?.content || '').toString().trim()
        if (query) {
          try {
            const chunks = await searchRelevantChunks(this.workspacePath, query)
            ragBlock = formatRelevantFilesBlock(chunks)
          } catch (e) {
            console.warn('[AI Agent] RAG search failed', e)
          }
        }
      }
      const { contextWindow } = this.getContextLimits()
      const systemBudget = Math.max(2000, Math.floor(contextWindow * 0.4))
      const truncated = this.truncateContextBlocks(
        { editor: editorBlock, project: projectBlock, rag: ragBlock, sdk: sdkBlock, game: gameGraphBlock, assets: assetsBlock },
        systemBudget
      )
      const systemContent = this.getSystemPrompt() + (truncated.sdk || '') + (truncated.project || '') + (truncated.game || '') + (truncated.assets || '') + (truncated.editor || '') + (truncated.rag || '')

      // Monta mensagens para o LLM (usando histórico limitado)
      const messages = [
        { role: 'system', content: systemContent },
        ...this.getRecentHistory()
      ]

      // Chama o LLM
      const response = await this.callLLM(messages, options.useTools !== false, 0, { sendChunk: options.sendChunk })

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
   * Detecta se o endpoint é Ollama (/api/generate)
   */
  isOllamaEndpoint() {
    return (this.settings.endpoint || '').includes('/api/generate')
  }

  /**
   * Converte mensagens (OpenAI format) em prompt único para Ollama
   */
  messagesToOllamaPrompt(messages) {
    const parts = []
    for (const msg of messages) {
      const content = (msg.content || '').trim()
      if (!content) continue
      if (msg.role === 'system') {
        parts.push(content)
      } else if (msg.role === 'user') {
        parts.push(`User: ${content}`)
      } else if (msg.role === 'assistant') {
        parts.push(`Assistant: ${content}`)
      }
    }
    return parts.join('\n\n')
  }

  /**
   * Chama API Ollama (/api/generate) - sem suporte a tools
   */
  async callOllama(messages) {
    const prompt = this.messagesToOllamaPrompt(messages)
    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.model,
        prompt,
        stream: false
      }),
      ...(typeof AbortSignal?.timeout === 'function' && { signal: AbortSignal.timeout(120000) })
    }
    const apiKey = (this.settings.apiKey || '').trim()
    if (apiKey) {
      fetchOptions.headers['X-API-KEY'] = apiKey
    }
    let response
    try {
      response = await fetch(this.settings.endpoint, fetchOptions)
    } catch (err) {
      const msg = err?.cause?.code === 'ETIMEDOUT' ? 'Timeout ao conectar na API Ollama.' : (err?.cause?.code === 'ECONNREFUSED' ? 'Conexão recusada. Verifique a URL (ex.: localhost:11434 ou ia.retrostudio.dev).' : (err?.message || 'Erro de rede'))
      throw new Error(`Ollama: ${msg}`)
    }
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama API: ${response.status} - ${errorText}`)
    }
    const data = await response.json()
    const content = data?.response ?? ''
    return { content: content || null, tool_calls: null }
  }

  /**
   * Chama o LLM (compatível com API OpenAI ou Ollama)
   * Inclui gerenciamento dinâmico de tokens
   */
  async callLLM(messages, useTools = true, retryCount = 0, callOptions = {}) {
    if (this.isOllamaEndpoint()) {
      return await this.callOllama(messages)
    }

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

    const sendChunk = callOptions.sendChunk
    if (sendChunk) {
      body.stream = true
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

      // DashScope/OpenAI: Authorization Bearer (apiKey = DASHSCOPE_API_KEY)
      const isDashScope = this.settings.endpoint?.includes('dashscope')
      const apiKey = (this.settings.apiKey || '').trim()
      if (isDashScope && !apiKey) {
        throw new Error('DashScope exige API Key. Configure em Configurações > Assistente IA > API Key.')
      }
      if (apiKey) {
        fetchOptions.headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(this.settings.endpoint, fetchOptions)

      if (!response.ok) {
        const errorText = await response.text()
        if ([429, 503].includes(response.status) && retryCount < MAX_RETRIES) {
          const delay = Math.min(2000 * Math.pow(2, retryCount), 10000)
          console.warn(`[AI Agent] ${response.status} - retry em ${delay}ms (${retryCount + 1}/${MAX_RETRIES})`)
          await new Promise((r) => setTimeout(r, delay))
          return await this.callLLM(messages, useTools, retryCount + 1, callOptions)
        }
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
          
          return await this.callLLM(retryMessages, !shouldDisableTools && useTools, retryCount + 1, callOptions)
        }
        
        // Mensagem mais clara para 401 (API key inválida)
        if (response.status === 401) {
          let hint = 'Verifique a API Key em Configurações > Assistente IA.'
          try {
            const err = JSON.parse(errorText)
            if (err?.error?.code === 'invalid_api_key') {
              const isChina = this.settings.endpoint?.includes('dashscope.aliyuncs.com') && !this.settings.endpoint?.includes('-intl')
              hint = isChina
                ? 'Chave Internacional não funciona com endpoint China. Use o provedor "DashScope (Qwen) Internacional".'
                : 'Chave China não funciona com endpoint Internacional. Use o provedor "DashScope (Qwen) China".'
            }
          } catch (_) {}
          throw new Error(`${hint} (HTTP 401)`)
        }
        throw new Error(`Erro na API: ${response.status} - ${errorText}`)
      }

      if (body.stream && response.body) {
        return await this._streamLLMResponse(response, sendChunk)
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
   * Processa resposta em streaming do LLM
   */
  async _streamLLMResponse(response, sendChunk) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    const toolCallsAcc = {}

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed?.choices?.[0]?.delta
            if (!delta) continue
            if (delta.content) {
              content += delta.content
              if (sendChunk) sendChunk(delta.content)
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: '', function: { name: '', arguments: '' } }
                if (tc.id) toolCallsAcc[idx].id = tc.id
                if (tc.function?.name) toolCallsAcc[idx].function.name = tc.function.name
                if (tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments
              }
            }
          } catch (_) {}
        }
      }
    }

    const toolCalls = Object.keys(toolCallsAcc).length > 0
      ? Object.values(toolCallsAcc)
          .filter((tc) => tc.function?.name)
          .map((tc, i) => ({
            id: tc.id || `call_${i}`,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments || '{}' }
          }))
      : null

    return {
      content: content || null,
      tool_calls: toolCalls,
      finish_reason: toolCalls ? 'tool_calls' : 'stop'
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
