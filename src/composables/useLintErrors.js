/**
 * Detecção de erros de lint após edições da IA
 */
import * as monaco from 'monaco-editor'

export function useLintErrors(getMonacoInstance) {
  async function checkForLintErrors(filePath) {
    const monacoInstance = getMonacoInstance()
    if (!monacoInstance) return []
    const model = monacoInstance.getModel()
    if (!model) return []
    await new Promise(resolve => setTimeout(resolve, 500))
    const markers = monaco.editor.getModelMarkers({ resource: model.uri })
    const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error)
    return errors.map(e => ({
      line: e.startLineNumber,
      column: e.startColumn,
      message: e.message,
      source: e.source || 'lint'
    }))
  }

  return { checkForLintErrors }
}
