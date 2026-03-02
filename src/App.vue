<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
// import MonacoEditor from 'monaco-editor-vue3' // DESABILITADO - vamos usar direto
import * as monaco from 'monaco-editor'
import TitleBar from './components/TitleBar.vue'
import AppModals from './components/AppModals.vue'
import AppOverlays from './components/AppOverlays.vue'
import AppContent from './components/AppContent.vue'
import AIChat from './components/AIChat.vue'
import { useRetroProject } from './composables/useRetroProject.js'
import { registerSGDKProviders } from './utils/retro/sgdkMonaco.js'
import { formatCode } from './utils/retro/codeFormatter.js'
import { languageForPath, escapeRegExp } from './utils/editorUtils.js'
import { useCheckpointUndo } from './composables/useCheckpointUndo.js'
import { useLintErrors } from './composables/useLintErrors.js'
import { useInlineDiff } from './composables/useInlineDiff.js'
import { useEditorOptions } from './composables/useEditorOptions.js'
import { useCtrlK } from './composables/useCtrlK.js'
import { useGit } from './composables/useGit.js'
import { useCrudDialog } from './composables/useCrudDialog.js'
import { buildCommandPaletteCommands } from './constants/commandPaletteCommands.js'

// Monaco Editor instance
const monacoEditorRef = ref(null)
const monacoContainer = ref(null)
let monacoInstance = null
let resizeObserver = null
let autocompleteProviderDisposable = null

// Autocomplete state
const autocompleteEnabled = ref(false) // Desabilitado por padrão - habilitar apenas com servidor IA local
const isAutocompleteLoading = ref(false)
let autocompleteAbortController = null

// NOTA: handleEditorMount e funções relacionadas movidas para depois das declarações de variáveis
// para evitar erro "Cannot access before initialization"
// Veja as funções após activeTab/activePath (linha ~2050)

function layoutMonaco() {
  if (monacoInstance) {
    monacoInstance.layout()
  }
}


// Sidebar resize
const sidebarWidth = ref(280)
const isResizing = ref(false)
const minSidebarWidth = 180
const maxSidebarWidth = 600

// AI Chat panel resize
const aiChatWidth = ref(400)
const isResizingAIChat = ref(false)
const minAIChatWidth = 300
const maxAIChatWidth = 800

// AI Chat state
const isAIChatOpen = ref(false)

// Active view state
const activeView = ref('explorer')

// Search state (useSearch - inicializado após openFile)
const searchQuery = ref('')
const searchResults = ref([])
const isSearching = ref(false)
const searchInContent = ref(false)
const searchCaseSensitive = ref(false)
const searchUseRegex = ref(false)

// Git state - useGit (inicializado após openFile)
// Terminal state
const isTerminalOpen = ref(false)
const terminalHeight = ref(250)
const isResizingTerminal = ref(false)
const minTerminalHeight = 100
const maxTerminalHeight = 600
const appContentRef = ref(null)
const appOverlaysRef = ref(null)
const mainEditorAreaRef = computed(() => appContentRef.value?.mainEditorAreaRef?.value ?? null)
const terminalRef = computed(() => mainEditorAreaRef.value?.terminalRef?.value ?? null)

// Compilation errors (Retro)
const compilationErrors = ref([])


// NPM Scripts state

const showCommandPalette = ref(false)
const ctrlKWidgetRef = computed(() => appOverlaysRef.value?.ctrlKWidgetRef ?? null)

// Ctrl+K - useCtrlK (inicializado após showDiffInEditor, saveCheckpoint, checkForLintErrors)

// Checkpoint/Undo e Lint - inicializados após tabs, activePath, getMonacoInstance (ver initEditorComposables)
let saveCheckpoint = () => {}
let undoLastChange = () => false
let checkForLintErrors = async () => []

// Inline diff - useInlineDiff (inicializado acima com tabs/activePath)

const commandPaletteCommands = computed(() => buildCommandPaletteCommands({
  createNewFile,
  createNewFolder,
  saveActive,
  saveAll,
  triggerFindInMonaco,
  setActiveView: (v) => { activeView.value = v },
  showHelp: () => { if (isRetroProject.value) showHelpViewer.value = true },
  openTerminal,
  openAIChat,
  showStoreModal: () => { showStoreModal.value = true },
  gitCommit,
  gitPush,
  gitPull,
  loadGitStatus,
  openSettings,
  undoLastChange,
  getActivePath: () => activePath.value,
  toggleAutocomplete
}))

function startResize(e) {
  isResizing.value = true
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  e.preventDefault()
}

function onResize(e) {
  if (!isResizing.value) return
  const newWidth = e.clientX
  sidebarWidth.value = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, newWidth))
  // Atualiza Monaco durante o redimensionamento
  layoutMonaco()
}

function stopResize() {
  isResizing.value = false
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  // Faz layout final do Monaco
  layoutMonaco()
  saveSettingsToFile()
}

// AI Chat resize functions
function startResizeAIChat(e) {
  isResizingAIChat.value = true
  document.addEventListener('mousemove', onResizeAIChat)
  document.addEventListener('mouseup', stopResizeAIChat)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  e.preventDefault()
}

function onResizeAIChat(e) {
  if (!isResizingAIChat.value) return
  // Calcula a largura a partir da borda direita
  const newWidth = window.innerWidth - e.clientX
  aiChatWidth.value = Math.max(minAIChatWidth, Math.min(maxAIChatWidth, newWidth))
  layoutMonaco()
}

function stopResizeAIChat() {
  isResizingAIChat.value = false
  document.removeEventListener('mousemove', onResizeAIChat)
  document.removeEventListener('mouseup', stopResizeAIChat)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  layoutMonaco()
  saveSettingsToFile()
}

// Terminal resize functions
function startResizeTerminal(e) {
  isResizingTerminal.value = true
  document.addEventListener('mousemove', onResizeTerminal)
  document.addEventListener('mouseup', stopResizeTerminal)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
  e.preventDefault()
}

function onResizeTerminal(e) {
  if (!isResizingTerminal.value) return
  // Calcula a altura a partir da borda inferior
  const appHeight = window.innerHeight - 36 - 22 // titlebar + statusbar
  const mouseY = e.clientY - 36 // offset da titlebar
  const newHeight = appHeight - mouseY
  terminalHeight.value = Math.max(minTerminalHeight, Math.min(maxTerminalHeight, newHeight))
  layoutMonaco()
  fitTerminal()
}

function stopResizeTerminal() {
  isResizingTerminal.value = false
  document.removeEventListener('mousemove', onResizeTerminal)
  document.removeEventListener('mouseup', stopResizeTerminal)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  layoutMonaco()
  fitTerminal()
  saveSettingsToFile()
}

function openTerminal() {
  isTerminalOpen.value = true
  nextTick(() => {
    layoutMonaco()
    fitTerminal()
  })
  saveSettingsToFile()
}

function closeTerminal() {
  isTerminalOpen.value = false
  nextTick(() => {
    layoutMonaco()
  })
  saveSettingsToFile()
}

function toggleTerminal() {
  if (isTerminalOpen.value) {
    closeTerminal()
  } else {
    openTerminal()
  }
}

function fitTerminal() {
  if (terminalRef.value) {
    terminalRef.value.fit()
  }
}

// Grid template columns computed (sempre 4 colunas; chat é overlay)
const gridTemplateColumns = computed(() => {
  return `36px ${sidebarWidth.value}px 4px 1fr`
})

const showColorPalette = ref(false)
const colorPaletteRef = computed(() => appOverlaysRef.value?.colorPaletteRef?.value ?? null)
const pickedColor = ref(null)

function toggleColorPalette() {
  showColorPalette.value = !showColorPalette.value
}

function activateEyedropper() {
  colorPaletteRef.value?.activateEyedropper?.()
}

function onColorPicked(color) {
  pickedColor.value = color
}

function clearPickedColor() {
  pickedColor.value = null
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log('Cor copiada:', text)
  })
}

function toggleAutocomplete() {
  autocompleteEnabled.value = !autocompleteEnabled.value
  
  // Atualiza o serviço de autocomplete
  if (window.retroStudio?.ai?.autocomplete) {
    window.retroStudio.ai.autocomplete.setEnabled(autocompleteEnabled.value)
  }
  
  // Notifica o usuário
  if (window.retroStudioToast) {
    if (autocompleteEnabled.value) {
      window.retroStudioToast.success('AI Autocomplete ativado')
    } else {
      window.retroStudioToast.info('AI Autocomplete desativado')
    }
  }
}

async function refreshTree() {
  if (!workspacePath.value) return
  lastError.value = null
  try {
    const selectedPath = selectedNode.value?.path ?? null
    tree.value = await window.retroStudio.listWorkspaceTree()
    if (!selectedPath || !tree.value) {
      selectedNode.value = tree.value
      return
    }

    // Try to keep selection by path after refresh. If not found, fallback to root.
    const findByPath = (node) => {
      if (node.path === selectedPath) return node
      if (node.kind === 'dir' && node.children) {
        for (const c of node.children) {
          const found = findByPath(c)
          if (found) return found
        }
      }
      return null
    }

    selectedNode.value = findByPath(tree.value) ?? tree.value
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('refreshTree failed', e)
    lastError.value = msg
  }
}

function onSelectNode(node) {
  selectedNode.value = node
}

const contextMenu = ref({ open: false, x: 0, y: 0, node: null })

const contextMenuWidth = 240
const contextMenuHeight = 250

function openContextMenu(payload) {
  selectedNode.value = payload.node

  const margin = 8
  const maxX = Math.max(margin, window.innerWidth - contextMenuWidth - margin)
  const maxY = Math.max(margin, window.innerHeight - contextMenuHeight - margin)
  const x = Math.max(margin, Math.min(payload.x, maxX))
  const y = Math.max(margin, Math.min(payload.y, maxY))

  contextMenu.value = { open: true, x, y, node: payload.node }
}

function openTreeContextMenu(e) {
  if (!tree.value) return
  const node = selectedNode.value ?? tree.value
  openContextMenu({ node, x: e.clientX, y: e.clientY })
}

function closeContextMenu() {
  contextMenu.value = { open: false, x: 0, y: 0, node: null }
}

function onGlobalPointerDown(e) {
  if (!contextMenu.value.open) return
  const target = e.target
  if (target && target.closest('[data-context-menu="file-tree"]')) return
  closeContextMenu()
}

function onContextMenuRename() {
  closeContextMenu()
  renameSelected()
}

function onContextMenuDelete() {
  closeContextMenu()
  deleteSelected()
}

function onContextMenuNewFile() {
  closeContextMenu()
  createNewFile()
}

function onContextMenuNewFolder() {
  closeContextMenu()
  createNewFolder()
}

function onContextMenuOpen() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n) return
  if (n.kind !== 'file') return
  openFile(n.path)
}

async function onContextMenuRefresh() {
  closeContextMenu()
  await refreshTree()
}

function onContextMenuCopyPath() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n) return
  navigator.clipboard.writeText(n.path)
}

function onContextMenuCopyRelativePath() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n || !workspacePath.value) return
  const relativePath = n.path.replace(workspacePath.value + '/', '')
  navigator.clipboard.writeText(relativePath)
}

async function onContextMenuEditExternalImage() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n?.path || !retroUiSettings.value?.imageEditorPath) return
  await window.retroStudio?.retro?.openExternalEditor?.(retroUiSettings.value.imageEditorPath, n.path)
}

async function onContextMenuEditExternalMap() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n?.path || !retroUiSettings.value?.mapEditorPath) return
  await window.retroStudio?.retro?.openExternalEditor?.(retroUiSettings.value.mapEditorPath, n.path)
}

async function onContextMenuEditTilemap() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n?.path) return
  await openTilemapEditorForFile(n.path)
}

const workspacePath = ref(null)

// Retro Studio
const showNewRetroProjectModal = ref(false)
const showOpenWorkspaceModal = ref(false)
const showStoreModal = ref(false)
const showStoreLoginModal = ref(false)
const storeUser = ref(null)
const isRetroCompiling = ref(false)
const isPackaging = ref(false)
const buildProgressMessage = ref('')
let pendingPackageAfterBuild = false
const { isRetroProject, projectConfig, uiSettings: retroUiSettings, loadUiSettings, runGame, buildOnly, stopBuild } = useRetroProject(workspacePath)
const tree = ref(null)

const windowTitle = computed(() => {
  const base = 'Retro Studio'
  if (projectConfig?.value?.name) return `${base} - ${projectConfig.value.name}`
  if (workspacePath?.value) return `${base} - ${workspacePath.value.split(/[/\\]/).pop() || 'Workspace'}`
  return base
})
const showHelpViewer = ref(false)
const availableEmulators = ref([])
const selectedEmulator = ref('gen_sdl2')

const activityBarItems = computed(() => {
  const base = [
    { id: 'explorer', label: 'Explorer (Ctrl+Shift+E)', icon: 'icon-folder-tree' },
    { id: 'store', label: 'Loja', icon: 'icon-store' },
    { id: 'search', label: 'Search (Ctrl+Shift+F)', icon: 'icon-magnifying-glass' },
    { id: 'git', label: 'Source Control', icon: 'icon-code-branch' },
    { id: 'debug', label: 'Run and Debug', icon: 'icon-bug' },
    { id: 'extensions', label: 'Extensions', icon: 'icon-grid-2' }
  ]
  if (isRetroProject.value) {
    base.splice(2, 0, { id: 'resources', label: 'Recursos Retro', icon: 'icon-image' })
    base.splice(3, 0, { id: 'cartridge', label: 'Cartridge Programmer', icon: 'icon-microchip' })
  }
  return base
})

const lastError = ref(null)

const selectedNode = ref(null)

const expandedMap = ref({})

const isMaximized = ref(false)
const statusLineCol = ref({ line: 1, col: 1 })

function winMinimize() {
  window.retroStudio.windowMinimize()
}

function winToggleMaximize() {
  window.retroStudio.windowToggleMaximize()
  setTimeout(() => refreshIsMaximized(), 100) // Delay to allow state update
}

function winClose() {
  window.retroStudio.windowClose()
}

function refreshIsMaximized() {
  window.retroStudio.windowIsMaximized().then((maximized) => {
    isMaximized.value = maximized
  })
}

function openAIChat() {
  isAIChatOpen.value = true
  saveSettingsToFile()
}

function closeAIChat() {
  isAIChatOpen.value = false
  saveSettingsToFile()
}

function toggleAIChat() {
  isAIChatOpen.value = !isAIChatOpen.value
  saveSettingsToFile()
}

// Retro Studio
async function handlePlayRetro() {
  if (!retroUiSettings.value?.toolkitPath) {
    window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
    openSettings()
    return
  }
  isRetroCompiling.value = true
  runGame()
}

function handleStopRetro() {
  stopBuild()
  isRetroCompiling.value = false
  buildProgressMessage.value = ''
}

async function handleBuildRetro() {
  if (!retroUiSettings.value?.toolkitPath) {
    window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
    openSettings()
    return
  }
  compilationErrors.value = []
  buildProgressMessage.value = ''
  isRetroCompiling.value = true
  if (!isTerminalOpen.value) {
    isTerminalOpen.value = true
    nextTick(() => { layoutMonaco(); fitTerminal() })
  }
  buildOnly()
}

async function runPackageSteamLinux() {
  const api = window.retroStudio?.retro
  const projectPath = projectConfig.value?.path || workspacePath?.value
  if (!api?.packageSteamLinux || !projectPath) return
  isPackaging.value = true
  buildProgressMessage.value = ''
  if (!isTerminalOpen.value) {
    isTerminalOpen.value = true
    nextTick(() => { layoutMonaco(); fitTerminal() })
  }
  const unsub = api.onPackageProgress?.((msg) => {
    buildProgressMessage.value = msg
    terminalRef.value?.writeRetroData?.(`\r\n> ${msg}\r\n`)
  })
  try {
    const res = await api.packageSteamLinux({
      projectPath,
      gameName: projectConfig.value?.name
    })
    if (res?.success) {
      const out = res.appImagePath || res.appDirPath
      window.retroStudioToast?.success?.(`Pacote gerado: ${out}`)
    } else if (!res?.canceled) {
      window.retroStudioToast?.error?.(res?.error || 'Falha ao empacotar')
    }
  } catch (e) {
    window.retroStudioToast?.error?.(e?.message || 'Erro ao empacotar')
  } finally {
    unsub?.()
    isPackaging.value = false
    buildProgressMessage.value = ''
  }
}

async function handlePackageRetro() {
  const api = window.retroStudio?.retro
  const projectPath = projectConfig.value?.path || workspacePath?.value
  if (!projectPath || !api?.canPackageSteamLinux) return
  const { canPackage, reason } = await api.canPackageSteamLinux(projectPath)
  if (!canPackage) {
    if (reason === 'Execute o build antes de empacotar') {
      if (!retroUiSettings.value?.toolkitPath) {
        window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
        openSettings()
        return
      }
      pendingPackageAfterBuild = true
      compilationErrors.value = []
      isRetroCompiling.value = true
      buildOnly()
    } else {
      window.retroStudioToast?.warning?.(reason || 'Não é possível empacotar')
    }
    return
  }
  await runPackageSteamLinux()
}

async function loadEmulators() {
  const api = window.retroStudio?.retro
  if (!api?.getAvailableEmulators || !api?.getEmulatorConfig) return
  try {
    const [emusRes, configRes] = await Promise.all([
      api.getAvailableEmulators(),
      api.getEmulatorConfig()
    ])
    if (emusRes?.success && emusRes.emulators?.length) {
      availableEmulators.value = emusRes.emulators
    }
    if (configRes?.success && configRes.config?.selectedEmulator) {
      selectedEmulator.value = configRes.config.selectedEmulator
    }
  } catch (e) {
    console.warn('[RetroToolbar] loadEmulators:', e)
  }
}

async function updateEmulator(emulator) {
  selectedEmulator.value = emulator
  const api = window.retroStudio?.retro
  if (!api?.setEmulatorConfig) return
  try {
    await api.setEmulatorConfig({ selectedEmulator: emulator })
  } catch (e) {
    console.warn('[RetroToolbar] updateEmulator:', e)
  }
}


async function handleRetroProjectCreated({ path: projectPath }) {
  showNewRetroProjectModal.value = false
  await openWorkspace(projectPath)
  window.retroStudioToast?.success?.('Projeto Retro Studio criado e aberto')
}

// Handler para ações do menu
function handleMenuAction(action) {
  switch (action) {
    case 'newFile':
      createNewFile()
      break
    case 'newFolder':
      createNewFolder()
      break
    case 'openFolder':
      showOpenWorkspaceModal.value = true
      break
    case 'newRetroProject':
      showNewRetroProjectModal.value = true
      break
    case 'toggleAIChat':
      toggleAIChat()
      break
    case 'toggleExplorer':
      // TODO: Implementar toggle do explorer
      break
    case 'toggleTerminal':
      toggleTerminal()
      break
    case 'find':
      triggerFindInMonaco()
      break
    case 'replace':
      triggerReplaceInMonaco()
      break
    case 'undo':
      executeMonacoAction('undo')
      break
    case 'redo':
      executeMonacoAction('redo')
      break
    case 'cut':
      executeMonacoAction('editor.action.clipboardCutAction')
      break
    case 'copy':
      executeMonacoAction('editor.action.clipboardCopyAction')
      break
    case 'paste':
      // Paste precisa de tratamento especial devido às permissões do clipboard
      navigator.clipboard.readText().then((text) => {
        if (monacoInstance) {
          monacoInstance.trigger('keyboard', 'paste', { text })
        }
      }).catch(() => {
        executeMonacoAction('editor.action.clipboardPasteAction')
      })
      break
    case 'selectAll':
      executeMonacoAction('editor.action.selectAll')
      break
    case 'zoomIn':
      editorSettings.value.fontSize = Math.min(30, editorSettings.value.fontSize + 1)
      saveSettingsToFile()
      break
    case 'zoomOut':
      editorSettings.value.fontSize = Math.max(10, editorSettings.value.fontSize - 1)
      saveSettingsToFile()
      break
    case 'resetZoom':
      editorSettings.value.fontSize = 14
      saveSettingsToFile()
      break
    case 'toggleFullscreen':
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else {
        document.documentElement.requestFullscreen()
      }
      break
    case 'about':
      alert('Retro Studio\nVersão 0.6.0\n\nIDE para desenvolvimento de jogos Sega Mega Drive\nElectron + Vue 3 + Monaco Editor + SGDK')
      break
    default:
      console.log('Menu action not implemented:', action)
  }
}

// Executar ações do Monaco Editor
function executeMonacoAction(actionId) {
  if (monacoInstance) {
    monacoInstance.focus()
    monacoInstance.trigger('menu', actionId, null)
  }
}

// Trigger Replace no Monaco
function triggerReplaceInMonaco() {
  if (!activeTab.value) return
  const input = document.querySelector('.monaco-editor textarea.inputarea')
  if (!input) return
  
  input.focus()
  
  const event = new KeyboardEvent('keydown', {
    key: 'h',
    code: 'KeyH',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  })
  input.dispatchEvent(event)
}

// Atualiza layout do Monaco quando AI Chat abre/fecha
watch(isAIChatOpen, () => {
  nextTick(() => {
    layoutMonaco()
  })
})

watch(workspacePath, (newPath) => {
  if (newPath) expandedMap.value = {}
})

watch(isRetroProject, (v) => { if (v) loadEmulators() })

function toggleDir(dirPath) {
  // Agora a lógica é invertida: undefined/false = colapsado, true = expandido
  const isExpanded = expandedMap.value[dirPath] === true
  expandedMap.value = {
    ...expandedMap.value,
    [dirPath]: !isExpanded
  }
}

function updateCursorOffsetFromDom() {
  // TODO: Implement to update cursor offset from DOM
}

const tabs = ref([])
const activePath = ref(null)

const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value) ?? null)

// Inicializa composables do editor (checkpoint, lint, inline diff)
const getMonacoInstance = () => monacoInstance
const { checkForLintErrors: checkForLintErrorsFn } = useLintErrors(getMonacoInstance)
checkForLintErrors = checkForLintErrorsFn
const { saveCheckpoint: saveCheckpointFn, undoLastChange: undoLastChangeFn } = useCheckpointUndo(tabs, activePath, getMonacoInstance)
saveCheckpoint = saveCheckpointFn
undoLastChange = undoLastChangeFn
window.retroStudioUndo = undoLastChange
const {
  showInlineDiff,
  inlineDiffData,
  showDiffInEditor,
  clearDiffDecorations,
  acceptInlineDiff,
  rejectInlineDiff
} = useInlineDiff(getMonacoInstance, activePath, activeTab, saveCheckpoint, checkForLintErrors)

const {
  showCtrlKPopup,
  ctrlKInput,
  ctrlKLoading,
  ctrlKSelection,
  ctrlKText,
  ctrlKPosition,
  ctrlKFilePath,
  ctrlKInputRef,
  ctrlKPreviewCode,
  ctrlKShowPreview,
  ctrlKWidgetPosition,
  ctrlKInlineMode,
  ctrlKSuggestions,
  handleCtrlKEvent,
  cancelCtrlK,
  submitCtrlK,
  acceptCtrlKChanges,
  rejectCtrlKChanges,
  useCtrlKSuggestion
} = useCtrlK(getMonacoInstance, showDiffInEditor, saveCheckpoint, checkForLintErrors, activeTab, nextTick, () => appOverlaysRef.value?.ctrlKWidgetRef?.value?.focusInput?.())

// Observa mudanças na aba ativa para recriar o editor Monaco
watch(activeTab, (newTab, oldTab) => {
  if (!newTab) {
    // Destroi o editor se não há aba
    if (monacoInstance) {
      monacoInstance.dispose()
      monacoInstance = null
    }
    return
  }
  
  // Aguarda o DOM atualizar
  nextTick(() => {
    if (!monacoContainer.value) return
    
    // Destroi editor anterior se existir
    if (monacoInstance) {
      monacoInstance.dispose()
    }
    
    // Cria novo editor
    console.log('[Monaco] Criando editor para', newTab.name, 'linguagem:', newTab.language)
    monacoInstance = monaco.editor.create(monacoContainer.value, {
      value: newTab.value || '',
      language: newTab.language || 'plaintext',
      theme: 'vs-dark',
      ...editorOptions.value
    })
    
    // Registra event handlers
    monacoInstance.onDidChangeModelContent(() => {
      if (newTab) {
        newTab.value = monacoInstance.getValue()
        newTab.dirty = true
      }
    })
    
    // Chama handleEditorMount
    handleEditorMount(monacoInstance)
  })
})

// ============================================================================
// MONACO EDITOR: Funções de configuração
// NOTA: Essas funções DEVEM estar depois de activePath/activeTab para evitar
// "Cannot access before initialization"
// ============================================================================

function handleEditorMount(editor) {
  monacoInstance = editor
  console.log('[Monaco] Editor montado!', editor)
  console.log('[Monaco] Linguagem do modelo:', editor.getModel()?.getLanguageId())
  
  // Registra atalhos personalizados
  registerEditorShortcuts(editor)
  
  // Registra provider de autocomplete com IA
  registerInlineCompletionProvider()
  
  // Registra provider de sugestões baseado em palavras
  registerWordBasedCompletionProvider()
  
  // SGDK providers (autocomplete, hover, snippets, go-to-definition) para projetos Retro
  registerSGDKProviders(monaco, () => projectConfig?.value?.path ?? workspacePath?.value ?? null)
  
  // Testa os providers registrados
  setTimeout(() => {
    const providers = monaco.languages.getLanguages()
    console.log('[Monaco] Linguagens registradas:', providers.map(l => l.id))
  }, 500)
  
  // Faz layout inicial após montar
  setTimeout(() => {
    if (monacoInstance) {
      monacoInstance.layout()
    }
  }, 100)
}

/**
 * Registra provider de completion baseado em palavras do documento
 */
let wordCompletionDisposable = null
function registerWordBasedCompletionProvider() {
  if (wordCompletionDisposable) {
    wordCompletionDisposable.dispose()
  }
  
  console.log('[Monaco] Registrando completion provider...')
  
  // Lista de linguagens que queremos suportar
  const languages = ['javascript', 'typescript', 'c', 'html', 'css', 'json', 'markdown', 'plaintext']
  
  // Registra provider para cada linguagem
  const disposables = languages.map(lang => {
    return monaco.languages.registerCompletionItemProvider(lang, {
      // Remove triggerCharacters para permitir acionamento manual
      provideCompletionItems: (model, position) => {
        console.log(`[Monaco] provideCompletionItems chamado para ${lang}!`, position)
        
        // Obtém a palavra atual sendo digitada
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        
        // Extrai todas as palavras do documento
        const text = model.getValue()
        const wordPattern = /\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g
        const wordsSet = new Set()
        let match
        
        while ((match = wordPattern.exec(text)) !== null) {
          // Não inclui a palavra atual sendo digitada
          if (match[0].toLowerCase() !== word.word.toLowerCase()) {
            wordsSet.add(match[0])
          }
        }
        
        // Adiciona keywords comuns de JavaScript
        const jsKeywords = [
          'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
          'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
          'async', 'await', 'class', 'extends', 'import', 'export', 'default', 'from',
          'new', 'this', 'super', 'static', 'get', 'set', 'typeof', 'instanceof',
          'true', 'false', 'null', 'undefined', 'console', 'document', 'window'
        ]
        jsKeywords.forEach(kw => wordsSet.add(kw))
        
        // Converte para suggestions
        const suggestions = Array.from(wordsSet).map(w => ({
          label: w,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: w,
          range: range
          // Removido: detail: 'Palavra do documento' - para não aparecer no autocomplete
        }))
        
        console.log('[Monaco] Retornando', suggestions.length, 'sugestões')
        
        return { suggestions }
      }
    })
  })
  
  // Guarda todos os disposables
  wordCompletionDisposable = {
    dispose: () => disposables.forEach(d => d.dispose())
  }
  
  console.log('[Monaco] Provider registrado com sucesso para', languages.length, 'linguagens!')
}

/**
 * Registra o provider de inline completions (autocomplete com IA)
 */
function registerInlineCompletionProvider() {
  // Remove provider anterior se existir
  if (autocompleteProviderDisposable) {
    autocompleteProviderDisposable.dispose()
  }
  
  autocompleteProviderDisposable = monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**' }, // Aplica a todos os arquivos
    {
      provideInlineCompletions: async (model, position, context, token) => {
        // Verifica se autocomplete está habilitado
        if (!autocompleteEnabled.value) {
          return { items: [] }
        }
        
        // Suporta Automatic (digitação) e Explicit (Ctrl+Space)
        const trigger = context.triggerKind
        const isExplicit = trigger === monaco.languages.InlineCompletionTriggerKind.Explicit
        const isAutomatic = trigger === monaco.languages.InlineCompletionTriggerKind.Automatic
        if (!isExplicit && !isAutomatic) return { items: [] }
        
        // Verifica se o serviço de autocomplete está disponível
        if (!window.retroStudio?.ai?.autocomplete?.complete) {
          return { items: [] }
        }
        
        // Obtém o texto antes e depois do cursor
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })
        
        const textAfterCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: model.getLineCount(),
          endColumn: model.getLineMaxColumn(model.getLineCount())
        })
        
        // Mínimo de caracteres (Explicit permite menos para Ctrl+Space)
        const minChars = isExplicit ? 3 : 6
        if (textBeforeCursor.trim().length < minChars) {
          return { items: [] }
        }
        
        // Detecta linguagem
        const language = model.getLanguageId()
        const filePath = activePath.value || ''
        
        // Aborta request anterior se existir
        if (autocompleteAbortController) {
          autocompleteAbortController.abort()
        }
        autocompleteAbortController = new AbortController()
        
        try {
          isAutocompleteLoading.value = true
          
          // Chama o serviço de autocomplete
          const result = await window.retroStudio.ai.autocomplete.complete({
            prefix: textBeforeCursor,
            suffix: textAfterCursor,
            language: language,
            filePath: filePath
          })
          
          // Verifica se foi cancelado
          if (token.isCancellationRequested || result.aborted) {
            return { items: [] }
          }
          
          // Retorna a compleção
          if (result.insertText && result.insertText.trim()) {
            return {
              items: [{
                insertText: result.insertText,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column
                }
              }]
            }
          }
          
          return { items: [] }
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.error('Autocomplete error:', error)
          }
          return { items: [] }
        } finally {
          isAutocompleteLoading.value = false
        }
      },
      
      freeInlineCompletions: () => {
        // Limpa recursos se necessário
      }
    }
  )
}

function registerEditorShortcuts(editor) {
  // Usa o Monaco importado diretamente
  const { KeyMod, KeyCode } = monaco

  // Ctrl+D - Duplicar linha
  editor.addAction({
    id: 'duplicate-line',
    label: 'Duplicate Line',
    keybindings: [
      KeyMod.CtrlCmd | KeyCode.KeyD
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.copyLinesDownAction', null)
    }
  })
  
  // Ctrl+/ - Comentar/Descomentar
  editor.addAction({
    id: 'toggle-comment',
    label: 'Toggle Line Comment',
    keybindings: [
      KeyMod.CtrlCmd | KeyCode.Slash
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.commentLine', null)
    }
  })
  
  // Alt+↑ - Mover linha para cima
  editor.addAction({
    id: 'move-line-up',
    label: 'Move Line Up',
    keybindings: [
      KeyMod.Alt | KeyCode.UpArrow
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.moveLinesUpAction', null)
    }
  })
  
  // Alt+↓ - Mover linha para baixo
  editor.addAction({
    id: 'move-line-down',
    label: 'Move Line Down',
    keybindings: [
      KeyMod.Alt | KeyCode.DownArrow
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.moveLinesDownAction', null)
    }
  })
  
  // Ctrl+Shift+K - Deletar linha
  editor.addAction({
    id: 'delete-line',
    label: 'Delete Line',
    keybindings: [
      KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.deleteLines', null)
    }
  })
  
  // Ctrl+Shift+D - Duplicar seleção
  editor.addAction({
    id: 'duplicate-selection',
    label: 'Duplicate Selection',
    keybindings: [
      KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyD
    ],
    run: (ed) => {
      const selection = ed.getSelection()
      const text = ed.getModel().getValueInRange(selection)
      ed.executeEdits('', [{
        range: selection,
        text: text + text
      }])
    }
  })
  
  // Ctrl+] - Indent
  editor.addAction({
    id: 'indent-line',
    label: 'Indent Line',
    keybindings: [
      KeyMod.CtrlCmd | KeyCode.BracketRight
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.indentLines', null)
    }
  })
  
  // Ctrl+[ - Outdent
  editor.addAction({
    id: 'outdent-line',
    label: 'Outdent Line',
    keybindings: [
      KeyMod.CtrlCmd | KeyCode.BracketLeft
    ],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.outdentLines', null)
    }
  })
  
  // Ctrl+Espaço - Acionar Autocomplete/IntelliSense
  // Nota: Ctrl+Espaço pode ser interceptado pelo sistema (IBus/Fcitx no Linux)
  // Registramos com addCommand para ter maior prioridade
  editor.addCommand(KeyMod.CtrlCmd | KeyCode.Space, () => {
    editor.trigger('keyboard', 'editor.action.triggerSuggest', null)
  })
  
  // Ctrl+I - Alternativa para Trigger Suggest (não conflita com sistema)
  editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyI, () => {
    console.log('[Monaco] Ctrl+I pressionado! Acionando suggest...')
    editor.trigger('keyboard', 'editor.action.triggerSuggest', null)
  })
  
  // Também registra como action para aparecer no command palette
  editor.addAction({
    id: 'trigger-suggest',
    label: 'Trigger Suggest (Ctrl+Space ou Ctrl+I)',
    keybindings: [],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.triggerSuggest', null)
    }
  })
  
  // Ctrl+Shift+F - Format document (custom para .c/.h, Monaco para outros)
  editor.addAction({
    id: 'format-document',
    label: 'Format Document',
    keybindings: [
      KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF
    ],
    run: (ed) => {
      const model = ed.getModel()
      if (!model) return
      const lang = model.getLanguageId()
      const path = activePath.value || ''
      const isC = lang === 'c' || path.endsWith('.c') || path.endsWith('.h')
      if (isC) {
        const code = model.getValue()
        const formatted = formatCode(code)
        if (formatted !== code) {
          ed.executeEdits('', [{ range: model.getFullModelRange(), text: formatted }])
        }
      } else {
        ed.trigger('keyboard', 'editor.action.formatDocument', null)
      }
    }
  })
  
  // Ctrl+K - Edição inline com IA
  editor.addAction({
    id: 'ai-inline-edit',
    label: 'AI: Edit Selection (Ctrl+K)',
    keybindings: [
      KeyMod.CtrlCmd | KeyCode.KeyK
    ],
    run: (ed) => {
      // Emitir evento para abrir o popup de edição inline
      const selection = ed.getSelection()
      const model = ed.getModel()
      
      if (!model) return
      
      // Se não tem seleção, seleciona a linha atual
      let range = selection
      if (selection.isEmpty()) {
        const lineNumber = selection.startLineNumber
        range = {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: model.getLineMaxColumn(lineNumber)
        }
        ed.setSelection(range)
      }
      
      const selectedText = model.getValueInRange(range)
      const position = ed.getPosition()
      
      // Notificar a UI para mostrar o popup
      window.dispatchEvent(new CustomEvent('retroStudio:ctrlk', {
        detail: {
          selection: range,
          text: selectedText,
          position: position,
          filePath: window.retroStudioEditor?.getCurrentFile?.() || ''
        }
      }))
    }
  })
  
  // Ctrl+L - Toggle AI Chat
  editor.addAction({
    id: 'toggle-ai-chat',
    label: 'Toggle AI Chat (Ctrl+L)',
    keybindings: [
      KeyMod.CtrlCmd | KeyCode.KeyL
    ],
    run: () => {
      // Dispara evento para toggle do chat
      window.dispatchEvent(new CustomEvent('retroStudio:toggle-ai-chat'))
    }
  })
}

// ============================================================================
// FIM DAS FUNÇÕES DO MONACO EDITOR
// ============================================================================


const hasDirtyTabs = computed(() => tabs.value.some((t) => t.dirty))

const closeConfirmOpen = ref(false)
const closeConfirmTabPath = ref(null)
const closeConfirmResolver = ref(null)

const settingsDialogOpen = ref(false)
const settingsDraft = ref({ fontSize: 14, wordWrap: 'off', tabSize: 2 })
const uiSettingsDraft = ref({ windowControlsPosition: 'left' })
const editorSettings = ref({ fontSize: 14, wordWrap: 'off', tabSize: 2, minimap: true, lineNumbers: 'on' })
const uiSettings = ref({ windowControlsPosition: 'left', theme: 'dark' })
const terminalSettings = ref({ fontSize: 13, fontFamily: 'monospace', cursorBlink: true, cursorStyle: 'block' })

const { editorOptions } = useEditorOptions(editorSettings)

async function loadStoreUser() {
  try {
    const r = await window.retroStudio?.store?.me?.()
    storeUser.value = r?.user ?? null
  } catch {
    storeUser.value = null
  }
}

async function loadSettings() {
  try {
    if (!window.retroStudio?.settings) return
    const settings = await window.retroStudio.settings.load()
    
    if (settings.editor) {
      editorSettings.value = {
        fontSize: settings.editor.fontSize ?? 14,
        wordWrap: settings.editor.wordWrap ?? 'off',
        tabSize: settings.editor.tabSize ?? 2,
        minimap: settings.editor.minimap !== false,
        lineNumbers: settings.editor.lineNumbers ?? 'on'
      }
    }
    
    if (settings.appearance) {
      uiSettings.value = {
        windowControlsPosition: settings.appearance.windowControlsPosition ?? 'left',
        theme: settings.appearance.theme ?? 'dark'
      }
    }
    
    if (settings.terminal) {
      terminalSettings.value = {
        fontSize: settings.terminal.fontSize ?? 13,
        fontFamily: settings.terminal.fontFamily ?? 'monospace',
        cursorBlink: settings.terminal.cursorBlink !== false,
        cursorStyle: settings.terminal.cursorStyle ?? 'block'
      }
    }
    
    // Carregar estado dos painéis
    if (settings.panels) {
      if (settings.panels.aiChat) {
        isAIChatOpen.value = settings.panels.aiChat.open ?? false
        aiChatWidth.value = settings.panels.aiChat.width ?? 400
      }
      if (settings.panels.terminal) {
        isTerminalOpen.value = settings.panels.terminal.open ?? false
        terminalHeight.value = settings.panels.terminal.height ?? 250
      }
      if (settings.panels.sidebar) {
        sidebarWidth.value = settings.panels.sidebar.width ?? 280
      }
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
}

async function saveSettingsToFile(override = {}) {
  try {
    if (!window.retroStudio?.settings) return
    const current = await window.retroStudio.settings.load().catch(() => ({}))
    const base = {
      editor: { ...(current.editor || {}), ...editorSettings.value },
      appearance: { ...(current.appearance || {}), ...uiSettings.value },
      terminal: { ...(current.terminal || {}), ...terminalSettings.value },
      panels: {
        ...(current.panels || {}),
        aiChat: { open: isAIChatOpen.value, width: aiChatWidth.value },
        terminal: { open: isTerminalOpen.value, height: terminalHeight.value },
        sidebar: { width: sidebarWidth.value }
      },
      store: current.store || {},
      ai: current.ai || {},
      recentWorkspaces: current.recentWorkspaces || []
    }
    const payload = { ...base, ...override }
    if (override.ai) {
      payload.ai = {
        provider: override.ai.provider,
        apiKey: override.ai.apiKey,
        endpoint: override.ai.apiUrl ?? override.ai.endpoint,
        model: override.ai.model,
        temperature: override.ai.temperature,
        maxTokens: override.ai.maxTokens
      }
    }
    if (override.store) {
      payload.store = { ...(base.store || {}), ...override.store }
    }
    await window.retroStudio.settings.save(payload)
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

function onActivityBarSelect(id) {
  if (id === 'store') {
    showStoreModal.value = true
    return
  }
  activeView.value = id
  if (id === 'git') loadGitStatus()
}

async function openTilemapEditorFromBar() {
  const path = projectConfig?.value?.path ?? workspacePath?.value ?? ''
  if (!path) return
  let assets = []
  try {
    const config = await window.retroStudio?.retro?.getProjectConfig?.(path)
    assets = config?.assets || []
  } catch (_) {}
  window.retroStudio?.openTilemapEditor?.({ asset: null, projectPath: path, assets })
}

async function openTilemapEditorForFile(filePath) {
  const projectPath = projectConfig?.value?.path ?? workspacePath?.value ?? ''
  if (!projectPath || !window.retroStudio?.openTilemapEditor) return
  const base = projectPath.replace(/[/\\]+$/, '')
  const sep = filePath.includes('\\') ? '\\' : '/'
  const relativePath = filePath.startsWith(base)
    ? filePath.slice(base.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
    : filePath.split(sep).pop() || filePath
  const name = relativePath.split('/').pop()?.replace(/\.tmx$/i, '') || 'map'
  const asset = { path: relativePath, name, type: 'tilemap' }
  let assets = []
  try {
    const config = await window.retroStudio?.retro?.getProjectConfig?.(projectPath)
    assets = config?.assets || []
  } catch (_) {}
  window.retroStudio.openTilemapEditor({ asset, projectPath, assets })
}

function openSettings() {
  settingsDraft.value = { ...editorSettings.value }
  uiSettingsDraft.value = { ...uiSettings.value }
  settingsDialogOpen.value = true
}

function closeSettings() {
  settingsDialogOpen.value = false
}

async function handleSettingsSave(settings) {
  // Aplica configurações do editor
  if (settings.editor) {
    editorSettings.value = {
      fontSize: settings.editor.fontSize || 14,
      wordWrap: settings.editor.wordWrap || 'off',
      tabSize: settings.editor.tabSize || 2,
      minimap: settings.editor.minimap !== false,
      lineNumbers: settings.editor.lineNumbers || 'on'
    }
  }
  
  // Aplica configurações de aparência
  if (settings.appearance) {
    uiSettings.value = {
      windowControlsPosition: settings.appearance.windowControlsPosition || 'left',
      theme: settings.appearance.theme || 'dark'
    }
  }
  
  if (settings.retro) {
    loadUiSettings()
  }
  
  // Aplica configurações de terminal
  if (settings.terminal) {
    terminalSettings.value = {
      fontSize: settings.terminal.fontSize || 13,
      fontFamily: settings.terminal.fontFamily || 'monospace',
      cursorBlink: settings.terminal.cursorBlink !== false,
      cursorStyle: settings.terminal.cursorStyle || 'block'
    }
  }
  
  await saveSettingsToFile(settings)
  if (settings.ai && window.retroStudio?.ai?.updateSettings) {
    await window.retroStudio.ai.updateSettings({
      endpoint: settings.ai.apiUrl ?? settings.ai.endpoint,
      model: settings.ai.model,
      apiKey: settings.ai.apiKey,
      temperature: settings.ai.temperature,
      maxTokens: settings.ai.maxTokens
    })
  }
  console.log('Settings saved to file')
}

async function saveSettings() {
  const next = {
    fontSize: Math.max(10, Math.min(30, Number(settingsDraft.value.fontSize) || 14)),
    wordWrap: settingsDraft.value.wordWrap === 'on' ? 'on' : 'off',
    tabSize: Math.max(1, Math.min(8, Number(settingsDraft.value.tabSize) || 2)),
    minimap: editorSettings.value.minimap,
    lineNumbers: editorSettings.value.lineNumbers
  }

  const nextUi = {
    windowControlsPosition: uiSettingsDraft.value.windowControlsPosition === 'left' ? 'left' : 'right',
    theme: uiSettings.value.theme
  }
  
  editorSettings.value = next
  uiSettings.value = nextUi
  await saveSettingsToFile()
  settingsDialogOpen.value = false
}

const activeBreadcrumb = computed(() => {
  if (!activeTab.value) return null
  if (!workspacePath.value) return activeTab.value.path
  const ws = workspacePath.value
  if (activeTab.value.path === ws) return ws
  const prefix = ws.endsWith('/') ? ws : ws + '/'
  if (activeTab.value.path.startsWith(prefix)) return activeTab.value.path.slice(prefix.length)
})

async function openWorkspace(path) {
  if (!path) return
  
  lastError.value = null
  try {
    const openedPath = await window.retroStudio.workspace.openRecent(path)
    if (openedPath) {
      // Se estamos mudando de workspace, podemos querer fechar as abas atuais
      // mas apenas se o caminho for realmente diferente
      if (workspacePath.value !== openedPath) {
        tabs.value = []
        activePath.value = null
      }
      
      workspacePath.value = openedPath
      await refreshTree()
      
      const folderName = openedPath.split(/[/\\]/).pop() || openedPath
      window.retroStudioToast?.success(`Workspace aberto: ${folderName}`, { duration: 2000 })
    }
  } catch (e) {
    console.error('Failed to open workspace:', e)
    window.retroStudioToast?.error(`Erro ao abrir workspace: ${e.message}`)
  }
}

async function pickWorkspace() {
  lastError.value = null
  try {
    const selected = await window.retroStudio.selectWorkspace()
    if (selected) {
      await openWorkspace(selected)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('pickWorkspace failed', e)
    lastError.value = msg
  }
}

async function handleOpenWorkspacePick(path) {
  showOpenWorkspaceModal.value = false
  await openWorkspace(path)
}

async function handleOpenWorkspaceBrowse() {
  showOpenWorkspaceModal.value = false
  await pickWorkspace()
}

async function openFile(filePath) {
  lastError.value = null
  try {
    if (filePath?.toLowerCase().endsWith('.tmx') && isRetroProject && workspacePath.value) {
      await openTilemapEditorForFile(filePath)
      return
    }

    const existing = tabs.value.find((t) => t.path === filePath)
    if (existing) {
      activePath.value = existing.path
      return
    }

    const contents = await window.retroStudio.readTextFile(filePath)
    const name = filePath.split('/').pop() ?? filePath
    const tab = {
      path: filePath,
      name,
      language: languageForPath(filePath),
      value: contents,
      dirty: false
    }

    tabs.value.push(tab)
    activePath.value = tab.path

    // Dispara evento para os plugins
    window.retroStudio?.plugins?.emit('fileOpened', filePath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('openFile failed', filePath, e)
    lastError.value = msg
  }
}

const {
  isGitRepo,
  gitStatus,
  gitBranch,
  gitCommitMessage,
  isLoadingGit,
  gitBranches,
  showBranchDialog,
  newBranchName,
  showBranchesPanel,
  gitCommits,
  showCommitsPanel,
  isLoadingCommits,
  showDiffModal,
  diffContent,
  diffFilePath,
  diffStaged,
  parsedDiff,
  stagedFiles,
  unstagedFiles,
  loadGitStatus,
  gitStageFile,
  gitUnstageFile,
  gitDiscardFile,
  gitCommit,
  gitInitRepo,
  gitPull,
  gitPush,
  loadGitBranches,
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  loadGitCommits,
  showFileDiff,
  closeDiffModal,
  formatCommitDate,
  getGitStatusIcon,
  toggleBranchesPanel,
  openBranchDialog,
  closeBranchDialog,
  toggleCommitsPanel
} = useGit(workspacePath, openFile, refreshTree, lastError)

const {
  crudDialogOpen,
  crudDialogMode,
  crudDialogTitle,
  crudDialogLabel,
  crudDialogValue,
  closeCrudDialog,
  handleCrudConfirm,
  openNewFile: createNewFile,
  openNewFolder: createNewFolder,
  openRename: renameSelected,
  openDelete: deleteSelected
} = useCrudDialog({
  refreshTree,
  openFile,
  lastError,
  workspacePath,
  tabs,
  activePath,
  selectedNode,
  tree
})

// Abre arquivo Git (caminho relativo ao workspace)
function openGitFile(relativePath) {
  if (!workspacePath.value) return
  
  // Constrói o caminho absoluto
  const separator = workspacePath.value.includes('\\') ? '\\' : '/'
  const fullPath = workspacePath.value + separator + relativePath
  
  openFile(fullPath)
}

// Search in workspace
async function performSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  try {
    const results = await window.retroStudio.searchFiles(searchQuery.value, {
      searchContent: searchInContent.value,
      caseSensitive: searchCaseSensitive.value,
      useRegex: searchUseRegex.value,
      maxResults: 500
    })
    
    // Adiciona highlight e contexto aos resultados
    searchResults.value = results.map(result => {
      if (result.type === 'match' && result.text) {
        const query = searchQuery.value
        let highlightedText = result.text
        
        // Highlight do match
        if (!searchUseRegex.value) {
          const flags = searchCaseSensitive.value ? 'g' : 'gi'
          const regex = new RegExp(escapeRegExp(query), flags)
          highlightedText = result.text.replace(regex, match => `<mark>${match}</mark>`)
        }
        
        return { ...result, highlightedText }
      }
      return result
    })
    
    // Notificação de sucesso
    if (results.length > 0) {
      window.retroStudioToast?.success(`${results.length} resultado${results.length > 1 ? 's' : ''} encontrado${results.length > 1 ? 's' : ''}`, { duration: 2000 })
    } else {
      window.retroStudioToast?.info('Nenhum resultado encontrado')
    }
  } catch (e) {
    console.error('Search failed', e)
    lastError.value = e.message
    window.retroStudioToast?.error('Erro na busca', { description: e.message })
  } finally {
    isSearching.value = false
  }
}

function openSearchResult(result) {
  if (result.type === 'directory') return
  
  // Abre o arquivo
  openFile(result.fullPath)
  
  // Se tiver número de linha, posiciona o cursor
  if (result.line && monacoInstance) {
    nextTick(() => {
      try {
        monacoInstance.revealLineInCenter(result.line)
        monacoInstance.setPosition({ lineNumber: result.line, column: 1 })
        monacoInstance.focus()
      } catch (e) {
        console.error('Failed to position cursor:', e)
      }
    })
  }
}

function resolveErrorFilePath(errorFile, projectPath) {
  if (!errorFile) return null
  if (!projectPath) return errorFile
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const base = projectPath.endsWith(sep) ? projectPath.slice(0, -1) : projectPath
  if (errorFile.startsWith('/') || /^[A-Za-z]:[\\/]/.test(errorFile)) return errorFile
  return base + sep + errorFile.replace(/^[\\/]/, '')
}

function clearCompilationErrors() {
  compilationErrors.value = []
}

async function onCompilationErrorClick({ file, line, column }) {
  const proj = projectConfig?.value?.path ?? workspacePath?.value ?? ''
  const fullPath = resolveErrorFilePath(file, proj)
  if (!fullPath) return
  await openFile(fullPath)
  const ln = Math.max(1, parseInt(line) || 1)
  const col = Math.max(1, parseInt(column) || 1)
  nextTick(() => {
    setTimeout(() => {
      if (monacoInstance && activePath.value === fullPath) {
        try {
          monacoInstance.revealLineInCenter(ln)
          monacoInstance.setPosition({ lineNumber: ln, column: col })
          monacoInstance.focus()
        } catch (e) {
          console.error('Failed to position cursor:', e)
        }
      }
    }, 150)
  })
}

function removeTab(filePath) {
  const idx = tabs.value.findIndex((t) => t.path === filePath)
  if (idx === -1) return

  const wasActive = activePath.value === filePath
  tabs.value.splice(idx, 1)

  if (wasActive) {
    activePath.value = tabs.value[idx - 1]?.path ?? tabs.value[0]?.path ?? null
  }
}

function askCloseDecision(filePath) {
  closeConfirmOpen.value = true
  closeConfirmTabPath.value = filePath

  return new Promise((resolve) => {
    closeConfirmResolver.value = resolve
  })
}

function resolveCloseDecision(decision) {
  closeConfirmOpen.value = false
  const resolver = closeConfirmResolver.value
  closeConfirmResolver.value = null
  closeConfirmTabPath.value = null
  if (resolver) resolver(decision)
}

async function closeTab(filePath) {
  const tab = tabs.value.find((t) => t.path === filePath)
  if (!tab) return

  if (!tab.dirty) {
    removeTab(filePath)
    return
  }

  const decision = await askCloseDecision(filePath)
  if (decision === 'cancel') return

  if (decision === 'save') {
    lastError.value = null
    try {
      await window.retroStudio.writeTextFile(tab.path, tab.value)
      tab.dirty = false
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('closeTab save failed', e)
      lastError.value = msg
      return
    }
  }

  removeTab(filePath)
}

async function saveActive() {
  if (!activeTab.value) return
  lastError.value = null
  try {
    await window.retroStudio.writeTextFile(activeTab.value.path, activeTab.value.value)
    activeTab.value.dirty = false
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('saveActive failed', e)
    lastError.value = msg
  }
}

async function saveAll() {
  lastError.value = null
  const dirtyTabs = tabs.value.filter((t) => t.dirty)
  if (dirtyTabs.length === 0) return

  try {
    for (const t of dirtyTabs) {
      await window.retroStudio.writeTextFile(t.path, t.value)
      t.dirty = false
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('saveAll failed', e)
    lastError.value = msg
  }
}

function triggerFindInMonaco() {
  const input = document.querySelector('.monaco-editor textarea.inputarea')
  if (!input) return

  input.focus()

  const down = new KeyboardEvent('keydown', {
    key: 'f',
    code: 'KeyF',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  })
  input.dispatchEvent(down)

  const up = new KeyboardEvent('keyup', {
    key: 'f',
    code: 'KeyF',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  })
  input.dispatchEvent(up)
}

function onEditorChange(v) {
  if (!activeTab.value) return
  activeTab.value.value = v
  activeTab.value.dirty = true
}

function executeCommandPaletteAction(command) {
  if (command && command.action) {
    command.action()
  }
}

// Ctrl+K - handlers em useCtrlK composable

function onKeyDown(e) {
  if (!e.isTrusted) return

  if (e.key === 'Escape') {
    // Fechar diff inline se estiver aberto
    if (showInlineDiff.value) {
      rejectInlineDiff()
      return
    }
    // Fechar popup do Ctrl+K se estiver aberto
    if (showCtrlKPopup.value) {
      cancelCtrlK()
      return
    }
    closeContextMenu()
    return
  }
  
  // Enter para aceitar diff inline
  if (e.key === 'Enter' && showInlineDiff.value) {
    e.preventDefault()
    acceptInlineDiff()
    return
  }

  const isCmdOrCtrl = e.metaKey || e.ctrlKey
  if (e.key === 'F1') {
    e.preventDefault()
    if (isRetroProject.value) showHelpViewer.value = true
  }

  if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveActive()
  }

  if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
    const targetEl = e.target
    if (targetEl && targetEl.closest('.monaco-editor') && targetEl.matches('textarea.inputarea')) {
      return
    }

    e.preventDefault()
    if (!activeTab.value) return
    triggerFindInMonaco()
  }

  if (isCmdOrCtrl && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    toggleAIChat()
  }

  if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === ',') {
    e.preventDefault()
    openSettings()
  }

  // Ctrl+` para toggle terminal
  if (isCmdOrCtrl && e.key === '`') {
    e.preventDefault()
    toggleTerminal()
  }

  // Ctrl+Shift+P para Command Palette
  if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    showCommandPalette.value = true
  }

  // Ctrl+Shift+B para Build (projetos Retro)
  if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'b') {
    if (isRetroProject.value) {
      e.preventDefault()
      handleBuildRetro()
    }
  }
}

onMounted(async () => {
  console.log('\n================================================')
  console.log('🚀 [App.vue] onMounted INICIADO - Vue renderizado com sucesso!')
  console.log('================================================\n')
  
  refreshIsMaximized()
  await loadSettings()
  await loadStoreUser()
  loadEmulators()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', updateCursorOffsetFromDom, true)
  window.addEventListener('mouseup', updateCursorOffsetFromDom, true)
  window.addEventListener('pointerdown', onGlobalPointerDown)
  
  // Notifica plugins que o App está pronto
  window.retroStudio?.plugins?.emit('appReady', true)
  
  // Listener para redimensionamento da janela
  window.addEventListener('resize', layoutMonaco)
  
  // Expor API do editor para o chat da IA
  window.retroStudioEditor = {
    // Retorna o caminho do arquivo atualmente focado
    getCurrentFile: () => activePath.value,
    
    // Retorna todas as abas abertas
    getOpenTabs: () => tabs.value.map(t => ({ path: t.path, name: t.name, dirty: t.dirty })),
    
    // Abre um arquivo em uma aba
    openFile: (filePath) => openFile(filePath),
    
    // Retorna o workspace atual
    getWorkspace: () => workspacePath.value,
    
    // Busca um arquivo pelo nome no projeto
    findFile: async (fileName) => {
      try {
        // Busca recursiva na árvore
        const searchInTree = (nodes, target) => {
          for (const node of nodes) {
            if (node.type === 'file' && node.name === target) {
              return node.path
            }
            if (node.children) {
              const found = searchInTree(node.children, target)
              if (found) return found
            }
          }
          return null
        }
        
        // Primeiro tenta nome exato
        let found = searchInTree(tree.value, fileName)
        if (found) return found
        
        // Tenta com extensão parcial
        const baseName = fileName.split('/').pop()
        found = searchInTree(tree.value, baseName)
        if (found) return found
        
        return null
      } catch (e) {
        console.error('Erro ao buscar arquivo:', e)
        return null
      }
    },
    
    // Atualiza o conteúdo de um arquivo aberto
    updateFileContent: (filePath, content) => {
      const tab = tabs.value.find(t => t.path === filePath)
      if (tab) {
        tab.value = content
        tab.dirty = true
        if (activePath.value === filePath && monacoInstance) {
          const currentPosition = monacoInstance.getPosition()
          monacoInstance.setValue(content)
          if (currentPosition) {
            monacoInstance.setPosition(currentPosition)
          }
        }
        return true
      }
      return false
    }
  }
  
  // Listener para mudanças no filesystem (IA criando/editando arquivos)
  if (window.retroStudio?.onFileSystemChange) {
    window.retroStudio.onFileSystemChange(async (changeInfo) => {
      console.log('Filesystem changed:', changeInfo)
      
      // Atualiza FileTree
      await refreshTree()
      
      // Se o arquivo modificado está aberto, recarrega
      if (changeInfo.type === 'modified' && changeInfo.path) {
        const openTab = tabs.value.find(t => t.path === changeInfo.path)
        if (openTab && !openTab.dirty) {
          try {
            const content = await window.retroStudio.readTextFile(changeInfo.path)
            openTab.value = content
            
            // Atualiza Monaco se for a aba ativa
            if (activePath.value === changeInfo.path && monacoInstance) {
              const currentPosition = monacoInstance.getPosition()
              monacoInstance.setValue(content)
              if (currentPosition) {
                monacoInstance.setPosition(currentPosition)
              }
            }
          } catch (e) {
            console.error('Erro ao recarregar arquivo:', e)
          }
        }
      }
    })
  }
  
  // Listener para abrir editor de tilemaps (janela separada)
  window.addEventListener('retroStudio:edit-tilemap', (e) => {
    const { asset, projectPath, assets } = e.detail || {}
    window.retroStudio?.openTilemapEditor?.({ asset, projectPath, assets: assets || [] })
  })

  // Listener para abertura de workspace via CLI (Abrir com...)
  if (window.retroStudio?.workspace?.onOpenFromCli) {
    window.retroStudio.workspace.onOpenFromCli((path) => {
      console.log('📂 [App] Recebido comando para abrir workspace via CLI:', path)
      openWorkspace(path)
    })
  }

  // Carrega o último workspace automaticamente
  try {
    const lastWorkspace = await window.retroStudio.workspace.getLast()
    if (lastWorkspace && lastWorkspace.path) {
      await openWorkspace(lastWorkspace.path)
    }
  } catch (e) {
    console.error('❌ [onMounted] Erro ao carregar workspace inicial:', e)
  }
  
  // ResizeObserver para o container do editor
  nextTick(() => {
    const editorContainer = document.querySelector('.editorWrap')
    if (editorContainer) {
      resizeObserver = new ResizeObserver(() => {
        layoutMonaco()
      })
      resizeObserver.observe(editorContainer)
    }
  })
  
  // Listener para Ctrl+K (edição inline com IA)
  window.addEventListener('retroStudio:ctrlk', handleCtrlKEvent)
  
  // Listener para Ctrl+L (toggle AI chat)
  window.addEventListener('retroStudio:toggle-ai-chat', toggleAIChat)

  // Retro Studio: carregar UI settings e listeners
  loadUiSettings()
  const unsubTerminal = window.retroStudio?.retro?.onTerminalData?.((data) => {
    terminalRef.value?.writeRetroData?.(data)
  })
  window.retroStudio?.retro?.onRunGameError?.(({ message }) => {
    isRetroCompiling.value = false
    buildProgressMessage.value = ''
    window.retroStudioToast?.error?.(message)
  })
  window.retroStudio?.retro?.onRunGameBuildComplete?.(() => {
    isRetroCompiling.value = false
  })
  window.retroStudio?.retro?.onBuildComplete?.(async () => {
    isRetroCompiling.value = false
    compilationErrors.value = []
    if (pendingPackageAfterBuild) {
      pendingPackageAfterBuild = false
      runPackageSteamLinux()
    } else {
      const api = window.retroStudio?.retro
      const projectPath = projectConfig.value?.path || workspacePath?.value
      if (api?.canPackageSteamLinux && projectPath) {
        const { canPackage } = await api.canPackageSteamLinux(projectPath)
        if (canPackage) runPackageSteamLinux()
        else window.retroStudioToast?.success?.('Build concluído com sucesso')
      } else {
        window.retroStudioToast?.success?.('Build concluído com sucesso')
      }
    }
  })
  window.retroStudio?.retro?.onCompilationErrors?.(({ errors }) => {
    compilationErrors.value = errors || []
  })
  if (unsubTerminal) {
    window._retroUnsubTerminal = unsubTerminal
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', updateCursorOffsetFromDom, true)
  window.removeEventListener('mouseup', updateCursorOffsetFromDom, true)
  window.removeEventListener('pointerdown', onGlobalPointerDown)
  window.removeEventListener('resize', layoutMonaco)
  window.removeEventListener('retroStudio:ctrlk', handleCtrlKEvent)
  window.removeEventListener('retroStudio:toggle-ai-chat', toggleAIChat)
  
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  
  // Limpa o provider de autocomplete
  if (autocompleteProviderDisposable) {
    autocompleteProviderDisposable.dispose()
    autocompleteProviderDisposable = null
  }

  // Retro Studio cleanup
  window._retroUnsubTerminal?.()
})
</script>

<template>
  <div class="appShell">
    <TitleBar
      :title="windowTitle"
      :window-controls-position="uiSettings.windowControlsPosition"
      :is-maximized="isMaximized"
      :has-dirty-tabs="hasDirtyTabs"
      :has-dirty-active-tab="!!(activeTab && activeTab.dirty)"
      :is-retro-project="!!isRetroProject"
      :is-retro-compiling="isRetroCompiling"
      :is-packaging="isPackaging"
      :show-terminal="isTerminalOpen"
      :show-ai-chat="isAIChatOpen"
      :show-cartridge="activeView === 'cartridge'"
      :store-user="storeUser"
      :available-emulators="availableEmulators"
      :selected-emulator="selectedEmulator"
      @minimize="winMinimize"
      @toggle-maximize="winToggleMaximize"
      @close="winClose"
      @save-active="saveActive"
      @open-settings="openSettings"
      @menu-action="handleMenuAction"
      @build-retro="handleBuildRetro"
      @play-retro="handlePlayRetro"
      @stop-retro="handleStopRetro"
      @package-retro="handlePackageRetro"
      @open-map-editor="openTilemapEditorFromBar"
      @help="showHelpViewer = true"
      @command-palette="showCommandPalette = true"
      @toggle-terminal="toggleTerminal"
      @toggle-ai-chat="toggleAIChat"
      @search="activeView = 'search'"
      @toggle-cartridge="activeView = activeView === 'cartridge' ? 'resources' : 'cartridge'"
      @open-store-login="showStoreLoginModal = true"
      @emulator-change="updateEmulator"
    />

    <AppModals
      :show-new-retro-project-modal="showNewRetroProjectModal"
      :show-open-workspace-modal="showOpenWorkspaceModal"
      :show-store-modal="showStoreModal"
      :show-store-login-modal="showStoreLoginModal"
      :is-retro-compiling="isRetroCompiling"
      :is-packaging="isPackaging"
      :build-progress-message="buildProgressMessage"
      :show-help-viewer="showHelpViewer"
      :settings-dialog-open="settingsDialogOpen"
      :crud-dialog-open="crudDialogOpen"
      :crud-dialog-mode="crudDialogMode"
      :crud-dialog-title="crudDialogTitle"
      :crud-dialog-label="crudDialogLabel"
      :crud-dialog-value="crudDialogValue"
      :close-confirm-open="closeConfirmOpen"
      :show-branch-dialog="showBranchDialog"
      :new-branch-name="newBranchName"
      :show-diff-modal="showDiffModal"
      :diff-file-path="diffFilePath"
      :diff-staged="diffStaged"
      :parsed-diff="parsedDiff"
      :project-path="projectConfig?.path ?? workspacePath ?? ''"
      :store-user="storeUser"
      @close-new-project="showNewRetroProjectModal = false"
      @retro-project-created="handleRetroProjectCreated"
      @close-open-workspace="showOpenWorkspaceModal = false"
      @open-workspace-pick="handleOpenWorkspacePick"
      @open-workspace-browse="handleOpenWorkspaceBrowse"
      @close-store="showStoreModal = false"
      @close-store-login="showStoreLoginModal = false"
      @store-logged-in="storeUser = $event"
      @store-logged-out="storeUser = null"
      @stop-build="handleStopRetro"
      @close-help="showHelpViewer = false"
      @close-settings="closeSettings"
      @settings-save="handleSettingsSave"
      @crud-confirm="handleCrudConfirm"
      @crud-cancel="closeCrudDialog"
      @close-confirm-save="resolveCloseDecision('save')"
      @close-confirm-cancel="resolveCloseDecision('cancel')"
      @close-confirm-discard="resolveCloseDecision('discard')"
      @branch-update-name="newBranchName = $event"
      @branch-create="gitCreateBranch"
      @branch-close="closeBranchDialog"
      @diff-close="closeDiffModal"
    />

    <div class="app-main-wrapper" :class="{ 'has-ai-chat': isAIChatOpen }">
    <AppContent
      ref="appContentRef"
      :grid-template-columns="gridTemplateColumns"
      :active-view="activeView"
      :activity-bar-items="activityBarItems"
      :tree="tree"
      :selected-node="selectedNode"
      :expanded-map="expandedMap"
      :project-path="projectConfig?.path ?? workspacePath ?? ''"
      :image-editor-path="retroUiSettings?.imageEditorPath ?? ''"
      :map-editor-path="retroUiSettings?.mapEditorPath ?? ''"
      :workspace-path="workspacePath"
      :is-retro-project="!!isRetroProject"
      :search-query="searchQuery"
      :search-results="searchResults"
      :is-searching="isSearching"
      :search-in-content="searchInContent"
      :search-case-sensitive="searchCaseSensitive"
      :search-use-regex="searchUseRegex"
      :is-git-repo="isGitRepo"
      :is-loading-git="isLoadingGit"
      :git-branch="gitBranch"
      :git-commit-message="gitCommitMessage"
      :git-branches="gitBranches"
      :show-branches-panel="showBranchesPanel"
      :git-commits="gitCommits"
      :show-commits-panel="showCommitsPanel"
      :is-loading-commits="isLoadingCommits"
      :staged-files="stagedFiles"
      :unstaged-files="unstagedFiles"
      :format-commit-date="formatCommitDate"
      :get-git-status-icon="getGitStatusIcon"
      :context-menu="contextMenu"
      :context-menu-width="contextMenuWidth"
      :active-tab="activeTab"
      :tabs="tabs"
      :active-path="activePath"
      :is-terminal-open="isTerminalOpen"
      :terminal-height="terminalHeight"
      :compilation-errors="compilationErrors"
      :status-line-col="statusLineCol"
      :picked-color="pickedColor"
      :autocomplete-enabled="autocompleteEnabled"
      :autocomplete-loading="isAutocompleteLoading"
      :last-error="lastError"
      @activity-bar-select="onActivityBarSelect"
      @activity-bar-settings="openSettings"
      @sidebar-resize-start="startResize"
      @sidebar-open-file="openFile"
      @sidebar-select-node="onSelectNode"
      @sidebar-toggle-dir="toggleDir"
      @sidebar-context="openContextMenu"
      @sidebar-tree-context="openTreeContextMenu"
      @sidebar-cartridge-close="activeView = 'resources'"
      @sidebar-update-search-query="searchQuery = $event"
      @sidebar-update-search-in-content="searchInContent = $event"
      @sidebar-update-search-case-sensitive="searchCaseSensitive = $event"
      @sidebar-update-search-use-regex="searchUseRegex = $event"
      @sidebar-search="performSearch"
      @sidebar-open-search-result="openSearchResult"
      @sidebar-update-git-commit="gitCommitMessage = $event"
      @sidebar-git-pull="gitPull"
      @sidebar-git-push="gitPush"
      @sidebar-load-git="loadGitStatus"
      @sidebar-git-init="gitInitRepo"
      @sidebar-git-checkout="gitCheckout"
      @sidebar-git-create-branch="gitCreateBranch"
      @sidebar-git-delete-branch="gitDeleteBranch"
      @sidebar-toggle-branches="toggleBranchesPanel"
      @sidebar-toggle-commits="toggleCommitsPanel"
      @sidebar-load-commits="(reset) => loadGitCommits(reset)"
      @sidebar-open-branch-dialog="openBranchDialog"
      @sidebar-git-commit="gitCommit"
      @sidebar-git-stage="gitStageFile"
      @sidebar-git-unstage="gitUnstageFile"
      @sidebar-git-discard="gitDiscardFile"
      @sidebar-open-git-file="openGitFile"
      @sidebar-show-file-diff="showFileDiff"
      @context-close="closeContextMenu"
      @context-open="onContextMenuOpen"
      @context-refresh="onContextMenuRefresh"
      @context-new-file="onContextMenuNewFile"
      @context-new-folder="onContextMenuNewFolder"
      @context-rename="onContextMenuRename"
      @context-delete="onContextMenuDelete"
      @context-copy-path="onContextMenuCopyPath"
      @context-copy-relative-path="onContextMenuCopyRelativePath"
      @context-edit-external-image="onContextMenuEditExternalImage"
      @context-edit-external-map="onContextMenuEditExternalMap"
      @context-edit-tilemap="onContextMenuEditTilemap"
      @main-update-active-path="activePath = $event"
      @main-close-tab="closeTab"
      @main-close-terminal="closeTerminal"
      @main-resize-terminal="startResizeTerminal"
      @main-clear-errors="clearCompilationErrors"
      @main-error-click="onCompilationErrorClick"
      @main-activate-eyedropper="activateEyedropper"
      @main-toggle-color-palette="toggleColorPalette"
      @main-copy-color="copyToClipboard"
      @main-clear-picked-color="clearPickedColor"
      @main-toggle-autocomplete="toggleAutocomplete"
    >
      <div class="editorWrap" ref="monacoEditorRef">
        <div v-if="!activeTab" class="emptyState">Open a file from the explorer.</div>
        <div v-else ref="monacoContainer" class="monaco-editor-container"></div>
      </div>
    </AppContent>
    <div
      v-if="isAIChatOpen"
      class="ai-chat-sash-inline"
      @mousedown="startResizeAIChat"
    />
    <div
      v-if="isAIChatOpen"
      class="ai-chat-panel"
      :style="{ width: aiChatWidth + 'px' }"
    >
      <AIChat :is-open="true" @close="closeAIChat" />
    </div>
    </div>
  </div>

  <AppOverlays
    ref="appOverlaysRef"
    :show-color-palette="showColorPalette"
    :show-command-palette="showCommandPalette"
    :command-palette-commands="commandPaletteCommands"
    :show-ctrl-k-popup="showCtrlKPopup"
    :ctrl-k-input="ctrlKInput"
    :ctrl-k-loading="ctrlKLoading"
    :ctrl-k-show-preview="ctrlKShowPreview"
    :ctrl-k-inline-mode="ctrlKInlineMode"
    :ctrl-k-widget-position="ctrlKWidgetPosition"
    :ctrl-k-suggestions="ctrlKSuggestions"
    :ctrl-k-selected-text="ctrlKText"
    :ctrl-k-preview-code="ctrlKPreviewCode"
    @toggle-color-palette="toggleColorPalette"
    @color-picked="onColorPicked"
    @command-palette-close="showCommandPalette = false"
    @command-palette-execute="executeCommandPaletteAction"
    @ctrlk-update-input="(v) => { ctrlKInput.value = v }"
    @ctrlk-submit="submitCtrlK"
    @ctrlk-cancel="cancelCtrlK"
    @ctrlk-accept="acceptCtrlKChanges"
    @ctrlk-reject="rejectCtrlKChanges"
    @ctrlk-use-suggestion="useCtrlKSuggestion"
  />
</template>
