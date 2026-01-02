/**
 * SGDK Language Server - Análise estática de código
 * Implementa funcionalidades LSP (Language Server Protocol)
 */

import { sgdkSystemFunctions, sgdkTypes } from './sgdkAutocomplete'

// ============================================
// 1. PARSER - Extrai símbolos do código
// ============================================

/**
 * Extrai todas as funções definidas no código
 */
export function extractFunctionDefinitions(code) {
  const functionDefs = []
  // Padrão: tipo_retorno nome_funcao(parametros)
  const regex = /(?:^|\n)\s*(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm
  
  let match
  while ((match = regex.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length
    functionDefs.push({
      name: match[1],
      line: lineNumber,
      column: match.index - code.lastIndexOf('\n', match.index),
      type: 'function'
    })
  }
  
  return functionDefs
}

/**
 * Extrai todas as variáveis declaradas
 */
export function extractVariableDefinitions(code) {
  const variables = []
  // Padrão: tipo nome = valor; ou tipo nome;
  const regex = /(?:^|\n)\s*(?:u\d{1,2}|s\d{1,2}|int|float|void|char|fix\d+)\s+(\w+)\s*[=;]/gm
  
  let match
  while ((match = regex.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length
    variables.push({
      name: match[1],
      line: lineNumber,
      column: match.index - code.lastIndexOf('\n', match.index),
      type: 'variable'
    })
  }
  
  return variables
}

/**
 * Extrai todas as chamadas de função (uso)
 */
export function extractFunctionCalls(code) {
  const calls = []
  // Padrão: nome_funcao(
  const regex = /\b([a-zA-Z_]\w*)\s*\(/gm
  
  let match
  while ((match = regex.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length
    const funcName = match[1]
    
    // Ignorar keywords
    if (!['if', 'while', 'for', 'switch', 'return'].includes(funcName)) {
      calls.push({
        name: funcName,
        line: lineNumber,
        column: match.index - code.lastIndexOf('\n', match.index),
        type: 'call'
      })
    }
  }
  
  return calls
}

/**
 * Extrai todos os includes (arquivos incluídos)
 */
export function extractIncludes(code) {
  const includes = []
  const regex = /#include\s+[<"]([^>"]+)[>"]$/gm
  
  let match
  while ((match = regex.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length
    includes.push({
      file: match[1],
      line: lineNumber,
      type: 'include'
    })
  }
  
  return includes
}

// ============================================
// 2. SYMBOL TABLE - Mapa de símbolos
// ============================================

export class SymbolTable {
  constructor() {
    this.symbols = new Map()
    this.references = new Map()
    this.definitions = new Map()
  }

  addSymbol(name, type, line, column) {
    if (!this.symbols.has(name)) {
      this.symbols.set(name, [])
    }
    this.symbols.get(name).push({ type, line, column })
  }

  addReference(name, line, column) {
    if (!this.references.has(name)) {
      this.references.set(name, [])
    }
    this.references.get(name).push({ line, column })
  }

  addDefinition(name, type, line, column, details = {}) {
    this.definitions.set(name, { type, line, column, details })
  }

  getSymbol(name) {
    return this.symbols.get(name)
  }

  getReferences(name) {
    return this.references.get(name) || []
  }

  getDefinition(name) {
    return this.definitions.get(name)
  }

  getAllSymbols() {
    return Array.from(this.symbols.entries()).map(([name, uses]) => ({
      name,
      uses
    }))
  }
}

// ============================================
// 3. ANALYSIS - Análise de código
// ============================================

export function analyzeCode(code) {
  const symbolTable = new SymbolTable()
  
  // Extrair definições
  const funcDefs = extractFunctionDefinitions(code)
  const varDefs = extractVariableDefinitions(code)
  const includes = extractIncludes(code)
  
  // Adicionar ao symbol table
  funcDefs.forEach(f => {
    symbolTable.addDefinition(f.name, 'function', f.line, f.column)
  })
  
  varDefs.forEach(v => {
    symbolTable.addDefinition(v.name, 'variable', v.line, v.column)
  })
  
  // Adicionar funções SGDK ao symbol table
  sgdkSystemFunctions.forEach(f => {
    symbolTable.addDefinition(f.name, 'sgdk_function', 0, 0, {
      description: f.description,
      returns: f.returns
    })
  })
  
  // Adicionar tipos SGDK
  sgdkTypes.forEach(t => {
    symbolTable.addDefinition(t.name, 'sgdk_type', 0, 0)
  })
  
  // Extrair e validar chamadas de função
  const calls = extractFunctionCalls(code)
  calls.forEach(call => {
    symbolTable.addReference(call.name, call.line, call.column)
  })
  
  return {
    symbolTable,
    functionDefinitions: funcDefs,
    variableDefinitions: varDefs,
    functionCalls: calls,
    includes,
    codeLength: code.length,
    lineCount: code.split('\n').length
  }
}

// ============================================
// 4. VALIDATION - Validação de código
// ============================================

export function validateCode(code) {
  const analysis = analyzeCode(code)
  const diagnostics = []
  
  // Verificar funções não definidas
  const { symbolTable, functionCalls } = analysis
  
  functionCalls.forEach(call => {
    const def = symbolTable.getDefinition(call.name)
    
    if (!def) {
      diagnostics.push({
        range: {
          startLineNumber: call.line,
          startColumn: call.column,
          endLineNumber: call.line,
          endColumn: call.column + call.name.length
        },
        message: `Função indefinida: "${call.name}"`,
        severity: 8, // Error
        code: 'undefined-function'
      })
    }
  })
  
  // Verificar variáveis não utilizadas
  const { variableDefinitions } = analysis
  variableDefinitions.forEach(varDef => {
    const refs = symbolTable.getReferences(varDef.name)
    if (refs.length === 0) {
      diagnostics.push({
        range: {
          startLineNumber: varDef.line,
          startColumn: varDef.column,
          endLineNumber: varDef.line,
          endColumn: varDef.column + varDef.name.length
        },
        message: `Variável não utilizada: "${varDef.name}"`,
        severity: 4, // Warning
        code: 'unused-variable'
      })
    }
  })
  
  // Verificar includes inválidos
  const { includes } = analysis
  const validHeaders = ['genesis.h', 'sys.h', 'vdp.h', 'sprite.h', 'joy.h', 'sound.h', 'mem.h', 'fix16.h']
  includes.forEach(inc => {
    if (!validHeaders.includes(inc.file) && !inc.file.startsWith('res/')) {
      diagnostics.push({
        range: {
          startLineNumber: inc.line,
          startColumn: 0,
          endLineNumber: inc.line,
          endColumn: 50
        },
        message: `Include desconhecido: "${inc.file}"`,
        severity: 4, // Warning
        code: 'unknown-include'
      })
    }
  })
  
  return diagnostics
}

// ============================================
// 5. CODE ACTIONS - Sugestões de correção
// ============================================

export function getCodeActions(code, diagnostics, line, column) {
  const actions = []
  
  // Encontrar diagnósticos nesta linha
  const lineDiagnostics = diagnostics.filter(d => 
    d.range.startLineNumber === line && 
    column >= d.range.startColumn && 
    column <= d.range.endColumn
  )
  
  lineDiagnostics.forEach(diag => {
    if (diag.code === 'undefined-function') {
      // Sugerir função SGDK similar
      const funcName = code.split('\n')[line - 1].match(/\b([a-zA-Z_]\w*)\s*\(/)?.[1]
      const suggestions = sgdkSystemFunctions
        .filter(f => levenshteinDistance(f.name, funcName) < 3)
        .slice(0, 3)
      
      if (suggestions.length > 0) {
        suggestions.forEach(sug => {
          actions.push({
            title: `Usar ${sug.name}`,
            kind: 'quickfix',
            edit: {
              range: {
                startLineNumber: line,
                startColumn: diag.range.startColumn,
                endLineNumber: line,
                endColumn: diag.range.endColumn
              },
              text: sug.name
            }
          })
        })
      }
    }
  })
  
  return actions
}

// ============================================
// HELPERS
// ============================================

/**
 * Calcula distância de Levenshtein (similaridade entre strings)
 */
function levenshteinDistance(a, b) {
  const matrix = []
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  
  return matrix[b.length][a.length]
}

/**
 * Encontra posição de um símbolo no código
 */
export function findSymbolDefinition(code, symbolName) {
  const analysis = analyzeCode(code)
  const def = analysis.symbolTable.getDefinition(symbolName)
  
  if (def) {
    return {
      uri: 'sgdk:symbols',
      range: {
        startLineNumber: def.line,
        startColumn: def.column,
        endLineNumber: def.line,
        endColumn: def.column + symbolName.length
      }
    }
  }
  
  return null
}

/**
 * Encontra todas as referências a um símbolo
 */
export function findSymbolReferences(code, symbolName) {
  const analysis = analyzeCode(code)
  const refs = analysis.symbolTable.getReferences(symbolName)
  
  return refs.map(ref => ({
    uri: 'sgdk:current-file',
    range: {
      startLineNumber: ref.line,
      startColumn: ref.column,
      endLineNumber: ref.line,
      endColumn: ref.column + symbolName.length
    }
  }))
}

/**
 * Renomeia um símbolo em todo o código
 */
export function renameSymbol(code, symbolName, newName) {
  let result = code
  const refs = findSymbolReferences(code, symbolName)
  
  // Ordenar em reverse para não corromper índices
  const sortedRefs = refs.sort((a, b) => 
    b.range.startLineNumber - a.range.startLineNumber
  )
  
  const lines = result.split('\n')
  
  sortedRefs.forEach(ref => {
    const line = ref.range.startLineNumber - 1
    const start = ref.range.startColumn - 1
    const end = ref.range.endColumn
    
    if (lines[line]) {
      lines[line] = 
        lines[line].substring(0, start) + 
        newName + 
        lines[line].substring(end)
    }
  })
  
  return lines.join('\n')
}
