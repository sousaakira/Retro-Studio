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

  function showDiffInEditor(selection, originalCode, newCode) {
    const monacoInstance = getMonacoInstance()
    if (!monacoInstance) return
    const model = monacoInstance.getModel()
    if (!model) return

    clearDiffDecorations()
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

  return {
    showInlineDiff,
    inlineDiffData,
    showDiffInEditor,
    clearDiffDecorations,
    acceptInlineDiff,
    rejectInlineDiff
  }
}
