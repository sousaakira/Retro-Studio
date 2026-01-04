<template>
  <Teleport to="body">
    <div v-if="show" class="help-overlay" @click.self="$emit('close')">
      <div class="help-window">
        <!-- Title Bar (Retro Style) -->
        <div class="help-title-bar">
          <div class="title-text">
            <i class="fas fa-question-circle"></i> SGDK Help - Sistema de Ajuda
          </div>
          <div class="title-actions">
            <button class="title-btn" @click="$emit('close')">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="help-toolbar">
          <button class="toolbar-btn" @click="activeTab = 'contents'" :class="{ active: activeTab === 'contents' }">
            <i class="fas fa-list-ul"></i> Conteúdo
          </button>
          <button class="toolbar-btn" @click="activeTab = 'index'" :class="{ active: activeTab === 'index' }">
            <i class="fas fa-search"></i> Índice
          </button>
          <button class="toolbar-btn" @click="activeTab = 'tutorials'" :class="{ active: activeTab === 'tutorials' }">
            <i class="fas fa-book"></i> Tutoriais
          </button>
          <div class="toolbar-separator"></div>
          <button class="toolbar-btn" @click="goBack" :disabled="history.length <= 1">
            <i class="fas fa-arrow-left"></i> Voltar
          </button>
          <button class="toolbar-btn" @click="printContent">
            <i class="fas fa-print"></i> Imprimir
          </button>
        </div>

        <div class="help-main">
          <!-- Sidebar: Topics Tree -->
          <div class="help-sidebar">
            <!-- Contents Tab -->
            <div v-if="activeTab === 'contents'" class="sidebar-tab-content">
              <div class="topics-tree">
                <template v-for="topic in topics" :key="topic.id">
                  <div class="tree-node">
                    <div 
                      class="node-header" 
                      :class="{ active: currentTopic?.id === topic.id }"
                      @click="selectTopic(topic)"
                    >
                      <i :class="topic.icon || (topic.children && topic.children.length > 0 ? 'fas fa-folder' : 'far fa-file-alt')"></i>
                      {{ topic.title }}
                    </div>
                    
                    <div v-if="topic.children && topic.children.length > 0" class="node-children">
                      <div 
                        v-for="child in topic.children" 
                        :key="child.id"
                        class="child-node"
                        :class="{ active: currentTopic?.id === child.id }"
                        @click="selectTopic(child)"
                      >
                        <i :class="child.icon || 'far fa-file-alt'"></i>
                        {{ child.title }}
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Index Tab -->
            <div v-if="activeTab === 'index'" class="sidebar-tab-content">
              <div class="index-search">
                <input 
                  type="text" 
                  v-model="searchQuery" 
                  placeholder="Digite o nome da função..."
                  class="search-input"
                />
              </div>
              <div class="index-list">
                <div 
                  v-for="func in filteredFunctions" 
                  :key="func.name" 
                  class="index-item"
                  @click="selectFunction(func)"
                >
                  {{ func.name }}
                </div>
              </div>
            </div>

            <!-- Tutorials Tab -->
            <div v-if="activeTab === 'tutorials'" class="sidebar-tab-content">
              <div class="tutorials-search">
                <input 
                  type="text" 
                  v-model="tutorialSearchQuery" 
                  placeholder="Buscar tutoriais..."
                  class="search-input"
                />
              </div>
              <div class="tutorials-list">
                <div 
                  v-for="tut in filteredTutorials" 
                  :key="tut.id" 
                  class="tutorial-item"
                  :class="{ active: currentTopic?.id === tut.id }"
                  @click="selectTutorial(tut)"
                >
                  <div class="tutorial-title">{{ tut.title }}</div>
                  <div class="tutorial-description">{{ tut.description }}</div>
                  <div v-if="tut.tags.length > 0" class="tutorial-tags">
                    <span v-for="tag in tut.tags" :key="tag" class="tag">{{ tag }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Content Area -->
          <div class="help-content" ref="contentArea">
            <div v-if="currentTopic" class="article-body">
              <div v-html="currentTopic.content"></div>
              
              <!-- If it's a function, show extra details from sgdkDocumentation -->
              <div v-if="currentTopic.function && functionDoc" class="function-docs">
                <hr />
                <h3>Referência Técnica: {{ currentTopic.function }}</h3>
                <p><strong>Descrição:</strong> {{ functionDoc.description }}</p>
                <div v-if="functionDoc.params && functionDoc.params.length > 0">
                  <p><strong>Parâmetros:</strong></p>
                  <ul>
                    <li v-for="p in functionDoc.params" :key="p.name">
                      <code>{{ p.name }}</code> ({{ p.type }}): {{ p.description }}
                    </li>
                  </ul>
                </div>
                <p><strong>Retorno:</strong> <code>{{ functionDoc.returns }}</code></p>
                <p><strong>Exemplo:</strong></p>
                <pre class="help-code"><code>{{ functionDoc.example }}</code></pre>
              </div>
            </div>
            <div v-else class="empty-state">
              <i class="fas fa-book-reader"></i>
              <p>Selecione um tópico para começar a leitura.</p>
            </div>
          </div>
        </div>

        <!-- Status Bar -->
        <div class="help-status-bar">
          Pronto.
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, defineProps, defineEmits, onMounted, onUnmounted, nextTick } from 'vue'
import { sgdkHelpTopics } from '@/utils/sgdkDocsData'
import { sgdkDocumentation } from '@/utils/sgdkHoverProvider'
import { markdownToHtml } from '@/utils/markdownTutorialsLoader'

defineProps({
  show: Boolean
})

defineEmits(['close'])

const activeTab = ref('contents')
const searchQuery = ref('')
const tutorialSearchQuery = ref('')
const currentTopic = ref(sgdkHelpTopics[0])
const history = ref([sgdkHelpTopics[0]])
const topics = ref(sgdkHelpTopics)
const tutorials = ref([])

// Get function docs from the hover provider utility
const functionDoc = computed(() => {
  if (currentTopic.value?.function) {
    return sgdkDocumentation[currentTopic.value.function]
  }
  return null
})

// Flatten functions for index
const allFunctions = computed(() => {
  return Object.keys(sgdkDocumentation).map(name => ({
    name,
    ...sgdkDocumentation[name]
  })).sort((a, b) => a.name.localeCompare(b.name))
})

const filteredFunctions = computed(() => {
  if (!searchQuery.value) return allFunctions.value
  const q = searchQuery.value.toLowerCase()
  return allFunctions.value.filter(f => f.name.toLowerCase().includes(q))
})

const selectTopic = (topic) => {
  currentTopic.value = topic
  history.value.push(topic)
  nextTick(() => {
    highlightCode()
  })
}

const selectFunction = (func) => {
  // Create a temporary topic for the function
  currentTopic.value = {
    id: `func_${func.name}`,
    title: func.name,
    function: func.name,
    content: `<h1>${func.name}</h1><p>${func.description}</p>`
  }
  history.value.push(currentTopic.value)
  nextTick(() => {
    highlightCode()
  })
}

const goBack = () => {
  if (history.value.length > 1) {
    history.value.pop()
    currentTopic.value = history.value[history.value.length - 1]
  }
}

const filteredTutorials = computed(() => {
  if (!tutorialSearchQuery.value) return tutorials.value
  const q = tutorialSearchQuery.value.toLowerCase()
  return tutorials.value.filter(t => 
    t.title.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.toLowerCase().includes(q))
  )
})

const selectTutorial = (tutorial) => {
  currentTopic.value = tutorial
  history.value.push(tutorial)
  // Aplicar syntax highlighting após renderizar
  nextTick(() => {
    highlightCode()
  })
}

const highlightCode = () => {
  try {
    if (!window.hljs) {
      console.warn('[Help] Highlight.js não está disponível')
      return
    }
    
    // Processar blocos de código em tags <pre><code>
    const preBlocks = document.querySelectorAll('.article-body pre code, .help-content pre code, .function-docs pre code, .code-block code')
    preBlocks.forEach(block => {
      try {
        // Adicionar classe de linguagem se não tiver
        if (!block.className.includes('language-')) {
          block.classList.add('language-c')
        }
        // Remover classe hljs se existir (para reprocessar)
        block.classList.remove('hljs-done')
        // Aplicar Highlight.js
        window.hljs.highlightElement(block)
        // Marcar como feito
        block.classList.add('hljs-done')
      } catch (e) {
        console.warn('[Help] Erro ao highlight bloco:', e)
      }
    })
    
    // Também processar blocos .hljs diretos (Markdown renderizado)
    const hlsBlocks = document.querySelectorAll('.article-body .hljs, .help-content .hljs, .function-docs .hljs')
    hlsBlocks.forEach(block => {
      try {
        if (!block.classList.contains('hljs-done')) {
          window.hljs.highlightElement(block)
          block.classList.add('hljs-done')
        }
      } catch (e) {
        // Silenciar erro
      }
    })
    
    // Adicionar event listeners aos botões de copiar
    setupCopyButtons()
    
    // Configurar handlers de links com delay para garantir DOM pronto
    setTimeout(() => {
      setupLinkHandlers()
    }, 50)
  } catch (error) {
    console.error('[Help] Erro ao realizar highlighting:', error)
  }
}

const setupCopyButtons = () => {
  const copyButtons = document.querySelectorAll('.code-copy-btn')
  copyButtons.forEach(btn => {
    // Remover event listeners antigos para evitar duplicação
    btn.replaceWith(btn.cloneNode(true))
  })
  
  // Re-selecionar após clonar
  document.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      
      const codeId = btn.getAttribute('data-code-id')
      const codeBlock = document.getElementById(codeId)
      
      if (!codeBlock) {
        console.warn('[Help] Bloco de código não encontrado:', codeId)
        return
      }
      
      // Extrair texto puro (sem HTML)
      const code = codeBlock.querySelector('code')?.textContent || codeBlock.textContent
      const originalText = btn.innerHTML
      
      try {
        // Copiar para clipboard
        await navigator.clipboard.writeText(code)
        
        // Feedback visual
        btn.classList.add('copied')
        btn.innerHTML = '<i class="fas fa-check"></i> Copiado!'
        
        // Voltar ao estado original após 2 segundos
        setTimeout(() => {
          btn.classList.remove('copied')
          btn.innerHTML = originalText
        }, 2000)
      } catch (err) {
        console.error('[Help] Erro ao copiar código:', err)
        btn.innerHTML = '<i class="fas fa-exclamation"></i> Erro!'
        setTimeout(() => {
          btn.innerHTML = originalText
        }, 1500)
      }
    })
  })
}

const setupLinkHandlers = () => {
  const contentArea = document.querySelector('.help-content')
  if (!contentArea) {
    console.warn('[Help] Elemento .help-content não encontrado')
    return
  }
  
  // Remover listener antigo se existir
  contentArea.removeEventListener('click', handleLinkClick, true)
  
  // Adicionar listener global no container com captura
  contentArea.addEventListener('click', handleLinkClick, true)
  
  console.log('[Help] Link handlers configurados via event delegation')
}

const handleLinkClick = (e) => {
  // Verificar se clicou em um link
  const link = e.target.closest('a')
  if (!link) return
  
  e.preventDefault()
  e.stopPropagation()
  
  const href = link.getAttribute('href')
  console.log('[Help] Clique em link:', href)
  
  if (!href) return
  
  // Verificar se é um link externo (começa com http:// ou https://)
  if (href.startsWith('http://') || href.startsWith('https://')) {
    console.log('[Help] Abrindo URL externa:', href)
    // Abrir no navegador padrão do SO
    window.ipc?.send('open-external-url', { url: href })
  } else if (href.endsWith('.md') || href.includes('.md')) {
    console.log('[Help] Carregando arquivo Markdown interno:', href)
    // Link interno para arquivo Markdown - carregar conteúdo
    loadMarkdownFile(href)
  } else {
    console.log('[Help] Abrindo link interno:', href)
    // Link interno genérico - abrir em nova janela Electron
    window.open(href, '_blank')
  }
}

const loadMarkdownFile = async (filePath) => {
  try {
    // Enviar requisição para carregar arquivo Markdown
    window.ipc?.send('load-markdown-file', { filePath })
    
    // Escutar resultado
    window.ipc?.once('load-markdown-file-result', (data) => {
      if (data.success && data.content) {
        console.log('[Help] Arquivo Markdown carregado:', filePath)
        
        // Criar novo tópico com o conteúdo
        const newTopic = {
          id: `loaded_${Date.now()}`,
          title: data.title || filePath.split('/').pop(),
          content: markdownToHtml(data.content),
          children: []
        }
        
        // Adicionar ao histórico
        currentTopic.value = newTopic
        history.value.push(newTopic)
        
        // Aplicar highlighting
        nextTick(() => {
          highlightCode()
        })
      } else {
        console.error('[Help] Erro ao carregar arquivo:', data.error)
      }
    })
  } catch (error) {
    console.error('[Help] Erro ao solicitar carregamento de arquivo:', error)
  }
}

const printContent = () => {
  window.print()
}

onMounted(() => {
  // Carregar tópicos e tutoriais dinamicamente via IPC
  loadContentTopics()
  loadTutorials()

  // Configurar Hot Reload: recarregar conteúdo se os arquivos mudarem no disco
  if (window.ipc) {
    window.ipc.on('help-content-updated', handleHotReload)
  }
})

onUnmounted(() => {
  // Limpar listener de Hot Reload
  if (window.ipc) {
    window.ipc.off('help-content-updated', handleHotReload)
  }
})

const handleHotReload = () => {
  console.log('[Help] Hot Reload disparado: Recarregando dados...')
  loadContentTopics()
  loadTutorials()
}

const loadContentTopics = async () => {
  try {
    // Enviar requisição para carregar tópicos
    window.ipc?.send('load-content-topics', {})
    
    // Escutar resultado com timeout de 3 segundos
    let received = false
    const timeout = setTimeout(() => {
      if (!received) {
        console.warn('[Help] Timeout ao carregar tópicos, usando padrão')
      }
    }, 3000)
    
    // Escutar resultado
    window.ipc?.once('load-content-topics-result', (data) => {
      received = true
      clearTimeout(timeout)
      
      if (data.success && data.topics && data.topics.length > 0) {
        // Função recursiva para processar a árvore e converter Markdown para HTML
        const processTree = (nodes) => {
          return nodes.map(node => ({
            ...node,
            content: markdownToHtml(node.content),
            children: node.children && node.children.length > 0 ? processTree(node.children) : []
          }))
        }

        const processedTopics = processTree(data.topics)
        topics.value = processedTopics
        
        // Selecionar primeiro tópico automaticamente
        currentTopic.value = processedTopics[0]
        history.value = [processedTopics[0]]
        console.log(`[Help] Árvore de tópicos carregada e processada`)
        
        // Aplicar highlighting após renderizar
        nextTick(() => {
          highlightCode()
        })
      } else {
        console.warn('[Help] Nenhum tópico carregado do sistema de arquivos, usando padrão')
      }
    })
  } catch (error) {
    console.error('[Help] Erro ao carregar tópicos:', error)
  }
}

const loadTutorials = async () => {
  try {
    // Enviar requisição para carregar tutoriais
    window.ipc?.send('load-tutorials', {})
    
    // Escutar resultado com timeout de 3 segundos
    let received = false
    const timeout = setTimeout(() => {
      if (!received) {
        console.warn('[Help] Timeout ao carregar tutoriais, usando padrão')
        loadDefaultTutorials()
      }
    }, 3000)
    
    // Escutar resultado
    window.ipc?.once('load-tutorials-result', (data) => {
      received = true
      clearTimeout(timeout)
      
      if (data.success && data.tutorials && data.tutorials.length > 0) {
        // Processar tutoriais para converter Markdown para HTML
        const processedTutorials = data.tutorials.map(tut => ({
          ...tut,
          content: markdownToHtml(tut.content)
        }))
        tutorials.value = processedTutorials
        console.log(`[Help] Carregados ${processedTutorials.length} tutoriais do sistema de arquivos`)
        
        // Aplicar highlighting após renderizar
        nextTick(() => {
          highlightCode()
        })
      } else {
        console.warn('[Help] Nenhum tutorial carregado do sistema de arquivos, usando padrão')
        loadDefaultTutorials()
      }
    })
  } catch (error) {
    console.error('[Help] Erro ao carregar tutoriais:', error)
    loadDefaultTutorials()
  }
}

const loadDefaultTutorials = () => {
  // Criar alguns tutoriais de exemplo
  const exampleTutorials = [
    {
      id: 'tutorial_sprites',
      title: 'Iniciando com Sprites',
      description: 'Aprenda como criar e manipular sprites no SGDK',
      tags: ['sprites', 'beginner', 'graphics'],
      content: markdownToHtml(`# Iniciando com Sprites

## Pré-requisitos

Antes de começar, você deve ter:

- O SGDK instalado
- Um arquivo .h com a definição do sprite
- Uma imagem PNG (preferentemente 8-bit com paleta)

## Passo 1: Criar o Sprite

\`\`\`c
SPR_init();
Sprite* player = SPR_addSprite(&player_sprite, 160, 120, NULL);
\`\`\`

## Passo 2: Mover o Sprite

\`\`\`c
SPR_setPosition(player, x, y);
\`\`\`

Tudo pronto! Seu sprite está na tela.`)
    },
    {
      id: 'tutorial_palettes',
      title: 'Trabalhando com Paletas',
      description: 'Carregue e manipule paletas de cores',
      tags: ['paletas', 'cores', 'beginner'],
      content: markdownToHtml(`# Trabalhando com Paletas

As paletas no Mega Drive são compostas de até 4 linhas de 16 cores cada.

## Carregar uma Paleta

\`\`\`c
PAL_setPalette(PAL0, my_palette.data, CPU);
\`\`\`

Você pode criar paletas usando ferramentas como GIMP ou Aseprite.`)
    }
  ]
  tutorials.value = exampleTutorials
}
</script>

<style>
.help-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.help-window {
  width: 900px;
  height: 650px;
  background: #f0f0f0;
  border: 2px solid #888;
  box-shadow: 5px 5px 15px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  color: #000;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.help-title-bar {
  background: linear-gradient(to right, #000080, #1084d0);
  color: white;
  padding: 4px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
  font-size: 14px;
}

.title-btn {
  background: #c0c0c0;
  border: 1px solid #fff;
  border-right-color: #404040;
  border-bottom-color: #404040;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 10px;
}

.title-btn:active {
  border: 1px solid #404040;
  border-right-color: #fff;
  border-bottom-color: #fff;
}

.help-toolbar {
  background: #f0f0f0;
  border-bottom: 1px solid #888;
  padding: 4px;
  display: flex;
  gap: 4px;
}

.toolbar-btn {
  background: transparent;
  border: 1px solid transparent;
  padding: 4px 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.toolbar-btn:hover {
  background: #e0e0e0;
  border-color: #bbb;
}

.toolbar-btn.active {
  background: #fff;
  border-color: #888;
  border-bottom-color: transparent;
}

.toolbar-separator {
  width: 1px;
  background: #888;
  margin: 0 4px;
}

.help-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.help-sidebar {
  width: 250px;
  background: #fff;
  border-right: 1px solid #888;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.topics-tree {
  padding: 8px;
}

.tree-node {
  margin-bottom: 4px;
}

.node-header {
  padding: 4px 8px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-header:hover {
  background: #eef;
}

.node-header.active {
  background: #000080;
  color: white;
}

.node-children {
  padding-left: 20px;
  margin-top: 2px;
}

.child-node {
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.child-node:hover {
  background: #eef;
}

.child-node.active {
  background: #000080;
  color: white;
}

.help-content {
  flex: 1;
  background: #fff;
  overflow-y: auto;
  padding: 24px;
  line-height: 1.6;
}

.article-body {
  font-size: 13px;
  line-height: 1.6;
  color: #000;
}

.article-body h1 {
  margin-top: 0;
  margin-bottom: 16px;
  color: #000080;
  border-bottom: 2px solid #000080;
  padding-bottom: 8px;
  font-size: 16px;
  font-weight: bold;
}

.article-body h2 {
  margin-top: 18px;
  margin-bottom: 10px;
  color: #000080;
  font-size: 14px;
  font-weight: bold;
}

.article-body h3 {
  margin-top: 14px;
  margin-bottom: 8px;
  color: #334080;
  font-size: 13px;
  font-weight: bold;
}

.article-body h4,
.article-body h5,
.article-body h6 {
  margin-top: 12px;
  margin-bottom: 6px;
  color: #000080;
  font-size: 12px;
  font-weight: bold;
}

.article-body p {
  margin: 0 0 10px 0;
  font-size: 13px;
  line-height: 1.5;
  text-align: justify;
}

.article-body ul,
.article-body ol {
  margin: 10px 0 10px 30px;
  font-size: 13px;
  line-height: 1.5;
}

.article-body li {
  margin-bottom: 4px;
}

.article-body strong,
.article-body b {
  color: #000080;
  font-weight: bold;
}

.article-body em,
.article-body i {
  font-style: italic;
  color: #333;
}

.article-body code {
  background: #f0f0f0;
  padding: 2px 4px;
  border: 1px solid #ccc;
  border-radius: 2px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #c41a16;
}

.article-body a {
  color: #0066cc;
  text-decoration: underline;
  cursor: pointer;
}

.article-body a:hover {
  color: #0044aa;
}

.article-body pre {
  background: #f8f8f8;
  border: 1px solid #ccc;
  padding: 0;
  margin: 12px 0;
  overflow-x: auto;
  line-height: 1.4;
  border-left: 4px solid #0066cc;
}

.code-block-wrapper {
  margin: 12px 0;
  border: 1px solid #ccc;
  border-left: 4px solid #0066cc;
  border-radius: 0;
  overflow: hidden;
  background: #f8f8f8;
}

.code-block-header {
  background: linear-gradient(to right, #f0f0f0, #ffffff);
  border-bottom: 1px solid #ccc;
  padding: 6px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.code-block-lang {
  color: #000080;
  font-weight: bold;
  text-transform: uppercase;
  font-family: 'Segoe UI', Tahoma, sans-serif;
}

.code-copy-btn {
  background: #c0c0c0;
  border: 1px solid #fff;
  border-right-color: #404040;
  border-bottom-color: #404040;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: #000;
}

.code-copy-btn:active {
  border: 1px solid #404040;
  border-right-color: #fff;
  border-bottom-color: #fff;
}

.code-copy-btn.copied {
  background: #90EE90;
}

.code-block {
  background: #f8f8f8 !important;
  padding: 12px !important;
  margin: 0 !important;
  border: none !important;
  overflow-x: auto;
  line-height: 1.4;
  font-size: 12px;
  display: block;
  width: 100%;
}

.code-block code {
  background: transparent !important;
  padding: 0 !important;
  border: none !important;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: inherit !important;
}

/* Highlight.js color scheme (Windows/Delphi Style) */
.hljs {
  display: block;
  overflow-x: auto;
  padding: 0;
  background: transparent !important;
  color: #000 !important;
}

.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-section,
.hljs-link,
.hljs-type {
  color: #0000FF !important; /* Azul puro estilo Delphi */
  font-weight: bold !important;
}

.hljs-string {
  color: #800000 !important; /* Marrom/Vermelho escuro */
}

.hljs-comment {
  color: #008000 !important; /* Verde escuro estilo Delphi */
  font-style: italic !important;
}

.hljs-number {
  color: #000080 !important; /* Navy */
}

.hljs-title,
.hljs-title.function_ {
  color: #000 !important;
  font-weight: bold !important;
}

.hljs-built_in {
  color: #0000FF !important;
  font-weight: bold !important;
}

.help-code {
  background: #f8f8f8;
  border: 1px solid #ccc;
  border-left: 4px solid #0066cc;
  padding: 12px;
  border-radius: 0;
  font-family: 'Courier New', 'Source Code Pro', monospace;
  font-size: 12px;
  overflow-x: auto;
  margin: 12px 0;
  line-height: 1.4;
  color: #000;
}

.help-code code {
  background: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
  border: none;
}

.index-search {
  padding: 8px;
  background: #f0f0f0;
}

.search-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #888;
  font-size: 12px;
}

.index-list {
  flex: 1;
  overflow-y: auto;
}

.index-item {
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}

.index-item:hover {
  background: #000080;
  color: white;
}

.help-status-bar {
  background: #f0f0f0;
  border-top: 1px solid #888;
  padding: 2px 8px;
  font-size: 11px;
  color: #444;
}

.function-docs {
  margin-top: 24px;
  padding: 16px;
  background: linear-gradient(135deg, #f0f4ff 0%, #f8f0ff 100%);
  border-left: 4px solid #000080;
  border-radius: 0;
  border: 1px solid #d0d8ff;
  border-left: 4px solid #0066cc;
}

.function-docs hr {
  border: none;
  border-top: 1px solid #d0d8ff;
  margin: 0 0 12px 0;
}

.function-docs h3 {
  margin: 0 0 12px 0;
  color: #000080;
  font-size: 14px;
  font-weight: bold;
}

.function-docs p {
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.5;
}

.function-docs strong {
  color: #000080;
  font-weight: bold;
}

.function-docs code {
  background: #ffffff;
  padding: 2px 4px;
  border: 1px solid #d0d8ff;
  border-radius: 2px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #c41a16;
}

.function-docs pre {
  background: #ffffff;
  border: 1px solid #d0d8ff;
  padding: 12px;
  margin: 8px 0;
  border-left: 4px solid #0066cc;
  overflow-x: auto;
  line-height: 1.4;
}

.function-docs pre code {
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
  font-size: 12px;
  font-family: 'Courier New', monospace;
}

/* Syntax Highlighting dentro de function-docs */
.function-docs .hljs {
  background: #ffffff !important;
  color: #000 !important;
}

.function-docs .hljs-keyword,
.function-docs .hljs-selector-tag,
.function-docs .hljs-literal,
.function-docs .hljs-type {
  color: #0066cc !important;
  font-weight: bold !important;
}

.function-docs .hljs-attr,
.function-docs .hljs-attribute {
  color: #d73a49 !important;
}

.function-docs .hljs-string {
  color: #c41a16 !important;
}

.function-docs .hljs-title,
.function-docs .hljs-title.function_ {
  color: #6f42c1 !important;
}

.function-docs .hljs-number {
  color: #005a9e !important;
}

.function-docs .hljs-comment {
  color: #0a7900 !important;
  font-style: italic !important;
}

.function-docs .hljs-built_in {
  color: #0066cc !important;
  font-weight: bold !important;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
}

.empty-state i {
  font-size: 48px;
  margin-bottom: 16px;
}

/* Tutorials Tab Styles */
.tutorials-search {
  padding: 8px;
  background: #f0f0f0;
}

.tutorials-list {
  flex: 1;
  overflow-y: auto;
}

.tutorial-item {
  padding: 12px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  background: #fff;
}

.tutorial-item:hover {
  background: #f8f8ff;
  border-left: 3px solid #000080;
  padding-left: 9px;
}

.tutorial-item.active {
  background: #e8e8ff;
  border-left: 3px solid #000080;
  padding-left: 9px;
}

.tutorial-title {
  font-weight: bold;
  font-size: 13px;
  margin-bottom: 4px;
  color: #000080;
}

.tutorial-description {
  font-size: 11px;
  color: #666;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tutorial-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  display: inline-block;
  background: #e0e0ff;
  color: #000080;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
}

.sidebar-tab-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Estilos para imagens no Markdown */
.markdown-img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 15px auto;
  border: 1px solid #888;
  box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
  background: white;
  padding: 3px;
}
</style>
