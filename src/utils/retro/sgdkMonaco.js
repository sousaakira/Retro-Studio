/**
 * Registra providers SGDK no Monaco Editor
 */
import { sgdkCompletionProvider, sgdkSignatureProvider } from './sgdkAutocomplete.js'
import { expandSGDKDocumentation, createSGDKHoverProvider } from './sgdkHoverProvider.js'
import { registerSGDKSnippets } from './sgdkSnippets.js'

let sgdkDisposables = []

function isCLikePath(filePath) {
  return /\.(c|h|cpp|hpp|cc)$/i.test(String(filePath || ''))
}

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
      const projectPath = typeof projectPathGetter === 'function' ? projectPathGetter() : projectPathGetter
      const filePath = window.retroStudioEditor?.getCurrentFile?.() || ''
      if (!projectPath || !filePath) return null

      // Prefer clangd LSP
      try {
        if (window.retroStudio?.retro?.lspDefinition) {
          const content = model.getValue()
          const result = await window.retroStudio.retro.lspDefinition({
            projectPath,
            filePath,
            line: position.lineNumber,
            character: position.column,
            content
          })
          if (result?.path) {
            const openAt = window.retroStudioEditor?.openFileAt
            if (typeof openAt === 'function') {
              await openAt(result.path, result.line || 1, result.column || 1)
              // Já navegamos via abas da IDE — evita Uri.file órfão
              return null
            }
            return {
              uri: monaco.Uri.file(result.path),
              range: {
                startLineNumber: result.line || 1,
                startColumn: result.column || 1,
                endLineNumber: result.line || 1,
                endColumn: (result.column || 1) + 1
              }
            }
          }
        }
      } catch (e) {
        console.warn('[SGDK] lspDefinition error:', e)
      }

      // Fallback regex (símbolos em src/)
      const word = model.getWordAtPosition(position)
      if (!word?.word || !window.retroStudio?.retro?.getFindDefinition) return null
      try {
        const result = await window.retroStudio.retro.getFindDefinition(projectPath, word.word)
        if (result?.path) {
          const openAt = window.retroStudioEditor?.openFileAt
          if (typeof openAt === 'function') {
            await openAt(result.path, result.line || 1, result.column || 1)
            return null
          }
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

/** Sincroniza buffer aberto com clangd (debounce externo). */
export async function syncClangdDocument({ projectPath, filePath, content, action = 'open' }) {
  if (!projectPath || !filePath || !isCLikePath(filePath)) return
  if (!window.retroStudio?.retro?.lspSync) return
  try {
    await window.retroStudio.retro.lspSync({
      projectPath,
      filePath,
      content,
      action,
      languageId: 'c'
    })
  } catch (e) {
    console.warn('[SGDK] lspSync:', e?.message || e)
  }
}
