/**
 * AI Autocomplete Service - Sugestões inline de código usando FIM (Fill-In-Middle)
 * 
 * Baseado na implementação do Void Editor
 */

// Configurações
const DEBOUNCE_TIME = 280
const TIMEOUT_TIME = 4000
const MAX_CACHE_SIZE = 30
const CONTEXT_LIMITS = {
  c: { prefix: 40, suffix: 15 },
  h: { prefix: 40, suffix: 15 },
  plaintext: { prefix: 40, suffix: 15 },
  default: { prefix: 50, suffix: 20 }
}

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
    let endpoint = settings.endpoint || 'https://ia.auth.com.br/v1/chat/completions'
    if (endpoint.includes('/completions') && !endpoint.includes('/chat/')) {
      endpoint = endpoint.replace(/\/v1\/completions?\/?$/, '/v1/chat/completions')
    }
    this.settings = {
      endpoint,
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
    const next = { ...this.settings, ...settings }
    if (next.endpoint?.includes('/completions') && !next.endpoint?.includes('/chat/')) {
      next.endpoint = next.endpoint.replace(/\/v1\/completions?\/?$/, '/v1/chat/completions')
    }
    this.settings = next
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

    const limits = CONTEXT_LIMITS[language] || CONTEXT_LIMITS.default
    const prefixLines = prefix.split('\n')
    const suffixLines = suffix.split('\n')
    const limitedPrefix = prefixLines.slice(-limits.prefix).join('\n')
    const limitedSuffix = suffixLines.slice(0, limits.suffix).join('\n')

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
      const headers = { 'Content-Type': 'application/json' }
      if (this.settings.apiKey) {
        headers['Authorization'] = `Bearer ${this.settings.apiKey}`
      }
      const response = await fetch(this.settings.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.settings.model,
          messages: [
            {
              role: 'system',
              content: 'Code completion. Complete at <CURSOR>. Return ONLY the code to insert. No explanations, no markdown. SGDK/C for Mega Drive.'
            },
            {
              role: 'user',
              content: `${limitedPrefix}<CURSOR>${limitedSuffix}`
            }
          ],
          max_tokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
          ...(stopTokens.length ? { stop: stopTokens } : {}),
          stream: false
        }),
        signal: abortController.signal
      })
      
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errText = await response.text()
        if (process.env.DEBUG_AI === '1') console.error('Autocomplete API:', response.status, errText.slice(0, 200))
        return { insertText: '', error: `API ${response.status}` }
      }

      const data = await response.json()
      let insertText = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || ''
      
      insertText = this.extractCodeFromMarkdown(insertText)
      insertText = this.postprocessCompletion(insertText, prefixLine, suffixLine)

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
   * Extrai código de blocos markdown ou remove formatação indesejada
   */
  extractCodeFromMarkdown(text) {
    if (!text || typeof text !== 'string') return ''
    const trimmed = text.trim()
    const blockMatch = trimmed.match(/^```\w*\n?([\s\S]*?)\n?```\s*$/m)
    if (blockMatch) return blockMatch[1].trim()
    if (trimmed.startsWith('```')) {
      const end = trimmed.indexOf('```', 3)
      if (end > 0) return trimmed.slice(3, end).trim()
    }
    return trimmed
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
