<template>
  <div class="main-layout">
    <!-- Top Bar -->
    <div class="top-bar" @dblclick="handleWindowControl('toggle-maximize')">
      <div class="top-bar-left">
        <div 
          v-if="isWindowControlsLeft" 
          class="window-controls no-drag left"
        >
          <button class="window-btn close" @click.stop="handleWindowControl('close')" title="Close">
            <i class="fas fa-times"></i>
          </button>
          <button class="window-btn minimize" @click.stop="handleWindowControl('minimize')" title="Minimize">
            <i class="fas fa-minus"></i>
          </button>
          <button class="window-btn maximize" @click.stop="handleWindowControl('toggle-maximize')" :title="isMaximized ? 'Restore' : 'Maximize'">
            <i :class="isMaximized ? 'fas fa-clone' : 'far fa-square'"></i>
          </button>
        </div>
        <div class="app-title">
          <i class="fas fa-gamepad"></i>
          Retro Studio
        </div>
        <div class="menu-section no-drag">
          <button class="menu-btn" @click="openSettings" title="Settings">
            <i class="fas fa-cog"></i>
          </button>
        </div>

        <div class="mode-section no-drag">
          <button 
            class="mode-btn" 
            :class="{ active: viewMode === 'code' }"
            @click="store.commit('setViewMode', 'code')"
          >
            <i class="fas fa-code"></i> Code
          </button>
          <button 
            class="mode-btn" 
            :class="{ active: viewMode === 'visual' }"
            @click="store.commit('setViewMode', 'visual')"
          >
            <i class="fas fa-eye"></i> Visual
          </button>
        </div>

        <div v-if="viewMode === 'visual' && store.state.currentScene" class="scene-name">
          <i class="fas fa-film" style="margin-right: 8px; color: #0066cc;"></i>
          {{ store.state.currentScene.name }}
        </div>
      </div>
      
      <div class="top-bar-right no-drag">
        <button class="toolbar-btn" @click="showHelp = true" title="Ajuda (F1)">
          <i class="fas fa-question-circle"></i>
        </button>
        <button class="toolbar-btn" @click="showCommandPalette = true" title="Command Palette (Ctrl+K)">
          <i class="fas fa-terminal"></i>
        </button>
        <button class="toolbar-btn" @click="toggleSearch" title="Search (Ctrl+F)">
          <i class="fas fa-search"></i>
        </button>
        <button class="toolbar-btn" @click="saveCurrent" title="Save (Ctrl+S)">
          <i class="fas fa-save"></i>
        </button>
        <button 
          class="play-btn" 
          :class="{ compiling: isCompiling }" 
          @click="playGame" 
          :title="isCompiling ? 'Compiling...' : 'Play (F5)'"
          :disabled="isCompiling"
        >
          <i :class="isCompiling ? 'fas fa-pause' : 'fas fa-play'"></i>
        </button>
      </div>

      <div 
        v-if="!isWindowControlsLeft" 
        class="window-controls no-drag right"
      >
        <button class="window-btn minimize" @click.stop="handleWindowControl('minimize')" title="Minimize">
          <i class="fas fa-minus"></i>
        </button>
        <button class="window-btn maximize" @click.stop="handleWindowControl('toggle-maximize')" :title="isMaximized ? 'Restore' : 'Maximize'">
          <i :class="isMaximized ? 'fas fa-clone' : 'far fa-square'"></i>
        </button>
        <button class="window-btn close" @click.stop="handleWindowControl('close')" title="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <!-- Search Bar -->
    <SearchBar 
      :show="showSearch" 
      @close="showSearch = false"
      @select="handleSearchSelect"
    />
    
    <!-- Command Palette -->
    <CommandPalette
      :show="showCommandPalette"
      @close="showCommandPalette = false"
      @execute="handleCommand"
    />

    <!-- Main Content Area -->
    <div class="main-content">
      <!-- Left Panel: File Explorer + Resources -->
      <div class="left-panel">
        <div class="panel-tabs">
          <button 
            class="panel-tab"
            :class="{ active: leftPanelTab === 'files' }"
            @click="leftPanelTab = 'files'"
          >
            <i class="fas fa-folder"></i> Files
          </button>
          <button 
            class="panel-tab"
            :class="{ active: leftPanelTab === 'resources' }"
            @click="leftPanelTab = 'resources'"
          >
            <i class="fas fa-box"></i> Resources
          </button>
        </div>
        
        <div class="panel-content">
          <FileExplorer v-if="leftPanelTab === 'files'" />
          <ResourcesPanel v-else />
        </div>
      </div>

      <!-- Center Panel: Editor -->
      <div class="center-panel">
        <VisualEditor 
          ref="visualEditorRef" 
          :tabs="tabs" 
          :activeTabPath="activeTabPath"
          @tab-selected="handleTabSelected"
          @tab-closed="handleTabClosed"
          @tabs-reordered="handleTabsReordered"
        />
      </div>

      <!-- Right Panel: Hierarchy + Inspector -->
      <div class="right-panel" v-if="viewMode === 'visual'">
        <div class="panel-tabs">
          <button 
            class="panel-tab"
            :class="{ active: rightPanelTab === 'hierarchy' }"
            @click="rightPanelTab = 'hierarchy'"
          >
            <i class="fas fa-sitemap"></i> Hierarchy
          </button>
          <button 
            class="panel-tab"
            :class="{ active: rightPanelTab === 'inspector' }"
            @click="rightPanelTab = 'inspector'"
          >
            <i class="fas fa-info-circle"></i> Inspector
          </button>
        </div>
        
        <div class="panel-content">
          <SceneHierarchy v-if="rightPanelTab === 'hierarchy'" />
          <InspectorPanel v-else />
        </div>
      </div>

    </div>

    <!-- Error Panel -->
    <ErrorPanel 
      :errors="compilationErrors"
      @error-click="handleErrorClick"
      @close="compilationErrors = []"
    />

    <!-- Help Viewer -->
    <HelpViewer
      :show="showHelp"
      @close="showHelp = false"
    />

    <!-- Status Bar -->
    <StatusBar />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useStore } from 'vuex'
import FileExplorer from './FileExplorer.vue'
import ResourcesPanel from './ResourcesPanel.vue'
import VisualEditor from './VisualEditor.vue'
import StatusBar from './StatusBar.vue'
import SearchBar from './SearchBar.vue'
import CommandPalette from './CommandPalette.vue'
import ErrorPanel from './ErrorPanel.vue'
import HelpViewer from './HelpViewer.vue'
import SceneHierarchy from './SceneHierarchy.vue'
import InspectorPanel from './InspectorPanel.vue'

const store = useStore()

const visualEditorRef = ref(null)
const tabs = ref([])
const activeTabPath = ref(null)
const viewMode = computed(() => store.state.viewMode)
const windowControlsPosition = computed(() => store.state.uiSettings?.windowControlsPosition || 'right')
const isWindowControlsLeft = computed(() => windowControlsPosition.value === 'left')

const leftPanelTab = ref('files')
const rightPanelTab = ref('hierarchy')
const showSearch = ref(false)
const showCommandPalette = ref(false)
const showHelp = ref(false)
const isMaximized = ref(false)
const isCompiling = ref(false)
const compilationErrors = ref([])

const initializeTabs = () => {
  const saved = localStorage.getItem('tabs')
  if (saved) {
    try {
      tabs.value = JSON.parse(saved) || []
      if (tabs.value.length) {
        activeTabPath.value = tabs.value[tabs.value.length - 1].path
      }
    } catch (error) {
      console.error('Failed to parse tabs from storage', error)
    }
  }
}

const syncTabRename = (oldPath, newPath) => {
  if (!oldPath || !newPath || oldPath === newPath) return
  const idx = tabs.value.findIndex(tab => tab.path === oldPath)
  if (idx === -1) {
    if (activeTabPath.value === oldPath) {
      openFileInEditor(newPath, false)
    }
    return
  }

  const updatedTabs = [...tabs.value]
  const newName = newPath.split(/[/\\]/).pop() || 'file'
  updatedTabs[idx] = { ...updatedTabs[idx], path: newPath, name: newName }
  tabs.value = updatedTabs
  persistTabs()

  if (activeTabPath.value === oldPath) {
    openFileInEditor(newPath, false)
  }
}

const syncTabDelete = (targetPath) => {
  if (!targetPath) return
  const tabToClose = tabs.value.find(tab => tab.path === targetPath)
  if (tabToClose) {
    handleTabClosed({ tab: tabToClose })
  }
}

const handleFsOperationResult = (result) => {
  if (!result?.success) return
  switch (result.operation) {
    case 'rename':
      syncTabRename(result.previousPath || result.path, result.path)
      break
    case 'delete':
      syncTabDelete(result.path)
      break
    default:
      break
  }
}

const persistTabs = () => {
  localStorage.setItem('tabs', JSON.stringify(tabs.value))
}

const focusTab = (path) => {
  activeTabPath.value = path
  store.commit('setCurrentFile', path)
}

const openFileInEditor = (filePath, shouldAddTab = true) => {
  if (!filePath) return
  
  const path = filePath.trim()
  // Detectar se é uma cena (qualquer .json que não seja configuração do sistema)
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase()
  const isSystemJson = normalizedPath.endsWith('retro-studio.json') || 
                       normalizedPath.endsWith('package.json') || 
                       normalizedPath.endsWith('jsconfig.json') ||
                       normalizedPath.includes('node_modules')

  const isScene = normalizedPath.endsWith('.json') && !isSystemJson
  
  console.log('[MainLayout] Detection result:', { filePath, isScene, isSystemJson })
  
  if (isScene) {
    console.log('[MainLayout] Switching to VISUAL mode for:', path)
    store.commit('setViewMode', 'visual')
    // Tentar carregar a cena se não estiver carregada
    if (!store.state.currentScene || store.state.currentScene.path !== path) {
       window.ipc?.send('load-scene', path)
    }
  } else {
    console.log('[MainLayout] Switching to CODE mode for:', path)
    // Se abrir outro arquivo, volta para o modo código
    store.commit('setViewMode', 'code')
  }

  if (shouldAddTab) {
    const exists = tabs.value.some(tab => tab.path === path)
    if (!exists) {
      const name = path.split(/[/\\]/).pop() || 'file'
      tabs.value.push({ name, path })
      persistTabs()
    }
  }

  focusTab(path)
  
  // Para cenas, não precisamos do open-file (texto), o load-scene já cuida disso.
  // Mas chamamos se não for cena para carregar no Monaco.
  if (!isScene) {
    visualEditorRef.value?.openFile(path)
  }
}

const handleTabsReordered = ({ from, to }) => {
  if (
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= tabs.value.length ||
    to >= tabs.value.length
  ) {
    return
  }

  const updatedTabs = [...tabs.value]
  const [moved] = updatedTabs.splice(from, 1)
  updatedTabs.splice(to, 0, moved)
  tabs.value = updatedTabs
  persistTabs()
}

const handleTabSelected = ({ tab }) => {
  if (tab?.path) {
    openFileInEditor(tab.path, false)
  }
}

const handleTabClosed = ({ tab }) => {
  tabs.value = tabs.value.filter(t => t.path !== tab.path)
  persistTabs()
  if (activeTabPath.value === tab.path) {
    const nextTab = tabs.value[tabs.value.length - 1]
    if (nextTab) {
      openFileInEditor(nextTab.path, false)
    } else {
      activeTabPath.value = null
      store.commit('setCurrentFile', null)
      visualEditorRef.value?.clearEditor?.()
    }
  }
}

const saveCurrent = () => {
  if (visualEditorRef.value && typeof visualEditorRef.value.saveScene === 'function') {
    visualEditorRef.value.saveScene()
  } else {
    // Fallback: try to save code file
    if (visualEditorRef.value && typeof visualEditorRef.value.sendSave === 'function') {
      visualEditorRef.value.sendSave()
    }
  }
}

const playGame = async () => {
  if (isCompiling.value) return
  
  isCompiling.value = true
  try {
    if (visualEditorRef.value && typeof visualEditorRef.value.playScene === 'function') {
      await visualEditorRef.value.playScene()
    } else {
      // Fallback: run game directly if no visual editor
      const project = store.state.projectConfig
      if (project.path) {
        window.ipc?.send('run-game', JSON.parse(JSON.stringify({
          ...project,
          toolkitPath: store.state.uiSettings.toolkitPath
        })))
        // Show compilation message
        store.dispatch('showNotification', {
          type: 'info',
          title: 'Compiling',
          message: 'Building and running your game...'
        })
        // O estado isCompiling será resetado quando o emulador fechar
      } else {
        store.dispatch('showNotification', {
          type: 'warning',
          title: 'No Project',
          message: 'Please open a project first'
        })
        isCompiling.value = false
      }
    }
  } catch (error) {
    console.error('Error playing game:', error)
    isCompiling.value = false
  }
}

const openProjectDialog = () => {
  store.dispatch('openProjectDialog')
}

const handleErrorClick = (error) => {
  console.log('[MainLayout] Error clicked:', error)
  if (!error.file || !error.line) return
  
  // Abrir arquivo no editor
  const project = store.state.projectConfig
  if (!project.path) return
  
  // Construir path simples (browser-side)
  const filePath = error.file.startsWith('/') 
    ? error.file 
    : `${project.path}/${error.file}`.replace(/\/\//g, '/')
  
  openFileInEditor(filePath, true)
  
  // Ir para a linha do erro
  if (visualEditorRef.value?.goToLine) {
    visualEditorRef.value.goToLine(error.line, error.column || 0)
  }
}

const openSettings = () => {
  store.dispatch('openSettings')
}

const toggleSearch = () => {
  showSearch.value = !showSearch.value
}

const handleSearchSelect = (result) => {
  if (result.type === 'sprite' || result.type === 'tile' || result.type === 'palette') {
    // Open resource editor
    const resource = store.state.resources[result.type + 's']?.find(r => r.id === result.id)
    if (resource) {
      store.dispatch('openResourceEditor', resource)
    }
  } else if (result.type === 'scene') {
    // Select scene node
    const node = store.state.sceneNodes.find(n => n.id === result.id)
    if (node) {
      store.dispatch('updateSelectedNode', node)
    }
  }
}

const handleCommand = (commandId) => {
  switch(commandId) {
    case 'new-scene':
      // Create new scene
      store.dispatch('setCurrentScene', {
        id: `scene_${Date.now()}`,
        name: 'New Scene',
        createdAt: new Date().toISOString()
      })
      store.commit('setSceneNodes', [])
      break
    case 'open-project':
      openProjectDialog()
      break
    case 'save':
      saveCurrent()
      break
    case 'search':
      toggleSearch()
      break
    case 'play':
      playGame()
      break
    case 'settings':
      openSettings()
      break
    case 'new-sprite': {
      // Open resources panel and add sprite
      leftPanelTab.value = 'resources'
      // Trigger add resource dialog
      break
    }
    case 'new-tile': {
      leftPanelTab.value = 'resources'
      break
    }
    case 'new-palette': {
      leftPanelTab.value = 'resources'
      break
    }
    case 'export-scene':
      if (visualEditorRef.value) {
        visualEditorRef.value.exportSceneToCodeFile()
      }
      break
  }
  
  store.dispatch('showNotification', {
    type: 'info',
    title: 'Command Executed',
    message: `Executed: ${commandId}`
  })
}

const handleWindowControl = (action) => {
  window.ipc?.send('window-control', action)
}

// Keyboard shortcuts
const handleKeyDown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  
  // F5 - Play
  if (e.key === 'F5') {
    e.preventDefault()
    playGame()
  }
  
  // Ctrl/Cmd + O - Open Project
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault()
    openProjectDialog()
  }
  
  // Ctrl/Cmd + F - Search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
    e.preventDefault()
    toggleSearch()
  }
  
  // Ctrl/Cmd + K - Command Palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    showCommandPalette.value = !showCommandPalette.value
  }

  // F1 - Help
  if (e.key === 'F1') {
    e.preventDefault()
    showHelp.value = true
  }

  // Ctrl+Tab - Toggle Mode
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
    e.preventDefault()
    const nextMode = viewMode.value === 'code' ? 'visual' : 'code'
    store.commit('setViewMode', nextMode)
  }
}

watch(() => store.state.fileRequest, (newData) => {
  if (newData?.node && newData.node.tipo === 'arquivo') {
    openFileInEditor(newData.node.path, true)
    
    // Se houver informação de linha, pular para ela após um pequeno delay para carregar
    if (newData.line) {
      setTimeout(() => {
        if (visualEditorRef.value?.goToLine) {
          visualEditorRef.value.goToLine(newData.line, newData.column || 1)
        }
      }, 200)
    }
  }
})

onMounted(() => {
  initializeTabs()
  if (activeTabPath.value) {
    openFileInEditor(activeTabPath.value, false)
  }

  window.addEventListener('keydown', handleKeyDown)
  window.ipc?.on?.('window-control-state', (state) => {
    isMaximized.value = !!state?.isMaximized
  })
  window.ipc?.on?.('fs-operation-result', handleFsOperationResult)
  
  window.ipc?.on?.('load-scene-result', (data) => {
    console.log('[MainLayout] Received load-scene-result:', data)
    if (data.success && data.scene) {
      store.dispatch('setCurrentScene', data.scene)
      store.commit('setSceneNodes', data.scene.nodes || [])
      store.dispatch('showNotification', {
        type: 'success',
        title: 'Cena Carregada',
        message: `Cena "${data.scene.name}" aberta com sucesso.`
      })
    } else {
      store.dispatch('showNotification', {
        type: 'error',
        title: 'Erro ao carregar cena',
        message: data.error || 'Não foi possível carregar o arquivo de cena.'
      })
    }
  })

  window.ipc?.on?.('save-scene-result', (data) => {
    if (data.success) {
      store.dispatch('showNotification', {
        type: 'success',
        title: 'Cena Salva',
        message: 'O arquivo de cena foi salvo com sucesso.'
      })
    } else {
      store.dispatch('showNotification', {
        type: 'error',
        title: 'Erro ao salvar',
        message: data.error || 'Falha ao salvar a cena.'
      })
    }
  })

  window.ipc?.on?.('export-scene-result', (data) => {
    if (data.success) {
      store.dispatch('showNotification', {
        type: 'success',
        title: 'Código Gerado',
        message: 'O arquivo .c foi atualizado com as mudanças da cena.'
      })
    } else {
      store.dispatch('showNotification', {
        type: 'error',
        title: 'Erro na exportação',
        message: data.error || 'Falha ao gerar o código da cena.'
      })
    }
  })
  
  // Escutar erros de compilação
  window.ipc?.on?.('compilation-errors', (data) => {
    console.log('[MainLayout] Received compilation errors:', data.errors.length)
    compilationErrors.value = data.errors
  })
  
  // Escutar quando o emulador fecha
  window.ipc?.on?.('emulator-closed', () => {
    console.log('Emulador fechou, resetando estado de compilação')
    isCompiling.value = false
    store.dispatch('showNotification', {
      type: 'success',
      title: 'Emulator Closed',
      message: 'Game execution completed'
    })
  })
  
  // Escutar erros de execução do jogo
  window.ipc?.on?.('run-game-error', (error) => {
    console.error('Erro ao executar jogo:', error)
    isCompiling.value = false
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Build Failed',
      message: error.message || 'Failed to build or run game'
    })
  })

  // Carregar previews de assets ao iniciar se já houver um projeto
  if (store.state.projectConfig?.path) {
    store.dispatch('loadAllMissingPreviews')
  }
})

// Observar mudanças no projeto para recarregar previews
watch(() => store.state.projectConfig?.path, (newPath) => {
  if (newPath) {
    store.dispatch('loadAllMissingPreviews')
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.ipc?.off?.('fs-operation-result', handleFsOperationResult)
  window.ipc?.off?.('compilation-errors')
  window.ipc?.off?.('emulator-closed')
  window.ipc?.off?.('run-game-error')
})
</script>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a1a;
  overflow: hidden;
}

/* Top Bar */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  background: #1f1f1f;
  border-bottom: 1px solid #333;
  padding: 0 8px;
  -webkit-app-region: drag;
  user-select: none;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.top-bar-left {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 12px;
  min-width: 0;
}

.app-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ccc;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.4px;
}

.app-title i {
  color: #ffb703;
}

.menu-section {
  display: flex;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid #333;
}

.mode-section {
  display: flex;
  gap: 2px;
  padding-right: 8px;
  border-right: 1px solid #333;
}

.mode-btn {
  background: transparent;
  border: none;
  color: #888;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mode-btn:hover {
  background: #333;
  color: #ccc;
}

.mode-btn.active {
  background: #0066cc;
  color: white;
}

.mode-btn.active:hover {
  background: #0088ff;
}

.menu-btn {
  background: transparent;
  border: none;
  color: #ccc;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
}

.menu-btn:hover {
  background: #333;
  color: #fff;
}

.scene-name {
  flex: 1;
  padding: 0 12px;
  color: #ccc;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.play-btn {
  background: transparent;
  border: none;
  color: #ccc;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-btn:hover:not(:disabled) {
  background: #333;
  color: #fff;
}

.play-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.play-btn.compiling {
  animation: pulse 1.5s ease-in-out infinite;
  color: #ffb703;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.toolbar-btn {
  background: transparent;
  border: none;
  color: #ccc;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn:hover {
  background: #333;
  color: #fff;
}

.window-controls {
  display: flex;
  align-items: center;
}

.window-controls.right {
  gap: 8px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 1px solid #333;
}

.window-controls.left {
  gap: 8px;
  margin-right: 16px;
  padding-right: 12px;
  border-right: 1px solid #333;
}

.window-btn {
  width: 38px;
  height: 26px;
  border: none;
  background: transparent;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.window-controls.right .window-btn:hover {
  background: #333;
  color: #fff;
}

.window-controls.right .window-btn.close:hover {
  background: #b00020;
  color: #fff;
}

/* Main Content */
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Left Panel */
.left-panel {
  width: 280px;
  min-width: 220px;
  max-width: 380px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
  background: #1e1e1e;
  flex: 0 0 auto;
}

/* Center Panel */
.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1a1a1a;
}

/* Right Panel */
.right-panel {
  width: 300px;
  min-width: 250px;
  max-width: 400px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #333;
  background: #1e1e1e;
  flex: 0 0 auto;
}

/* Panel Tabs */
.panel-tabs {
  display: flex;
  background: #252525;
  border-bottom: 1px solid #333;
}

.panel-tab {
  flex: 1;
  background: transparent;
  border: none;
  color: #888;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-bottom: 2px solid transparent;
}

.panel-tab:hover {
  background: #2a2a2a;
  color: #ccc;
}

.panel-tab.active {
  color: #0066cc;
  border-bottom-color: #0066cc;
  background: #1e1e1e;
}

.panel-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
