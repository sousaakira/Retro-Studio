/**
 * Formatador de Código C para SGDK
 * Fornece formatação de código com várias opções de estilo
 */

/**
 * Opções padrão de formatação
 */
export const defaultFormatterOptions = {
  indentStyle: 'space', // 'space' ou 'tab'
  indentSize: 2, // Número de espaços se indentStyle === 'space'
  lineWidth: 100,
  insertSpaceAfterControlFlowStatements: true,
  insertSpaceAfterFunctionKeyword: true,
  insertSpaceBeforeOpenBrace: true,
  insertSpaceAfterComma: true,
  insertSpaceAfterSemicolon: true,
  removeTrailingWhitespace: true,
  insertFinalNewline: true
}

/**
 * Cria a string de indentação baseada nas opções
 */
function getIndent(options) {
  if (options.indentStyle === 'tab') {
    return '\t'
  }
  return ' '.repeat(options.indentSize)
}

/**
 * Remove espaços em branco desnecessários no final de linhas
 */
function removeTrailingWhitespace(code) {
  return code.split('\n').map(line => line.trimEnd()).join('\n')
}

/**
 * Adiciona nova linha final se necessário
 */
function ensureFinalNewline(code) {
  if (!code.endsWith('\n')) {
    return code + '\n'
  }
  return code
}

/**
 * Formata espaços ao redor de operadores e palavras-chave
 */
function formatSpacing(code, options) {
  let result = code

  // Espaço após palavras-chave de controle de fluxo
  if (options.insertSpaceAfterControlFlowStatements) {
    result = result.replace(/\b(if|else|while|for|switch|catch)\s*\(/g, '$1 (')
  }

  // Espaço após 'function'
  if (options.insertSpaceAfterFunctionKeyword) {
    result = result.replace(/function\s*\(/g, 'function (')
  }

  // Espaço antes de '{'
  if (options.insertSpaceBeforeOpenBrace) {
    result = result.replace(/\)\s*{/g, ') {')
    result = result.replace(/}\s*else\s*{/g, '} else {')
  }

  // Espaço após vírgula
  if (options.insertSpaceAfterComma) {
    result = result.replace(/,(?!\s)/g, ', ')
  }

  // Espaço após ponto-e-vírgula (mas não em for loops)
  if (options.insertSpaceAfterSemicolon) {
    result = result.replace(/;(?!\s|$)/g, '; ')
  }

  return result
}

/**
 * Formata indentação do código
 */
function formatIndentation(code, options) {
  const lines = code.split('\n')
  const indent = getIndent(options)
  let indentLevel = 0
  const formattedLines = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Pular linhas vazias
    if (!trimmed) {
      formattedLines.push('')
      continue
    }

    // Diminuir indentação para '}', 'case', 'default'
    if (trimmed.startsWith('}') || trimmed.startsWith('case ') || trimmed.startsWith('default:')) {
      indentLevel = Math.max(0, indentLevel - 1)
    }

    // Adicionar linha com indentação
    const indentedLine = indentLevel > 0 ? indent.repeat(indentLevel) + trimmed : trimmed

    formattedLines.push(indentedLine)

    // Aumentar indentação após '{'
    if (trimmed.endsWith('{')) {
      indentLevel++
    }

    // Casos especiais para 'case' e 'default'
    if (trimmed.startsWith('case ') || trimmed.startsWith('default:')) {
      indentLevel++
    }
  }

  return formattedLines.join('\n')
}

/**
 * Remove linhas em branco desnecessárias (máximo 2 linhas em branco consecutivas)
 */
function removeExcessiveBlankLines(code) {
  return code.replace(/\n{3,}/g, '\n\n')
}

/**
 * Formata comentários (espaço após //)
 */
function formatComments(code) {
  return code
    .replace(/\/\/(?!\s|\/)/g, '// ')
    .replace(/\/\*(?!\s)/g, '/* ')
    .replace(/(?<!\s)\*\//g, ' */')
}

/**
 * Função principal de formatação
 * @param {string} code - Código a ser formatado
 * @param {object} options - Opções de formatação (sobrescreve defaultFormatterOptions)
 * @returns {string} Código formatado
 */
export function formatCode(code, options = {}) {
  if (!code || typeof code !== 'string') {
    return code
  }

  // Mesclar com opções padrão
  const finalOptions = { ...defaultFormatterOptions, ...options }

  let formatted = code

  // Aplicar formatação na ordem correta
  formatted = removeTrailingWhitespace(formatted)
  formatted = formatComments(formatted)
  formatted = formatSpacing(formatted, finalOptions)
  formatted = formatIndentation(formatted, finalOptions)
  formatted = removeExcessiveBlankLines(formatted)

  if (finalOptions.removeTrailingWhitespace) {
    formatted = removeTrailingWhitespace(formatted)
  }

  if (finalOptions.insertFinalNewline) {
    formatted = ensureFinalNewline(formatted)
  }

  return formatted
}

/**
 * Formata código e retorna objeto com mudanças (para diff)
 */
export function formatCodeWithDiff(code, options = {}) {
  const formatted = formatCode(code, options)
  const hasChanges = code !== formatted

  return {
    code: formatted,
    hasChanges,
    originalLength: code.length,
    formattedLength: formatted.length
  }
}

/**
 * Obtém a indentação automática para uma nova linha
 * baseada na linha anterior
 */
export function getAutoIndentation(previousLine, options = {}) {
  const finalOptions = { ...defaultFormatterOptions, ...options }
  const indent = getIndent(finalOptions)

  if (!previousLine) return ''

  const trimmed = previousLine.trim()
  let indentLevel = 0

  // Contar indentação da linha anterior
  if (previousLine.startsWith('\t')) {
    indentLevel = (previousLine.match(/^\t+/) || [''])[0].length
  } else {
    indentLevel = Math.floor((previousLine.match(/^ +/) || [''])[0].length / finalOptions.indentSize)
  }

  // Aumentar indentação se a linha anterior termina com '{'
  if (trimmed.endsWith('{')) {
    indentLevel++
  }

  return indent.repeat(indentLevel)
}

/**
 * Formata apenas a indentação de linhas selecionadas
 */
export function formatSelectedLines(code, startLine, endLine, options = {}) {
  const lines = code.split('\n')
  const start = Math.max(0, startLine - 1)
  const end = Math.min(lines.length, endLine)

  // Formatar linhas selecionadas
  const selectedCode = lines.slice(start, end).join('\n')
  const formatted = formatCode(selectedCode, options)
  const formattedLines = formatted.split('\n')

  // Substituir linhas originais pelas formatadas
  const result = [
    ...lines.slice(0, start),
    ...formattedLines,
    ...lines.slice(end)
  ]

  return result.join('\n')
}
