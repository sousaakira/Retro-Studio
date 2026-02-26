/**
 * Registra providers SGDK no Monaco Editor
 */
import { sgdkCompletionProvider, sgdkSignatureProvider } from './sgdkAutocomplete.js'
import { expandSGDKDocumentation, createSGDKHoverProvider } from './sgdkHoverProvider.js'
import { registerSGDKSnippets } from './sgdkSnippets.js'

let sgdkDisposables = []

export function registerSGDKProviders(monaco, projectPathGetter) {
  sgdkDisposables.forEach((d) => d?.dispose?.())
  sgdkDisposables = []

  expandSGDKDocumentation()
  sgdkDisposables.push(monaco.languages.registerCompletionItemProvider('c', sgdkCompletionProvider))
  sgdkDisposables.push(
    monaco.languages.registerSignatureHelpProvider('c', sgdkSignatureProvider, { triggerCharacters: ['('] })
  )
  sgdkDisposables.push(monaco.languages.registerHoverProvider('c', createSGDKHoverProvider(monaco)))
  const snippetDisposables = registerSGDKSnippets(monaco)
  if (Array.isArray(snippetDisposables)) sgdkDisposables.push(...snippetDisposables)

  const defProvider = monaco.languages.registerDefinitionProvider('c', {
    async provideDefinition(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word?.word) return null
      const projectPath = typeof projectPathGetter === 'function' ? projectPathGetter() : projectPathGetter
      if (!projectPath || !window.retroStudio?.retro?.getFindDefinition) return null
      try {
        const result = await window.retroStudio.retro.getFindDefinition(projectPath, word.word)
        if (result?.path) {
          return {
            uri: monaco.Uri.file(result.path),
            range: {
              startLineNumber: result.line || 1,
              startColumn: result.column || 1,
              endLineNumber: result.line || 1,
              endColumn: (result.column || 1) + word.word.length
            }
          }
        }
      } catch (e) {
        console.warn('[SGDK] getFindDefinition error:', e)
      }
      return null
    }
  })
  sgdkDisposables.push(defProvider)
}

export function disposeSGDKProviders() {
  sgdkDisposables.forEach((d) => d?.dispose?.())
  sgdkDisposables = []
}
