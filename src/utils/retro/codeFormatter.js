/**
 * Formatador de Código C para SGDK
 */

export const defaultFormatterOptions = {
  indentStyle: 'space',
  indentSize: 2,
  insertSpaceAfterControlFlowStatements: true,
  insertSpaceAfterFunctionKeyword: true,
  insertSpaceBeforeOpenBrace: true,
  insertSpaceAfterComma: true,
  insertSpaceAfterSemicolon: true,
  removeTrailingWhitespace: true,
  insertFinalNewline: true
}

function getIndent(options) {
  return options.indentStyle === 'tab' ? '\t' : ' '.repeat(options.indentSize)
}

function removeTrailingWhitespace(code) {
  return code.split('\n').map(line => line.trimEnd()).join('\n')
}

function ensureFinalNewline(code) {
  return code.endsWith('\n') ? code : code + '\n'
}

function formatSpacing(code, options) {
  let result = code
  if (options.insertSpaceAfterControlFlowStatements) {
    result = result.replace(/\b(if|else|while|for|switch|catch)\s*\(/g, '$1 (')
  }
  if (options.insertSpaceAfterFunctionKeyword) {
    result = result.replace(/function\s*\(/g, 'function (')
  }
  if (options.insertSpaceBeforeOpenBrace) {
    result = result.replace(/\)\s*{/g, ') {')
    result = result.replace(/}\s*else\s*{/g, '} else {')
  }
  if (options.insertSpaceAfterComma) {
    result = result.replace(/,(?!\s)/g, ', ')
  }
  if (options.insertSpaceAfterSemicolon) {
    result = result.replace(/;(?!\s|$)/g, '; ')
  }
  return result
}

function formatIndentation(code, options) {
  const lines = code.split('\n')
  const indent = getIndent(options)
  let indentLevel = 0
  const formattedLines = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      formattedLines.push('')
      continue
    }
    if (trimmed.startsWith('}') || trimmed.startsWith('case ') || trimmed.startsWith('default:')) {
      indentLevel = Math.max(0, indentLevel - 1)
    }
    formattedLines.push(indentLevel > 0 ? indent.repeat(indentLevel) + trimmed : trimmed)
    if (trimmed.endsWith('{')) indentLevel++
    if (trimmed.startsWith('case ') || trimmed.startsWith('default:')) indentLevel++
  }
  return formattedLines.join('\n')
}

function removeExcessiveBlankLines(code) {
  return code.replace(/\n{3,}/g, '\n\n')
}

function formatComments(code) {
  return code
    .replace(/\/\/(?!\s|\/)/g, '// ')
    .replace(/\/\*(?!\s)/g, '/* ')
    .replace(/(?<!\s)\*\//g, ' */')
}

export function formatCode(code, options = {}) {
  if (!code || typeof code !== 'string') return code
  const opts = { ...defaultFormatterOptions, ...options }
  let formatted = removeTrailingWhitespace(code)
  formatted = formatComments(formatted)
  formatted = formatSpacing(formatted, opts)
  formatted = formatIndentation(formatted, opts)
  formatted = removeExcessiveBlankLines(formatted)
  if (opts.removeTrailingWhitespace) formatted = removeTrailingWhitespace(formatted)
  if (opts.insertFinalNewline) formatted = ensureFinalNewline(formatted)
  return formatted
}
