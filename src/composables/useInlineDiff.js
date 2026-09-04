/**
 * Diff inline no editor (estilo Cursor) - aceitar/rejeitar alterações da IA
 */
import { ref } from 'vue'
import * as monaco from 'monaco-editor'

let diffDecorations = []
let diffViewZoneId = null

export function useInlineDiff(getMonacoInstance, activePath, activeTab, saveCheckpoint, checkForLintErrors) {
  const showInlineDiff = ref(false)
  const inlineDiffData = ref({
    originalCode: '',
    newCode: '',
    selection: null,
    filePath: ''
  })

  /** Review de write completo do ACP (arquivo já gravado no disco). */
  const pendingAiWrite = ref(null)
  // { filePath, fileName, previousContent, newContent, wasNewFile }
  const pendingAiWriteQueue = []

  function clearDiffDecorations() {
    const monacoInstance = getMonacoInstance()
    if (!monacoInstance) return
    if (diffDecorations.length > 0) {
      diffDecorations = monacoInstance.deltaDecorations(diffDecorations, [])
    }
    if (diffViewZoneId !== null) {
      monacoInstance.changeViewZones((accessor) => {
        accessor.removeZone(diffViewZoneId)
      })
      diffViewZoneId = null
    }
    showInlineDiff.value = false
    inlineDiffData.value = { originalCode: '', newCode: '', selection: null, filePath: '' }
  }

  function clearPendingAiWrite() {
    pendingAiWrite.value = null
  }

  function bindPendingHandlers() {
    window.retroStudioAcceptDiff = () => acceptCurrentReview()
    window.retroStudioRejectDiff = () => rejectCurrentReview()
  }

  function markTabClean(filePath, content) {
    const norm = (p) => (p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
    const normPath = norm(filePath)
    if (activeTab.value && (norm(activeTab.value.path) === normPath || activeTab.value.path === filePath)) {
      if (content != null) activeTab.value.value = content
      activeTab.value.dirty = false
    }
  }

  function showDiffInEditor(selection, originalCode, newCode) {
    const monacoInstance = getMonacoInstance()
    if (!monacoInstance) return
    const model = monacoInstance.getModel()
    if (!model) return

    clearDiffDecorations()
    clearPendingAiWrite()
    pendingAiWriteQueue.length = 0
    inlineDiffData.value = {
      originalCode,
      newCode,
      selection,
      filePath: activePath.value
    }

    const decorations = []
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
    diffDecorations = monacoInstance.deltaDecorations(diffDecorations, decorations)

    const newLines = newCode.split('\n')
    window.retroStudioAcceptDiff = () => acceptInlineDiff()
    window.retroStudioRejectDiff = () => rejectInlineDiff()

    monacoInstance.changeViewZones((accessor) => {
      const domNode = document.createElement('div')
      domNode.className = 'diff-view-zone-container'
      domNode.style.cssText = 'width: 100%; background: rgba(46, 160, 67, 0.1); border-left: 3px solid #3fb950;'

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

      const codeDiv = document.createElement('div')
      codeDiv.className = 'diff-zone-code'
      codeDiv.style.cssText = 'font-family: monospace; font-size: 13px; line-height: 20px;'

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

      const zoneHeight = Math.max((newLines.length * 20) + 50, 100)
      diffViewZoneId = accessor.addZone({
        afterLineNumber: selection.endLineNumber,
        heightInPx: zoneHeight,
        domNode: domNode,
        suppressMouseDown: false
      })
    })

    showInlineDiff.value = true
    monacoInstance.revealLineInCenter(selection.startLineNumber)
  }

  async function acceptInlineDiff() {
    const monacoInstance = getMonacoInstance()
    if (!monacoInstance || !inlineDiffData.value.selection) return
    const { selection, newCode, filePath } = inlineDiffData.value
    const model = monacoInstance.getModel()
    if (model) {
      saveCheckpoint(filePath, model.getValue())
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
      if (activeTab.value) activeTab.value.dirty = true
      window.retroStudioToast?.success('Alterações aplicadas! (Ctrl+Z para desfazer)')
      const errors = await checkForLintErrors(filePath)
      if (errors.length > 0) window.retroStudioToast?.warning(`${errors.length} erro(s) detectado(s)`)
    }
    clearDiffDecorations()
  }

  function rejectInlineDiff() {
    clearDiffDecorations()
    window.retroStudioToast?.info('Alterações rejeitadas')
  }

  async function applyPendingToEditor(item) {
    try {
      await window.retroStudioEditor?.openFile?.(item.filePath)
    } catch (_) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 40))
    let applied = window.retroStudioEditor?.updateFileContent?.(item.filePath, item.newContent, { fromAI: true })
    if (!applied) {
      try {
        await window.retroStudioEditor?.openFile?.(item.filePath)
        await new Promise((r) => setTimeout(r, 50))
        applied = window.retroStudioEditor?.updateFileContent?.(item.filePath, item.newContent, { fromAI: true })
      } catch (_) { /* ignore */ }
    }
    return !!applied
  }

  function presentPending(item) {
    pendingAiWrite.value = item
    showInlineDiff.value = true
    bindPendingHandlers()
  }

  async function advanceQueue() {
    const next = pendingAiWriteQueue.shift()
    if (!next) {
      clearPendingAiWrite()
      showInlineDiff.value = false
      return
    }
    await applyPendingToEditor(next)
    presentPending(next)
  }

  /**
   * Abre o arquivo (se preciso), aplica o conteúdo novo e pede accept/reject.
   * O disco já contém newContent (write ACP); reject restaura previousContent.
   */
  async function reviewAiFileWrite({ filePath, previousContent, newContent, wasNewFile = false }) {
    if (!filePath) return false
    const previous = previousContent == null ? '' : String(previousContent)
    const next = newContent == null ? '' : String(newContent)
    if (previous === next) return false

    const fileName = String(filePath).split(/[/\\]/).pop() || filePath
    const item = {
      filePath,
      fileName,
      previousContent: previous,
      newContent: next,
      wasNewFile: !!wasNewFile
    }

    // Já há review ativo → enfileira (não sobrescreve a decisão atual)
    if (pendingAiWrite.value) {
      const exists = pendingAiWriteQueue.some((q) => q.filePath === filePath)
        || pendingAiWrite.value.filePath === filePath
      if (exists) {
        // Atualiza o item da fila / atual com o write mais recente do mesmo path
        if (pendingAiWrite.value.filePath === filePath) {
          pendingAiWrite.value = { ...item, previousContent: pendingAiWrite.value.previousContent }
          await applyPendingToEditor(pendingAiWrite.value)
          presentPending(pendingAiWrite.value)
        } else {
          const idx = pendingAiWriteQueue.findIndex((q) => q.filePath === filePath)
          if (idx >= 0) {
            pendingAiWriteQueue[idx] = {
              ...item,
              previousContent: pendingAiWriteQueue[idx].previousContent
            }
          }
        }
        return true
      }
      pendingAiWriteQueue.push(item)
      return true
    }

    clearDiffDecorations()
    await applyPendingToEditor(item)
    presentPending(item)
    return true
  }

  async function acceptPendingAiWrite() {
    const pending = pendingAiWrite.value
    if (!pending) return
    markTabClean(pending.filePath, pending.newContent)
    clearPendingAiWrite()
    window.retroStudioToast?.success?.('Alterações do agente mantidas')
    try {
      const errors = await checkForLintErrors?.(pending.filePath)
      if (errors?.length) window.retroStudioToast?.warning?.(`${errors.length} erro(s) detectado(s)`)
    } catch (_) { /* ignore */ }
    await advanceQueue()
  }

  async function rejectPendingAiWrite() {
    const pending = pendingAiWrite.value
    if (!pending) return
    const { filePath, previousContent, wasNewFile } = pending
    clearPendingAiWrite()
    try {
      if (wasNewFile) {
        await window.retroStudio?.deletePath?.(filePath)
      } else {
        await window.retroStudio?.writeTextFile?.(filePath, previousContent)
      }
    } catch (e) {
      window.retroStudioToast?.error?.(e?.message || 'Falha ao restaurar arquivo')
    }
    if (wasNewFile) {
      try {
        await window.retroStudioEditor?.closeTab?.(filePath)
      } catch (_) { /* ignore */ }
    } else {
      window.retroStudioEditor?.updateFileContent?.(filePath, previousContent, { fromAI: false, dirty: false })
      markTabClean(filePath, previousContent)
    }
    window.retroStudioToast?.info?.('Alterações do agente rejeitadas')
    await advanceQueue()
  }

  function acceptCurrentReview() {
    if (pendingAiWrite.value) return acceptPendingAiWrite()
    return acceptInlineDiff()
  }

  function rejectCurrentReview() {
    if (pendingAiWrite.value) return rejectPendingAiWrite()
    return rejectInlineDiff()
  }

  return {
    showInlineDiff,
    inlineDiffData,
    pendingAiWrite,
    showDiffInEditor,
    reviewAiFileWrite,
    clearDiffDecorations,
    clearPendingAiWrite,
    acceptInlineDiff,
    rejectInlineDiff,
    acceptPendingAiWrite,
    rejectPendingAiWrite,
    acceptCurrentReview,
    rejectCurrentReview
  }
}
