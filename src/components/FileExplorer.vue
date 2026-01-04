<template>
  <div class="file-explorer" @contextmenu.prevent="handleBackgroundContextMenu">
    <div class="explorer-header">
      <h3>File Explorer</h3>
      <div class="header-actions">
        <button class="icon-btn" @click="refreshFiles" title="Refresh (F5)">
          <i class="fas fa-sync-alt"></i>
        </button>
        <button class="icon-btn" @click="openProjectDialog" title="Open Project (Ctrl+O)">
          <i class="fas fa-folder-open"></i>
        </button>
      </div>
    </div>
    
    <Breadcrumbs 
      v-if="breadcrumbs.length > 0"
      :items="breadcrumbs"
      @navigate="handleBreadcrumbNavigate"
    />
    
    <div class="explorer-content">
      <div v-if="!project.path" class="no-project">
        <p>No project opened</p>
        <button class="btn-open-project" @click="openProjectDialog">
          <i class="fas fa-folder-open"></i> Open Project
        </button>
      </div>
      
      <div 
        v-else 
        class="file-tree"
        @dragover.prevent="handleRootDragOver($event)"
        @drop.prevent="handleRootDrop($event)"
      >
        <TreeviewComponent 
          :treeData="tvModel" 
          :openFile="handleFileOpen" 
          :selectedPath="selectedNodePath"
          :dragSourcePath="dragState.sourcePath"
          :dragTargetPath="dragState.targetDir"
          @select="handleNodeSelect"
          @contextmenu="handleNodeContextMenu"
          @dragstart="handleTreeDragStart"
          @dragover="handleTreeDragOver"
          @drop="handleTreeDrop"
          @dragend="handleTreeDragEnd"
          @toggle="handleTreeToggle"
        />
      </div>
    </div>
    <ContextMenu
      :show="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenuItems"
      @action="handleContextAction"
      @close="closeContextMenu"
    />
    <FsNamePrompt
      :show="namePrompt.visible"
      :title="namePrompt.title"
      :placeholder="namePrompt.placeholder"
      :initialValue="namePrompt.initialValue"
      @confirm="handleNamePromptConfirm"
      @cancel="handleNamePromptCancel"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useStore } from 'vuex'
import TreeviewComponent from './TreeviewComponent.vue'
import Breadcrumbs from './Breadcrumbs.vue'
import ContextMenu from './ContextMenu.vue'
import FsNamePrompt from './FsNamePrompt.vue'

const store = useStore()

const project = ref({})
const tvModel = ref([])
const currentPath = ref('')
const selectedNode = ref(null)
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  node: null,
  targetDir: null
})
const clipboardEntry = ref(null)
const readFilesHandler = ref(null)
const fsResultHandler = ref(null)
const pendingNotification = ref(null)
const namePrompt = reactive({
  visible: false,
  title: '',
  placeholder: '',
  initialValue: '',
  mode: null,
  targetDir: null,
  targetNode: null
})
const dragState = reactive({
  sourcePath: null,
  targetDir: null
})
const expandedPaths = ref(new Set())

const breadcrumbs = computed(() => {
  if (!currentPath.value || !project.value.path) return []
  
  const pathParts = currentPath.value.replace(project.value.path, '').split(/[/\\]/).filter(Boolean)
  const items = [
    { label: project.value.name || 'Project', path: project.value.path }
  ]
  
  let current = project.value.path
  pathParts.forEach(part => {
    current = current + '/' + part
    items.push({ label: part, path: current })
  })
  
  return items
})

const addExpandedPath = (path) => {
  if (!path) return
  const next = new Set(expandedPaths.value)
  next.add(path)
  expandedPaths.value = next
}

const removeExpandedPath = (path) => {
  if (!path) return
  const next = new Set(expandedPaths.value)
  next.delete(path)
  expandedPaths.value = next
}

const handleTreeToggle = ({ node, expanded }) => {
  if (!node?.path) return
  if (expanded) {
    addExpandedPath(node.path)
  } else {
    removeExpandedPath(node.path)
  }
}

const applyExpansionState = (nodes = []) => {
  nodes.forEach((node) => {
    if (node?.tipo !== 'diretorio') return
    node.expanded = expandedPaths.value.has(node.path)
    if (Array.isArray(node.children) && node.children.length > 0) {
      applyExpansionState(node.children)
    }
  })
}

const loadProject = () => {
  try {
    const projectData = localStorage.getItem('project')
    if (projectData) {
      project.value = JSON.parse(projectData)
      currentPath.value = project.value.path
      addExpandedPath(project.value.path)
      reloadFiles()
    }
  } catch (error) {
    console.error('Error loading project:', error)
  }
}

const clearDragState = () => {
  dragState.sourcePath = null
  dragState.targetDir = null
}

const isInvalidDropTarget = (sourcePath, targetDir) => {
  if (!sourcePath || !targetDir) return true
  if (targetDir === sourcePath) return true
  const normalizedSource = sourcePath.replace(/[/\\]+$/, '')
  const normalizedTarget = targetDir.replace(/[/\\]+$/, '')
  return normalizedTarget.startsWith(normalizedSource + '/')
}

const handleTreeDragStart = ({ node }) => {
  console.log('[Drag] start', node?.path)
  dragState.sourcePath = node?.path || null
  dragState.targetDir = null
}

const handleTreeDragOver = (payload) => {
  const node = payload?.node
  payload?.event?.preventDefault?.()
  if (!dragState.sourcePath || !node) return
  const candidateDir = node.tipo === 'diretorio'
    ? node.path
    : getParentDir(node.path)
  if (!candidateDir || isInvalidDropTarget(dragState.sourcePath, candidateDir)) {
    dragState.targetDir = null
    return
  }
  dragState.targetDir = candidateDir
}

const handleTreeDrop = (payload) => {
  const node = payload?.node
  payload?.event?.preventDefault?.()
  if (!dragState.sourcePath || !node) return
  const candidateDir = node.tipo === 'diretorio'
    ? node.path
    : getParentDir(node.path)
  if (!candidateDir || isInvalidDropTarget(dragState.sourcePath, candidateDir)) {
    clearDragState()
    return
  }
  console.log('[Drag] drop', dragState.sourcePath, '->', candidateDir)
  performFsOperation('fs-move-entry', {
    sourcePath: dragState.sourcePath,
    targetDir: candidateDir
  }, 'Item movido')
  clearDragState()
}

const handleTreeDragEnd = () => {
  clearDragState()
}

const handleRootDragOver = (event) => {
  if (!dragState.sourcePath) return
  const projectDir = project.value?.path
  event?.preventDefault?.()
  if (!projectDir || isInvalidDropTarget(dragState.sourcePath, projectDir)) {
    dragState.targetDir = null
    return
  }
  dragState.targetDir = projectDir
}

const handleRootDrop = (event) => {
  if (!dragState.sourcePath) return
  const projectDir = project.value?.path
  event?.preventDefault?.()
  if (!projectDir || isInvalidDropTarget(dragState.sourcePath, projectDir)) {
    clearDragState()
    return
  }
  console.log('[Drag] drop root', dragState.sourcePath, '->', projectDir)
  performFsOperation('fs-move-entry', {
    sourcePath: dragState.sourcePath,
    targetDir: projectDir
  }, 'Item movido')
  clearDragState()
}

const reloadFiles = () => {
  if (project.value?.path) {
    window.ipc?.send('req-projec', {
      path: project.value.path
    })
  }
}

const loadFiles = () => {
  if (readFilesHandler.value) return
  readFilesHandler.value = (data) => {
    // Agora o retorno é { estrutura, config }
    const result = data?.estrutura || data
    const config = data?.config

    // Sincronizar configuração do projeto se disponível
    if (config && project.value.path) {
      console.log('[FileExplorer] Atualizando configuração do projeto:', config.name)
      project.value = { ...project.value, ...config }
      localStorage.setItem('project', JSON.stringify(project.value))
    }

    tvModel.value = []
    if (result?.children) {
      addExpandedPath(project.value?.path)
      tvModel.value.push({
        id: 'project',
        label: project.value?.name || 'Project',
        path: project.value?.path,
        tipo: 'diretorio',
        expanded: true,
        isNodeExpanded: true,
        children: result.children
      })
      applyExpansionState(tvModel.value)
    }
  }
  window.ipc?.on?.('read-files', readFilesHandler.value)
}

const handleFileOpen = (node, options = {}) => {
  if (!node || node.tipo !== 'arquivo') return

  if (!selectedNode.value || selectedNode.value.path !== node.path) {
    selectedNode.value = node
  }

  const shouldEmit = options.emitRequest !== false
  if (shouldEmit) {
    store.dispatch('updateFileRequest', { node })
  }
}

const handleNodeSelect = (node) => {
  selectedNode.value = node || null
}

const selectedNodePath = computed(() => selectedNode.value?.path || '')

const refreshFiles = () => {
  reloadFiles()
}

const openProjectDialog = () => {
  store.dispatch('openProjectDialog')
}

const handleBreadcrumbNavigate = ({ item }) => {
  currentPath.value = item.path
  window.ipc?.send('req-projec', {
    path: item.path
  })
}

const contextMenuItems = computed(() => {
  const node = contextMenu.value.node
  if (!project.value.path) {
    return []
  }

  const items = []
  const hasClipboard = !!clipboardEntry.value
  const nodeIsDir = node?.tipo === 'diretorio'
  const nodeIsFile = node?.tipo === 'arquivo'

  if (nodeIsDir || node === null) {
    items.push(
      { id: 'new-file', action: 'new-file', label: 'Novo arquivo', icon: 'fas fa-file-circle-plus' },
      { id: 'new-folder', action: 'new-folder', label: 'Nova pasta', icon: 'fas fa-folder-plus' },
      { id: 'paste', action: 'paste', label: 'Colar', icon: 'fas fa-paste', disabled: !hasClipboard }
    )
  }

  if (nodeIsFile) {
    items.push(
      { id: 'open', action: 'open', label: 'Abrir', icon: 'fas fa-file' },
      { id: 'open-with', action: 'open-with', label: 'Abrir com aplicativo padrão', icon: 'fas fa-external-link-alt' },
    )
  }

  if (node || selectedNode.value) {
    items.push(
      { id: 'separator-1', separator: true },
      { id: 'rename', action: 'rename', label: 'Renomear', icon: 'fas fa-i-cursor' },
      { id: 'copy-relative-path', action: 'copy-relative-path', label: 'Copiar caminho relativo', icon: 'fas fa-link' },
      { id: 'copy-full-path', action: 'copy-full-path', label: 'Copiar caminho completo', icon: 'fas fa-link' }
    )
  }

  return items
})

const closeContextMenu = () => {
  contextMenu.value = { visible: false, x: 0, y: 0, node: null, targetDir: null }
}

const handleNodeContextMenu = ({ node, event }) => {
  if (!project.value.path) return
  if (node) {
    selectedNode.value = node
  }
  const targetDir = node
    ? (node.tipo === 'diretorio' ? node.path : getParentDir(node.path))
    : project.value.path
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    node,
    targetDir
  }
}

const handleBackgroundContextMenu = (event) => {
  if (!project.value.path) return
  const currentSelection = selectedNode.value
  const fallbackDir = currentSelection
    ? resolveTargetDir(currentSelection)
    : project.value.path
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    node: null,
    targetDir: fallbackDir
  }
}

const performFsOperation = (channel, payload, successMessage) => {
  if (!project.value.path) return
  ensureFsResultListener()
  console.log('[FileExplorer] IPC send', channel, payload)
  window.ipc?.send(channel, { projectPath: project.value.path, ...payload })
  pendingNotification.value = successMessage
}

const ensureFsResultListener = () => {
  if (fsResultHandler.value) return
  fsResultHandler.value = (result) => {
    if (result?.success) {
      if (pendingNotification.value) {
        store.dispatch('showNotification', {
          type: 'success',
          title: 'Operação concluída',
          message: pendingNotification.value
        })
        pendingNotification.value = null
      }
      reloadFiles()
    } else if (result?.error) {
      store.dispatch('showNotification', {
        type: 'error',
        title: 'Erro',
        message: result.error
      })
    }
    closeContextMenu()
  }
  window.ipc?.on?.('fs-operation-result', fsResultHandler.value)
}

const handleNamePromptConfirm = (value) => {
  if (!namePrompt.mode) return
  if (namePrompt.mode === 'create-file' || namePrompt.mode === 'create-folder') {
    performFsOperation('fs-create-entry', {
      targetDir: namePrompt.targetDir || project.value.path,
      entryName: value,
      entryType: namePrompt.mode === 'create-file' ? 'file' : 'folder'
    }, namePrompt.mode === 'create-file' ? 'Arquivo criado' : 'Pasta criada')
  } else if (namePrompt.mode === 'rename' && namePrompt.targetNode) {
    performFsOperation('fs-rename-entry', {
      targetPath: namePrompt.targetNode.path,
      newName: value
    }, 'Item renomeado')
  }
  console.log('[FileExplorer] Name prompt confirmed', namePrompt.mode, value)
  handleNamePromptCancel()
}

const handleNamePromptCancel = () => {
  namePrompt.visible = false
  namePrompt.mode = null
  namePrompt.targetDir = null
  namePrompt.targetNode = null
  namePrompt.initialValue = ''
  namePrompt.title = ''
  namePrompt.placeholder = ''
}

const openNamePrompt = ({ mode, title, placeholder, initialValue = '', targetDir = null, targetNode = null }) => {
  namePrompt.mode = mode
  namePrompt.title = title
  namePrompt.placeholder = placeholder
  namePrompt.initialValue = initialValue
  namePrompt.targetDir = targetDir
  namePrompt.targetNode = targetNode
  namePrompt.visible = true
}

const getParentDir = (targetPath) => {
  if (!targetPath) return project.value.path
  return targetPath.replace(/[/\\]+$/, '').replace(/[/\\][^/\\]+$/, '') || project.value.path
}

const resolveTargetDir = (node) => {
  if (!node) return project.value.path
  return node.tipo === 'diretorio' ? node.path : getParentDir(node.path)
}

const createEntry = (type, node) => {
  const target = node || selectedNode.value
  const targetDirFromContext = contextMenu.value.targetDir
  openNamePrompt({
    mode: type === 'file' ? 'create-file' : 'create-folder',
    title: type === 'file' ? 'Novo arquivo' : 'Nova pasta',
    placeholder: type === 'file' ? 'ex: main.c' : 'ex: assets',
    targetDir: targetDirFromContext || resolveTargetDir(target)
  })
  closeContextMenu()
}

const renameEntry = (node) => {
  if (!node) return
  openNamePrompt({
    mode: 'rename',
    title: 'Renomear',
    placeholder: 'Novo nome',
    initialValue: node.label,
    targetNode: node
  })
  closeContextMenu()
}

const deleteEntry = (node) => {
  if (!node) return
  const confirmed = window.confirm(`Excluir "${node.label}"?`)
  if (!confirmed) return
  performFsOperation('fs-delete-entry', {
    targetPath: node.path
  }, 'Item excluído')
}

const duplicateEntry = (node) => {
  if (!node) return
  performFsOperation('fs-copy-entry', {
    sourcePath: node.path,
    targetDir: getParentDir(node.path)
  }, 'Item duplicado')
}

const openWithSystem = (node) => {
  if (!node) return
  performFsOperation('fs-open-with', {
    targetPath: node.path
  }, 'Abrindo com aplicativo padrão')
}

const copyEntry = (node, isCut = false) => {
  if (!node) return
  clipboardEntry.value = {
    path: node.path,
    tipo: node.tipo,
    isCut
  }
  store.dispatch('showNotification', {
    type: 'info',
    title: isCut ? 'Recortado' : 'Copiado',
    message: node.label
  })
}

const pasteEntry = (targetNode) => {
  if (!clipboardEntry.value) return
  const targetDir = resolveTargetDir(targetNode || contextMenu.value.node)
  const channel = clipboardEntry.value.isCut ? 'fs-move-entry' : 'fs-copy-entry'
  performFsOperation(channel, {
    sourcePath: clipboardEntry.value.path,
    targetDir
  }, clipboardEntry.value.isCut ? 'Item movido' : 'Item colado')
  if (clipboardEntry.value.isCut) {
    clipboardEntry.value = null
  }
}

const handleContextAction = (action) => {
  const node = contextMenu.value.node || selectedNode.value
  switch (action) {
    case 'new-file':
      createEntry('file', node)
      break
    case 'new-folder':
      createEntry('folder', node)
      break
    case 'rename':
      renameEntry(node)
      break
    case 'delete':
      deleteEntry(node)
      break
    case 'duplicate':
      duplicateEntry(node)
      break
    case 'copy':
      copyEntry(node, false)
      closeContextMenu()
      break
    case 'cut':
      copyEntry(node, true)
      closeContextMenu()
      break
    case 'paste':
      pasteEntry(node)
      break
    case 'open':
      if (node?.tipo === 'arquivo') {
        handleFileOpen(node)
      }
      closeContextMenu()
      break
    case 'open-with':
      openWithSystem(node)
      break
    case 'copy-relative-path':
      copyPathToClipboard(node?.path, true)
      closeContextMenu()
      break
    case 'copy-full-path':
      copyPathToClipboard(node?.path, false)
      closeContextMenu()
      break
    default:
      closeContextMenu()
  }
}

const copyPathToClipboard = (path, isRelative = false) => {
  if (!path) return
  
  let pathToCopy = path
  
  if (isRelative && project.value.path) {
    // Obter caminho relativo
    pathToCopy = path.replace(project.value.path, '').replace(/^\//, '').replace(/^\\/,  '')
  }
  
  // Copiar para área de transferência
  navigator.clipboard.writeText(pathToCopy).then(() => {
    store.dispatch('showNotification', {
      type: 'success',
      title: 'Caminho copiado',
      message: `"${pathToCopy}" copiado para a área de transferência`
    })
  }).catch((err) => {
    console.error('[FileExplorer] Erro ao copiar para área de transferência:', err)
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Erro',
      message: 'Não foi possível copiar o caminho'
    })
  })
}

const handleExplorerHotkeys = (event) => {
  if (!selectedNode.value && !clipboardEntry.value) return
  const target = event.target
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }

  if (event.key === 'Delete' && selectedNode.value) {
    event.preventDefault()
    deleteEntry(selectedNode.value)
    return
  }

  if (event.key === 'F2' && selectedNode.value) {
    event.preventDefault()
    renameEntry(selectedNode.value)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedNode.value) {
    event.preventDefault()
    copyEntry(selectedNode.value, false)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedNode.value) {
    event.preventDefault()
    copyEntry(selectedNode.value, true)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    pasteEntry(selectedNode.value)
    return
  }
}

onMounted(() => {
  loadProject()
  loadFiles()
  ensureFsResultListener()
  window.addEventListener('keydown', handleExplorerHotkeys)
})

onUnmounted(() => {
  if (readFilesHandler.value) {
    window.ipc?.off?.('read-files', readFilesHandler.value)
    readFilesHandler.value = null
  }
  if (fsResultHandler.value) {
    window.ipc?.off?.('fs-operation-result', fsResultHandler.value)
    fsResultHandler.value = null
  }
  window.removeEventListener('keydown', handleExplorerHotkeys)
})

watch(() => store.state.fileRequest, (newData) => {
  if (newData?.node) {
    // Evita feedback loop quando nós próprios enviarmos updateFileRequest
    if (!selectedNode.value || selectedNode.value.path !== newData.node.path) {
      handleFileOpen(newData.node)
    }
  }
})

// Update current path when files are loaded
watch(() => tvModel.value, (newModel) => {
  if (newModel.length > 0 && newModel[0].path) {
    // Path is already set from project
  }
}, { deep: true })
</script>

<style scoped>
.file-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-right: 1px solid #333;
}

.explorer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.explorer-header h3 {
  margin: 0;
  font-size: 14px;
  color: #ccc;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 3px;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: #333;
  color: #fff;
}

.explorer-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.no-project {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #666;
  text-align: center;
}

.no-project p {
  margin: 0 0 16px 0;
  font-size: 14px;
}

.btn-open-project {
  background: #0066cc;
  border: none;
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-open-project:hover {
  background: #0088ff;
}

.file-tree {
  padding: 4px;
}
</style>
