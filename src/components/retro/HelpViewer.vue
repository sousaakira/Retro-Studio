<template>
  <Teleport to="body">
    <div v-if="show" class="help-overlay" @click.self="$emit('close')">
      <div class="help-window">
        <div class="help-title-bar">
          <div class="title-text">
            <span class="icon-circle-question"></span> SGDK Help - Sistema de Ajuda
          </div>
          <div class="title-actions">
            <button class="title-btn" @click="$emit('close')" title="Fechar">×</button>
          </div>
        </div>

        <div class="help-toolbar">
          <button class="toolbar-btn" :class="{ active: activeTab === 'contents' }" @click="activeTab = 'contents'">
            <span class="icon-list-check"></span> Conteúdo
          </button>
          <button class="toolbar-btn" :class="{ active: activeTab === 'index' }" @click="activeTab = 'index'">
            <span class="icon-magnifying-glass"></span> Índice
          </button>
          <button class="toolbar-btn" :class="{ active: activeTab === 'tutorials' }" @click="activeTab = 'tutorials'">
            <span class="icon-code"></span> Tutoriais
          </button>
          <div class="toolbar-separator"></div>
          <button class="toolbar-btn" :disabled="history.length <= 1" @click="goBack">
            <span class="icon-arrows-rotate"></span> Voltar
          </button>
          <button class="toolbar-btn" @click="printContent">
            Imprimir
          </button>
        </div>

        <div class="help-main">
          <div class="help-sidebar">
            <div v-if="activeTab === 'contents'" class="sidebar-tab-content">
              <div class="topics-tree">
                <template v-for="topic in topics" :key="topic.id">
                  <div class="tree-node">
                    <div
                      class="node-header"
                      :class="{ active: currentTopic?.id === topic.id }"
                      @click="selectTopic(topic)"
                    >
                      <span :class="topic.children?.length ? 'icon-folder-tree' : 'icon-code'"></span>
                      {{ topic.title }}
                    </div>
                    <div v-if="topic.children?.length" class="node-children">
                      <div
                        v-for="child in topic.children"
                        :key="child.id"
                        class="child-node"
                        :class="{ active: currentTopic?.id === child.id }"
                        @click="selectTopic(child)"
                      >
                        <span class="icon-code"></span>
                        {{ child.title }}
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <div v-if="activeTab === 'index'" class="sidebar-tab-content">
              <div class="index-search">
                <input v-model="searchQuery" type="text" placeholder="Digite o nome da função..." class="search-input" />
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

            <div v-if="activeTab === 'tutorials'" class="sidebar-tab-content">
              <div class="tutorials-search">
                <input v-model="tutorialSearchQuery" type="text" placeholder="Buscar tutoriais..." class="search-input" />
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
                  <div v-if="tut.tags?.length" class="tutorial-tags">
                    <span v-for="tag in tut.tags" :key="tag" class="tag">{{ tag }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div ref="contentArea" class="help-content">
            <div v-if="currentTopic" class="article-body">
              <div v-html="currentTopic.content"></div>
              <div v-if="currentTopic.function && functionDoc" class="function-docs">
                <hr />
                <h3>Referência Técnica: {{ currentTopic.function }}</h3>
                <p><strong>Descrição:</strong> {{ functionDoc.description }}</p>
                <div v-if="functionDoc.params?.length">
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
              <span class="icon-code"></span>
              <p>Selecione um tópico para começar a leitura.</p>
            </div>
          </div>
        </div>

        <div class="help-status-bar">Pronto.</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { sgdkHelpTopics } from '@/utils/retro/sgdkDocsData'
import { sgdkDocumentation, expandSGDKDocumentation } from '@/utils/retro/sgdkHoverProvider'
import { markdownToHtml } from '@/utils/retro/markdownTutorialsLoader'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

defineProps({ show: Boolean })
defineEmits(['close'])

const activeTab = ref('contents')
const searchQuery = ref('')
const tutorialSearchQuery = ref('')
const currentTopic = ref(sgdkHelpTopics[0])
const history = ref([sgdkHelpTopics[0]])
const topics = ref(sgdkHelpTopics)
const tutorials = ref([])

const functionDoc = computed(() => {
  if (currentTopic.value?.function) {
    return sgdkDocumentation[currentTopic.value.function]
  }
  return null
})

const allFunctions = computed(() => {
  return Object.keys(sgdkDocumentation).map((name) => ({
    name,
    ...sgdkDocumentation[name]
  })).sort((a, b) => a.name.localeCompare(b.name))
})

const filteredFunctions = computed(() => {
  if (!searchQuery.value) return allFunctions.value
  const q = searchQuery.value.toLowerCase()
  return allFunctions.value.filter((f) => f.name.toLowerCase().includes(q))
})

const filteredTutorials = computed(() => {
  if (!tutorialSearchQuery.value) return tutorials.value
  const q = tutorialSearchQuery.value.toLowerCase()
  return tutorials.value.filter(
    (t) =>
      t.title?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(q))
  )
})

function selectTopic(topic) {
  currentTopic.value = topic
  history.value.push(topic)
  nextTick(() => highlightCode())
}

function selectFunction(func) {
  currentTopic.value = {
    id: `func_${func.name}`,
    title: func.name,
    function: func.name,
    content: `<h1>${func.name}</h1><p>${func.description}</p>`
  }
  history.value.push(currentTopic.value)
  nextTick(() => highlightCode())
}

function goBack() {
  if (history.value.length > 1) {
    history.value.pop()
    currentTopic.value = history.value[history.value.length - 1]
  }
}

function selectTutorial(tutorial) {
  currentTopic.value = tutorial
  history.value.push(tutorial)
  nextTick(() => highlightCode())
}

function highlightCode() {
  try {
    const blocks = document.querySelectorAll('.article-body pre code, .help-content pre code, .function-docs pre code, .code-block code')
    blocks.forEach((block) => {
      try {
        if (!block.className.includes('language-')) block.classList.add('language-c')
        block.classList.remove('hljs-done')
        hljs.highlightElement(block)
        block.classList.add('hljs-done')
      } catch (e) {}
    })
    setupCopyButtons()
    setTimeout(() => setupLinkHandlers(), 50)
  } catch (e) {}
}

function setupCopyButtons() {
  document.querySelectorAll('.code-copy-btn').forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true))
  })
  document.querySelectorAll('.code-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      const codeId = btn.getAttribute('data-code-id')
      const codeBlock = document.getElementById(codeId)
      if (!codeBlock) return
      const code = codeBlock.querySelector('code')?.textContent || codeBlock.textContent
      const originalText = btn.innerHTML
      try {
        await navigator.clipboard.writeText(code)
        btn.classList.add('copied')
        btn.innerHTML = '✓ Copiado!'
        setTimeout(() => {
          btn.classList.remove('copied')
          btn.innerHTML = originalText
        }, 2000)
      } catch {
        btn.innerHTML = 'Erro!'
        setTimeout(() => { btn.innerHTML = originalText }, 1500)
      }
    })
  })
}

function setupLinkHandlers() {
  const contentArea = document.querySelector('.help-content')
  if (!contentArea) return
  contentArea.removeEventListener('click', handleLinkClick, true)
  contentArea.addEventListener('click', handleLinkClick, true)
}

function handleLinkClick(e) {
  const link = e.target.closest('a')
  if (!link) return
  e.preventDefault()
  e.stopPropagation()
  const href = link.getAttribute('href')
  if (!href) return
  if (href.startsWith('http://') || href.startsWith('https://')) {
    window.retroStudio?.retro?.openExternalUrl?.(href)
  } else if (href.endsWith('.md') || href.includes('.md')) {
    loadMarkdownFile(href)
  } else {
    window.open(href, '_blank')
  }
}

async function loadMarkdownFile(filePath) {
  try {
    const data = await window.retroStudio?.retro?.loadMarkdownFile?.(filePath)
    if (data?.success && data.content) {
      const newTopic = {
        id: `loaded_${Date.now()}`,
        title: data.title || filePath.split('/').pop(),
        content: markdownToHtml(data.content),
        children: []
      }
      currentTopic.value = newTopic
      history.value.push(newTopic)
      nextTick(() => highlightCode())
    }
  } catch (e) {
    console.error('[Help] Erro ao carregar Markdown:', e)
  }
}

function printContent() {
  window.print()
}

async function loadContentTopics() {
  try {
    const data = await window.retroStudio?.retro?.loadContentTopics?.()
    if (data?.success && data.topics?.length) {
      const processTree = (nodes) =>
        nodes.map((node) => ({
          ...node,
          content: markdownToHtml(node.content || ''),
          children: node.children?.length ? processTree(node.children) : []
        }))
      const processed = processTree(data.topics)
      topics.value = processed
      if (processed[0]) {
        currentTopic.value = processed[0]
        history.value = [processed[0]]
      }
      nextTick(() => highlightCode())
    }
  } catch (e) {
    console.warn('[Help] Usando tópicos padrão')
  }
}

async function loadTutorials() {
  try {
    const data = await window.retroStudio?.retro?.loadTutorials?.()
    if (data?.success && data.tutorials?.length) {
      tutorials.value = data.tutorials.map((t) => ({
        ...t,
        content: markdownToHtml(t.content)
      }))
      nextTick(() => highlightCode())
    } else {
      loadDefaultTutorials()
    }
  } catch (e) {
    loadDefaultTutorials()
  }
}

function loadDefaultTutorials() {
  tutorials.value = [
    {
      id: 'tutorial_sprites',
      title: 'Iniciando com Sprites',
      description: 'Aprenda como criar e manipular sprites no SGDK',
      tags: ['sprites', 'beginner', 'graphics'],
      content: markdownToHtml(`# Iniciando com Sprites\n\n## Pré-requisitos\n- SGDK instalado\n- Arquivo .h com definição do sprite\n\n## Passo 1\n\`\`\`c\nSPR_init();\nSprite* player = SPR_addSprite(&player_sprite, 160, 120, NULL);\n\`\`\`\n\n## Passo 2\n\`\`\`c\nSPR_setPosition(player, x, y);\n\`\`\``)
    },
    {
      id: 'tutorial_palettes',
      title: 'Trabalhando com Paletas',
      description: 'Carregue e manipule paletas de cores',
      tags: ['paletas', 'cores', 'beginner'],
      content: markdownToHtml(`# Trabalhando com Paletas\n\nAs paletas no Mega Drive são compostas de até 4 linhas de 16 cores cada.\n\n\`\`\`c\nPAL_setPalette(PAL0, my_palette.data, CPU);\n\`\`\``)
    }
  ]
}

function handleHotReload() {
  loadContentTopics()
  loadTutorials()
}

let unsubscribeHelp = null

onMounted(() => {
  expandSGDKDocumentation()
  loadContentTopics()
  loadTutorials()
  unsubscribeHelp = window.retroStudio?.retro?.onHelpContentUpdated?.(handleHotReload)
})

onUnmounted(() => {
  unsubscribeHelp?.()
})
</script>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
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
  box-shadow: 5px 5px 15px rgba(0, 0, 0, 0.5);
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
  font-size: 16px;
  font-weight: bold;
  color: #000;
  line-height: 1;
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
  color: #000;
}

.help-toolbar .toolbar-btn span[class^="icon-"] {
  filter: none;
}

.help-sidebar span[class^="icon-"],
.help-content span[class^="icon-"],
.empty-state span[class^="icon-"] {
  filter: none;
}

.node-header.active span[class^="icon-"],
.child-node.active span[class^="icon-"],
.tutorial-item.active span[class^="icon-"] {
  filter: invert(1);
}

.toolbar-btn:hover:not(:disabled) {
  background: #e0e0e0;
  border-color: #bbb;
}

.toolbar-btn.active {
  background: #fff;
  border-color: #888;
  border-bottom-color: transparent;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.topics-tree { padding: 8px; }
.tree-node { margin-bottom: 4px; }

.node-header, .child-node {
  padding: 4px 8px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-header:hover, .child-node:hover {
  background: #eef;
}

.node-header.active, .child-node.active {
  background: #000080;
  color: white;
}

.node-children {
  padding-left: 20px;
  margin-top: 2px;
}

.help-content {
  flex: 1;
  background: #fff;
  overflow-y: auto;
  padding: 24px;
  line-height: 1.6;
}

.article-body { font-size: 13px; color: #000; }
.article-body h1 { margin-top: 0; margin-bottom: 16px; color: #000080; border-bottom: 2px solid #000080; padding-bottom: 8px; font-size: 16px; }
.article-body h2 { margin-top: 18px; margin-bottom: 10px; color: #000080; font-size: 14px; }
.article-body h3 { margin-top: 14px; margin-bottom: 8px; color: #334080; font-size: 13px; }
.article-body p { margin: 0 0 10px 0; font-size: 13px; }
.article-body ul, .article-body ol { margin: 10px 0 10px 30px; font-size: 13px; }
.article-body li { margin-bottom: 4px; }
.article-body code { background: #f0f0f0; padding: 2px 4px; border: 1px solid #ccc; border-radius: 2px; font-family: monospace; font-size: 12px; color: #c41a16; }
.article-body a { color: #0066cc; text-decoration: underline; cursor: pointer; }
.article-body pre { background: #f8f8f8; border: 1px solid #ccc; padding: 0; margin: 12px 0; overflow-x: auto; line-height: 1.4; border-left: 4px solid #0066cc; }

.index-search, .tutorials-search { padding: 8px; background: #f0f0f0; }
.search-input { width: 100%; padding: 4px 8px; border: 1px solid #888; font-size: 12px; }

.index-item {
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.index-item:hover {
  background: #000080;
  color: white;
}

.tutorial-item {
  padding: 12px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  background: #fff;
}
.tutorial-item:hover { background: #f8f8ff; border-left: 3px solid #000080; padding-left: 9px; }
.tutorial-item.active { background: #e8e8ff; border-left: 3px solid #000080; padding-left: 9px; }
.tutorial-title { font-weight: bold; font-size: 13px; margin-bottom: 4px; color: #000080; }
.tutorial-description { font-size: 11px; color: #666; margin-bottom: 6px; }
.tutorial-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tag { display: inline-block; background: #e0e0ff; color: #000080; padding: 2px 6px; border-radius: 3px; font-size: 10px; }

.function-docs {
  margin-top: 24px;
  padding: 16px;
  background: linear-gradient(135deg, #f0f4ff 0%, #f8f0ff 100%);
  border-left: 4px solid #000080;
  border: 1px solid #d0d8ff;
  border-left: 4px solid #0066cc;
}
.function-docs hr { border: none; border-top: 1px solid #d0d8ff; margin: 0 0 12px 0; }
.function-docs h3 { margin: 0 0 12px 0; color: #000080; font-size: 14px; }
.function-docs code { background: #fff; padding: 2px 4px; border: 1px solid #d0d8ff; font-family: monospace; font-size: 12px; color: #c41a16; }
.help-code { background: #f8f8f8; border: 1px solid #ccc; border-left: 4px solid #0066cc; padding: 12px; margin: 12px 0; overflow-x: auto; font-size: 12px; }

.code-block-wrapper { margin: 12px 0; border: 1px solid #ccc; border-left: 4px solid #0066cc; overflow: hidden; background: #f8f8f8; }
.code-block-header { background: linear-gradient(to right, #f0f0f0, #fff); border-bottom: 1px solid #ccc; padding: 6px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.code-block-lang { color: #000080; font-weight: bold; text-transform: uppercase; }
.code-copy-btn { background: #c0c0c0; border: 1px solid #fff; border-right-color: #404040; border-bottom-color: #404040; padding: 2px 8px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 4px; }
.code-copy-btn.copied { background: #90ee90; }

.help-status-bar { background: #f0f0f0; border-top: 1px solid #888; padding: 2px 8px; font-size: 11px; color: #444; }

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
}
.empty-state .icon-code { font-size: 48px; margin-bottom: 16px; }

.sidebar-tab-content { display: flex; flex-direction: column; height: 100%; }
.markdown-img { max-width: 100%; height: auto; display: block; margin: 15px auto; border: 1px solid #888; }
</style>
