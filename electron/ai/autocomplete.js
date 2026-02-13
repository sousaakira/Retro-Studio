/**
 * AI Autocomplete Service - Sugestões inline de código usando FIM (Fill-In-Middle)
 * 
 * Baseado na implementação do Void Editor
 */

// Configurações
const DEBOUNCE_TIME = 400 // ms para esperar antes de fazer request
const TIMEOUT_TIME = 5000 // 5s timeout - autocomplete precisa ser rápido
const MAX_CACHE_SIZE = 20
const MAX_PREFIX_LINES = 50 // Linhas de contexto antes do cursor
const MAX_SUFFIX_LINES = 20 // Linhas de contexto depois do cursor

/**
 * Cache LRU para autocompletions
 */
class LRUCache {
  constructor(maxSize, disposeCallback) {
    this.items = new Map()
    this.keyOrder = []
    this.maxSize = maxSize
    this.disposeCallback = disposeCallback
  }

  set(key, value) {
    if (this.items.has(key)) {
      this.keyOrder = this.keyOrder.filter(k => k !== key)
    } else if (this.items.size >= this.maxSize) {
      const oldKey = this.keyOrder[0]
      const oldValue = this.items.get(oldKey)
      if (this.disposeCallback && oldValue !== undefined) {
        this.disposeCallback(oldValue, oldKey)
      }
      this.items.delete(oldKey)
      this.keyOrder.shift()
    }
    this.items.set(key, value)
    this.keyOrder.push(key)
  }

  get(key) {
    return this.items.get(key)
  }

  delete(key) {
    const value = this.items.get(key)
    if (value !== undefined) {
      if (this.disposeCallback) {
        this.disposeCallback(value, key)
      }
      this.items.delete(key)
      this.keyOrder = this.keyOrder.filter(k => k !== key)
      return true
    }
    return false
  }

  clear() {
    if (this.disposeCallback) {
      for (const [key, value] of this.items.entries()) {
        this.disposeCallback(value, key)
      }
    }
    this.items.clear()
    this.keyOrder = []
  }

  has(key) {
    return this.items.has(key)
  }

  get size() {
    return this.items.size
  }
}

/**
 * Classe do serviço de Autocomplete
 */
export class AutocompleteService {
  constructor(settings = {}) {
    this.settings = {
      // endpoint: settings.endpoint || 'http://192.168.1.18:8000/v1/completions',
      endpoint: settings.endpoint || 'https://ia.auth.com.br/v1/completions',
      model: settings.model || 'Qwen/Qwen2.5-Coder-3B-Instruct',
      temperature: settings.temperature ?? 0.1,
      maxTokens: settings.maxTokens || 128,
      enabled: settings.enabled ?? true,
      ...settings
    }
    
    this.cache = new LRUCache(MAX_CACHE_SIZE, (item) => {
      if (item.abortController) {
        item.abortController.abort()
      }
    })
    
    this.pendingRequests = new Map()
    this.lastRequestTime = 0
    this.completionId = 0
  }

  /**
   * Atualiza configurações
   */
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings }
  }

  /**
   * Limpa o cache
   */
  clearCache() {
    this.cache.clear()
    this.pendingRequests.clear()
  }

  /**
   * Gera uma chave de cache baseada no prefixo (trimado)
   */
  getCacheKey(prefix) {
    // Remove espaços no final e mantém apenas uma quebra de linha
    const trimmed = prefix.trimEnd()
    const trailing = prefix.slice(trimmed.length)
    if (trailing.includes('\n')) {
      return trimmed + '\n'
    }
    return trimmed
  }

  /**
   * Busca uma completion do cache
   */
  getFromCache(prefix) {
    const cacheKey = this.getCacheKey(prefix)
    
    for (const [key, completion] of this.cache.items) {
      // Verifica se o prefixo atual "estende" uma completion cacheada
      if (cacheKey.startsWith(key)) {
        const insertText = completion.insertText
        const extraTyped = cacheKey.slice(key.length)
        
        // Se o usuário digitou algo que faz parte da completion, retorna o resto
        if (insertText.startsWith(extraTyped)) {
          return {
            ...completion,
            insertText: insertText.slice(extraTyped.length)
          }
        }
      }
    }
    
    return null
  }

  /**
   * Determina o tipo de completion baseado no contexto
   */
  getCompletionType(prefixLine, suffixLine) {
    const hasPrefix = prefixLine.trim().length > 0
    const hasSuffix = suffixLine.trim().length > 0
    
    if (!hasPrefix && !hasSuffix) {
      return 'empty-line'
    }
    if (hasPrefix && !hasSuffix) {
      return 'end-of-line'
    }
    if (!hasPrefix && hasSuffix) {
      return 'beginning-of-line'
    }
    return 'middle-of-line'
  }

  /**
   * Faz uma requisição FIM (Fill-In-Middle) ao LLM
   */
  async complete(params) {
    const { prefix, suffix, language, filePath } = params
    
    if (!this.settings.enabled) {
      return { insertText: '', fromCache: false }
    }

    // Verifica cache primeiro
    const cached = this.getFromCache(prefix)
    if (cached && cached.insertText) {
      return { ...cached, fromCache: true }
    }

    // Debounce - espera um pouco antes de fazer request
    const now = Date.now()
    if (now - this.lastRequestTime < DEBOUNCE_TIME) {
      await new Promise(resolve => setTimeout(resolve, DEBOUNCE_TIME - (now - this.lastRequestTime)))
    }
    this.lastRequestTime = Date.now()

    // Limita o contexto
    const prefixLines = prefix.split('\n')
    const suffixLines = suffix.split('\n')
    const limitedPrefix = prefixLines.slice(-MAX_PREFIX_LINES).join('\n')
    const limitedSuffix = suffixLines.slice(0, MAX_SUFFIX_LINES).join('\n')

    // Determina tokens de parada baseado no contexto
    const prefixLine = prefixLines[prefixLines.length - 1] || ''
    const suffixLine = suffixLines[0] || ''
    const completionType = this.getCompletionType(prefixLine, suffixLine)
    
    let stopTokens = ['\n\n'] // Para em linhas vazias duplas
    if (completionType === 'middle-of-line') {
      stopTokens = ['\n'] // Para no fim da linha
    }

    const completionId = ++this.completionId
    const abortController = new AbortController()
    
    // Timeout para evitar loading infinito
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, TIMEOUT_TIME)

    try {
      // Tenta usar o endpoint de completions (FIM)
      const response = await fetch(this.settings.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.settings.model,
          prompt: this.buildFIMPrompt(limitedPrefix, limitedSuffix, language),
          max_tokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
          stop: stopTokens,
          stream: false
        }),
        signal: abortController.signal
      })
      
      clearTimeout(timeoutId)

      if (!response.ok) {
        // Fallback para chat/completions se o endpoint de completions não existir
        return await this.completeFallback(params, abortController)
      }

      const data = await response.json()
      let insertText = data.choices?.[0]?.text || ''
      
      // Processa o resultado
      insertText = this.postprocessCompletion(insertText, prefixLine, suffixLine)

      // Adiciona ao cache
      const cacheKey = this.getCacheKey(prefix)
      this.cache.set(cacheKey, {
        id: completionId,
        insertText,
        status: 'finished',
        abortController: null
      })

      return { insertText, fromCache: false }

    } catch (error) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        return { insertText: '', aborted: true }
      }
      console.error('Autocomplete error:', error.message)
      return { insertText: '', error: error.message }
    }
  }

  /**
   * Fallback usando o endpoint de chat/completions
   */
  async completeFallback(params, abortController) {
    const { prefix, suffix, language } = params
    
    const prefixLines = prefix.split('\n')
    const suffixLines = suffix.split('\n')
    const limitedPrefix = prefixLines.slice(-MAX_PREFIX_LINES).join('\n')
    const limitedSuffix = suffixLines.slice(0, MAX_SUFFIX_LINES).join('\n')

    const prefixLine = prefixLines[prefixLines.length - 1] || ''
    const suffixLine = suffixLines[0] || ''

    try {
      const chatEndpoint = this.settings.endpoint.replace('/completions', '/chat/completions')
      
      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.settings.model,
          messages: [
            {
              role: 'system',
              content: 'You are a code completion assistant. Complete the code at the cursor position marked with <CURSOR>. Return ONLY the code to insert, nothing else. No explanations.'
            },
            {
              role: 'user',
              content: `Complete this ${language || 'code'}:\n\n${limitedPrefix}<CURSOR>${limitedSuffix}`
            }
          ],
          max_tokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
          stream: false
        }),
        signal: abortController.signal
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      let insertText = data.choices?.[0]?.message?.content || ''
      
      // Remove markdown code blocks se existirem
      insertText = this.extractCodeFromMarkdown(insertText)
      insertText = this.postprocessCompletion(insertText, prefixLine, suffixLine)

      // Adiciona ao cache
      const cacheKey = this.getCacheKey(prefix)
      this.cache.set(cacheKey, {
        id: this.completionId,
        insertText,
        status: 'finished',
        abortController: null
      })

      return { insertText, fromCache: false }

    } catch (error) {
      if (error.name === 'AbortError') {
        return { insertText: '', aborted: true }
      }
      console.error('Autocomplete fallback error:', error.message)
      return { insertText: '', error: error.message }
    }
  }

  /**
   * Constrói o prompt FIM
   */
  buildFIMPrompt(prefix, suffix, language) {
    // Formato FIM padrão (suportado por modelos como CodeLlama, StarCoder, Qwen-Coder)
    // Diferentes modelos podem usar formatos diferentes
    return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
  }

  /**
   * Extrai código de blocos markdown
   */
  extractCodeFromMarkdown(text) {
    const match = text.match(/^```\w*\n?([\s\S]*?)\n?```$/m)
    if (match) {
      return match[1]
    }
    return text
  }

  /**
   * Pós-processamento da completion
   */
  postprocessCompletion(insertText, prefixLine, suffixLine) {
    if (!insertText) return ''

    // Remove espaços desnecessários no início se o usuário já digitou espaço
    if (prefixLine.endsWith(' ') || prefixLine.endsWith('\t')) {
      insertText = insertText.trimStart()
    }

    // Remove quebras de linha extras no início se estiver em linha vazia
    if (!prefixLine.trim() && !suffixLine.trim()) {
      insertText = insertText.replace(/^\n+/, '')
    }

    // Limita a uma linha se estiver no meio de uma linha
    if (suffixLine.trim()) {
      const firstNewline = insertText.indexOf('\n')
      if (firstNewline > 0) {
        insertText = insertText.slice(0, firstNewline)
      }
    }

    // Remove parênteses não balanceados no final
    insertText = this.trimUnbalancedBrackets(insertText, prefixLine)

    return insertText
  }

  /**
   * Remove parênteses não balanceados
   */
  trimUnbalancedBrackets(text, prefix) {
    const pairs = { ')': '(', '}': '{', ']': '[' }
    const stack = []

    // Processa o prefixo para saber o estado inicial
    for (const char of prefix) {
      if ('([{'.includes(char)) {
        stack.push(char)
      } else if (')]}'.includes(char)) {
        if (stack.length > 0 && stack[stack.length - 1] === pairs[char]) {
          stack.pop()
        }
      }
    }

    // Processa o texto e corta em parênteses não balanceados
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if ('([{'.includes(char)) {
        stack.push(char)
      } else if (')]}'.includes(char)) {
        if (stack.length === 0 || stack.pop() !== pairs[char]) {
          return text.slice(0, i)
        }
      }
    }

    return text
  }

  /**
   * Aborta requests pendentes
   */
  abort() {
    for (const [key, item] of this.pendingRequests) {
      if (item.abortController) {
        item.abortController.abort()
      }
    }
    this.pendingRequests.clear()
  }
}

// Exporta instância singleton
export const autocompleteService = new AutocompleteService()
