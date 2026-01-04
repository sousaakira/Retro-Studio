/**
 * SGDK LSP Providers - Integração com Monaco Editor
 * Providers para: Go to Definition, Find References, Rename, etc.
 */

import * as monaco from 'monaco-editor'
import {
  analyzeCode,
  validateCode,
  getCodeActions,
  findSymbolDefinition,
  findSymbolReferences,
  renameSymbol
} from './sgdkLanguageServer'

// ============================================
// 1. DIAGNOSTICS PROVIDER
// ============================================

export function createSGDKDiagnosticsProvider() {
  return {
    provideDiagnostics(model) {
      const code = model.getValue()
      const diagnostics = validateCode(code)
      
      return {
        diagnostics: diagnostics,
        dispose: () => {}
      }
    }
  }
}

// ============================================
// 2. GO TO DEFINITION PROVIDER
// ============================================

export function createSGDKGoToDefinitionProvider() {
  return {
    async provideDefinition(model, position) {
      if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) return null
      const lineContent = model.getLineContent(position.lineNumber)
      
      // Extrair palavra sob o cursor
      const column = position.column - 1
      let start = column
      let end = column
      
      // Expandir para a esquerda
      while (start > 0 && /[a-zA-Z0-9_]/.test(lineContent[start - 1])) {
        start--
      }
      
      // Expandir para a direita
      while (end < lineContent.length && /[a-zA-Z0-9_]/.test(lineContent[end])) {
        end++
      }
      
      if (start === end) return null
      
      const symbolName = lineContent.substring(start, end)
      const code = model.getValue()
      
      // 1. Tentar encontrar no arquivo atual
      const definition = findSymbolDefinition(code, symbolName)
      
      if (definition) {
        if (definition.uri === 'current' || !definition.uri) {
          return {
            uri: model.uri,
            range: definition.range
          }
        }
      }
      
      // 2. Tentar encontrar em outros arquivos do projeto via IPC
      try {
        const projectStr = localStorage.getItem('project')
        if (projectStr) {
          const project = JSON.parse(projectStr)
          if (project && project.path) {
            console.log(`[LSP] Searching definition for "${symbolName}" in project...`)
            const result = await window.ipc.invoke('find-definition-in-project', {
              projectPath: project.path,
              symbolName: symbolName
            })
            
            if (result && result.path) {
              // Se for o mesmo arquivo, o Monaco já lidaria, mas vamos garantir
              const targetUri = monaco.Uri.file(result.path)
              
              return {
                uri: targetUri,
                range: {
                  startLineNumber: result.line,
                  startColumn: result.column,
                  endLineNumber: result.line,
                  endColumn: result.column + symbolName.length
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('[LSP] Error searching in project:', error)
      }
      
      return null
    }
  }
}

// ============================================
// 3. FIND REFERENCES PROVIDER
// ============================================

export function createSGDKFindReferencesProvider() {
  return {
    provideReferences(model, position) {
      if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) return []
      const code = model.getValue()
      const lineContent = model.getLineContent(position.lineNumber)
      
      // Extrair palavra sob o cursor
      const column = position.column - 1
      let start = column
      let end = column
      
      while (start > 0 && /[a-zA-Z0-9_]/.test(lineContent[start - 1])) {
        start--
      }
      
      while (end < lineContent.length && /[a-zA-Z0-9_]/.test(lineContent[end])) {
        end++
      }
      
      if (start === end) return []
      
      const symbolName = lineContent.substring(start, end)
      console.log('[LSP] Find References:', symbolName)
      
      const references = findSymbolReferences(code, symbolName)
      
      return references.map(ref => ({
        uri: model.uri,
        range: ref.range
      }))
    }
  }
}

// ============================================
// 4. RENAME PROVIDER
// ============================================

export function createSGDKRenameProvider() {
  return {
    provideRenameEdits(model, position, newName) {
      if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) return null
      const code = model.getValue()
      const lineContent = model.getLineContent(position.lineNumber)
      
      // Extrair palavra sob o cursor
      const column = position.column - 1
      let start = column
      let end = column
      
      while (start > 0 && /[a-zA-Z0-9_]/.test(lineContent[start - 1])) {
        start--
      }
      
      while (end < lineContent.length && /[a-zA-Z0-9_]/.test(lineContent[end])) {
        end++
      }
      
      if (start === end) return null
      
      const symbolName = lineContent.substring(start, end)
      
      if (!newName || newName === symbolName) return null
      
      console.log(`[LSP] Rename "${symbolName}" to "${newName}"`)
      
      // Validar novo nome (deve ser identificador válido)
      if (!/^[a-zA-Z_]\w*$/.test(newName)) {
        return {
          edits: [],
          rejectReason: 'Nome inválido. Use apenas letras, números e underscore.'
        }
      }
      
      const newCode = renameSymbol(code, symbolName, newName)
      
      return {
        edits: [{
          resource: model.uri,
          edit: {
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: model.getLineCount(),
              endColumn: model.getLineLength(model.getLineCount()) + 1
            },
            text: newCode
          }
        }]
      }
    },
    
    resolveRenameLocation(model, position) {
      if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) return null
      const lineContent = model.getLineContent(position.lineNumber)
      const column = position.column - 1
      
      let start = column
      let end = column
      
      while (start > 0 && /[a-zA-Z0-9_]/.test(lineContent[start - 1])) {
        start--
      }
      
      while (end < lineContent.length && /[a-zA-Z0-9_]/.test(lineContent[end])) {
        end++
      }
      
      if (start === end) return null
      
      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: start + 1,
          endLineNumber: position.lineNumber,
          endColumn: end + 1
        },
        text: lineContent.substring(start, end)
      }
    }
  }
}

// ============================================
// 5. CODE ACTIONS PROVIDER
// ============================================

export function createSGDKCodeActionsProvider() {
  return {
    provideCodeActions(model, range) {
      const code = model.getValue()
      const diagnostics = validateCode(code)
      
      // Encontrar diagnósticos neste intervalo
      const relevantDiags = diagnostics.filter(d =>
        d.range.startLineNumber >= range.startLineNumber &&
        d.range.startLineNumber <= range.endLineNumber
      )
      
      if (relevantDiags.length === 0) return { actions: [], dispose: () => {} }
      
      const actions = []
      
      relevantDiags.forEach(diag => {
        const codeActions = getCodeActions(
          code,
          [diag],
          diag.range.startLineNumber,
          diag.range.startColumn
        )
        
        actions.push(...codeActions.map(action => ({
          title: action.title,
          kind: 'quickfix',
          edit: {
            range: action.edit.range,
            text: action.edit.text
          },
          diagnostics: [diag]
        })))
      })
      
      return {
        actions,
        dispose: () => {}
      }
    }
  }
}

// ============================================
// 6. INLINE DIAGNOSTICS (Real-time)
// ============================================

export function createSGDKInlineDiagnosticsProvider(editor) {
  let diagnosticsCollection = null
  
  const updateDiagnostics = () => {
    if (!editor) return
    
    const model = editor.getModel()
    if (!model) return
    
    const code = model.getValue()
    const diagnostics = validateCode(code)
    
    console.log(`[LSP] ${diagnostics.length} diagnósticos encontrados`)
    
    // Atualizar marcadores no editor
    if (editor.deltaDecorations) {
      const decorations = diagnostics.map(diag => ({
        range: new (window.monaco?.Range || Range)(
          diag.range.startLineNumber,
          diag.range.startColumn,
          diag.range.endLineNumber,
          diag.range.endColumn
        ),
        options: {
          isWholeLine: false,
          className: diag.severity === 8 ? 'squiggly-error' : 'squiggly-warning',
          glyphMarginClassName: diag.severity === 8 ? 'glyph-error' : 'glyph-warning',
          glyphMarginHoverMessage: { value: diag.message },
          minimap: { color: diag.severity === 8 ? '#ff0000' : '#ffcc00' }
        }
      }))
      
      diagnosticsCollection = editor.deltaDecorations(diagnosticsCollection || [], decorations)
    }
  }
  
  return {
    updateDiagnostics,
    dispose: () => {
      if (editor && diagnosticsCollection) {
        editor.deltaDecorations(diagnosticsCollection, [])
      }
    }
  }
}

// ============================================
// 7. SYMBOL PROVIDER
// ============================================

export function createSGDKDocumentSymbolProvider() {
  return {
    provideDocumentSymbols(model) {
      const code = model.getValue()
      const analysis = analyzeCode(code)
      
      const symbols = []
      
      // Adicionar funções
      analysis.functionDefinitions.forEach(func => {
        symbols.push({
          name: func.name,
          kind: 12, // Function
          location: {
            uri: model.uri,
            range: {
              startLineNumber: func.line,
              startColumn: func.column,
              endLineNumber: func.line,
              endColumn: func.column + func.name.length
            }
          },
          containerName: 'Functions'
        })
      })
      
      // Adicionar variáveis
      analysis.variableDefinitions.forEach(varDef => {
        symbols.push({
          name: varDef.name,
          kind: 13, // Variable
          location: {
            uri: model.uri,
            range: {
              startLineNumber: varDef.line,
              startColumn: varDef.column,
              endLineNumber: varDef.line,
              endColumn: varDef.column + varDef.name.length
            }
          },
          containerName: 'Variables'
        })
      })
      
      return symbols
    }
  }
}

// ============================================
// 8. OUTLINE (Symbol Navigator)
// ============================================

export function createSGDKOutlineProvider(editor) {
  const symbols = []
  
  const updateOutline = () => {
    if (!editor) return
    
    const model = editor.getModel()
    if (!model) return
    
    const provider = createSGDKDocumentSymbolProvider()
    const newSymbols = provider.provideDocumentSymbols(model) || []
    
    symbols.length = 0
    symbols.push(...newSymbols)
    
    console.log(`[LSP] Outline atualizado: ${symbols.length} símbolos`)
  }
  
  return {
    getSymbols: () => symbols,
    updateOutline,
    dispose: () => {
      symbols.length = 0
    }
  }
}
