<template>
  <div class="void-chat-panel" :class="{ open: props.isOpen }">
    <!-- Chat Container -->
    <div class="chat-container" ref="chatContainer">
      <!-- Messages -->
      <div class="messages-wrapper" ref="messagesWrapper">
        <template v-for="(msg, index) in messages" :key="index">
          <!-- User Message -->
          <div v-if="msg.role === 'user'" class="message user-message">
            <div class="message-content" v-html="parseMessage(msg.content)"></div>
          </div>
          
          <!-- Assistant Message -->
          <div v-else-if="msg.role === 'assistant'" class="message assistant-message">
            <!-- Tool Calls (se houver) -->
            <div v-if="msg.toolCalls?.length > 0" class="tool-calls-summary">
              <div v-for="(tool, idx) in msg.toolCalls" :key="idx" class="tool-badge">
                <svg class="tool-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <span>{{ formatToolName(tool.name) }}</span>
              </div>
            </div>
            <div class="message-content" v-html="parseMessage(msg.content)"></div>
          </div>
        </template>

        <!-- Loading State -->
        <div v-if="isLoading" class="message assistant-message loading">
          <!-- Tool calls em execução -->
          <div v-if="currentToolCalls.length > 0" class="tool-calls-live">
            <div v-for="(tool, idx) in currentToolCalls" :key="idx" class="tool-call-item" :class="tool.status">
              <div class="tool-spinner" v-if="tool.status === 'executing'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              </div>
              <svg v-else class="tool-done" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span class="tool-name">{{ formatToolName(tool.name) }}</span>
            </div>
          </div>
          <div v-else class="thinking-indicator">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Input Area (Void Style) -->
    <div class="input-area">
      <div class="input-container" :class="{ focused: inputFocused }">
        <!-- Context items -->
        <div v-if="contextItems.length > 0" class="context-bar">
          <div v-for="(item, idx) in contextItems" :key="idx" class="context-item">
            <span class="context-icon">{{ item.icon }}</span>
            <span class="context-name">{{ item.label }}</span>
            <button class="context-remove" @click="removeContext(idx)">×</button>
          </div>
        </div>
        
        <!-- Input -->
        <div class="input-row">
          <div 
            ref="inputRef"
            contenteditable="true"
            class="text-input"
            @input="updateInput"
            @keydown="handleKeydown"
            @paste="handlePaste"
            @focus="inputFocused = true"
            @blur="inputFocused = false"
            :data-placeholder="getPlaceholder()"
          ></div>
        </div>
        
        <!-- Bottom Bar -->
        <div class="bottom-bar">
          <div class="left-controls">
            <!-- Mode Selector -->
            <div class="mode-selector" @click.stop="toggleModeMenu">
              <span class="mode-current">{{ selectedModeLabel }}</span>
              <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              
              <!-- Mode Dropdown -->
              <div v-if="showModeMenu" class="mode-menu">
                <div 
                  v-for="(config, mode) in availableModes" 
                  :key="mode"
                  class="mode-item"
                  :class="{ active: selectedMode === mode }"
                  @click.stop="selectMode(mode)"
                >
                  <span class="mode-name">{{ config.name }}</span>
                  <span class="mode-desc">{{ config.description }}</span>
                  <svg v-if="selectedMode === mode" class="mode-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
            </div>
            
            <!-- Model Selector -->
            <div class="model-selector" @click.stop="toggleModelMenu">
              <span class="model-current">{{ selectedModel }}</span>
              <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              <div v-if="showModelMenu" class="model-menu">
                <button
                  class="model-refresh"
                  :disabled="isLoadingModels"
                  @click.stop="fetchModelsList"
                >
                  {{ isLoadingModels ? 'Carregando...' : 'Atualizar' }}
                </button>
                <div
                  v-for="m in availableModels"
                  :key="m"
                  class="model-item"
                  :class="{ active: selectedModel === m }"
                  @click.stop="selectModel(m)"
                >
                  <span class="model-name">{{ m }}</span>
                  <svg v-if="selectedModel === m" class="mode-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <p v-if="availableModels.length === 0 && !isLoadingModels" class="model-empty">
                  Configure a API em Configurações e clique em Atualizar
                </p>
              </div>
            </div>
          </div>
          
          <div class="right-controls">
            <!-- New Chat -->
            <button class="icon-btn" @click="clearChat" title="Nova conversa">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
            
            <!-- Send -->
            <button 
              class="send-btn"
              :class="{ active: inputMessage.trim().length > 0 && !isLoading }"
              :disabled="!inputMessage.trim() || isLoading"
              @click="sendPrompt"
            >
              <svg v-if="!isLoading" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"/>
              </svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Diff Preview Modal -->
  <Teleport to="body">
    <div v-if="showDiffPreview" class="diff-modal-overlay" @click="handleRejectDiff">
      <div class="diff-modal" @click.stop>
        <div class="diff-modal-header">
          <h3>Preview de Mudanças</h3>
          <span class="diff-modal-file">{{ diffPreviewData.fileName }}</span>
          <button class="diff-modal-close" @click="handleRejectDiff">×</button>
        </div>
        <div class="diff-modal-content">
          <DiffViewer
            :original-code="diffPreviewData.originalCode"
            :new-code="diffPreviewData.newCode"
            :title="diffPreviewData.filePath"
            :show-accept="false"
            :show-reject="false"
            mode="inline"
            :context-lines="5"
          />
        </div>
        <div class="diff-modal-footer">
          <button class="diff-btn diff-btn-reject" @click="handleRejectDiff">
            <span class="icon-xmark"></span> Rejeitar
          </button>
          <button class="diff-btn diff-btn-accept" @click="handleAcceptDiff">
            <span class="icon-check"></span> Aceitar Mudanças
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { marked } from 'marked'
import DiffViewer from './DiffViewer.vue'
import { hasChanges } from '../utils/diff.js'

marked.setOptions({
  breaks: true,
  gfm: true
})

const props = defineProps({ 
  isOpen: Boolean
})

const emit = defineEmits(['close'])

// State
const messages = ref([
  { role: 'system', content: 'Assistente especializado em jogos Mega Drive/SGDK no Retro Studio IDE.' },
  { role: 'assistant', content: 'Pronto para ajudar com SGDK, VDP, sprites, tilemaps. Como posso ajudar?' }
])
const inputMessage = ref('')
const isLoading = ref(false)
const chatContainer = ref(null)
const messagesWrapper = ref(null)
const inputRef = ref()
const inputFocused = ref(false)
let typingMessageIndex = -1

// Diff Preview State
const showDiffPreview = ref(false)
const diffPreviewData = ref({
  originalCode: '',
  newCode: '',
  filePath: '',
  fileName: '',
  blockId: null
})

// Tool calls
const currentToolCalls = ref([])
let cleanupToolCallListener = null

// Mode & Model
const contextItems = ref([])
const selectedMode = ref('agent')
const selectedModeLabel = ref('Agent')
const selectedModel = ref('Qwen 7B')
const showModeMenu = ref(false)
const showModelMenu = ref(false)
const availableModels = ref([])
const isLoadingModels = ref(false)
const availableModes = ref({
  normal: { name: 'Normal', description: 'Chat SGDK/Mega Drive sem ferramentas' },
  gather: { name: 'Gather', description: 'Leitura: analisar código e projeto' },
  agent: { name: 'Agent', description: 'Completo: editar, build (make), git' }
})

// Methods
function getPlaceholder() {
  if (selectedMode.value === 'agent') return 'Pergunte sobre SGDK, Mega Drive... (Ctrl+L)'
  if (selectedMode.value === 'gather') return 'Analise o projeto, main.c, res/...'
  return 'Chat SGDK/Mega Drive...'
}

function formatToolName(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

const updateInput = () => {
  if (inputRef.value) {
    inputMessage.value = inputRef.value.innerText || ''
  }
}

const handleKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendPrompt()
  }
}

const handlePaste = (e) => {
  e.preventDefault()
  const text = e.clipboardData.getData('text/plain')
  document.execCommand('insertText', false, text)
}

const removeContext = (idx) => {
  contextItems.value.splice(idx, 1)
}

const toggleModeMenu = () => {
  showModeMenu.value = !showModeMenu.value
}

const toggleModelMenu = () => {
  showModelMenu.value = !showModelMenu.value
  if (showModelMenu.value && availableModels.value.length === 0) fetchModelsList()
}

const FALLBACK_MODELS = [
  'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
  'Qwen/Qwen2.5-Coder-7B-Instruct',
  'Qwen/Qwen2.5-Coder-3B-Instruct'
]

const fetchModelsList = async () => {
  if (!window.monarco?.ai?.fetchModels) return
  isLoadingModels.value = true
  try {
    const settings = await window.monarco?.settings?.load?.()
    const apiUrl = settings?.ai?.endpoint ?? settings?.ai?.apiUrl ?? ''
    const baseUrl = apiUrl.replace(/\/v1\/(chat\/)?completions?\/?$/, '').replace(/\/$/, '') || 'http://localhost:8000'
    const models = await window.monarco.ai.fetchModels(baseUrl)
    availableModels.value = (models?.length > 0) ? models : FALLBACK_MODELS
  } catch (e) {
    console.error('Erro ao listar modelos:', e)
    availableModels.value = FALLBACK_MODELS
  } finally {
    isLoadingModels.value = false
  }
}

const selectModel = async (model) => {
  try {
    if (window.monarco?.ai?.updateSettings) {
      await window.monarco.ai.updateSettings({ model })
    }
    selectedModel.value = model
    showModelMenu.value = false
    const settings = await window.monarco?.settings?.load?.()
    if (settings) {
      settings.ai = { ...(settings.ai || {}), model }
      await window.monarco?.settings?.save?.(settings)
    }
  } catch (e) {
    console.error('Erro ao selecionar modelo:', e)
  }
}

const selectMode = async (mode) => {
  try {
    if (window.monarco?.ai?.setMode) {
      await window.monarco.ai.setMode(mode)
    }
    selectedMode.value = mode
    selectedModeLabel.value = availableModes.value[mode]?.name || mode
    showModeMenu.value = false
  } catch (e) {
    console.error('Erro ao mudar modo:', e)
  }
}

// Smooth scroll to bottom
const scrollToBottom = () => {
  if (chatContainer.value) {
    chatContainer.value.scrollTo({
      top: chatContainer.value.scrollHeight,
      behavior: 'smooth'
    })
  }
}

// Funções para o modal de Diff Preview
const handleAcceptDiff = async () => {
  try {
    const { filePath, newCode, fileName } = diffPreviewData.value
    
    await window.monarco.ai.executeTool('write_file', {
      path: filePath,
      content: newCode
    })
    
    // Atualizar o conteúdo no editor se o arquivo estiver aberto
    window.monarcoEditor?.updateFileContent?.(filePath, newCode)
    
    messages.value.push({
      role: 'assistant',
      content: `✅ Applied changes to \`${fileName}\``
    })
    
    showDiffPreview.value = false
    await nextTick()
    scrollToBottom()
  } catch (error) {
    console.error('Erro ao aplicar código:', error)
    messages.value.push({
      role: 'assistant',
      content: `❌ Erro ao aplicar: ${error.message}`
    })
    showDiffPreview.value = false
    await nextTick()
    scrollToBottom()
  }
}

const handleRejectDiff = () => {
  showDiffPreview.value = false
  messages.value.push({
    role: 'assistant',
    content: `❎ Mudanças rejeitadas. O arquivo não foi alterado.`
  })
  nextTick().then(scrollToBottom)
}

const sendPrompt = async () => {
  const textContent = inputRef.value?.innerText?.trim() || ''
  if (!textContent || isLoading.value) return

  messages.value.push({ role: 'user', content: textContent })
  inputMessage.value = ''
  
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.innerHTML = ''
      inputRef.value.focus()
    }
    scrollToBottom()
  })
  
  isLoading.value = true
  currentToolCalls.value = []
  typingMessageIndex = messages.value.length
  messages.value.push({ role: 'assistant', content: '' })
  
  await nextTick()
  scrollToBottom()

  try {
    const result = await window.monarco.ai.chat(textContent)
    
    messages.value[typingMessageIndex] = { 
      role: 'assistant', 
      content: result.content || 'Desculpe, não consegui gerar uma resposta.',
      toolCalls: currentToolCalls.value.length > 0 ? [...currentToolCalls.value] : undefined
    }

    await nextTick()
    scrollToBottom()
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error)
    messages.value[typingMessageIndex] = { 
      role: 'assistant', 
      content: `Erro: ${error.message || 'Erro desconhecido'}` 
    }
  } finally {
    isLoading.value = false
    currentToolCalls.value = []
  }
}

const clearChat = async () => {
  try {
    await window.monarco.ai.clear()
  } catch (e) {
    console.error('Erro ao limpar histórico:', e)
  }
  
  const systemMessage = messages.value.find(m => m.role === 'system')
  messages.value = systemMessage ? [systemMessage] : []
  messages.value.push({ role: 'assistant', content: 'Pronto para ajudar com SGDK, VDP, sprites, tilemaps. Como posso ajudar?' })
  currentToolCalls.value = []
  nextTick().then(scrollToBottom)
}

const parseMessage = (text) => {
  if (!text) return ''
  try {
    let html = marked.parse(text)
    
    let codeBlockIndex = 0
    
    // Add Apply button to ALL code blocks
    html = html.replace(
      /<pre><code(?:\s+class="language-(\w+)")?>(([\s\S]*?))<\/code><\/pre>/g,
      (match, lang, code, innerCode) => {
        const decodedCode = (innerCode || code)
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
        
        // Detectar caminho do arquivo de várias formas
        const fileMatch = 
          decodedCode.match(/^\/\/\s*File:\s*(.+)$/m) ||
          decodedCode.match(/^#\s*File:\s*(.+)$/m) ||
          decodedCode.match(/^\/\*\*?\s*File:\s*(.+?)\s*\*\//m) ||
          decodedCode.match(/^<!--\s*File:\s*(.+?)\s*-->/m) ||
          // Detectar caminhos absolutos ou relativos no início
          decodedCode.match(/^(\/[\w\-./]+\.\w+)$/m) ||
          decodedCode.match(/^([\w\-./]+\.\w{1,6})\s*$/m)
        
        let filePath = fileMatch ? fileMatch[1].trim() : null
        
        // Limpar o path se necessário
        if (filePath) {
          filePath = filePath.replace(/["'`]/g, '')
        }
        
        const displayLang = lang || 'code'
        const displayPath = filePath ? filePath.split('/').pop() : displayLang.toUpperCase()
        const blockId = `code-block-${codeBlockIndex++}`
        
        // Armazenar o código para acesso posterior
        if (typeof window !== 'undefined') {
          window._codeBlocks = window._codeBlocks || {}
          window._codeBlocks[blockId] = {
            code: decodedCode,
            filePath: filePath,
            lang: displayLang
          }
        }
        
        return `
          <div class="code-block" data-block-id="${blockId}">
            <div class="code-header">
              <span class="code-label">${displayPath}</span>
              <div class="code-actions">
                <button class="code-action-btn copy-btn" onclick="navigator.clipboard.writeText(window._codeBlocks['${blockId}'].code).then(() => { this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy', 1500) })">
                  Copy
                </button>
                <button class="code-action-btn apply-btn" onclick="window.applyCodeBlock('${blockId}')">
                  Apply
                </button>
              </div>
            </div>
            <pre><code class="language-${displayLang}">${code}</code></pre>
          </div>
        `
      }
    )
    
    return html
  } catch (e) {
    console.error('Erro ao parsear markdown:', e)
    return text
  }
}

onMounted(() => {
  scrollToBottom()
  
  if (window.monarco?.ai?.getModes) {
    window.monarco.ai.getModes().then((modes) => {
      if (modes) availableModes.value = modes
    }).catch(console.error)
  }
  if (window.monarco?.settings?.load) {
    window.monarco.settings.load().then((s) => {
      if (s?.ai?.model) selectedModel.value = s.ai.model
    }).catch(console.error)
  }
  
  const handleClickOutside = (e) => {
    if (showModeMenu.value && !e.target.closest('.mode-selector')) showModeMenu.value = false
    if (showModelMenu.value && !e.target.closest('.model-selector')) showModelMenu.value = false
  }
  document.addEventListener('click', handleClickOutside)
  
  // Apply code handler - agora mostra diff preview primeiro
  window.applyCodeBlock = async (blockId) => {
    try {
      const blockData = window._codeBlocks?.[blockId]
      if (!blockData) {
        console.error('Bloco de código não encontrado:', blockId)
        return
      }
      
      let { code, filePath, lang } = blockData
      
      // Se não tem caminho especificado, tentar encontrar de outras formas
      if (!filePath) {
        // 1. Tentar usar o arquivo atualmente focado no editor
        const currentFile = window.monarcoEditor?.getCurrentFile?.()
        
        if (currentFile) {
          // Verificar se a extensão do arquivo atual é compatível com a linguagem
          const currentExt = currentFile.split('.').pop()?.toLowerCase()
          const langExts = {
            'javascript': ['js', 'mjs', 'cjs'],
            'typescript': ['ts', 'tsx'],
            'python': ['py'],
            'html': ['html', 'htm'],
            'css': ['css', 'scss', 'sass', 'less'],
            'json': ['json'],
            'vue': ['vue'],
            'jsx': ['jsx', 'tsx'],
            'java': ['java'],
            'c': ['c', 'h'],
            'cpp': ['cpp', 'cc', 'cxx', 'hpp'],
            'go': ['go'],
            'rust': ['rs'],
            'php': ['php'],
            'ruby': ['rb'],
            'shell': ['sh', 'bash', 'zsh'],
            'sql': ['sql'],
            'markdown': ['md'],
            'yaml': ['yml', 'yaml'],
            'xml': ['xml']
          }
          
          const compatibleExts = langExts[lang?.toLowerCase()] || []
          const isCompatible = compatibleExts.length === 0 || compatibleExts.includes(currentExt)
          
          if (isCompatible) {
            filePath = currentFile
          }
        }
      }
      
      // 2. Se ainda não tem caminho, tentar buscar pelo nome do arquivo no código
      if (!filePath) {
        // Procurar por padrões comuns de referência a arquivos no código
        const fileNamePatterns = [
          /\/\/.*?([\w\-]+\.\w{1,6})\s*$/m,
          /#.*?([\w\-]+\.\w{1,6})\s*$/m,
          /\/\*.*?([\w\-]+\.\w{1,6}).*?\*\//m
        ]
        
        for (const pattern of fileNamePatterns) {
          const match = code.match(pattern)
          if (match) {
            const fileName = match[1]
            // Buscar no projeto
            const foundPath = await window.monarcoEditor?.findFile?.(fileName)
            if (foundPath) {
              filePath = foundPath
              break
            }
          }
        }
      }
      
      // 3. Se ainda não tem caminho, mostrar erro informativo
      if (!filePath) {
        messages.value.push({
          role: 'assistant',
          content: `⚠️ **Não foi possível aplicar o código**

O código não especifica o arquivo de destino e nenhum arquivo compatível está aberto.

**Soluções:**
1. Abra o arquivo de destino em uma aba e clique em Apply novamente
2. Peça para a IA especificar o arquivo: \"melhore o arquivo app.js\" ou \"edite src/main.js\"`
        })
        await nextTick()
        scrollToBottom()
        return
      }
      
      // Remover a linha do File: se existir
      code = code
        .replace(/^\/\/\s*File:.*\n?/m, '')
        .replace(/^#\s*File:.*\n?/m, '')
        .replace(/^\/\*\*?\s*File:.*?\*\/\n?/m, '')
        .replace(/^<!--\s*File:.*?-->\n?/m, '')
        .trim()
      
      // Buscar o conteúdo original do arquivo para mostrar diff
      let originalCode = ''
      try {
        originalCode = await window.monarco.readTextFile(filePath) || ''
      } catch (e) {
        // Arquivo novo, sem conteúdo original
        originalCode = ''
      }
      
      // Se há mudanças, mostrar preview do diff
      if (hasChanges(originalCode, code)) {
        diffPreviewData.value = {
          originalCode,
          newCode: code,
          filePath,
          fileName: filePath.split('/').pop(),
          blockId
        }
        showDiffPreview.value = true
      } else {
        // Sem mudanças, apenas informar
        messages.value.push({
          role: 'assistant',
          content: `ℹ️ O código é idêntico ao arquivo atual. Nenhuma mudança necessária.`
        })
        await nextTick()
        scrollToBottom()
      }
    } catch (error) {
      console.error('Erro ao preparar aplicação:', error)
      messages.value.push({
        role: 'assistant',
        content: `❌ Erro ao preparar: ${error.message}`
      })
      await nextTick()
      scrollToBottom()
    }
  }
  
  // Legacy handler (manter compatibilidade)
  window.applyCode = async (filePath) => {
    try {
      const lastAssistantMsg = [...messages.value].reverse().find(m => m.role === 'assistant')
      if (!lastAssistantMsg) return
      
      const codeRegex = new RegExp(`\`\`\`\\w*\\s*(?:\\/\\/|#|\\/\\*\\*?)\\s*File:\\s*${filePath.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[^\\n]*\\n([\\s\\S]*?)\`\`\``, 'i')
      const match = lastAssistantMsg.content.match(codeRegex)
      
      if (!match) {
        console.error('Código não encontrado para:', filePath)
        return
      }
      
      const code = match[1].trim()
      
      await window.monarco.ai.executeTool('write_file', {
        path: filePath,
        content: code
      })
      
      messages.value.push({
        role: 'assistant',
        content: `✅ Applied changes to \`${filePath}\``
      })
      
      await nextTick()
      scrollToBottom()
    } catch (error) {
      console.error('Erro ao aplicar código:', error)
    }
  }
  
  // Tool call listener
  if (window.monarco?.ai?.onToolCall) {
    cleanupToolCallListener = window.monarco.ai.onToolCall((toolInfo) => {
      const existingIndex = currentToolCalls.value.findIndex(t => t.name === toolInfo.name)
      if (existingIndex >= 0) {
        currentToolCalls.value[existingIndex] = toolInfo
      } else {
        currentToolCalls.value.push(toolInfo)
      }
      nextTick().then(scrollToBottom)
    })
  }
})

onUnmounted(() => {
  if (cleanupToolCallListener) {
    cleanupToolCallListener()
    cleanupToolCallListener = null
  }
})

watch(() => props.isOpen, (newVal) => {
  if (!newVal) emit('close')
})
</script>

<style scoped>
/* Void-style Chat Panel */
.void-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0; /* ESSENCIAL para scroll funcionar em flex */
  background: var(--panel);
  border-left: 1px solid var(--border);
  font-size: 13px;
  overflow: hidden;
}

/* Chat Container - Scrollable */
.chat-container {
  flex: 1;
  min-height: 0; /* ESSENCIAL para scroll funcionar em flex */
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}

.chat-container::-webkit-scrollbar {
  width: 6px;
}

.chat-container::-webkit-scrollbar-track {
  background: transparent;
}

.chat-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.messages-wrapper {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Messages */
.message {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.user-message {
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 2px solid var(--accent);
}

.assistant-message {
  padding: 0;
}

.message-content {
  color: var(--text);
  line-height: 1.6;
  word-break: break-word;
}

/* Tool Calls Summary (after completion) */
.tool-calls-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid rgba(52, 211, 153, 0.2);
  border-radius: 12px;
  font-size: 11px;
  color: #34d399;
}

.tool-check {
  color: #34d399;
}

/* Tool Calls Live (during execution) */
.tool-calls-live {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.tool-call-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  font-size: 12px;
}

.tool-call-item.executing {
  border-left: 2px solid var(--accent);
}

.tool-call-item.completed {
  border-left: 2px solid #34d399;
}

.tool-spinner {
  animation: spin 1s linear infinite;
  color: var(--accent);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-done {
  color: #34d399;
}

.tool-name {
  color: var(--text);
}

/* Thinking Indicator */
.thinking-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 0;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  background: var(--muted);
  border-radius: 50%;
  animation: pulse 1.4s ease-in-out infinite;
}

.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Input Area */
.input-area {
  padding: 12px 16px 16px;
  background: var(--panel);
  border-top: 1px solid var(--border);
}

.input-container {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.input-container.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.15);
}

/* Context Bar */
.context-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.context-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  font-size: 11px;
}

.context-remove {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
}

.context-remove:hover {
  color: #ef4444;
}

/* Input Row */
.input-row {
  padding: 10px 12px;
}

.text-input {
  min-height: 20px;
  max-height: 200px;
  outline: none;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  overflow-y: auto;
  word-break: break-word;
  white-space: pre-wrap;
}

.text-input:empty:before {
  content: attr(data-placeholder);
  color: var(--muted);
  pointer-events: none;
}

/* Bottom Bar */
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.left-controls,
.right-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Mode Selector */
.mode-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  font-size: 12px;
  color: var(--text);
}

.mode-selector:hover {
  background: rgba(255, 255, 255, 0.06);
}

.chevron {
  color: var(--muted);
}

/* Mode Menu */
.mode-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 220px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  overflow: hidden;
}

.mode-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  cursor: pointer;
  position: relative;
  transition: background 0.1s ease;
}

.mode-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.mode-item.active {
  background: rgba(0, 122, 204, 0.1);
}

.mode-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
}

.mode-desc {
  font-size: 11px;
  color: var(--muted);
}

.mode-check {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--accent);
}

/* Model Selector */
.model-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  font-size: 11px;
  color: var(--muted);
}

.model-selector:hover {
  background: rgba(255, 255, 255, 0.06);
}

.model-current {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 200px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 9999;
}

.model-refresh {
  width: 100%;
  padding: 8px 12px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.04);
  border: none;
  color: var(--muted);
  cursor: pointer;
}

.model-refresh:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.model-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.model-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.model-item.active {
  background: rgba(0, 122, 204, 0.1);
}

.model-name {
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-empty {
  padding: 12px;
  font-size: 11px;
  color: var(--muted);
  margin: 0;
}

/* Icon Button */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.1s ease;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

/* Send Button */
.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 6px;
  color: var(--bg);
  cursor: pointer;
  transition: all 0.1s ease;
}

.send-btn.active {
  background: white;
  color: black;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Message Content Styles */
.message-content :deep(p) {
  margin: 0 0 8px 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(code) {
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 0.9em;
  padding: 2px 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  color: #e5c07b;
}

.message-content :deep(pre) {
  margin: 8px 0;
  padding: 0;
  background: transparent;
  border: none;
}

.message-content :deep(pre code) {
  display: block;
  padding: 12px;
  background: var(--bg);
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}

.message-content :deep(ul),
.message-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.message-content :deep(li) {
  margin: 4px 0;
}

.message-content :deep(a) {
  color: var(--accent);
  text-decoration: none;
}

.message-content :deep(a:hover) {
  text-decoration: underline;
}

.message-content :deep(strong) {
  font-weight: 600;
  color: var(--text);
}

/* Code Block with Actions */
.message-content :deep(.code-block) {
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}

.message-content :deep(.code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid var(--border);
}

.message-content :deep(.code-label) {
  font-size: 11px;
  color: var(--muted);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.message-content :deep(.code-actions) {
  display: flex;
  gap: 6px;
}

.message-content :deep(.code-action-btn) {
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.message-content :deep(.copy-btn) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.message-content :deep(.copy-btn:hover) {
  background: rgba(255, 255, 255, 0.1);
}

.message-content :deep(.apply-btn) {
  background: var(--accent);
  color: white;
}

.message-content :deep(.apply-btn:hover) {
  filter: brightness(1.1);
}

.message-content :deep(.code-block pre) {
  margin: 0;
  padding: 12px;
}

.message-content :deep(.code-block pre code) {
  padding: 0;
  background: transparent;
  border-radius: 0;
}

/* Diff Preview Modal */
.diff-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  animation: fade-in 0.15s ease;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.diff-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 90vw;
  max-width: 1000px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  animation: slide-up 0.2s ease;
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.diff-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.diff-modal-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.diff-modal-file {
  flex: 1;
  font-size: 12px;
  color: var(--muted);
  font-family: 'Monaco', 'Menlo', monospace;
}

.diff-modal-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.diff-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.diff-modal-content {
  flex: 1;
  overflow: auto;
  padding: 0;
}

.diff-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

.diff-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.diff-btn-accept {
  background: #238636;
  color: white;
}

.diff-btn-accept:hover {
  background: #2ea043;
}

.diff-btn-reject {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.diff-btn-reject:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
