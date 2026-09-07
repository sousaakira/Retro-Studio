/**
 * Ctrl+K - Edição inline com IA
 */
import { ref } from 'vue'
import * as monaco from 'monaco-editor'

export function useCtrlK(getMonacoInstance, showDiffInEditor, saveCheckpoint, checkForLintErrors, activeTab, nextTick, getFocusInput = null) {
  const showCtrlKPopup = ref(false)
  const ctrlKInput = ref('')
  const ctrlKLoading = ref(false)
  const ctrlKSelection = ref(null)
  const ctrlKText = ref('')
  const ctrlKPosition = ref(null)
  const ctrlKFilePath = ref('')
  const ctrlKInputRef = ref(null)
  const ctrlKPreviewCode = ref('')
  const ctrlKShowPreview = ref(false)
  const ctrlKWidgetPosition = ref({ top: 0, left: 0 })
  const ctrlKInlineMode = ref(true)

  const ctrlKSuggestions = [
    'Adicione tratamento de erros SGDK',
    'Adicione comentários explicativos',
    'Refatore para melhor legibilidade',
    'Use APIs do SGDK (genesis.h)',
    'Otimize para 68k / Mega Drive',
    'Adicione logs de debug',
    'Simplifique este código',
    'Corrija possíveis bugs'
  ]

  function handleCtrlKEvent(event) {
    const { selection, text, position, filePath } = event.detail
    ctrlKSelection.value = selection
    ctrlKText.value = text
    ctrlKPosition.value = position
    ctrlKFilePath.value = filePath
    ctrlKInput.value = ''
    ctrlKShowPreview.value = false
    ctrlKPreviewCode.value = ''

    const monacoInstance = getMonacoInstance()
    if (monacoInstance && ctrlKInlineMode.value) {
      try {
        const endPosition = { lineNumber: selection.endLineNumber, column: selection.startColumn }
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
        ctrlKInlineMode.value = false
      }
    }
    showCtrlKPopup.value = true
    nextTick(() => (getFocusInput?.() ?? ctrlKInputRef.value?.focus()))
  }

  function cancelCtrlK() {
    showCtrlKPopup.value = false
    ctrlKInput.value = ''
    ctrlKLoading.value = false
    ctrlKSelection.value = null
    ctrlKText.value = ''
    ctrlKPreviewCode.value = ''
    ctrlKShowPreview.value = false
    const monaco = getMonacoInstance()
    if (monaco) monaco.focus()
  }

  /**
   * Encaminha a edição para o painel ACP (OpenCode).
   * O agente aplica mudanças via write; o banner Accept/Reject cobre o review.
   */
  async function submitCtrlK() {
    if (!ctrlKInput.value.trim() || ctrlKLoading.value) return
    ctrlKLoading.value = true
    try {
      const instruction = ctrlKInput.value.trim()
      const selectedCode = ctrlKText.value
      const filePath = ctrlKFilePath.value
      const selection = ctrlKSelection.value
        ? { ...ctrlKSelection.value }
        : null
      cancelCtrlK()
      window.dispatchEvent(new CustomEvent('retroStudio:acp-edit-selection', {
        detail: { instruction, selectedCode, filePath, selection }
      }))
    } catch (error) {
      console.error('Erro ao encaminhar Ctrl+K:', error)
      window.retroStudioToast?.error('Erro ao processar: ' + error.message)
    } finally {
      ctrlKLoading.value = false
    }
  }

  async function acceptCtrlKChanges() {
    // Mantido por compatibilidade do widget (preview legado não é mais o fluxo principal)
    cancelCtrlK()
  }

  function rejectCtrlKChanges() {
    ctrlKShowPreview.value = false
    ctrlKPreviewCode.value = ''
    nextTick(() => (getFocusInput?.() ?? ctrlKInputRef.value?.focus()))
  }

  function useCtrlKSuggestion(suggestion) {
    ctrlKInput.value = suggestion
    nextTick(() => (getFocusInput?.() ?? ctrlKInputRef.value?.focus()))
  }

  return {
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
  }
}
