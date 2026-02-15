<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
// import MonacoEditor from 'monaco-editor-vue3' // DESABILITADO - vamos usar direto
import * as monaco from 'monaco-editor'
import FileTree from './components/FileTree.vue'
import AIChat from './components/AIChat.vue'
import TitleBar from './components/TitleBar.vue'
import ActivityBar from './components/ActivityBar.vue'
import Settings from './components/Settings.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import CrudDialog from './components/CrudDialog.vue'
import ColorPalette from './components/ColorPalette.vue'
import ContextMenu from './components/ContextMenu.vue'
import StatusBar from './components/StatusBar.vue'
import EditorTabs from './components/EditorTabs.vue'
import TerminalPanel from './components/Terminal.vue'
import Toast from './components/Toast.vue'
import CommandPalette from './components/CommandPalette.vue'
import NewProjectModal from './components/retro/NewProjectModal.vue'
import ResourcesPanel from './components/retro/ResourcesPanel.vue'
import CartridgeProgrammer from './components/retro/CartridgeProgrammer.vue'
import HelpViewer from './components/retro/HelpViewer.vue'
import ErrorPanel from './components/retro/ErrorPanel.vue'
import { useRetroProject } from './composables/useRetroProject.js'
import { registerSGDKProviders } from './utils/retro/sgdkMonaco.js'
import { formatCode } from './utils/retro/codeFormatter.js'

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

// Search state
const searchQuery = ref('')
const searchResults = ref([])
const isSearching = ref(false)
const searchInContent = ref(false)
const searchCaseSensitive = ref(false)
const searchUseRegex = ref(false)

// Git state
const isGitRepo = ref(false)
const gitStatus = ref([])
const gitBranch = ref('')
const gitCommitMessage = ref('')
const isLoadingGit = ref(false)
const gitBranches = ref([])
const showBranchDialog = ref(false)
const newBranchName = ref('')
const showBranchesPanel = ref(false)
const gitCommits = ref([])
const showCommitsPanel = ref(false)
const isLoadingCommits = ref(false)
const showDiffModal = ref(false)
const diffContent = ref('')
const diffFilePath = ref('')
const diffStaged = ref(false)

// Terminal state
const isTerminalOpen = ref(false)
const terminalHeight = ref(250)
const isResizingTerminal = ref(false)
const minTerminalHeight = 100
const maxTerminalHeight = 600
const terminalRef = ref(null)

// Compilation errors (Retro)
const compilationErrors = ref([])


// NPM Scripts state

// Command Palette state
const showCommandPalette = ref(false)

// Ctrl+K Inline Edit state
const showCtrlKPopup = ref(false)
const ctrlKInput = ref('')
const ctrlKLoading = ref(false)
const ctrlKSelection = ref(null)
const ctrlKText = ref('')
const ctrlKPosition = ref(null)
const ctrlKFilePath = ref('')
const ctrlKInputRef = ref(null)
const ctrlKPreviewCode = ref('')  // Código gerado pela IA para preview
const ctrlKShowPreview = ref(false)  // Mostrar preview antes de aplicar
const ctrlKWidgetPosition = ref({ top: 0, left: 0 })  // Posição do widget inline
const ctrlKInlineMode = ref(true)  // Se true, mostra widget inline; se false, mostra modal
let ctrlKContentWidget = null  // Referência ao content widget do Monaco

// Sugestões de prompts comuns para Ctrl+K
const ctrlKSuggestions = [
  'Adicione tratamento de erros',
  'Adicione comentários explicativos',
  'Refatore para melhor legibilidade',
  'Converta para async/await',
  'Adicione tipos TypeScript',
  'Otimize performance',
  'Adicione logs de debug',
  'Simplifique este código'
]

// ========================================
// CHECKPOINT/UNDO SYSTEM
// ========================================
// Salva o estado antes de edições da IA para permitir undo
const fileCheckpoints = ref(new Map()) // Map<filePath, { content: string, timestamp: Date }>
const maxCheckpoints = 10 // Máximo de checkpoints por arquivo

function saveCheckpoint(filePath, content) {
  if (!filePath || !content) return
  
  let checkpoints = fileCheckpoints.value.get(filePath) || []
  
  // Adiciona novo checkpoint
  checkpoints.push({
    content,
    timestamp: new Date(),
    description: 'Before AI edit'
  })
  
  // Limita o número de checkpoints
  if (checkpoints.length > maxCheckpoints) {
    checkpoints = checkpoints.slice(-maxCheckpoints)
  }
  
  fileCheckpoints.value.set(filePath, checkpoints)
}

function undoLastChange(filePath) {
  const checkpoints = fileCheckpoints.value.get(filePath)
  if (!checkpoints || checkpoints.length === 0) {
    window.monarcoToast?.warning('Nenhum checkpoint disponível para este arquivo')
    return false
  }
  
  const lastCheckpoint = checkpoints.pop()
  fileCheckpoints.value.set(filePath, checkpoints)
  
  // Restaura o conteúdo
  const tab = tabs.value.find(t => t.path === filePath)
  if (tab) {
    tab.value = lastCheckpoint.content
    tab.dirty = true
    
    if (activePath.value === filePath && monacoInstance) {
      const position = monacoInstance.getPosition()
      monacoInstance.setValue(lastCheckpoint.content)
      if (position) {
        monacoInstance.setPosition(position)
      }
    }
    
    window.monarcoToast?.success('Checkpoint restaurado!')
    return true
  }
  
  return false
}

// Expor função de undo globalmente
window.monarcoUndo = undoLastChange

// ========================================
// LINT ERRORS DETECTION
// ========================================
// Detecta erros após edições da IA

async function checkForLintErrors(filePath) {
  if (!monacoInstance) return []
  
  const model = monacoInstance.getModel()
  if (!model) return []
  
  // Aguarda um pouco para o Monaco processar
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Obtém os marcadores (erros/warnings) do Monaco
  const markers = monaco.editor.getModelMarkers({ resource: model.uri })
  
  // Filtra apenas erros (não warnings)
  const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error)
  
  return errors.map(e => ({
    line: e.startLineNumber,
    column: e.startColumn,
    message: e.message,
    source: e.source || 'lint'
  }))
}

function formatLintErrors(errors) {
  if (!errors || errors.length === 0) return ''
  
  return errors.map(e => 
    `• Linha ${e.line}: ${e.message}`
  ).join('\n')
}

// ========================================
// INLINE DIFF PREVIEW NO EDITOR (Estilo Cursor)
// ========================================
// Mostra diff diretamente no editor com código antigo riscado e novo em verde
let diffDecorations = []  // Decorations atuais de diff
let diffViewZoneId = null  // ID da view zone com o novo código
let diffWidgetId = null  // ID do content widget com botões
const showInlineDiff = ref(false)  // Se está mostrando diff inline
const inlineDiffData = ref({  // Dados do diff inline
  originalCode: '',
  newCode: '',
  selection: null,
  filePath: ''
})

// Mostra preview do diff diretamente no Monaco (estilo Cursor)
function showDiffInEditor(selection, originalCode, newCode) {
  if (!monacoInstance) return
  
  const model = monacoInstance.getModel()
  if (!model) return
  
  // Limpa diff anterior se existir
  clearDiffDecorations()
  
  // Salva dados do diff
  inlineDiffData.value = {
    originalCode,
    newCode,
    selection,
    filePath: activePath.value
  }
  
  const decorations = []
  
  // 1. Marca o código original com fundo vermelho e texto riscado
  for (let i = selection.startLineNumber; i <= selection.endLineNumber; i++) {
    decorations.push({
      range: new monaco.Range(i, 1, i, model.getLineMaxColumn(i)),
      options: {
        isWholeLine: true,
        className: 'diff-line-removed',
        glyphMarginClassName: 'diff-glyph-minus',
        overviewRuler: {
          color: 'rgba(248, 81, 73, 0.6)',
          position: monaco.editor.OverviewRulerLane.Left
        }
      }
    })
  }
  
  // Aplica decorations do código removido
  diffDecorations = monacoInstance.deltaDecorations(diffDecorations, decorations)
  
  // 2. Adiciona View Zone com o novo código (abaixo da seleção)
  const newLines = newCode.split('\n')
  const lineHeight = monacoInstance.getOption(monaco.editor.EditorOption.lineHeight)
  
  // Expor funções globalmente ANTES de criar os botões
  window.monarcoAcceptDiff = () => acceptInlineDiff()
  window.monarcoRejectDiff = () => rejectInlineDiff()
  
  monacoInstance.changeViewZones((accessor) => {
    // Cria o DOM element para a view zone
    const domNode = document.createElement('div')
    domNode.className = 'diff-view-zone-container'
    domNode.style.cssText = 'width: 100%; background: rgba(46, 160, 67, 0.1); border-left: 3px solid #3fb950;'
    
    // Header com botões de ação
    const headerDiv = document.createElement('div')
    headerDiv.className = 'diff-zone-header'
    headerDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(46, 160, 67, 0.2); border-bottom: 1px solid rgba(46, 160, 67, 0.3);'
    
    const labelSpan = document.createElement('span')
    labelSpan.className = 'diff-zone-label'
    labelSpan.style.cssText = 'font-size: 12px; font-weight: 600; color: #3fb950;'
    labelSpan.textContent = '✨ Código sugerido pela IA'
    headerDiv.appendChild(labelSpan)
    
    const actionsDiv = document.createElement('div')
    actionsDiv.className = 'diff-zone-actions'
    actionsDiv.style.cssText = 'display: flex; gap: 8px;'
    
    // Botão Rejeitar
    const rejectBtn = document.createElement('button')
    rejectBtn.className = 'diff-zone-btn diff-zone-reject'
    rejectBtn.style.cssText = 'padding: 6px 14px; border: 1px solid rgba(248, 81, 73, 0.4); border-radius: 4px; background: rgba(248, 81, 73, 0.15); color: #f85149; font-size: 12px; font-weight: 500; cursor: pointer;'
    rejectBtn.textContent = '✕ Rejeitar (Esc)'
    rejectBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      rejectInlineDiff()
    })
    actionsDiv.appendChild(rejectBtn)
    
    // Botão Aceitar
    const acceptBtn = document.createElement('button')
    acceptBtn.className = 'diff-zone-btn diff-zone-accept'
    acceptBtn.style.cssText = 'padding: 6px 14px; border: none; border-radius: 4px; background: #238636; color: white; font-size: 12px; font-weight: 500; cursor: pointer;'
    acceptBtn.textContent = '✓ Aceitar (Enter)'
    acceptBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      acceptInlineDiff()
    })
    actionsDiv.appendChild(acceptBtn)
    
    headerDiv.appendChild(actionsDiv)
    domNode.appendChild(headerDiv)
    
    // Container do código
    const codeDiv = document.createElement('div')
    codeDiv.className = 'diff-zone-code'
    codeDiv.style.cssText = 'font-family: monospace; font-size: 13px; line-height: 20px;'
    
    // Renderiza cada linha com número
    newLines.forEach((line, idx) => {
      const lineDiv = document.createElement('div')
      lineDiv.className = 'diff-zone-line'
      lineDiv.style.cssText = 'display: flex; align-items: center; padding: 0 12px; min-height: 20px;'
      
      const lineNumSpan = document.createElement('span')
      lineNumSpan.className = 'diff-zone-line-num'
      lineNumSpan.style.cssText = 'width: 40px; text-align: right; padding-right: 12px; color: rgba(255,255,255,0.4); font-size: 12px;'
      lineNumSpan.textContent = String(selection.startLineNumber + idx)
      
      const plusSpan = document.createElement('span')
      plusSpan.className = 'diff-zone-plus'
      plusSpan.style.cssText = 'width: 20px; color: #3fb950; font-weight: bold;'
      plusSpan.textContent = '+'
      
      const lineContentSpan = document.createElement('span')
      lineContentSpan.className = 'diff-zone-line-content'
      lineContentSpan.style.cssText = 'flex: 1; color: #e6edf3; white-space: pre;'
      lineContentSpan.textContent = line || ' '
      
      lineDiv.appendChild(lineNumSpan)
      lineDiv.appendChild(plusSpan)
      lineDiv.appendChild(lineContentSpan)
      codeDiv.appendChild(lineDiv)
    })
    
    domNode.appendChild(codeDiv)
    
    // Calcula altura da view zone (mínimo 100px)
    const zoneHeight = Math.max((newLines.length * 20) + 50, 100)
    
    console.log('[Diff] Criando View Zone:', { 
      afterLine: selection.endLineNumber, 
      height: zoneHeight,
      lines: newLines.length 
    })
    
    diffViewZoneId = accessor.addZone({
      afterLineNumber: selection.endLineNumber,
      heightInPx: zoneHeight,
      domNode: domNode,
      suppressMouseDown: false
    })
    
    console.log('[Diff] View Zone criada com ID:', diffViewZoneId)
  })
  
  showInlineDiff.value = true
  
  // Scroll para mostrar o diff
  monacoInstance.revealLineInCenter(selection.startLineNumber)
}

// Limpa todas as decorations e view zones de diff
function clearDiffDecorations() {
  if (!monacoInstance) return
  
  // Limpa decorations
  if (diffDecorations.length > 0) {
    diffDecorations = monacoInstance.deltaDecorations(diffDecorations, [])
  }
  
  // Remove view zone
  if (diffViewZoneId !== null) {
    monacoInstance.changeViewZones((accessor) => {
      accessor.removeZone(diffViewZoneId)
    })
    diffViewZoneId = null
  }
  
  showInlineDiff.value = false
  inlineDiffData.value = {
    originalCode: '',
    newCode: '',
    selection: null,
    filePath: ''
  }
}

// Aceita as mudanças do diff inline
async function acceptInlineDiff() {
  if (!monacoInstance || !inlineDiffData.value.selection) return
  
  const { selection, newCode, filePath } = inlineDiffData.value
  const model = monacoInstance.getModel()
  
  if (model) {
    // Salvar checkpoint antes da edição
    const originalContent = model.getValue()
    saveCheckpoint(filePath, originalContent)
    
    // Aplicar a mudança
    monacoInstance.executeEdits('ai-inline-diff', [{
      range: new monaco.Range(
        selection.startLineNumber,
        selection.startColumn,
        selection.endLineNumber,
        selection.endColumn
      ),
      text: newCode,
      forceMoveMarkers: true
    }])
    
    // Marcar arquivo como modificado
    if (activeTab.value) {
      activeTab.value.dirty = true
    }
    
    window.monarcoToast?.success('Alterações aplicadas! (Ctrl+Z para desfazer)')
    
    // Verificar erros de lint
    const errors = await checkForLintErrors(filePath)
    if (errors.length > 0) {
      window.monarcoToast?.warning(`${errors.length} erro(s) detectado(s)`)
    }
  }
  
  // Limpar decorations
  clearDiffDecorations()
}

// Rejeita as mudanças do diff inline
function rejectInlineDiff() {
  clearDiffDecorations()
  window.monarcoToast?.info('Alterações rejeitadas')
}

const commandPaletteCommands = computed(() => [
  // File commands
  { id: 'file.new', label: 'Novo Arquivo', icon: '📄', category: 'file', keybinding: 'Ctrl+N', action: () => createNewFile() },
  { id: 'file.newFolder', label: 'Nova Pasta', icon: '📁', category: 'file', action: () => createNewFolder() },
  { id: 'file.save', label: 'Salvar', icon: '💾', category: 'file', keybinding: 'Ctrl+S', action: () => saveActive() },
  { id: 'file.saveAll', label: 'Salvar Tudo', icon: '💾', category: 'file', keybinding: 'Ctrl+K S', action: () => saveAll() },
  
  // Edit commands
  { id: 'edit.find', label: 'Buscar no Arquivo', icon: '🔍', category: 'edit', keybinding: 'Ctrl+F', action: () => triggerFindInMonaco() },
  
  // View commands
  { id: 'view.explorer', label: 'Mostrar Explorer', icon: '📂', category: 'view', keybinding: 'Ctrl+Shift+E', action: () => activeView.value = 'explorer' },
  { id: 'view.search', label: 'Mostrar Busca', icon: '🔍', category: 'view', keybinding: 'Ctrl+Shift+F', action: () => activeView.value = 'search' },
  { id: 'view.git', label: 'Mostrar Git', icon: '🌿', category: 'view', action: () => activeView.value = 'git' },
  { id: 'view.resources', label: 'Mostrar Recursos Retro', icon: '🖼️', category: 'view', action: () => activeView.value = 'resources' },
  { id: 'view.help', label: 'Abrir Ajuda SGDK (F1)', icon: '❓', category: 'view', action: () => { if (isRetroProject.value) showHelpViewer.value = true } },
  { id: 'view.terminal', label: 'Abrir Terminal', icon: '💻', category: 'view', keybinding: 'Ctrl+`', action: () => openTerminal() },
  { id: 'view.aiChat', label: 'Abrir Chat IA', icon: '🤖', category: 'view', action: () => openAIChat() },
  
  // Git commands
  { id: 'git.commit', label: 'Git: Commit', icon: '✔️', category: 'git', description: 'Criar commit com mudanças staged', action: () => gitCommit() },
  { id: 'git.push', label: 'Git: Push', icon: '⬆️', category: 'git', description: 'Enviar commits para o remote', action: () => gitPush() },
  { id: 'git.pull', label: 'Git: Pull', icon: '⬇️', category: 'git', description: 'Baixar mudanças do remote', action: () => gitPull() },
  { id: 'git.refresh', label: 'Git: Atualizar Status', icon: '🔄', category: 'git', action: () => loadGitStatus() },
  
  // Settings
  { id: 'settings.open', label: 'Abrir Configurações', icon: '⚙️', category: 'settings', action: () => openSettings() },
  
  // Window
  { id: 'window.reload', label: 'Recarregar Janela', icon: '🔄', category: 'window', action: () => location.reload() },
  
  // AI commands
  { id: 'ai.undoCheckpoint', label: 'AI: Desfazer Última Edição', icon: '↩️', category: 'ai', description: 'Restaurar checkpoint anterior', action: () => undoLastChange(activePath.value) },
  { id: 'ai.toggleAutocomplete', label: 'AI: Toggle Autocomplete', icon: '✨', category: 'ai', action: () => toggleAutocomplete() },
])

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

// Grid template columns computed
const gridTemplateColumns = computed(() => {
  if (isAIChatOpen.value) {
    return `36px ${sidebarWidth.value}px 4px 1fr 4px ${aiChatWidth.value}px`
  }
  return `36px ${sidebarWidth.value}px 4px 1fr`
})

// Color Palette state
const showColorPalette = ref(false)
const colorPaletteRef = ref(null)
const pickedColor = ref(null)

function toggleColorPalette() {
  showColorPalette.value = !showColorPalette.value
}

function activateEyedropper() {
  if (colorPaletteRef.value) {
    colorPaletteRef.value.activateEyedropper()
  }
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
  if (window.monarco?.ai?.autocomplete) {
    window.monarco.ai.autocomplete.setEnabled(autocompleteEnabled.value)
  }
  
  // Notifica o usuário
  if (window.monarcoToast) {
    if (autocompleteEnabled.value) {
      window.monarcoToast.success('AI Autocomplete ativado')
    } else {
      window.monarcoToast.info('AI Autocomplete desativado')
    }
  }
}

async function refreshTree() {
  if (!workspacePath.value) return
  lastError.value = null
  try {
    const selectedPath = selectedNode.value?.path ?? null
    tree.value = await window.monarco.listWorkspaceTree()
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
  await window.monarco?.retro?.openExternalEditor?.(retroUiSettings.value.imageEditorPath, n.path)
}

async function onContextMenuEditExternalMap() {
  const n = contextMenu.value.node
  closeContextMenu()
  if (!n?.path || !retroUiSettings.value?.mapEditorPath) return
  await window.monarco?.retro?.openExternalEditor?.(retroUiSettings.value.mapEditorPath, n.path)
}

function getSelectedDirPath() {
  if (!selectedNode.value) return workspacePath.value
  if (selectedNode.value.kind === 'dir') return selectedNode.value.path
  return selectedNode.value.path.split('/').slice(0, -1).join('/') || workspacePath.value
}

function isSameOrInside(targetPath, basePath) {
  if (targetPath === basePath) return true
  const prefix = basePath.endsWith('/') ? basePath : basePath + '/'
  return targetPath.startsWith(prefix)
}

async function createNewFile() {
  const parentDir = getSelectedDirPath()
  if (!parentDir) return

  crudDialogOpen.value = true
  crudDialogMode.value = 'newFile'
  crudDialogTitle.value = 'New file'
  crudDialogLabel.value = 'File name'
  crudDialogValue.value = ''
  crudDialogTargetPath.value = parentDir
  crudDialogTargetKind.value = 'dir'
}

async function createNewFolder() {
  const parentDir = getSelectedDirPath()
  if (!parentDir) return

  crudDialogOpen.value = true
  crudDialogMode.value = 'newFolder'
  crudDialogTitle.value = 'New folder'
  crudDialogLabel.value = 'Folder name'
  crudDialogValue.value = ''
  crudDialogTargetPath.value = parentDir
  crudDialogTargetKind.value = 'dir'
}

async function renameSelected() {
  if (!selectedNode.value || selectedNode.value.path === workspacePath.value) return
  const currentName = selectedNode.value.name

  crudDialogOpen.value = true
  crudDialogMode.value = 'rename'
  crudDialogTitle.value = 'Rename'
  crudDialogLabel.value = 'New name'
  crudDialogValue.value = currentName
  crudDialogTargetPath.value = selectedNode.value.path
  crudDialogTargetKind.value = selectedNode.value.kind
}

async function deleteSelected() {
  if (!selectedNode.value || selectedNode.value.path === workspacePath.value) return

  crudDialogOpen.value = true
  crudDialogMode.value = 'delete'
  crudDialogTitle.value = 'Delete'
  crudDialogLabel.value = `Delete ${selectedNode.value.kind === 'dir' ? 'folder' : 'file'}: ${selectedNode.value.name}?`
  crudDialogValue.value = ''
  crudDialogTargetPath.value = selectedNode.value.path
  crudDialogTargetKind.value = selectedNode.value.kind
}

function closeCrudDialog() {
  crudDialogOpen.value = false
  crudDialogMode.value = null
  crudDialogTitle.value = ''
  crudDialogLabel.value = ''
  crudDialogValue.value = ''
  crudDialogTargetPath.value = null
  crudDialogTargetKind.value = null
}

async function handleCrudConfirm(value) {
  crudDialogValue.value = value
  await confirmCrudDialog()
}

async function confirmCrudDialog() {
  if (!crudDialogMode.value) return
  lastError.value = null

  try {
    if (crudDialogMode.value === 'newFile') {
      const parentDir = crudDialogTargetPath.value
      if (!parentDir) throw new Error('No target directory')
      const name = crudDialogValue.value.trim()
      if (!name) throw new Error('Name is required')
      const newPath = await window.monarco.createFile(parentDir, name)
      closeCrudDialog()
      await refreshTree()
      await openFile(newPath)
      return
    }

    if (crudDialogMode.value === 'newFolder') {
      const parentDir = crudDialogTargetPath.value
      if (!parentDir) throw new Error('No target directory')
      const name = crudDialogValue.value.trim()
      if (!name) throw new Error('Name is required')
      await window.monarco.createFolder(parentDir, name)
      closeCrudDialog()
      await refreshTree()
      return
    }

    if (crudDialogMode.value === 'rename') {
      const oldPath = crudDialogTargetPath.value
      if (!oldPath) throw new Error('No target path')
      const newName = crudDialogValue.value.trim()
      if (!newName) throw new Error('Name is required')
      const newPath = await window.monarco.renamePath(oldPath, newName)

      for (const t of tabs.value) {
        if (isSameOrInside(t.path, oldPath)) {
          t.path = newPath + t.path.slice(oldPath.length)
          if (t.path === newPath) t.name = newName
        }
      }
      if (activePath.value && isSameOrInside(activePath.value, oldPath)) {
        activePath.value = newPath + activePath.value.slice(oldPath.length)
      }

      closeCrudDialog()
      await refreshTree()
      return
    }

    if (crudDialogMode.value === 'delete') {
      const targetPath = crudDialogTargetPath.value
      if (!targetPath) throw new Error('No target path')
      await window.monarco.deletePath(targetPath)

      const remainingTabs = tabs.value.filter((t) => !isSameOrInside(t.path, targetPath))
      tabs.value.splice(0, tabs.value.length, ...remainingTabs)
      if (activePath.value && isSameOrInside(activePath.value, targetPath)) activePath.value = tabs.value[0]?.path ?? null

      closeCrudDialog()
      await refreshTree()
      selectedNode.value = tree.value
      return
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('confirmCrudDialog failed', e)
    lastError.value = msg
  }
}

const workspacePath = ref(null)

// Retro Studio
const showNewRetroProjectModal = ref(false)
const isRetroCompiling = ref(false)
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
  window.monarco.windowMinimize()
}

function winToggleMaximize() {
  window.monarco.windowToggleMaximize()
  setTimeout(() => refreshIsMaximized(), 100) // Delay to allow state update
}

function winClose() {
  window.monarco.windowClose()
}

function refreshIsMaximized() {
  window.monarco.windowIsMaximized().then((maximized) => {
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
    window.monarcoToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
    openSettings()
    return
  }
  isRetroCompiling.value = true
  runGame()
}

function handleStopRetro() {
  stopBuild()
  isRetroCompiling.value = false
}

async function handleBuildRetro() {
  if (!retroUiSettings.value?.toolkitPath) {
    window.monarcoToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
    openSettings()
    return
  }
  compilationErrors.value = []
  isRetroCompiling.value = true
  buildOnly()
}

async function loadEmulators() {
  const api = window.monarco?.retro
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
  const api = window.monarco?.retro
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
  window.monarcoToast?.success?.('Projeto Retro Studio criado e aberto')
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
      pickWorkspace()
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
        if (!window.monarco?.ai?.autocomplete?.complete) {
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
          const result = await window.monarco.ai.autocomplete.complete({
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
      window.dispatchEvent(new CustomEvent('monarco:ctrlk', {
        detail: {
          selection: range,
          text: selectedText,
          position: position,
          filePath: window.monarcoEditor?.getCurrentFile?.() || ''
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
      window.dispatchEvent(new CustomEvent('monarco:toggle-ai-chat'))
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

const crudDialogOpen = ref(false)
const crudDialogMode = ref(null)
const crudDialogTitle = ref('')
const crudDialogLabel = ref('')
const crudDialogValue = ref('')
const crudDialogTargetPath = ref(null)
const crudDialogTargetKind = ref(null)

const settingsDialogOpen = ref(false)
const settingsDraft = ref({ fontSize: 14, wordWrap: 'off', tabSize: 2 })
const uiSettingsDraft = ref({ windowControlsPosition: 'left' })
const editorSettings = ref({ fontSize: 14, wordWrap: 'off', tabSize: 2, minimap: true, lineNumbers: 'on' })
const uiSettings = ref({ windowControlsPosition: 'left', theme: 'dark' })
const terminalSettings = ref({ fontSize: 13, fontFamily: 'monospace', cursorBlink: true, cursorStyle: 'block' })

const editorOptions = computed(() => ({
  fontSize: editorSettings.value.fontSize,
  wordWrap: editorSettings.value.wordWrap === 'on',
  tabSize: editorSettings.value.tabSize,
  minimap: { enabled: editorSettings.value.minimap !== false },
  lineNumbers: editorSettings.value.lineNumbers || 'on',
  // Recursos avançados
  suggestOnTriggerCharacters: true,
  inlineSuggest: { enabled: true },
  quickSuggestions: {
    other: true,
    comments: false,
    strings: true
  },
  wordBasedSuggestions: 'currentDocument',
  wordBasedSuggestionsOnlySameLanguage: true,
  formatOnPaste: true,
  formatOnType: true,
  autoClosingBrackets: 'always',
  autoClosingQuotes: 'always',
  autoSurround: 'languageDefined',
  bracketPairColorization: { enabled: true },
  guides: {
    bracketPairs: true,
    indentation: true
  },
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
  mouseWheelZoom: true,
  multiCursorModifier: 'ctrlCmd',
  snippetSuggestions: 'top',
  suggest: {
    showKeywords: true,
    showSnippets: true,
    showClasses: true,
    showFunctions: true,
    showVariables: true,
    showModules: true,
    showProperties: true,
    showMethods: true,
    showWords: true,
    insertMode: 'insert',
    filterGraceful: true,
    localityBonus: true
  },
  acceptSuggestionOnEnter: 'on',
  tabCompletion: 'on',
  folding: true,
  foldingStrategy: 'indentation',
  showFoldingControls: 'always',
  unfoldOnClickAfterEndOfLine: true,
  matchBrackets: 'always',
  renderWhitespace: 'selection',
  renderLineHighlight: 'all',
  scrollBeyondLastLine: false,
  automaticLayout: true
}))

async function loadSettings() {
  try {
    if (!window.monarco?.settings) return
    const settings = await window.monarco.settings.load()
    
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
    if (!window.monarco?.settings) return
    const base = {
      editor: { ...editorSettings.value },
      appearance: { ...uiSettings.value },
      terminal: { ...terminalSettings.value },
      panels: {
        aiChat: { open: isAIChatOpen.value, width: aiChatWidth.value },
        terminal: { open: isTerminalOpen.value, height: terminalHeight.value },
        sidebar: { width: sidebarWidth.value }
      }
    }
    const ai = override.ai
    const payload = { ...base, ...override }
    if (ai) {
      payload.ai = {
        provider: ai.provider,
        apiKey: ai.apiKey,
        endpoint: ai.apiUrl ?? ai.endpoint,
        model: ai.model,
        temperature: ai.temperature,
        maxTokens: ai.maxTokens
      }
    }
    await window.monarco.settings.save(payload)
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

function onActivityBarSelect(id) {
  activeView.value = id
  if (id === 'git') loadGitStatus()
}

async function openTilemapEditorFromBar() {
  const path = projectConfig?.value?.path ?? workspacePath?.value ?? ''
  if (!path) return
  let assets = []
  try {
    const config = await window.monarco?.retro?.getProjectConfig?.(path)
    assets = config?.assets || []
  } catch (_) {}
  window.monarco?.openTilemapEditor?.({ asset: null, projectPath: path, assets })
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
  if (settings.ai && window.monarco?.ai?.updateSettings) {
    await window.monarco.ai.updateSettings({
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

function languageForPath(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript'
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return 'typescript'
  }
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c'
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

async function openWorkspace(path) {
  if (!path) return
  
  lastError.value = null
  try {
    const openedPath = await window.monarco.workspace.openRecent(path)
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
      window.monarcoToast?.success(`Workspace aberto: ${folderName}`, { duration: 2000 })
    }
  } catch (e) {
    console.error('Failed to open workspace:', e)
    window.monarcoToast?.error(`Erro ao abrir workspace: ${e.message}`)
  }
}

async function pickWorkspace() {
  lastError.value = null
  try {
    const selected = await window.monarco.selectWorkspace()
    if (selected) {
      await openWorkspace(selected)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('pickWorkspace failed', e)
    lastError.value = msg
  }
}

async function openFile(filePath) {
  lastError.value = null
  try {
    const existing = tabs.value.find((t) => t.path === filePath)
    if (existing) {
      activePath.value = existing.path
      return
    }

    const contents = await window.monarco.readTextFile(filePath)
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('openFile failed', filePath, e)
    lastError.value = msg
  }
}

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
    const results = await window.monarco.searchFiles(searchQuery.value, {
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
      window.monarcoToast?.success(`${results.length} resultado${results.length > 1 ? 's' : ''} encontrado${results.length > 1 ? 's' : ''}`, { duration: 2000 })
    } else {
      window.monarcoToast?.info('Nenhum resultado encontrado')
    }
  } catch (e) {
    console.error('Search failed', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro na busca', { description: e.message })
  } finally {
    isSearching.value = false
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

// Git functions
async function loadGitStatus() {
  if (!workspacePath.value) return
  
  isLoadingGit.value = true
  try {
    isGitRepo.value = await window.monarco.git.isRepository()
    
    if (isGitRepo.value) {
      const [status, branch] = await Promise.all([
        window.monarco.git.status(),
        window.monarco.git.currentBranch()
      ])
      gitStatus.value = status
      gitBranch.value = branch
    }
  } catch (e) {
    console.error('Failed to load git status', e)
  } finally {
    isLoadingGit.value = false
  }
}

async function gitStageFile(filePath) {
  try {
    await window.monarco.git.stage(filePath)
    await loadGitStatus()
  } catch (e) {
    console.error('Failed to stage file', e)
    lastError.value = e.message
  }
}

async function gitUnstageFile(filePath) {
  try {
    await window.monarco.git.unstage(filePath)
    await loadGitStatus()
  } catch (e) {
    console.error('Failed to unstage file', e)
    lastError.value = e.message
  }
}

async function gitDiscardFile(filePath) {
  if (!confirm(`Discard changes in ${filePath}?`)) return
  
  try {
    await window.monarco.git.discard(filePath)
    await loadGitStatus()
    await refreshTree()
  } catch (e) {
    console.error('Failed to discard file', e)
    lastError.value = e.message
  }
}

async function gitCommit() {
  if (!gitCommitMessage.value.trim()) {
    window.monarcoToast?.warning('Por favor, insira uma mensagem de commit')
    return
  }
  
  try {
    await window.monarco.git.commit(gitCommitMessage.value)
    gitCommitMessage.value = ''
    await loadGitStatus()
    window.monarcoToast?.success('Commit realizado com sucesso!')
  } catch (e) {
    console.error('Failed to commit', e)
    
    // Verifica se o erro é de configuração Git
    if (e.message.includes('não está configurado') || e.message.includes('user.name') || e.message.includes('user.email')) {
      const userName = prompt('Configure o Git:\n\nDigite seu nome:')
      if (!userName) return
      
      const userEmail = prompt('Digite seu email:')
      if (!userEmail) return
      
      try {
        await window.monarco.git.config('user.name', userName)
        await window.monarco.git.config('user.email', userEmail)
        
        // Tenta commit novamente
        await window.monarco.git.commit(gitCommitMessage.value)
        gitCommitMessage.value = ''
        await loadGitStatus()
        window.monarcoToast?.success('Git configurado e commit realizado!', { duration: 4000 })
      } catch (configError) {
        console.error('Failed to configure git', configError)
        lastError.value = configError.message
        window.monarcoToast?.error('Erro ao configurar Git', { description: configError.message })
      }
    } else {
      lastError.value = e.message
      window.monarcoToast?.error('Erro ao fazer commit', { description: e.message })
    }
  }
}

async function gitInitRepo() {
  try {
    await window.monarco.git.init()
    await loadGitStatus()
  } catch (e) {
    console.error('Failed to init git', e)
    lastError.value = e.message
  }
}

async function gitPull() {
  isLoadingGit.value = true
  try {
    const result = await window.monarco.git.pull()
    await loadGitStatus()
    window.monarcoToast?.success('Pull realizado com sucesso!', { description: result.message, duration: 4000 })
  } catch (e) {
    console.error('Failed to pull', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro ao fazer pull', { description: e.message })
  } finally {
    isLoadingGit.value = false
  }
}

async function gitPush() {
  isLoadingGit.value = true
  try {
    const result = await window.monarco.git.push()
    await loadGitStatus()
    window.monarcoToast?.success('Push realizado com sucesso!', { description: result.message, duration: 4000 })
  } catch (e) {
    console.error('Failed to push', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro ao fazer push', { description: e.message })
  } finally {
    isLoadingGit.value = false
  }
}

async function loadGitBranches() {
  try {
    const branches = await window.monarco.git.branches()
    gitBranches.value = branches
  } catch (e) {
    console.error('Failed to load branches', e)
    lastError.value = e.message
  }
}

async function gitCheckout(branchName) {
  if (!confirm(`Trocar para a branch "${branchName}"?`)) return
  
  isLoadingGit.value = true
  try {
    await window.monarco.git.checkout(branchName)
    await Promise.all([loadGitStatus(), loadGitBranches()])
    await refreshTree()
    window.monarcoToast?.success(`Branch trocada para "${branchName}"`)
  } catch (e) {
    console.error('Failed to checkout branch', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro ao trocar de branch', { description: e.message })
  } finally {
    isLoadingGit.value = false
  }
}

async function gitCreateBranch() {
  const name = newBranchName.value.trim()
  if (!name) {
    window.monarcoToast?.warning('Por favor, insira um nome para a branch')
    return
  }
  
  isLoadingGit.value = true
  try {
    await window.monarco.git.createBranch(name)
    await Promise.all([loadGitStatus(), loadGitBranches()])
    newBranchName.value = ''
    showBranchDialog.value = false
    window.monarcoToast?.success(`Branch "${name}" criada com sucesso!`)
  } catch (e) {
    console.error('Failed to create branch', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro ao criar branch', { description: e.message })
  } finally {
    isLoadingGit.value = false
  }
}

async function gitDeleteBranch(branchName) {
  if (!confirm(`Deletar a branch "${branchName}"?\n\nATENÇÃO: Esta ação não pode ser desfeita!`)) return
  
  isLoadingGit.value = true
  try {
    await window.monarco.git.deleteBranch(branchName)
    await Promise.all([loadGitStatus(), loadGitBranches()])
    window.monarcoToast?.success(`Branch "${branchName}" deletada com sucesso!`)
  } catch (e) {
    console.error('Failed to delete branch', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro ao deletar branch', { description: e.message })
  } finally {
    isLoadingGit.value = false
  }
}

function toggleBranchesPanel() {
  showBranchesPanel.value = !showBranchesPanel.value
  if (showBranchesPanel.value && gitBranches.value.length === 0) {
    loadGitBranches()
  }
}

function openBranchDialog() {
  newBranchName.value = ''
  showBranchDialog.value = true
}

function closeBranchDialog() {
  showBranchDialog.value = false
  newBranchName.value = ''
}

async function loadGitCommits(reset = false) {
  if (reset) {
    gitCommits.value = []
  }
  
  isLoadingCommits.value = true
  try {
    const skip = reset ? 0 : gitCommits.value.length
    const commits = await window.monarco.git.log({ limit: 20, skip })
    
    if (reset) {
      gitCommits.value = commits
    } else {
      gitCommits.value = [...gitCommits.value, ...commits]
    }
  } catch (e) {
    console.error('Failed to load commits', e)
    lastError.value = e.message
  } finally {
    isLoadingCommits.value = false
  }
}

function toggleCommitsPanel() {
  showCommitsPanel.value = !showCommitsPanel.value
  if (showCommitsPanel.value && gitCommits.value.length === 0) {
    loadGitCommits(true)
  }
}

function formatCommitDate(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

async function showFileDiff(filePath, staged = false) {
  try {
    const diff = await window.monarco.git.diff(filePath, staged)
    
    if (!diff) {
      window.monarcoToast?.info('Sem mudanças para exibir')
      return
    }
    
    diffFilePath.value = filePath
    diffStaged.value = staged
    diffContent.value = diff
    showDiffModal.value = true
  } catch (e) {
    console.error('Failed to get diff', e)
    lastError.value = e.message
    window.monarcoToast?.error('Erro ao carregar diff', { description: e.message })
  }
}

function closeDiffModal() {
  showDiffModal.value = false
  diffContent.value = ''
  diffFilePath.value = ''
  diffStaged.value = false
}

const parsedDiff = computed(() => {
  if (!diffContent.value) return []
  
  const lines = diffContent.value.split('\n')
  const result = []
  
  for (const line of lines) {
    let type = 'normal'
    if (line.startsWith('+++') || line.startsWith('---')) {
      type = 'header'
    } else if (line.startsWith('@@')) {
      type = 'hunk'
    } else if (line.startsWith('+')) {
      type = 'add'
    } else if (line.startsWith('-')) {
      type = 'delete'
    } else if (line.startsWith('diff --git')) {
      type = 'file'
    }
    
    result.push({ text: line, type })
  }
  
  return result
})

const stagedFiles = computed(() => gitStatus.value.filter(f => f.staged))
const unstagedFiles = computed(() => gitStatus.value.filter(f => f.unstaged && !f.staged))

function getGitStatusIcon(status) {
  switch (status) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return 'U'
    case 'conflict': return 'C'
    default: return '?'
  }
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
      await window.monarco.writeTextFile(tab.path, tab.value)
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
    await window.monarco.writeTextFile(activeTab.value.path, activeTab.value.value)
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
      await window.monarco.writeTextFile(t.path, t.value)
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

// ========================================
// CTRL+K - Edição Inline com IA
// ========================================

function handleCtrlKEvent(event) {
  const { selection, text, position, filePath } = event.detail
  
  ctrlKSelection.value = selection
  ctrlKText.value = text
  ctrlKPosition.value = position
  ctrlKFilePath.value = filePath
  ctrlKInput.value = ''
  ctrlKShowPreview.value = false
  ctrlKPreviewCode.value = ''
  
  // Calcular posição do widget inline (logo abaixo da seleção)
  if (monacoInstance && ctrlKInlineMode.value) {
    try {
      // Pega a posição do final da seleção
      const endPosition = {
        lineNumber: selection.endLineNumber,
        column: selection.startColumn
      }
      
      // Converte para coordenadas de tela
      const coords = monacoInstance.getScrolledVisiblePosition(endPosition)
      const editorDom = monacoInstance.getDomNode()
      
      if (coords && editorDom) {
        const editorRect = editorDom.getBoundingClientRect()
        const lineHeight = monacoInstance.getOption(monaco.editor.EditorOption.lineHeight)
        
        ctrlKWidgetPosition.value = {
          top: editorRect.top + coords.top + lineHeight + 4,
          left: editorRect.left + coords.left
        }
      }
    } catch (e) {
      console.error('Erro ao calcular posição do widget:', e)
      // Fallback para posição central
      ctrlKInlineMode.value = false
    }
  }
  
  showCtrlKPopup.value = true
  
  // Focar no input após o popup aparecer
  nextTick(() => {
    ctrlKInputRef.value?.focus()
  })
}

function cancelCtrlK() {
  showCtrlKPopup.value = false
  ctrlKInput.value = ''
  ctrlKLoading.value = false
  ctrlKSelection.value = null
  ctrlKText.value = ''
  ctrlKPreviewCode.value = ''
  ctrlKShowPreview.value = false
  
  // Retornar foco ao editor
  if (monacoInstance) {
    monacoInstance.focus()
  }
}

async function submitCtrlK() {
  if (!ctrlKInput.value.trim() || ctrlKLoading.value) return
  
  ctrlKLoading.value = true
  
  try {
    const instruction = ctrlKInput.value.trim()
    const selectedCode = ctrlKText.value
    const filePath = ctrlKFilePath.value
    const selection = ctrlKSelection.value
    
    // Prompt especial para edição inline
    const message = `Edit the following code according to this instruction: "${instruction}"

IMPORTANT: Return ONLY the modified code. No explanations, no markdown code blocks, no comments about the changes. Just the raw code that should replace the selection.

Code to edit:
${selectedCode}`
    
    // Enviar para a IA (modo simples, sem tools)
    const result = await window.monarco.ai.chat(message, { useTools: false })
    
    if (result.content) {
      // Limpar possíveis markdown code blocks da resposta
      let newCode = result.content.trim()
      
      // Remover markdown code blocks se existirem
      const codeBlockMatch = newCode.match(/^```\w*\n?([\s\S]*?)\n?```$/)
      if (codeBlockMatch) {
        newCode = codeBlockMatch[1]
      }
      
      // Salvar o código para preview
      ctrlKPreviewCode.value = newCode
      
      // Fechar o popup do Ctrl+K e mostrar diff inline no editor
      showCtrlKPopup.value = false
      
      // Mostrar diff diretamente no editor com decorations
      showDiffInEditor(selection, selectedCode, newCode)
      
      ctrlKLoading.value = false
    } else {
      window.monarcoToast?.error('A IA não retornou uma resposta válida')
      ctrlKLoading.value = false
    }
  } catch (error) {
    console.error('Erro ao processar Ctrl+K:', error)
    window.monarcoToast?.error('Erro ao processar: ' + error.message)
    ctrlKLoading.value = false
  }
}

// Aceitar as mudanças do Ctrl+K
async function acceptCtrlKChanges() {
  const selection = ctrlKSelection.value
  const newCode = ctrlKPreviewCode.value
  const filePath = ctrlKFilePath.value
  
  if (monacoInstance && selection && newCode) {
    const model = monacoInstance.getModel()
    if (model) {
      // Salvar checkpoint antes da edição
      const originalContent = model.getValue()
      saveCheckpoint(filePath, originalContent)
      
      // Criar a operação de edição
      monacoInstance.executeEdits('ai-inline-edit', [{
        range: selection,
        text: newCode,
        forceMoveMarkers: true
      }])
      
      // Marcar arquivo como modificado
      if (activeTab.value) {
        activeTab.value.dirty = true
      }
      
      window.monarcoToast?.success('Código editado com sucesso! (Ctrl+Z para desfazer)')
      
      // Verificar erros de lint após a edição
      const errors = await checkForLintErrors(filePath)
      if (errors.length > 0) {
        window.monarcoToast?.warning(`${errors.length} erro(s) detectado(s) após a edição`)
        console.log('Lint errors:', errors)
      }
    }
  }
  
  // Fechar o popup
  cancelCtrlK()
}

// Rejeitar as mudanças do Ctrl+K
function rejectCtrlKChanges() {
  ctrlKShowPreview.value = false
  ctrlKPreviewCode.value = ''
  // Voltar para o input para tentar novamente
  nextTick(() => {
    ctrlKInputRef.value?.focus()
  })
}

// Usar uma sugestão do Ctrl+K
function useCtrlKSuggestion(suggestion) {
  ctrlKInput.value = suggestion
  ctrlKInputRef.value?.focus()
}

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
  loadEmulators()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', updateCursorOffsetFromDom, true)
  window.addEventListener('mouseup', updateCursorOffsetFromDom, true)
  window.addEventListener('pointerdown', onGlobalPointerDown)
  
  // Listener para redimensionamento da janela
  window.addEventListener('resize', layoutMonaco)
  
  // Expor API do editor para o chat da IA
  window.monarcoEditor = {
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
  if (window.monarco?.onFileSystemChange) {
    window.monarco.onFileSystemChange(async (changeInfo) => {
      console.log('Filesystem changed:', changeInfo)
      
      // Atualiza FileTree
      await refreshTree()
      
      // Se o arquivo modificado está aberto, recarrega
      if (changeInfo.type === 'modified' && changeInfo.path) {
        const openTab = tabs.value.find(t => t.path === changeInfo.path)
        if (openTab && !openTab.dirty) {
          try {
            const content = await window.monarco.readTextFile(changeInfo.path)
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
  window.addEventListener('monarco:edit-tilemap', (e) => {
    const { asset, projectPath, assets } = e.detail || {}
    window.monarco?.openTilemapEditor?.({ asset, projectPath, assets: assets || [] })
  })

  // Listener para abertura de workspace via CLI (Abrir com...)
  if (window.monarco?.workspace?.onOpenFromCli) {
    window.monarco.workspace.onOpenFromCli((path) => {
      console.log('📂 [App] Recebido comando para abrir workspace via CLI:', path)
      openWorkspace(path)
    })
  }

  // Carrega o último workspace automaticamente
  try {
    const lastWorkspace = await window.monarco.workspace.getLast()
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
  window.addEventListener('monarco:ctrlk', handleCtrlKEvent)
  
  // Listener para Ctrl+L (toggle AI chat)
  window.addEventListener('monarco:toggle-ai-chat', toggleAIChat)

  // Retro Studio: carregar UI settings e listeners
  loadUiSettings()
  const unsubTerminal = window.monarco?.retro?.onTerminalData?.((data) => {
    terminalRef.value?.writeRetroData?.(data)
  })
  window.monarco?.retro?.onRunGameError?.(({ message }) => {
    isRetroCompiling.value = false
    window.monarcoToast?.error?.(message)
  })
  window.monarco?.retro?.onRunGameBuildComplete?.(() => {
    isRetroCompiling.value = false
  })
  window.monarco?.retro?.onBuildComplete?.(() => {
    isRetroCompiling.value = false
    compilationErrors.value = []
    window.monarcoToast?.success?.('Build concluído com sucesso')
  })
  window.monarco?.retro?.onCompilationErrors?.(({ errors }) => {
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
  window.removeEventListener('monarco:ctrlk', handleCtrlKEvent)
  window.removeEventListener('monarco:toggle-ai-chat', toggleAIChat)
  
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
      :show-terminal="isTerminalOpen"
      :show-ai-chat="isAIChatOpen"
      :show-cartridge="activeView === 'cartridge'"
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
      @open-map-editor="openTilemapEditorFromBar"
      @help="showHelpViewer = true"
      @command-palette="showCommandPalette = true"
      @toggle-terminal="toggleTerminal"
      @toggle-ai-chat="toggleAIChat"
      @search="activeView = 'search'"
      @toggle-cartridge="activeView = activeView === 'cartridge' ? 'resources' : 'cartridge'"
      @emulator-change="updateEmulator"
    />

    <div class="app" :style="{ gridTemplateColumns: gridTemplateColumns }">
    
    <!-- New Retro Project Modal -->
    <NewProjectModal
      :is-open="showNewRetroProjectModal"
      @close="showNewRetroProjectModal = false"
      @created="handleRetroProjectCreated"
    />

    <HelpViewer :show="showHelpViewer" @close="showHelpViewer = false" />

    <!-- Componente de Settings -->
    <Settings 
      v-if="settingsDialogOpen" 
      :is-open="settingsDialogOpen"
      @close="closeSettings"
      @save="handleSettingsSave"
    />

    <!-- Dialog CRUD (criar/renomear/deletar) -->
    <CrudDialog
      :is-open="crudDialogOpen"
      :mode="crudDialogMode"
      :title="crudDialogTitle"
      :label="crudDialogLabel"
      :initial-value="crudDialogValue"
      @confirm="handleCrudConfirm"
      @cancel="closeCrudDialog"
    />

    <!-- Dialog de confirmação para fechar aba -->
    <ConfirmDialog
      :is-open="closeConfirmOpen"
      title="Alterações não salvas"
      message="Este arquivo possui alterações não salvas. O que deseja fazer?"
      confirm-text="Salvar"
      cancel-text="Cancelar"
      discard-text="Descartar"
      :show-discard="true"
      @confirm="resolveCloseDecision('save')"
      @cancel="resolveCloseDecision('cancel')"
      @discard="resolveCloseDecision('discard')"
    />

    <!-- Dialog para criar nova branch -->
    <div v-if="showBranchDialog" class="dialog-overlay" @click="closeBranchDialog">
      <div class="dialog" @click.stop style="max-width: 400px;">
        <div class="dialog-header">
          <h3 style="margin: 0; font-size: 14px;">Create New Branch</h3>
          <button class="dialog-close" @click="closeBranchDialog" title="Close">×</button>
        </div>
        <div class="dialog-body" style="padding: 16px;">
          <label style="display: block; margin-bottom: 8px; font-size: 12px; font-weight: 500;">Branch name:</label>
          <input 
            v-model="newBranchName"
            type="text" 
            placeholder="e.g., feature/new-feature"
            @keyup.enter="gitCreateBranch"
            @keyup.esc="closeBranchDialog"
            style="width: 100%; padding: 8px; font-size: 13px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px;"
            autofocus
          />
        </div>
        <div class="dialog-footer" style="display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid var(--border);">
          <button @click="closeBranchDialog" style="padding: 6px 12px; font-size: 12px;">Cancel</button>
          <button 
            @click="gitCreateBranch" 
            :disabled="!newBranchName.trim()"
            style="padding: 6px 12px; font-size: 12px; background: var(--accent); color: white;"
          >
            Create
          </button>
        </div>
      </div>
    </div>

    <!-- Modal de Diff -->
    <div v-if="showDiffModal" class="dialog-overlay" @click="closeDiffModal">
      <div class="dialog" @click.stop style="max-width: 90vw; width: 1000px; max-height: 90vh;">
        <div class="dialog-header">
          <h3 style="margin: 0; font-size: 14px;">
            Diff: {{ diffFilePath }}
            <span style="margin-left: 8px; font-size: 11px; color: var(--muted);">
              ({{ diffStaged ? 'staged' : 'unstaged' }})
            </span>
          </h3>
          <button class="dialog-close" @click="closeDiffModal" title="Close">×</button>
        </div>
        <div class="dialog-body" style="padding: 0; overflow: auto;">
          <div class="diff-viewer">
            <div 
              v-for="(line, idx) in parsedDiff" 
              :key="idx"
              :class="['diff-line', 'diff-line-' + line.type]"
            >
              <pre style="margin: 0; padding: 4px 8px; font-size: 12px; font-family: 'Courier New', monospace; white-space: pre-wrap; word-wrap: break-word;">{{ line.text }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Activity Bar -->
    <ActivityBar
      :active-view="activeView"
      :items="activityBarItems"
      @select="onActivityBarSelect"
      @settings="openSettings"
    />

    <aside class="sidebar">
      <!-- Explorer View -->
      <div v-show="activeView === 'explorer'" class="sidebar-content">
        <div class="tree">
          <div class="treeArea" @contextmenu.prevent="openTreeContextMenu">
            <div v-if="!tree" class="emptyState">
              Select a folder to start.
            </div>
            <div v-else>
              <FileTree
                :node="tree"
                :selectedPath="selectedNode?.path ?? null"
                :expanded-map="expandedMap"
                @open="openFile"
                @select="onSelectNode"
                @toggle="toggleDir"
                @context="openContextMenu"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Resources View (Retro) -->
      <div v-show="activeView === 'resources'" class="sidebar-content">
        <div class="sidebarHeader">
          <h3 style="margin: 0; font-size: 13px; font-weight: 600;">RECURSOS</h3>
        </div>
        <ResourcesPanel
          :project-path="projectConfig?.path ?? workspacePath ?? ''"
          :image-editor-path="retroUiSettings?.imageEditorPath ?? ''"
          :map-editor-path="retroUiSettings?.mapEditorPath ?? ''"
        />
      </div>

      <!-- Cartridge Programmer View (Retro) -->
      <div v-show="activeView === 'cartridge'" class="sidebar-content">
        <div class="sidebarHeader">
          <h3 style="margin: 0; font-size: 13px; font-weight: 600;">CARTUCHO</h3>
        </div>
        <CartridgeProgrammer
          :project-path="projectConfig?.path ?? workspacePath ?? ''"
          :show="true"
          @close="activeView = 'resources'"
        />
      </div>

      <!-- Search View -->
      <div v-show="activeView === 'search'" class="sidebar-content">
        <div class="sidebarHeader">
          <h3 style="margin: 0; font-size: 13px; font-weight: 600;">SEARCH</h3>
        </div>
        <div class="search-panel">
          <div class="search-input-container">
            <input 
              v-model="searchQuery"
              type="text" 
              placeholder="Search in workspace..." 
              class="search-input"
              @keyup.enter="performSearch"
            />
            <button 
              class="search-btn" 
              title="Search"
              @click="performSearch"
              :disabled="!searchQuery.trim() || isSearching"
            >
              <span v-if="isSearching">⏳</span>
              <span v-else class="icon-magnifying-glass"></span>
            </button>
          </div>
          
          <!-- Opções de busca -->
          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 0 4px;">
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;">
              <input 
                v-model="searchInContent" 
                type="checkbox" 
                style="cursor: pointer;"
              />
              <span>Buscar no conteúdo dos arquivos</span>
            </label>
            
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;">
              <input 
                v-model="searchCaseSensitive" 
                type="checkbox" 
                style="cursor: pointer;"
              />
              <span>Maiúsculas/minúsculas (Aa)</span>
            </label>
            
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;">
              <input 
                v-model="searchUseRegex" 
                type="checkbox" 
                style="cursor: pointer;"
              />
              <span>Usar expressão regular (.*)</span>
            </label>
          </div>

          <div v-if="isSearching" class="emptyState" style="padding: 20px; text-align: center;">
            Buscando...
          </div>

          <div v-else-if="searchResults.length === 0 && searchQuery" class="emptyState" style="padding: 20px; text-align: center;">
            Nenhum resultado
          </div>

          <div v-else-if="searchResults.length > 0" class="search-results">
            <div class="search-result-header">
              {{ searchResults.length }} resultado{{ searchResults.length > 1 ? 's' : '' }}
            </div>
            <div 
              v-for="(result, idx) in searchResults" 
              :key="idx" 
              class="search-result-item"
              @click="openSearchResult(result)"
            >
              <div class="search-result-icon">
                <span v-if="result.type === 'directory'" style="color: var(--accent);">📁</span>
                <span v-else-if="result.type === 'file'" style="color: var(--text);">📄</span>
                <span v-else style="color: var(--muted);">📝</span>
              </div>
              <div class="search-result-content">
                <div class="search-result-path">{{ result.path }}</div>
                <div v-if="result.type === 'match'" class="search-result-match">
                  <span class="search-result-line">Linha {{ result.line }}:</span>
                  <span 
                    class="search-result-text"
                    v-html="result.highlightedText || result.text"
                  ></span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="emptyState" style="padding: 20px; text-align: center;">
            Digite para buscar no workspace
          </div>
        </div>
      </div>

      <!-- Source Control View -->
      <div v-show="activeView === 'git'" class="sidebar-content">
        <div class="sidebarHeader">
          <h3 style="margin: 0; font-size: 13px; font-weight: 600;">SOURCE CONTROL</h3>
          <span v-if="gitBranch" style="font-size: 11px; color: var(--muted); margin-left: 8px;">
            {{ gitBranch }}
          </span>
          <div style="margin-left: auto; display: flex; gap: 4px;">
            <button 
              @click="gitPull" 
              :disabled="isLoadingGit"
              title="Pull"
              style="padding: 4px 8px; font-size: 11px;"
            >
              ⬇️
            </button>
            <button 
              @click="gitPush" 
              :disabled="isLoadingGit"
              title="Push"
              style="padding: 4px 8px; font-size: 11px;"
            >
              ⬆️
            </button>
            <button 
              @click="loadGitStatus" 
              :disabled="isLoadingGit"
              title="Refresh Git Status"
              style="padding: 4px 8px; font-size: 11px;"
            >
              <span v-if="isLoadingGit">⟳</span>
              <span v-else>🔄</span>
            </button>
          </div>
        </div>

        <div v-if="isLoadingGit" class="emptyState" style="padding: 20px; text-align: center;">
          Loading...
        </div>

        <div v-else-if="!isGitRepo" class="git-panel">
          <div class="emptyState" style="padding: 20px; text-align: center;">
            <p>No git repository found</p>
            <button @click="gitInitRepo" style="margin-top: 12px;">
              Initialize Repository
            </button>
          </div>
        </div>

        <div v-else class="git-panel">
          <!-- Branches Section -->
          <div class="git-section" style="border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
            <div class="git-section-header" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between;" @click="toggleBranchesPanel">
              <div>
                <span style="margin-right: 4px;">{{ showBranchesPanel ? '▼' : '▶' }}</span>
                <span>BRANCHES</span>
              </div>
              <button 
                @click.stop="openBranchDialog"
                title="Create new branch"
                style="padding: 2px 6px; font-size: 11px;"
              >
                +
              </button>
            </div>
            
            <div v-if="showBranchesPanel" style="margin-top: 8px;">
              <div v-if="gitBranches.length === 0" style="padding: 8px; color: var(--muted); font-size: 11px; text-align: center;">
                Loading branches...
              </div>
              <div 
                v-for="branch in gitBranches" 
                :key="branch.name"
                class="git-file-item"
                :style="{ backgroundColor: branch.current ? 'var(--accent-bg)' : 'transparent' }"
              >
                <div class="git-file-info" @click="!branch.current && gitCheckout(branch.name)" :style="{ cursor: branch.current ? 'default' : 'pointer' }">
                  <span style="margin-right: 4px;">{{ branch.current ? '●' : '○' }}</span>
                  <span class="git-file-path" :style="{ fontWeight: branch.current ? '600' : '400' }">
                    {{ branch.name }}
                  </span>
                  <span v-if="branch.remote" style="margin-left: 4px; font-size: 9px; color: var(--muted);">
                    (remote)
                  </span>
                </div>
                <button 
                  v-if="!branch.current && !branch.remote"
                  class="git-file-action"
                  @click="gitDeleteBranch(branch.name)"
                  title="Delete branch"
                  style="color: var(--error);"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          <!-- Commits History Section -->
          <div class="git-section" style="border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
            <div class="git-section-header" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between;" @click="toggleCommitsPanel">
              <div>
                <span style="margin-right: 4px;">{{ showCommitsPanel ? '▼' : '▶' }}</span>
                <span>COMMITS</span>
              </div>
              <button 
                @click.stop="loadGitCommits(true)"
                title="Refresh commits"
                :disabled="isLoadingCommits"
                style="padding: 2px 6px; font-size: 11px;"
              >
                🔄
              </button>
            </div>
            
            <div v-if="showCommitsPanel" style="margin-top: 8px; max-height: 400px; overflow-y: auto;">
              <div v-if="isLoadingCommits && gitCommits.length === 0" style="padding: 8px; color: var(--muted); font-size: 11px; text-align: center;">
                Loading commits...
              </div>
              <div v-else-if="gitCommits.length === 0" style="padding: 8px; color: var(--muted); font-size: 11px; text-align: center;">
                No commits yet
              </div>
              <div v-else>
                <div 
                  v-for="commit in gitCommits" 
                  :key="commit.hash"
                  class="git-commit-item"
                >
                  <div class="git-commit-header">
                    <span class="git-commit-hash" :title="commit.hash">{{ commit.shortHash }}</span>
                    <span class="git-commit-date">{{ formatCommitDate(commit.date) }}</span>
                  </div>
                  <div class="git-commit-subject">{{ commit.subject }}</div>
                  <div class="git-commit-author">{{ commit.author }}</div>
                </div>
                <button 
                  v-if="gitCommits.length >= 20"
                  @click="loadGitCommits(false)"
                  :disabled="isLoadingCommits"
                  style="width: 100%; padding: 8px; margin-top: 4px; font-size: 11px; background: transparent;"
                >
                  {{ isLoadingCommits ? 'Loading...' : 'Load more' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Commit Section -->
          <div class="git-commit-section">
            <textarea 
              v-model="gitCommitMessage"
              placeholder="Commit message..."
              class="git-commit-input"
              rows="3"
            ></textarea>
            <button 
              @click="gitCommit"
              class="git-commit-btn"
              :disabled="!stagedFiles.length || !gitCommitMessage.trim()"
            >
              Commit ({{ stagedFiles.length }})
            </button>
          </div>

          <!-- Staged Changes -->
          <div v-if="stagedFiles.length > 0" class="git-section">
            <div class="git-section-header">STAGED CHANGES ({{ stagedFiles.length }})</div>
            <div 
              v-for="file in stagedFiles" 
              :key="file.path"
              class="git-file-item"
            >
              <div class="git-file-info" @click="showFileDiff(file.path, true)" style="cursor: pointer;" title="View diff">
                <span :class="'git-status-' + file.status">{{ getGitStatusIcon(file.status) }}</span>
                <span class="git-file-path">{{ file.path }}</span>
              </div>
              <div class="git-file-actions">
                <button 
                  class="git-file-action"
                  @click.stop="openGitFile(file.path)"
                  title="Open file"
                >
                  📄
                </button>
                <button 
                  class="git-file-action"
                  @click.stop="gitUnstageFile(file.path)"
                  title="Unstage"
                >
                  -
                </button>
              </div>
            </div>
          </div>

          <!-- Unstaged Changes -->
          <div v-if="unstagedFiles.length > 0" class="git-section">
            <div class="git-section-header">CHANGES ({{ unstagedFiles.length }})</div>
            <div 
              v-for="file in unstagedFiles" 
              :key="file.path"
              class="git-file-item"
            >
              <div class="git-file-info" @click="showFileDiff(file.path, false)" style="cursor: pointer;" title="View diff">
                <span :class="'git-status-' + file.status">{{ getGitStatusIcon(file.status) }}</span>
                <span class="git-file-path">{{ file.path }}</span>
              </div>
              <div class="git-file-actions">
                <button 
                  class="git-file-action"
                  @click.stop="openGitFile(file.path)"
                  title="Open file"
                >
                  📄
                </button>
                <button 
                  class="git-file-action"
                  @click.stop="gitStageFile(file.path)"
                  title="Stage"
                >
                  +
                </button>
                <button 
                  class="git-file-action"
                  @click.stop="gitDiscardFile(file.path)"
                  title="Discard"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          <!-- No Changes -->
          <div v-if="gitStatus.length === 0" class="emptyState" style="padding: 20px; text-align: center;">
            No changes to commit
          </div>
        </div>
      </div>

      <!-- Debug View -->
      <div v-show="activeView === 'debug'" class="sidebar-content">
        <div class="sidebarHeader">
          <h3 style="margin: 0; font-size: 13px; font-weight: 600;">RUN AND DEBUG</h3>
        </div>
        <div class="emptyState" style="padding: 20px; text-align: center;">
          Debug functionality coming soon...
        </div>
      </div>

      <!-- Extensions View -->
      <div v-show="activeView === 'extensions'" class="sidebar-content">
        <div class="sidebarHeader">
          <h3 style="margin: 0; font-size: 13px; font-weight: 600;">EXTENSIONS</h3>
        </div>
        <div class="emptyState" style="padding: 20px; text-align: center;">
          Extensions marketplace coming soon...
        </div>
      </div>
    </aside>

    <div class="sidebar-resizer" @mousedown="startResize"></div>

    <!-- Menu de Contexto -->
    <ContextMenu
      :is-open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :width="contextMenuWidth"
      :node="contextMenu.node"
      :root-path="workspacePath"
      :has-tree="!!tree"
      :is-retro-project="!!isRetroProject"
      :image-editor-path="retroUiSettings?.imageEditorPath ?? ''"
      :map-editor-path="retroUiSettings?.mapEditorPath ?? ''"
      @close="closeContextMenu"
      @open="onContextMenuOpen"
      @refresh="onContextMenuRefresh"
      @new-file="onContextMenuNewFile"
      @new-folder="onContextMenuNewFolder"
      @rename="onContextMenuRename"
      @delete="onContextMenuDelete"
      @copy-path="onContextMenuCopyPath"
      @copy-relative-path="onContextMenuCopyRelativePath"
      @edit-external-image="onContextMenuEditExternalImage"
      @edit-external-map="onContextMenuEditExternalMap"
    />

    <main class="main">

      <div v-if="lastError" class="emptyState" style="color: var(--danger); border-bottom: 1px solid var(--border);">
        {{ lastError }}
      </div>

      <!-- Componente de Abas -->
      <EditorTabs
        :tabs="tabs"
        :active-path="activePath"
        @select="activePath = $event"
        @close="closeTab"
      />

      <div class="editor-terminal-container" :style="{ '--terminal-height': isTerminalOpen ? terminalHeight + 'px' : '0px' }">
        <div class="editorWrap" ref="monacoEditorRef">
          <div v-if="!activeTab" class="emptyState">
            Open a file from the explorer.
          </div>
          <div v-else ref="monacoContainer" class="monaco-editor-container"></div>
        </div>

        <!-- Terminal Resizer -->
        <div v-if="isTerminalOpen" class="terminal-sash" @mousedown="startResizeTerminal"></div>

        <!-- Terminal Panel -->
        <TerminalPanel
          v-if="isTerminalOpen"
          ref="terminalRef"
          :style="{ height: terminalHeight + 'px' }"
          @close="closeTerminal"
        />
      </div>

      <!-- Painel de erros de compilação (Retro) -->
      <ErrorPanel
        v-if="compilationErrors.length > 0"
        :errors="compilationErrors"
        :project-path="projectConfig?.path ?? workspacePath ?? ''"
        @close="clearCompilationErrors"
        @error-click="onCompilationErrorClick"
      />

      <!-- Barra de Status -->
      <StatusBar
        :file-name="activeTab?.name || ''"
        :language="activeTab?.language || ''"
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
    </main>

    <!-- AI Chat Panel Resizer -->
    <div v-if="isAIChatOpen" class="sash ai-chat-sash" @mousedown="startResizeAIChat"></div>

    <!-- AI Chat Panel integrado no grid -->
    <AIChat
      v-if="isAIChatOpen"
      :is-open="isAIChatOpen"
      :style="{ width: aiChatWidth + 'px' }"
      class="ai-chat-integrated"
      @close="closeAIChat"
    />
    </div>
  </div>

  <!-- Componente de Histórico de Cores -->
  <ColorPalette
    ref="colorPaletteRef"
    :is-open="showColorPalette"
    @close="toggleColorPalette"
    @color-picked="onColorPicked"
  />

  <!-- Sistema de Notificações Toast -->
  <Toast />

  <!-- Command Palette -->
  <CommandPalette
    :is-open="showCommandPalette"
    :commands="commandPaletteCommands"
    @close="showCommandPalette = false"
    @execute="executeCommandPaletteAction"
  />
  
  <!-- Ctrl+K Inline Edit Widget -->
  <Teleport to="body">
    <div 
      v-if="showCtrlKPopup" 
      class="ctrlk-overlay" 
      :class="{ 'ctrlk-overlay-inline': ctrlKInlineMode }"
      @click="cancelCtrlK"
    >
      <div 
        class="ctrlk-popup" 
        :class="{ 
          'ctrlk-expanded': ctrlKShowPreview,
          'ctrlk-inline-widget': ctrlKInlineMode
        }" 
        :style="ctrlKInlineMode ? { 
          position: 'fixed',
          top: ctrlKWidgetPosition.top + 'px', 
          left: ctrlKWidgetPosition.left + 'px',
          transform: 'none'
        } : {}"
        @click.stop
      >
        <div class="ctrlk-header">
          <span class="ctrlk-icon">✨</span>
          <span class="ctrlk-title">{{ ctrlKShowPreview ? 'Preview' : 'AI Edit' }}</span>
          <span class="ctrlk-hint">{{ ctrlKShowPreview ? 'Enter → Aceitar' : 'Enter → Gerar' }}</span>
          <button class="ctrlk-close" @click="cancelCtrlK">×</button>
        </div>
        
        <!-- Modo Input -->
        <template v-if="!ctrlKShowPreview">
          <div class="ctrlk-input-area">
            <input
              ref="ctrlKInputRef"
              v-model="ctrlKInput"
              type="text"
              class="ctrlk-input"
              placeholder="O que você quer fazer?"
              :disabled="ctrlKLoading"
              @keydown.enter="submitCtrlK"
              @keydown.esc="cancelCtrlK"
            />
            <button 
              class="ctrlk-submit" 
              :disabled="!ctrlKInput.trim() || ctrlKLoading"
              @click="submitCtrlK"
            >
              <span v-if="ctrlKLoading" class="ctrlk-loading"></span>
              <span v-else>↑</span>
            </button>
          </div>
          
          <!-- Sugestões de prompts (compact) -->
          <div v-if="!ctrlKLoading && !ctrlKInput" class="ctrlk-suggestions">
            <button 
              v-for="(suggestion, idx) in ctrlKSuggestions.slice(0, 3)" 
              :key="idx"
              class="ctrlk-suggestion"
              @click="useCtrlKSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
          
          <!-- Info sobre seleção -->
          <div v-if="ctrlKText" class="ctrlk-selection-info">
            <span class="icon-code"></span>
            {{ ctrlKText.split('\n').length }} linhas selecionadas
          </div>
        </template>
        
        <!-- Modo Preview Diff -->
        <template v-else>
          <div class="ctrlk-diff-preview">
            <div class="ctrlk-diff-header">
              <span class="ctrlk-diff-instruction">"​{{ ctrlKInput }}"</span>
            </div>
            <div class="ctrlk-diff-content">
              <div class="ctrlk-diff-side ctrlk-diff-original">
                <div class="ctrlk-diff-side-label">Original</div>
                <pre>{{ ctrlKText }}</pre>
              </div>
              <div class="ctrlk-diff-side ctrlk-diff-new">
                <div class="ctrlk-diff-side-label">Novo</div>
                <pre>{{ ctrlKPreviewCode }}</pre>
              </div>
            </div>
          </div>
          <div class="ctrlk-actions">
            <button class="ctrlk-action-btn ctrlk-reject" @click="rejectCtrlKChanges">
              <span class="icon-xmark"></span> Voltar
            </button>
            <button class="ctrlk-action-btn ctrlk-accept" @click="acceptCtrlKChanges">
              <span class="icon-check"></span> Aceitar
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
