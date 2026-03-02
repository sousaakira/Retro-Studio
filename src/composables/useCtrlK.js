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
    'Adicione tratamento de erros',
    'Adicione comentários explicativos',
    'Refatore para melhor legibilidade',
    'Converta para async/await',
    'Adicione tipos TypeScript',
    'Otimize performance',
    'Adicione logs de debug',
    'Simplifique este código'
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

  async function submitCtrlK() {
    if (!ctrlKInput.value.trim() || ctrlKLoading.value) return
    ctrlKLoading.value = true
    try {
      const instruction = ctrlKInput.value.trim()
      const selectedCode = ctrlKText.value
      const filePath = ctrlKFilePath.value
      const selection = ctrlKSelection.value
      const message = `Edit the following code according to this instruction: "${instruction}"

IMPORTANT: Return ONLY the modified code. No explanations, no markdown code blocks, no comments about the changes. Just the raw code that should replace the selection.

Code to edit:
${selectedCode}`

      const result = await window.retroStudio.ai.chat(message, { useTools: false })
      if (result.content) {
        let newCode = result.content.trim()
        const codeBlockMatch = newCode.match(/^```\w*\n?([\s\S]*?)\n?```$/)
        if (codeBlockMatch) newCode = codeBlockMatch[1]
        ctrlKPreviewCode.value = newCode
        showCtrlKPopup.value = false
        showDiffInEditor(selection, selectedCode, newCode)
      } else {
        window.retroStudioToast?.error('A IA não retornou uma resposta válida')
      }
    } catch (error) {
      console.error('Erro ao processar Ctrl+K:', error)
      window.retroStudioToast?.error('Erro ao processar: ' + error.message)
    } finally {
      ctrlKLoading.value = false
    }
  }

  async function acceptCtrlKChanges() {
    const selection = ctrlKSelection.value
    const newCode = ctrlKPreviewCode.value
    const filePath = ctrlKFilePath.value
    const monacoInstance = getMonacoInstance()
    if (monacoInstance && selection && newCode) {
      const model = monacoInstance.getModel()
      if (model) {
        saveCheckpoint(filePath, model.getValue())
        monacoInstance.executeEdits('ai-inline-edit', [{ range: selection, text: newCode, forceMoveMarkers: true }])
        if (activeTab.value) activeTab.value.dirty = true
        window.retroStudioToast?.success('Código editado com sucesso! (Ctrl+Z para desfazer)')
        const errors = await checkForLintErrors(filePath)
        if (errors.length > 0) window.retroStudioToast?.warning(`${errors.length} erro(s) detectado(s) após a edição`)
      }
    }
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
