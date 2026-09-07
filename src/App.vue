<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { setAppLocale } from './i18n'
import TitleBar from './components/TitleBar.vue'
import AppModals from './components/AppModals.vue'
import AppOverlays from './components/AppOverlays.vue'
import AppContent from './components/AppContent.vue'
import AcpAgentPanel from './components/AcpAgentPanel.vue'
import StatusBar from './components/StatusBar.vue'
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

const { t } = useI18n()

// Refs base
const monacoEditorRef = ref(null)
const monacoContainer = ref(null)
const appContentRef = ref(null)
const appOverlaysRef = ref(null)
const mainEditorAreaRef = computed(() => appContentRef.value?.mainEditorAreaRef?.value || appContentRef.value?.mainEditorAreaRef || null)
const terminalRef = computed(() => mainEditorAreaRef.value?.terminalRef?.value || mainEditorAreaRef.value?.terminalRef || null)
let resizeObserver = null

const autocompleteEnabled = ref(false)
const isAutocompleteLoading = ref(false)
const isAITerminalOpen = ref(false)
const acpPanelRef = ref(null)
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
const savePanelSettings = () => saveSettingsToFile({}, { isAITerminalOpen, aiTerminalWidth: resize.aiTerminalWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
const resize = useResizePanels({ layoutMonaco, fitTerminal, saveSettings: savePanelSettings })
const { gridTemplateColumns, sidebarWidth, terminalHeight, aiTerminalWidth, startResize, startResizeTerminal, startResizeAITerminal } = resize

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
const { showInlineDiff, pendingAiWrite, showDiffInEditor, reviewAiFileWrite, acceptInlineDiff, rejectInlineDiff, acceptCurrentReview, rejectCurrentReview } = useInlineDiff(getMonacoInstance, activePath, activeTab, saveCheckpoint, checkForLintErrors)
const ctrlK = useCtrlK(getMonacoInstance, showDiffInEditor, saveCheckpoint, checkForLintErrors, activeTab, nextTick, () => appOverlaysRef.value?.ctrlKWidgetRef?.value?.focusInput?.())
const { showCtrlKPopup, ctrlKInput, ctrlKLoading, ctrlKText, ctrlKPreviewCode, ctrlKShowPreview, ctrlKWidgetPosition, ctrlKInlineMode, ctrlKSuggestions, handleCtrlKEvent, cancelCtrlK, submitCtrlK, acceptCtrlKChanges, rejectCtrlKChanges, useCtrlKSuggestion } = ctrlK

function onCtrlKUpdateInput(v) {
  ctrlK.ctrlKInput.value = v
}

// useSearch
const { searchQuery, searchResults, isSearching, searchInContent, searchCaseSensitive, searchUseRegex, performSearch, openSearchResult } = useSearch(openFile, getMonacoInstance, workspacePath, lastError, nextTick)

// useRetroBuild
const retroBuild = useRetroBuild({
  workspacePath, projectConfig, retroUiSettings, runGame, buildOnly, stopBuild,
  isTerminalOpen, terminalRef, layoutMonaco, fitTerminal,
  openSettings: () => { settingsDialogOpen.value = true; settingsDraft.value = { ...editorSettings.value }; uiSettingsDraft.value = { ...uiSettings.value } },
  nextTick
})
const { isBuilding, isPlaying, isPackaging, buildProgressMessage, compilationErrors, handlePlayRetro, handleStopRetro, handleBuildRetro, handlePackageRetro, onBuildComplete, runPackageSteamLinux, clearCompilationErrors } = retroBuild
const lastTilemapContext = ref(null) // { path, name }
const lastRomPath = ref(null)
const isRetroCompiling = computed(() => isBuilding.value || isPlaying.value)

// useGit
const git = useGit(workspacePath, openFile, refreshTree, lastError)
const { isGitRepo, gitBranch, gitCommitMessage, isLoadingGit, gitBranches, showBranchDialog, newBranchName, showBranchesPanel, gitCommits, showCommitsPanel, isLoadingCommits, showDiffModal, diffFilePath, diffStaged, parsedDiff, stagedFiles, unstagedFiles, loadGitStatus, gitStageFile, gitUnstageFile, gitDiscardFile, gitCommit, gitInitRepo, gitPull, gitPush, loadGitBranches, gitCheckout, gitCreateBranch, gitDeleteBranch, loadGitCommits, showFileDiff, closeDiffModal, formatCommitDate, getGitStatusIcon, toggleBranchesPanel, openBranchDialog, closeBranchDialog, toggleCommitsPanel } = git

// Terminal + painel IA (OpenCode ACP)
function openTerminal() { isTerminalOpen.value = true; nextTick(() => { layoutMonaco(); fitTerminal() }); savePanelSettings() }
function closeTerminal() { isTerminalOpen.value = false; nextTick(() => layoutMonaco()); savePanelSettings() }
function toggleTerminal() { isTerminalOpen.value ? closeTerminal() : openTerminal() }

async function runTerminalCommand(command) {
  if (!command) return
  openTerminal()
  for (let i = 0; i < 30; i++) {
    await nextTick()
    const term = terminalRef.value
    if (term?.sendCommand) {
      await new Promise((r) => setTimeout(r, 250))
      if (term.sendCommand(command)) return
    }
    await new Promise((r) => setTimeout(r, 40))
  }
}

function onRunTerminalCommand(e) {
  runTerminalCommand(e?.detail?.command)
}
function openAITerminal() { isAITerminalOpen.value = true; savePanelSettings() }
function closeAITerminal() { isAITerminalOpen.value = false; savePanelSettings() }
function toggleAITerminal() { isAITerminalOpen.value = !isAITerminalOpen.value; savePanelSettings() }

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
  createNewFile, createNewFolder, showOpenWorkspaceModal, showNewRetroProjectModal, toggleAITerminal, toggleTerminal,
  triggerFindInMonaco, triggerReplaceInMonaco, executeMonacoAction, getMonacoInstance, editorSettings,
  saveSettingsToFile: () => saveSettingsToFile({}, { isAITerminalOpen, aiTerminalWidth: resize.aiTerminalWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth }),
  openSettings
})

const commandPaletteCommands = computed(() => buildCommandPaletteCommands({
  createNewFile, createNewFolder, saveActive, saveAll, triggerFindInMonaco,
  setActiveView: (v) => { activeView.value = v },
  showHelp: () => { if (isRetroProject.value) showHelpViewer.value = true },
  openTerminal, openAITerminal, showStoreModal: () => { showStoreModal.value = true },
  gitCommit, gitPush, gitPull, loadGitStatus, openSettings, undoLastChange,
  getActivePath: () => activePath.value, toggleAutocomplete
}, t))

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
  const base = t('app.name')
  if (projectConfig?.value?.name) return `${base} - ${projectConfig.value.name}`
  if (workspacePath?.value) return `${base} - ${workspacePath.value.split(/[/\\]/).pop() || t('common.workspace')}`
  return base
})
const activityBarItems = computed(() => {
  const base = [
    { id: 'explorer', label: t('activityBar.explorer'), icon: 'icon-folder-tree' },
    { id: 'store', label: t('activityBar.store'), icon: 'icon-store' },
    { id: 'search', label: t('activityBar.search'), icon: 'icon-magnifying-glass' },
    { id: 'git', label: t('activityBar.git'), icon: 'icon-code-branch' },
    { id: 'debug', label: t('activityBar.debug'), icon: 'icon-bug' },
    { id: 'extensions', label: t('activityBar.extensions'), icon: 'icon-grid-2' }
  ]
  if (isRetroProject.value) {
    base.splice(2, 0, { id: 'resources', label: t('activityBar.resources'), icon: 'icon-image' })
    base.splice(3, 0, { id: 'cartridge', label: t('activityBar.cartridge'), icon: 'icon-microchip' })
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

watch(isAITerminalOpen, () => nextTick(() => layoutMonaco()))
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
  if (settings.appearance) {
    uiSettings.value = {
      windowControlsPosition: settings.appearance.windowControlsPosition || 'left',
      theme: settings.appearance.theme || 'dark',
      locale: settings.appearance.locale || uiSettings.value.locale || 'pt-BR'
    }
    if (settings.appearance.locale) setAppLocale(settings.appearance.locale)
  }
  if (settings.retro) loadUiSettings()
  if (settings.terminal) terminalSettings.value = { fontSize: settings.terminal.fontSize || 13, fontFamily: settings.terminal.fontFamily || 'monospace', cursorBlink: settings.terminal.cursorBlink !== false, cursorStyle: settings.terminal.cursorStyle || 'block' }
  await saveSettingsToFile(settings, { isAITerminalOpen, aiTerminalWidth: resize.aiTerminalWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
  if (settings.ai && window.retroStudio?.ai?.updateSettings) await window.retroStudio.ai.updateSettings({ endpoint: settings.ai.apiUrl ?? settings.ai.endpoint, model: settings.ai.model, apiKey: settings.ai.apiKey, temperature: settings.ai.temperature, maxTokens: settings.ai.maxTokens })
}

async function saveSettings() {
  editorSettings.value = { fontSize: Math.max(10, Math.min(30, Number(settingsDraft.value.fontSize) || 14)), wordWrap: settingsDraft.value.wordWrap === 'on' ? 'on' : 'off', tabSize: Math.max(1, Math.min(8, Number(settingsDraft.value.tabSize) || 2)), minimap: editorSettings.value.minimap, lineNumbers: editorSettings.value.lineNumbers }
  uiSettings.value = {
    windowControlsPosition: uiSettingsDraft.value.windowControlsPosition === 'left' ? 'left' : 'right',
    theme: uiSettings.value.theme,
    locale: uiSettings.value.locale || 'pt-BR'
  }
  await saveSettingsToFile({}, { isAITerminalOpen, aiTerminalWidth: resize.aiTerminalWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
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
  await openFileAt(fullPath, line, column)
}

async function openFileAt(filePath, line = 1, column = 1) {
  if (!filePath) return
  await openFile(filePath)
  const ln = Math.max(1, parseInt(line, 10) || 1)
  const col = Math.max(1, parseInt(column, 10) || 1)
  await nextTick()
  setTimeout(() => {
    const m = getMonacoInstance()
    if (m && activePath.value === filePath) {
      try {
        m.revealLineInCenter(ln)
        m.setPosition({ lineNumber: ln, column: col })
        m.focus()
      } catch (e) {
        console.error('Failed to position cursor:', e)
      }
    }
  }, 150)
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
  showInlineDiff, rejectInlineDiff: rejectCurrentReview, showCtrlKPopup, cancelCtrlK, acceptInlineDiff: acceptCurrentReview, closeContextMenu,
  isRetroProject, showHelpViewer, saveActive, activeTab, triggerFindInMonaco, toggleAITerminal, openSettings, toggleTerminal, showCommandPalette, handleBuildRetro
})

const searchInTree = (nodes, target) => {
  for (const node of nodes) {
    if (node.kind === 'file' && node.name === target) return node.path
    if (node.children) { const f = searchInTree(node.children, target); if (f) return f }
  }
  return null
}

function onAcpEditSelection(e) {
  openAITerminal()
  const detail = e?.detail || {}
  ;(async () => {
    for (let i = 0; i < 50; i++) {
      await nextTick()
      if (acpPanelRef.value?.queueEditSelection) {
        await acpPanelRef.value.queueEditSelection(detail)
        return
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    window.retroStudioToast?.warning?.(t('acp.ctrlkNotReady'))
  })()
}

onMounted(async () => {
  refreshIsMaximized()
  await loadSettings({ isAITerminalOpen, aiTerminalWidth: resize.aiTerminalWidth, isTerminalOpen, terminalHeight: resize.terminalHeight, sidebarWidth: resize.sidebarWidth })
  if (uiSettings.value.locale) setAppLocale(uiSettings.value.locale)
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
    getCurrentFileContent: () => {
      try {
        const editor = getMonacoInstance()
        if (editor?.getModel?.()) return editor.getValue()
      } catch (_) { /* fallback abaixo */ }
      return activeTab.value?.value ?? null
    },
    getOpenTabs: () => tabs.value.map(t => ({ path: t.path, name: t.name, dirty: t.dirty })),
    openFile: (fp) => openFile(fp),
    openFileAt: (fp, line, column) => openFileAt(fp, line, column),
    closeTab: (fp) => closeTab(fp),
    getWorkspace: () => workspacePath.value,
    findFile: async (fileName) => { try { const nodes = Array.isArray(tree.value) ? tree.value : (tree.value ? [tree.value] : []); return searchInTree(nodes, fileName) ?? searchInTree(nodes, fileName.split('/').pop()) ?? null } catch { return null } },
    reviewAiFileWrite: (payload) => reviewAiFileWrite(payload),
    updateFileContent: (filePath, content, options = {}) => {
      const norm = (p) => (p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
      const normPath = norm(filePath)
      const tab = tabs.value.find(t => norm(t.path) === normPath || t.path === filePath)
      if (!tab) return false
      tab.value = content
      tab.dirty = options.dirty === false ? false : true
      const editor = getMonacoInstance()
      const isActive = norm(activePath.value) === normPath || activePath.value === filePath
      if (isActive && editor) {
        const model = editor.getModel()
        if (model) {
          if (options.fromAI) saveCheckpoint(filePath, model.getValue())
          const fullRange = model.getFullModelRange()
          editor.executeEdits('ai-update', [{ range: fullRange, text: content, forceMoveMarkers: true }])
        }
      }
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
            const editor = getMonacoInstance()
            if (activePath.value === changeInfo.path && editor) {
              const model = editor.getModel()
              if (model) {
                const fullRange = model.getFullModelRange()
                editor.executeEdits('file-sync', [{ range: fullRange, text: content, forceMoveMarkers: true }])
              }
            }
          } catch (e) { console.error('Erro ao recarregar arquivo:', e) }
        }
      }
    })
  }
  window.addEventListener('retroStudio:edit-tilemap', (e) => {
    const { asset, projectPath, assets } = e.detail || {}
    if (asset) {
      lastTilemapContext.value = {
        path: asset.path || asset.file || asset.name || null,
        name: asset.name || asset.file || 'tilemap'
      }
    }
    window.retroStudio?.openTilemapEditor?.({ asset, projectPath, assets: assets || [] })
  })
  if (window.retroStudio?.workspace?.onOpenFromCli) window.retroStudio.workspace.onOpenFromCli(openWorkspace)
  try { const last = await window.retroStudio.workspace.getLast(); if (last?.path) await openWorkspace(last.path) } catch (e) { console.error('Erro ao carregar workspace inicial:', e) }
  nextTick(() => { const el = document.querySelector('.editorWrap'); if (el) { resizeObserver = new ResizeObserver(() => layoutMonaco()); resizeObserver.observe(el) } })
  window.addEventListener('retroStudio:ctrlk', handleCtrlKEvent)
  window.addEventListener('retroStudio:toggle-ai-terminal', toggleAITerminal)
  window.addEventListener('retroStudio:run-terminal-command', onRunTerminalCommand)
  window.addEventListener('retroStudio:acp-edit-selection', onAcpEditSelection)
  const onGotoCompilationError = (e) => onCompilationErrorClick(e?.detail || {})
  window.addEventListener('retroStudio:goto-compilation-error', onGotoCompilationError)
  window._retroOnGotoCompilationError = onGotoCompilationError

  // Retro Studio: carregar UI settings e listeners
  loadUiSettings()
  
  const pendingTerminalData = []
  const unsubTerminal = window.retroStudio?.retro?.onTerminalData?.((data) => {
    if (terminalRef.value?.writeRetroData) {
      terminalRef.value.writeRetroData(data)
    } else {
      pendingTerminalData.push(data)
    }
  })
  
  watch(terminalRef, (newRef) => {
    if (newRef && pendingTerminalData.length > 0) {
      pendingTerminalData.forEach(d => newRef.writeRetroData(d))
      pendingTerminalData.length = 0
    }
  })
  
  window.retroStudio?.retro?.onRunGameError?.(({ message }) => {
    buildProgressMessage.value = ''
    window.retroStudioToast?.error?.(message)
  })
  window.retroStudio?.retro?.onRunGameBuildComplete?.(() => {
    buildProgressMessage.value = ''
    isPlaying.value = false
    isBuilding.value = false
  })
  window.retroStudio?.retro?.onBuildComplete?.((payload) => {
    isPlaying.value = false
    isBuilding.value = false
    compilationErrors.value = []
    if (payload?.romPath) lastRomPath.value = payload.romPath
    window.dispatchEvent(new CustomEvent('retroStudio:acp-build-result', {
      detail: { ok: true, romPath: payload?.romPath || lastRomPath.value }
    }))

    // Defer behavior to useRetroBuild so it packages IF requested, otherwise generic success.
    onBuildComplete(() => {
      window.retroStudioToast?.success?.('Build concluído com sucesso')
    })
  })
  window.retroStudio?.retro?.onCompilationErrors?.(({ errors }) => {
    compilationErrors.value = errors || []
    window.dispatchEvent(new CustomEvent('retroStudio:acp-build-result', {
      detail: { ok: false, errors: errors || [] }
    }))
  })
  window.retroStudioContext = {
    getCompilationErrors: () => compilationErrors.value || [],
    setCompilationErrors: (errors) => {
      compilationErrors.value = Array.isArray(errors) ? errors : []
    },
    getLastTilemap: () => lastTilemapContext.value,
    getLastRomPath: () => lastRomPath.value,
    getWorkspace: () => workspacePath.value,
    getIsRetroProject: () => !!isRetroProject.value,
    isBuilding: () => !!isBuilding.value,
    isPlaying: () => !!isPlaying.value,
    build: () => handleBuildRetro(),
    play: () => handlePlayRetro(),
    stop: () => handleStopRetro(),
    refreshRomInfo: async () => {
      try {
        const projectPath = projectConfig.value?.path || workspacePath.value
        if (!projectPath) return null
        const info = await window.retroStudio?.retro?.getCurrentRomInfo?.(projectPath)
        const rom = info?.path || info?.romPath || null
        if (rom) lastRomPath.value = rom
        return rom
      } catch (_) {
        return lastRomPath.value
      }
    }
  }
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
  window.removeEventListener('retroStudio:toggle-ai-terminal', toggleAITerminal)
  window.removeEventListener('retroStudio:run-terminal-command', onRunTerminalCommand)
  window.removeEventListener('retroStudio:acp-edit-selection', onAcpEditSelection)
  if (window._retroOnGotoCompilationError) {
    window.removeEventListener('retroStudio:goto-compilation-error', window._retroOnGotoCompilationError)
    delete window._retroOnGotoCompilationError
  }
  
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
      :is-building="isBuilding"
      :is-playing="isPlaying"
      :is-packaging="isPackaging"
      :show-terminal="isTerminalOpen"
      :show-ai-terminal="isAITerminalOpen"
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
      @toggle-ai-terminal="toggleAITerminal"
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

    <div class="app-main-wrapper" :class="{ 'has-ai-panel': isAITerminalOpen }">
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
    >
      <div class="editorWrap" ref="monacoEditorRef">
        <div
          v-if="pendingAiWrite"
          class="ai-write-review-banner"
          role="status"
        >
          <div class="ai-write-review-banner__text">
            <span class="ai-write-review-banner__label">{{ t('acp.reviewTitle') }}</span>
            <span class="ai-write-review-banner__file" :title="pendingAiWrite.filePath">{{ pendingAiWrite.fileName }}</span>
            <span
              v-if="pendingAiWrite.addedCount || pendingAiWrite.removedCount"
              class="ai-write-review-banner__stats"
            >
              +{{ pendingAiWrite.addedCount || 0 }} / −{{ pendingAiWrite.removedCount || 0 }}
            </span>
          </div>
          <div class="ai-write-review-banner__actions">
            <button type="button" class="diff-reject" @click="rejectCurrentReview">{{ t('acp.reviewReject') }}</button>
            <button type="button" class="diff-accept" @click="acceptCurrentReview">{{ t('acp.reviewAccept') }}</button>
          </div>
        </div>
        <div v-if="!activeTab" class="emptyState">{{ t('app.emptyEditor') }}</div>
        <div v-else ref="monacoContainer" class="monaco-editor-container"></div>
      </div>
    </AppContent>
    <!-- AI Panel (OpenCode ACP) -->
    <div
      v-if="isAITerminalOpen"
      class="ai-terminal-sash"
      @mousedown="startResizeAITerminal"
    />
    <div
      v-if="isAITerminalOpen"
      class="ai-terminal-panel-wrapper"
      :style="{ width: aiTerminalWidth + 'px' }"
    >
      <AcpAgentPanel ref="acpPanelRef" :active="true" @close="closeAITerminal" />
    </div>
    </div>

    <StatusBar
      :file-name="activeTab?.name || ''"
      :language="activeTab ? languageForPath(activeTab.path) : ''"
      :line-col="statusLineCol"
      :picked-color="pickedColor"
      :autocomplete-enabled="autocompleteEnabled"
      :autocomplete-loading="isAutocompleteLoading"
      @activate-eyedropper="activateEyedropper"
      @toggle-color-palette="toggleColorPalette"
      @copy-color="copyToClipboard"
      @clear-picked-color="clearPickedColor"
      @toggle-autocomplete="toggleAutocomplete"
    />
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
    @ctrlk-update-input="onCtrlKUpdateInput"
    @ctrlk-submit="submitCtrlK"
    @ctrlk-cancel="cancelCtrlK"
    @ctrlk-accept="acceptCtrlKChanges"
    @ctrlk-reject="rejectCtrlKChanges"
    @ctrlk-use-suggestion="useCtrlKSuggestion"
  />
</template>
