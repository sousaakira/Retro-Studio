<template>
  <div class="visual-editor">
    <!-- Modo Código -->
    <div v-if="viewMode === 'code'" class="code-editor-container">
      <div class="code-editor-header">
        <div class="tabs-wrapper">
          <TabsComponet 
            :tabRef="tabs"
            :activePath="activePath"
            @tab-selected="emitTabSelected"
            @tab-closed="emitTabClosed"
            @tabs-reordered="emitTabsReordered"
          />
        </div>
        <div class="file-actions">
          <button class="header-btn" @click="saveCurrentFile" title="Salvar (Ctrl+S)">
            <i class="fas fa-save"></i>
          </button>
        </div>
      </div>
      <CodeEditor ref="codeEditorRef" :msg="contentFile" :sendSave="sendSave" />
    </div>

    <!-- Modo Visual -->
    <div v-else class="scene-viewport-container">
      <div v-if="!store.state.currentScene" class="no-scene-state">
        <div class="no-scene-content">
          <i class="fas fa-cubes"></i>
          <h2>Nenhuma Cena Ativa</h2>
          <p>Selecione um arquivo de cena (.json) ou crie uma nova para começar a editar visualmente.</p>
          <div class="no-scene-actions">
            <button class="action-btn primary" @click="createNewScene">
              <i class="fas fa-plus"></i> Criar Nova Cena
            </button>
          </div>
        </div>
      </div>
      <SceneViewport 
        v-else
        ref="sceneViewportRef" 
        @scene-changed="handleSceneChanged"
      />
    </div>

    <!-- Prompt para nome da nova cena -->
    <FsNamePrompt
      :show="showSceneNamePrompt"
      title="Nome da Nova Cena"
      placeholder="ex: fase_1"
      @confirm="confirmCreateNewScene"
      @cancel="showSceneNamePrompt = false"
    />
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useStore } from 'vuex'
import CodeEditor from './CodeEditor.vue'
import TabsComponet from './TabsComponet.vue'
import SceneViewport from './SceneViewport.vue'
import FsNamePrompt from './FsNamePrompt.vue'
import { exportSceneToCode } from '../utils/megadriveExport'

const store = useStore()
const codeEditorRef = ref(null)
const sceneViewportRef = ref(null)
const contentFile = ref('')
const showSceneNamePrompt = ref(false)

const props = defineProps({
  tabs: {
    type: Array,
    default: () => []
  },
  activeTabPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['tab-selected', 'tab-closed', 'tabs-reordered'])

const viewMode = computed(() => store.state.viewMode)
const currentFile = computed(() => store.state.currentFile)

// Log view mode changes for debugging
watch(viewMode, (newMode) => {
  console.log('[VisualEditor] Mode changed to:', newMode)
})
const tabs = computed(() => props.tabs || [])
const activePath = computed(() => props.activeTabPath || currentFile.value || '')
const toolkitPath = computed(() => store.state.uiSettings?.toolkitPath || '')

const sendSave = () => {
  codeEditorRef.value?.sendSave()
}

const saveCurrentFile = () => {
  if (!currentFile.value) {
    store.dispatch('showNotification', {
      type: 'info',
      title: 'Nenhum arquivo',
      message: 'Abra um arquivo antes de salvar.'
    })
    return
  }
  sendSave()
}

const playScene = () => {
  const project = store.state.projectConfig
  if (!toolkitPath.value) {
    store.dispatch('showNotification', {
      type: 'warning',
      title: 'SDK não configurado',
      message: 'Defina o caminho do SGDK nas configurações antes de executar.'
    })
    return
  }

  if (project.path) {
    window.ipc?.send('run-game', JSON.parse(JSON.stringify({
      ...project,
      toolkitPath: toolkitPath.value
    })))
  } else {
    store.dispatch('showNotification', {
      type: 'warning',
      title: 'Projeto não encontrado',
      message: 'Abra um projeto antes de executar.'
    })
  }
}

const exportSceneToCodeFile = () => {
  if (viewMode.value === 'visual') {
    const scene = store.state.currentScene
    if (!scene) {
      store.dispatch('showNotification', {
        type: 'warning',
        title: 'Nenhuma cena',
        message: 'Crie ou abra uma cena antes de exportar.'
      })
      return
    }
    
    // Gerar o código C a partir do estado atual da cena e recursos
    // Usamos JSON.parse(JSON.stringify()) para remover Proxies do Vue que o Electron não consegue clonar via IPC
    const sceneData = JSON.parse(JSON.stringify({
      ...scene,
      nodes: store.state.sceneNodes,
      resources: store.state.resources
    }))
    
    const generatedCode = exportSceneToCode(sceneData)
    
    window.ipc?.send('export-scene', {
      scene: sceneData,
      code: generatedCode,
      nodes: sceneData.nodes,
      resources: sceneData.resources
    })
  } else {
    store.dispatch('showNotification', {
      type: 'warning',
      title: 'Recurso indisponível',
      message: 'Mude para o modo Visual para exportar a cena.'
    })
  }
}

const saveScene = () => {
  if (viewMode.value === 'visual') {
    const scene = store.state.currentScene
    const project = store.state.projectConfig
    if (scene && project?.path) {
      window.ipc?.send('save-scene', JSON.parse(JSON.stringify({
        scene,
        nodes: store.state.sceneNodes,
        projectPath: project.path
      })))
    }
  } else {
    saveCurrentFile()
  }
}

const openFile = (filePath) => {
  if (!filePath) return
  contentFile.value = filePath
  store.commit('setCurrentFile', filePath)
  window.ipc?.send('open-file', filePath)
}

const clearEditor = () => {
  contentFile.value = ''
  store.commit('setCurrentFile', null)
  codeEditorRef.value?.getCodFile?.('')
}

const emitTabSelected = (payload) => emit('tab-selected', payload)
const emitTabClosed = (payload) => emit('tab-closed', payload)
const emitTabsReordered = (payload) => emit('tabs-reordered', payload)

const handleKeyDown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.target.closest?.('.monaco-editor-container')) return

  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    saveScene()
  }
}

const handleReceiveFile = (result) => {
  if (viewMode.value === 'code') {
    codeEditorRef.value?.getCodFile(result)
  } else {
    console.log('[VisualEditor] Ignorando receive-file no modo visual')
  }
}

const handleRunGameError = (payload) => {
  if (!payload?.message) return
  store.dispatch('showNotification', {
    type: 'error',
    title: 'Falha ao executar',
    message: payload.message
  })
}

const handleSceneChanged = () => {
  // Atualização em "tempo real" do arquivo C
  // Podemos adicionar um pequeno debounce aqui se necessário, 
  // mas como o export é rápido, vamos testar direto.
  exportSceneToCodeFile()
}

const createNewScene = () => {
  showSceneNamePrompt.value = true
}

const confirmCreateNewScene = (name) => {
  if (!name) return
  const safeName = name.trim().replace(/\s+/g, '_').toLowerCase()
  store.dispatch('setCurrentScene', {
    id: `scene_${Date.now()}`,
    name: safeName,
    createdAt: new Date().toISOString()
  })
  store.commit('setSceneNodes', [])
  showSceneNamePrompt.value = false
  
  // Notificar sucesso
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Cena Criada',
    message: `A cena "${safeName}" foi inicializada.`
  })
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  window.ipc?.on?.('receive-file', handleReceiveFile)
  window.ipc?.on?.('run-game-error', handleRunGameError)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.ipc?.off?.('receive-file', handleReceiveFile)
  window.ipc?.off?.('run-game-error', handleRunGameError)
})

// Expose methods to parent component
// eslint-disable-next-line no-undef
defineExpose({
  playScene,
  saveScene,
  exportSceneToCodeFile,
  sendSave,
  openFile,
  clearEditor,
  goToLine: (lineNumber, columnNumber) => {
    if (codeEditorRef.value?.goToLine) {
      codeEditorRef.value.goToLine(lineNumber, columnNumber)
    }
  }
})
</script>

<style scoped>
.visual-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
}

.no-scene-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e1e;
  color: #888;
}

.no-scene-content {
  text-align: center;
  max-width: 400px;
}

.no-scene-content i {
  font-size: 48px;
  margin-bottom: 20px;
  color: #333;
}

.no-scene-content h2 {
  color: #ccc;
  margin-bottom: 10px;
}

.no-scene-content p {
  margin-bottom: 20px;
  font-size: 14px;
}

.no-scene-actions {
  display: flex;
  justify-content: center;
}

.action-btn {
  background: #333;
  border: 1px solid #444;
  color: #ccc;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn:hover {
  background: #444;
  color: white;
}

.action-btn.primary {
  background: #0066cc;
  border-color: #0088ff;
  color: white;
}

.action-btn.primary:hover {
  background: #0088ff;
}

.code-editor-container, .scene-viewport-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1e1e1e;
}

.code-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: #1f1f1f;
  border-bottom: 1px solid #333;
  height: 40px;
  box-sizing: border-box;
}

.tabs-wrapper {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding-right: 12px;
}

.file-actions {
  display: flex;
  gap: 4px;
}

.header-btn {
  background: transparent;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
}

.header-btn:hover {
  background: #333;
  border-color: #444;
  color: #fff;
}

</style>
