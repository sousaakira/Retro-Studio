<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import TitleBar from './components/TitleBar.vue'
import AppModals from './components/AppModals.vue'
import AppOverlays from './components/AppOverlays.vue'
import AppContent from './components/AppContent.vue'
import AIChat from './components/AIChat.vue'
import { languageForPath } from './utils/editorUtils.js'
import { useRetroProject } from './composables/useRetroProject.js'
import { useTreeRefresh } from './composables/useTreeRefresh.js'
import { useFileTree } from './composables/useFileTree.js'
import { useAppSettings } from './composables/useAppSettings.js'
import { useResizePanels } from './composables/useResizePanels.js'
import { useMonacoEditor } from './composables/useMonacoEditor.js'
import { useCheckpointUndo } from './composables/useCheckpointUndo.js'
import { useLintErrors } from './composables/useLintErrors.js'
import { useInlineDiff } from './composables/useInlineDiff.js'
import { useEditorOptions } from './composables/useEditorOptions.js'
import { useCtrlK } from './composables/useCtrlK.js'
import { useGit } from './composables/useGit.js'
import { useCrudDialog } from './composables/useCrudDialog.js'
import { useSearch } from './composables/useSearch.js'
import { useRetroBuild } from './composables/useRetroBuild.js'
import { useMenuActions } from './composables/useMenuActions.js'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts.js'
import { useWorkspace } from './composables/useWorkspace.js'
import { useTabs } from './composables/useTabs.js'
import { useTilemapEditor } from './composables/useTilemapEditor.js'
import { buildCommandPaletteCommands } from './constants/commandPaletteCommands.js'

// Refs base
const monacoEditorRef = ref(null)
const monacoContainer = ref(null)
const appContentRef = ref(null)
const appOverlaysRef = ref(null)
const mainEditorAreaRef = computed(() => appContentRef.value?.mainEditorAreaRef?.value ?? null)
const terminalRef = computed(() => mainEditorAreaRef.value?.terminalRef?.value ?? null)
let resizeObserver = null

const autocompleteEnabled = ref(false)
const isAutocompleteLoading = ref(false)
const isAIChatOpen = ref(false)
const isTerminalOpen = ref(false)
const activeView = ref('explorer')
const showCommandPalette = ref(false)
const showHelpViewer = ref(false)
const showNewRetroProjectModal = ref(false)
const showOpenWorkspaceModal = ref(false)
const showStoreModal = ref(false)
const showStoreLoginModal = ref(false)
const storeUser = ref(null)

// Workspace, tree, tabs
const workspacePath = ref(null)
const tree = ref(null)
const selectedNode = ref(null)
const lastError = ref(null)
const tabs = ref([])
const activePath = ref(null)
const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value) ?? null)

// Retro project
const { isRetroProject, projectConfig, uiSettings: retroUiSettings, loadUiSettings, runGame, buildOnly, stopBuild } = useRetroProject(workspacePath)

// useTreeRefresh + useTilemapEditor + openFile
const refreshTree = useTreeRefresh({ workspacePath, tree, selectedNode, lastError })
const { openTilemapEditorForFile, openTilemapEditorFromBar } = useTilemapEditor({ projectConfig, workspacePath })

async function openFile(filePath) {
  lastError.value = null
  try {
    if (filePath?.toLowerCase().endsWith('.tmx') && isRetroProject.value && workspacePath.value) {
      await openTilemapEditorForFile(filePath)
      return
    }
    const existing = tabs.value.find((t) => t.path === filePath)
    if (existing) { activePath.value = existing.path; return }
    const contents = await window.retroStudio.readTextFile(filePath)
    const name = filePath.split('/').pop() ?? filePath
    const tab = { path: filePath, name, language: languageForPath(filePath), value: contents, dirty: false }
    tabs.value.push(tab)
    activePath.value = tab.path
    window.retroStudio?.plugins?.emit('fileOpened', filePath)
  } catch (e) {
    lastError.value = e instanceof Error ? e.message : String(e)
    console.error('openFile failed', filePath, e)
  }
}

// useCrudDialog
const { crudDialogOpen, crudDialogMode, crudDialogTitle, crudDialogLabel, crudDialogValue, closeCrudDialog, handleCrudConfirm, openNewFile: createNewFile, openNewFolder: createNewFolder, openRename: renameSelected, openDelete: deleteSelected } = useCrudDialog({ refreshTree, openFile, lastError, workspacePath, tabs, activePath, selectedNode, tree })

// useFileTree
const fileTree = useFileTree({ workspacePath, tree, selectedNode, openFile, refreshTree, createNewFile, createNewFolder, renameSelected, deleteSelected, retroUiSettings, openTilemapEditorForFile })
const { contextMenu, contextMenuWidth, expandedMap, openContextMenu, openTreeContextMenu, closeContextMenu, onGlobalPointerDown, toggleDir, contextMenuHandlers } = fileTree

// useAppSettings
const { editorSettings, uiSettings, terminalSettings, settingsDraft, uiSettingsDraft, settingsDialogOpen, loadSettings, saveSettingsToFile } = useAppSettings()

// useEditorOptions + useMonacoEditor (layoutMonaco virá daqui)
const { editorOptions } = useEditorOptions(editorSettings)
const monacoComposable = useMonacoEditor({
  monacoContainer, activeTab, activePath, editorOptions,
  projectPathGetter: () => projectConfig?.value?.path ?? workspacePath?.value ?? null,
  autocompleteEnabled, isAutocompleteLoading
})
const layoutMonaco = monacoComposable.layoutMonaco
const getMonacoInstance = monacoComposable.getMonacoInstance

// useResizePanels
const fitTerminal = () => terminalRef.value?.fit()
const savePanelSettings = () => saveSettingsToFile({}, { isAIChatOpen, aiChatWidth: resize.aiChatWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
const resize = useResizePanels({ layoutMonaco, fitTerminal, saveSettings: savePanelSettings })
const { gridTemplateColumns, sidebarWidth, aiChatWidth, terminalHeight, startResize, startResizeAIChat, startResizeTerminal } = resize

// Checkpoint, Lint, InlineDiff, CtrlK
let saveCheckpoint = () => {}
let undoLastChange = () => false
let checkForLintErrors = async () => []
const { checkForLintErrors: checkForLintErrorsFn } = useLintErrors(getMonacoInstance)
checkForLintErrors = checkForLintErrorsFn
const { saveCheckpoint: saveCheckpointFn, undoLastChange: undoLastChangeFn } = useCheckpointUndo(tabs, activePath, getMonacoInstance)
saveCheckpoint = saveCheckpointFn
undoLastChange = undoLastChangeFn
window.retroStudioUndo = undoLastChange
const { showInlineDiff, showDiffInEditor, acceptInlineDiff, rejectInlineDiff } = useInlineDiff(getMonacoInstance, activePath, activeTab, saveCheckpoint, checkForLintErrors)
const { showCtrlKPopup, ctrlKInput, ctrlKLoading, ctrlKText, ctrlKPreviewCode, ctrlKShowPreview, ctrlKWidgetPosition, ctrlKInlineMode, ctrlKSuggestions, handleCtrlKEvent, cancelCtrlK, submitCtrlK, acceptCtrlKChanges, rejectCtrlKChanges, useCtrlKSuggestion } = useCtrlK(getMonacoInstance, showDiffInEditor, saveCheckpoint, checkForLintErrors, activeTab, nextTick, () => appOverlaysRef.value?.ctrlKWidgetRef?.value?.focusInput?.())

// useSearch
const { searchQuery, searchResults, isSearching, searchInContent, searchCaseSensitive, searchUseRegex, performSearch, openSearchResult } = useSearch(openFile, getMonacoInstance, workspacePath, lastError, nextTick)

// useRetroBuild
const retroBuild = useRetroBuild({
  workspacePath, projectConfig, retroUiSettings, runGame, buildOnly, stopBuild,
  isTerminalOpen, terminalRef, layoutMonaco, fitTerminal,
  openSettings: () => { settingsDialogOpen.value = true; settingsDraft.value = { ...editorSettings.value }; uiSettingsDraft.value = { ...uiSettings.value } },
  nextTick
})
const { isRetroCompiling, isPackaging, buildProgressMessage, compilationErrors, handlePlayRetro, handleStopRetro, handleBuildRetro, handlePackageRetro, onBuildComplete, runPackageSteamLinux, clearCompilationErrors } = retroBuild

// useGit
const git = useGit(workspacePath, openFile, refreshTree, lastError)
const { isGitRepo, gitBranch, gitCommitMessage, isLoadingGit, gitBranches, showBranchDialog, newBranchName, showBranchesPanel, gitCommits, showCommitsPanel, isLoadingCommits, showDiffModal, diffFilePath, diffStaged, parsedDiff, stagedFiles, unstagedFiles, loadGitStatus, gitStageFile, gitUnstageFile, gitDiscardFile, gitCommit, gitInitRepo, gitPull, gitPush, loadGitBranches, gitCheckout, gitCreateBranch, gitDeleteBranch, loadGitCommits, showFileDiff, closeDiffModal, formatCommitDate, getGitStatusIcon, toggleBranchesPanel, openBranchDialog, closeBranchDialog, toggleCommitsPanel } = git

// Terminal, AI Chat
function openTerminal() { isTerminalOpen.value = true; nextTick(() => { layoutMonaco(); fitTerminal() }); savePanelSettings() }
function closeTerminal() { isTerminalOpen.value = false; nextTick(() => layoutMonaco()); savePanelSettings() }
function toggleTerminal() { isTerminalOpen.value ? closeTerminal() : openTerminal() }
function openAIChat() { isAIChatOpen.value = true; savePanelSettings() }
function closeAIChat() { isAIChatOpen.value = false; savePanelSettings() }
function toggleAIChat() { isAIChatOpen.value = !isAIChatOpen.value; savePanelSettings() }

function openSettings() { settingsDialogOpen.value = true; settingsDraft.value = { ...editorSettings.value }; uiSettingsDraft.value = { ...uiSettings.value } }
function closeSettings() { settingsDialogOpen.value = false }
function triggerFindInMonaco() {
  const input = document.querySelector('.monaco-editor textarea.inputarea')
  if (!input) return
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }))
}
function triggerReplaceInMonaco() {
  const input = document.querySelector('.monaco-editor textarea.inputarea')
  if (!input) return
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true, bubbles: true, cancelable: true }))
}
function executeMonacoAction(actionId) { const m = getMonacoInstance(); if (m) { m.focus(); m.trigger('menu', actionId, null) } }

const handleMenuAction = useMenuActions({
  createNewFile, createNewFolder, showOpenWorkspaceModal, showNewRetroProjectModal, toggleAIChat, toggleTerminal,
  triggerFindInMonaco, triggerReplaceInMonaco, executeMonacoAction, getMonacoInstance, editorSettings,
  saveSettingsToFile: () => saveSettingsToFile({}, { isAIChatOpen, aiChatWidth: resize.aiChatWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth }),
  openSettings
})

const commandPaletteCommands = computed(() => buildCommandPaletteCommands({
  createNewFile, createNewFolder, saveActive, saveAll, triggerFindInMonaco,
  setActiveView: (v) => { activeView.value = v },
  showHelp: () => { if (isRetroProject.value) showHelpViewer.value = true },
  openTerminal, openAIChat, showStoreModal: () => { showStoreModal.value = true },
  gitCommit, gitPush, gitPull, loadGitStatus, openSettings, undoLastChange,
  getActivePath: () => activePath.value, toggleAutocomplete
}))

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

function onSelectNode(node) { selectedNode.value = node }

const onContextMenuRename = contextMenuHandlers.rename
const onContextMenuDelete = contextMenuHandlers.delete
const onContextMenuNewFile = contextMenuHandlers.newFile
const onContextMenuNewFolder = contextMenuHandlers.newFolder
const onContextMenuOpen = contextMenuHandlers.open
const onContextMenuRefresh = contextMenuHandlers.refresh
const onContextMenuCopyPath = contextMenuHandlers.copyPath
const onContextMenuCopyRelativePath = contextMenuHandlers.copyRelativePath
const onContextMenuEditExternalImage = contextMenuHandlers.editExternalImage
const onContextMenuEditExternalMap = contextMenuHandlers.editExternalMap
const onContextMenuEditTilemap = contextMenuHandlers.editTilemap

// Modals, Store (restantes)
const availableEmulators = ref([])
const selectedEmulator = ref('gen_sdl2')
const isMaximized = ref(false)
const statusLineCol = ref({ line: 1, col: 1 })

const windowTitle = computed(() => {
  const base = 'Retro Studio'
  if (projectConfig?.value?.name) return `${base} - ${projectConfig.value.name}`
  if (workspacePath?.value) return `${base} - ${workspacePath.value.split(/[/\\]/).pop() || 'Workspace'}`
  return base
})
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
  window.retroStudio.windowIsMaximized().then((maximized) => { isMaximized.value = maximized })
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

watch(isAIChatOpen, () => nextTick(() => layoutMonaco()))
watch(workspacePath, (newPath) => { if (newPath) expandedMap.value = {} })
watch(isRetroProject, (v) => { if (v) loadEmulators() })

const hasDirtyTabs = computed(() => tabs.value.some((t) => t.dirty))

const workspace = useWorkspace({ workspacePath, tabs, activePath, lastError, refreshTree })
const { openWorkspace, pickWorkspace } = workspace

const tabsComposable = useTabs({ tabs, activePath, lastError })
const { closeConfirmOpen, closeConfirmTabPath, closeConfirmResolver, closeTab, saveActive, saveAll, resolveCloseDecision, askCloseDecision } = tabsComposable

async function loadStoreUser() {
  try { storeUser.value = (await window.retroStudio?.store?.me?.())?.user ?? null } catch { storeUser.value = null }
}

function onActivityBarSelect(id) {
  if (id === 'store') {
    showStoreModal.value = true
    return
  }
  activeView.value = id
  if (id === 'git') loadGitStatus()
}

async function handleSettingsSave(settings) {
  if (settings.editor) editorSettings.value = { fontSize: settings.editor.fontSize || 14, wordWrap: settings.editor.wordWrap || 'off', tabSize: settings.editor.tabSize || 2, minimap: settings.editor.minimap !== false, lineNumbers: settings.editor.lineNumbers || 'on' }
  if (settings.appearance) uiSettings.value = { windowControlsPosition: settings.appearance.windowControlsPosition || 'left', theme: settings.appearance.theme || 'dark' }
  if (settings.retro) loadUiSettings()
  if (settings.terminal) terminalSettings.value = { fontSize: settings.terminal.fontSize || 13, fontFamily: settings.terminal.fontFamily || 'monospace', cursorBlink: settings.terminal.cursorBlink !== false, cursorStyle: settings.terminal.cursorStyle || 'block' }
  await saveSettingsToFile(settings, { isAIChatOpen, aiChatWidth: resize.aiChatWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
  if (settings.ai && window.retroStudio?.ai?.updateSettings) await window.retroStudio.ai.updateSettings({ endpoint: settings.ai.apiUrl ?? settings.ai.endpoint, model: settings.ai.model, apiKey: settings.ai.apiKey, temperature: settings.ai.temperature, maxTokens: settings.ai.maxTokens })
}

async function saveSettings() {
  editorSettings.value = { fontSize: Math.max(10, Math.min(30, Number(settingsDraft.value.fontSize) || 14)), wordWrap: settingsDraft.value.wordWrap === 'on' ? 'on' : 'off', tabSize: Math.max(1, Math.min(8, Number(settingsDraft.value.tabSize) || 2)), minimap: editorSettings.value.minimap, lineNumbers: editorSettings.value.lineNumbers }
  uiSettings.value = { windowControlsPosition: uiSettingsDraft.value.windowControlsPosition === 'left' ? 'left' : 'right', theme: uiSettings.value.theme }
  await saveSettingsToFile({}, { isAIChatOpen, aiChatWidth: resize.aiChatWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
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

async function handleOpenWorkspacePick(path) {
  showOpenWorkspaceModal.value = false
  await openWorkspace(path)
}

async function handleOpenWorkspaceBrowse() {
  showOpenWorkspaceModal.value = false
  await pickWorkspace()
}

function openGitFile(relativePath) { if (!workspacePath.value) return; const sep = workspacePath.value.includes('\\') ? '\\' : '/'; openFile(workspacePath.value + sep + relativePath) }

async function handleDropFiles({ destDirPath, filePaths }) {
  if (!destDirPath || !filePaths?.length || !window.retroStudio?.copyFileFromExternal) return
  lastError.value = null
  try {
    for (const src of filePaths) await window.retroStudio.copyFileFromExternal(src, destDirPath)
    await refreshTree()
  } catch (e) {
    lastError.value = e?.message || String(e)
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

async function onCompilationErrorClick({ file, line, column }) {
  const proj = projectConfig?.value?.path ?? workspacePath?.value ?? ''
  const fullPath = resolveErrorFilePath(file, proj)
  if (!fullPath) return
  await openFile(fullPath)
  const ln = Math.max(1, parseInt(line) || 1)
  const col = Math.max(1, parseInt(column) || 1)
  nextTick(() => setTimeout(() => {
    const m = getMonacoInstance()
    if (m && activePath.value === fullPath) {
      try { m.revealLineInCenter(ln); m.setPosition({ lineNumber: ln, column: col }); m.focus() } catch (e) { console.error('Failed to position cursor:', e) }
    }
  }, 150))
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

function updateCursorOffsetFromDom() {}
const onKeyDown = useKeyboardShortcuts({
  showInlineDiff, rejectInlineDiff, showCtrlKPopup, cancelCtrlK, acceptInlineDiff, closeContextMenu,
  isRetroProject, showHelpViewer, saveActive, activeTab, triggerFindInMonaco, toggleAIChat, openSettings, toggleTerminal, showCommandPalette, handleBuildRetro
})

const searchInTree = (nodes, target) => {
  for (const node of nodes) {
    if (node.kind === 'file' && node.name === target) return node.path
    if (node.children) { const f = searchInTree(node.children, target); if (f) return f }
  }
  return null
}

onMounted(async () => {
  refreshIsMaximized()
  await loadSettings({ isAIChatOpen, aiChatWidth: resize.aiChatWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
  await loadStoreUser()
  loadEmulators()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', updateCursorOffsetFromDom, true)
  window.addEventListener('mouseup', updateCursorOffsetFromDom, true)
  window.addEventListener('pointerdown', onGlobalPointerDown)
  window.addEventListener('resize', layoutMonaco)
  document.addEventListener('drop', () => { try { document.dispatchEvent(new CustomEvent('retro-studio:clear-drop-targets')) } catch (_) {} }, true)
  window.retroStudio?.plugins?.emit('appReady', true)
  window.retroStudioEditor = {
    getCurrentFile: () => activePath.value,
    getOpenTabs: () => tabs.value.map(t => ({ path: t.path, name: t.name, dirty: t.dirty })),
    openFile: (fp) => openFile(fp),
    getWorkspace: () => workspacePath.value,
    findFile: async (fileName) => { try { const nodes = Array.isArray(tree.value) ? tree.value : (tree.value ? [tree.value] : []); return searchInTree(nodes, fileName) ?? searchInTree(nodes, fileName.split('/').pop()) ?? null } catch { return null } },
    updateFileContent: (filePath, content) => {
      const tab = tabs.value.find(t => t.path === filePath)
      if (!tab) return false
      tab.value = content
      tab.dirty = true
      const m = getMonacoInstance()
      if (activePath.value === filePath && m) { const pos = m.getPosition(); m.setValue(content); if (pos) m.setPosition(pos) }
      return true
    }
  }
  if (window.retroStudio?.onFileSystemChange) {
    window.retroStudio.onFileSystemChange(async (changeInfo) => {
      await refreshTree()
      if (changeInfo.type === 'modified' && changeInfo.path) {
        const openTab = tabs.value.find(t => t.path === changeInfo.path)
        if (openTab && !openTab.dirty) {
          try {
            const content = await window.retroStudio.readTextFile(changeInfo.path)
            openTab.value = content
            const m = getMonacoInstance()
            if (activePath.value === changeInfo.path && m) { const pos = m.getPosition(); m.setValue(content); if (pos) m.setPosition(pos) }
          } catch (e) { console.error('Erro ao recarregar arquivo:', e) }
        }
      }
    })
  }
  window.addEventListener('retroStudio:edit-tilemap', (e) => {
    const { asset, projectPath, assets } = e.detail || {}
    window.retroStudio?.openTilemapEditor?.({ asset, projectPath, assets: assets || [] })
  })
  if (window.retroStudio?.workspace?.onOpenFromCli) window.retroStudio.workspace.onOpenFromCli(openWorkspace)
  try { const last = await window.retroStudio.workspace.getLast(); if (last?.path) await openWorkspace(last.path) } catch (e) { console.error('Erro ao carregar workspace inicial:', e) }
  nextTick(() => { const el = document.querySelector('.editorWrap'); if (el) { resizeObserver = new ResizeObserver(() => layoutMonaco()); resizeObserver.observe(el) } })
  window.addEventListener('retroStudio:ctrlk', handleCtrlKEvent)
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
    onBuildComplete(async () => {
      const api = window.retroStudio?.retro
      const projectPath = projectConfig.value?.path || workspacePath?.value
      if (api?.canPackageSteamLinux && projectPath) {
        const { canPackage } = await api.canPackageSteamLinux(projectPath)
        if (canPackage) runPackageSteamLinux()
        else window.retroStudioToast?.success?.('Build concluído com sucesso')
      } else {
        window.retroStudioToast?.success?.('Build concluído com sucesso')
      }
    })
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
  
  monacoComposable.dispose()

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
      @sidebar-drop-files="handleDropFiles"
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
