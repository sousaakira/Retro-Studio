/**
 * Parser de Erros de Compilação GCC/SGDK
 * Extrai informações de arquivo, linha e mensagem
 */

/**
 * Padrões de erro reconhecidos
 */
const ERROR_PATTERNS = [
  // GCC: file.c:10:5: error: 'x' undeclared
  /^([^:]+):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  // Formato alternativo: file.c:10: error: message
  /^([^:]+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  // Padrão genérico
  /^(.+?):(\d+):\s*(.+)$/
]

/**
 * Parseia uma linha de erro do compilador
 * @param {string} line - Linha de saída do compilador
 * @returns {Object|null} Objeto com { file, line, column, type, message }
 */
export function parseErrorLine(line) {
  if (!line || typeof line !== 'string') return null

  for (const pattern of ERROR_PATTERNS) {
    const match = line.match(pattern)
    if (match) {
      const [, file, lineNum, ...rest] = match
      
      // Determinar tipo e mensagem dependendo do padrão
      let type = 'error'
      let message = ''
      let column = 1

      if (rest.length === 3) {
        // Padrão 1: tem coluna e tipo
        column = parseInt(rest[0])
        type = rest[1].toLowerCase()
        message = rest[2]
      } else if (rest.length === 2) {
        // Padrão 2: sem coluna, tem tipo
        type = rest[0].toLowerCase()
        message = rest[1]
      } else {
        // Padrão 3: genérico
        message = rest.join(':')
      }

      return {
        file: file.trim(),
        line: parseInt(lineNum),
        column: column,
        type: type, // 'error', 'warning', 'note'
        message: message.trim(),
        severity: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'
      }
    }
  }

  return null
}

/**
 * Parseia saída completa de compilação
 * @param {string} output - Saída do compilador
 * @returns {Array} Array de erros parsed
 */
export function parseCompilationOutput(output) {
  if (!output) return []

  const lines = output.split('\n')
  const errors = []
  const seenErrors = new Set()

  for (const line of lines) {
    const error = parseErrorLine(line)
    if (error) {
      // Evitar duplicatas
      const key = `${error.file}:${error.line}:${error.message}`
      if (!seenErrors.has(key)) {
        errors.push(error)
        seenErrors.add(key)
      }
    }
  }

  return errors
}

/**
 * Formata erros para exibição
 * @param {Array} errors - Array de erros
 * @returns {string} String formatada para exibição
 */
export function formatErrorsForDisplay(errors) {
  if (!errors || errors.length === 0) {
    return 'Build completed successfully'
  }

  let output = `Build failed with ${errors.length} issue(s):\n\n`

  errors.slice(0, 10).forEach((error, index) => {
    const icon = error.severity === 'error' ? '❌' : '⚠️'
    output += `${icon} ${error.file}:${error.line}:${error.column}\n`
    output += `   ${error.type.toUpperCase()}: ${error.message}\n`
    if (index < errors.length - 1) output += '\n'
  })

  if (errors.length > 10) {
    output += `\n... and ${errors.length - 10} more issues`
  }

  return output
}

/**
 * Cria um objeto de erro no formato do Monaco
 * @param {Object} error - Erro parseado
 * @returns {Object} Objeto compatible com Monaco problem format
 */
export function toMonacoProblem(error) {
  return {
    severity: error.severity === 'error' ? 8 : error.severity === 'warning' ? 4 : 2,
    message: error.message,
    startLineNumber: error.line,
    startColumn: error.column || 1,
    endLineNumber: error.line,
    endColumn: error.column + 1,
    source: error.type,
    relatedInformation: [
      {
        startLineNumber: error.line,
        startColumn: 1,
        message: `Click to jump to ${error.file}:${error.line}`,
        resource: error.file
      }
    ]
  }
}

/**
 * Extrai caminho relativo de erro para buscar no editor
 * @param {Object} error - Erro parseado
 * @param {string} projectPath - Caminho raiz do projeto
 * @returns {string} Caminho relativo
 */
export function getRelativeErrorPath(error, projectPath) {
  const filePath = error.file
  
  if (!projectPath) return filePath

  // Remover caminhos absolutos e normalizar
  if (filePath.includes(projectPath)) {
    return filePath.substring(projectPath.length).replace(/^[\\/]/, '')
  }

  return filePath
}

/**
 * Agrupa erros por arquivo
 * @param {Array} errors - Array de erros
 * @returns {Object} Objeto com arquivos como chave
 */
export function groupErrorsByFile(errors) {
  return errors.reduce((acc, error) => {
    if (!acc[error.file]) {
      acc[error.file] = []
    }
    acc[error.file].push(error)
    return acc
  }, {})
}

/**
 * Gera estatísticas de erros
 * @param {Array} errors - Array de erros
 * @returns {Object} Estatísticas
 */
export function getErrorStats(errors) {
  const stats = {
    total: errors.length,
    errors: 0,
    warnings: 0,
    notes: 0,
    files: new Set()
  }

  errors.forEach(error => {
    if (error.severity === 'error') stats.errors++
    else if (error.severity === 'warning') stats.warnings++
    else stats.notes++
    stats.files.add(error.file)
  })

  stats.files = stats.files.size

  return stats
}
