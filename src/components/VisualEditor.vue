<template>
  <div class="visual-editor">
    <div class="code-editor-container">
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
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useStore } from 'vuex'
import CodeEditor from './CodeEditor.vue'
import TabsComponet from './TabsComponet.vue'

const store = useStore()
const codeEditorRef = ref(null)
const contentFile = ref('')

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

const currentFile = computed(() => store.state.currentFile)
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
  const project = JSON.parse(localStorage.getItem('project') || '{}')
  if (!toolkitPath.value) {
    store.dispatch('showNotification', {
      type: 'warning',
      title: 'SDK não configurado',
      message: 'Defina o caminho do SGDK nas configurações antes de executar.'
    })
    return
  }

  if (project.path) {
    window.ipc?.send('run-game', {
      ...project,
      toolkitPath: toolkitPath.value
    })
  } else {
    store.dispatch('showNotification', {
      type: 'warning',
      title: 'Projeto não encontrado',
      message: 'Abra um projeto antes de executar.'
    })
  }
}

const exportSceneToCodeFile = () => {
  store.dispatch('showNotification', {
    type: 'warning',
    title: 'Recurso indisponível',
    message: 'O editor visual está desativado; exportação de cena não está disponível.'
  })
}

const saveScene = () => {
  saveCurrentFile()
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
  
  if (e.key === 'F5') {
    e.preventDefault()
    playScene()
  }
}

const handleReceiveFile = (result) => {
  codeEditorRef.value?.getCodFile(result)
}

const handleRunGameError = (payload) => {
  if (!payload?.message) return
  store.dispatch('showNotification', {
    type: 'error',
    title: 'Falha ao executar',
    message: payload.message
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

.code-editor-container {
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
