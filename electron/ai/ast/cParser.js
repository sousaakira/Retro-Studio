/**
 * Parser de símbolos para C (.c / .h) - funções, macros, includes
 * Usa regex para não depender de tree-sitter (native). Adequado para SGDK/C.
 */

/**
 * Extrai símbolos de um arquivo C (conteúdo)
 * @param {string} content - Conteúdo do arquivo
 * @param {string} filePath - Caminho do arquivo (para referência)
 * @returns {{ functions: Array<{ name: string, line: number }>, macros: Array<{ name: string, line: number }>, includes: Array<{ path: string, line: number, system: boolean }> }}
 */
export function getSymbolsFromCFile(content, filePath = '') {
  const lines = content.split('\n')
  const functions = []
  const macros = []
  const includes = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // #include — system (<...>) vs local ("...")
    let m
    const incRe = /#\s*include\s*(?:<([^>]+)>|"([^"]+)")/
    if ((m = incRe.exec(line))) {
      const isSystem = m[1] != null
      includes.push({ path: m[1] || m[2] || '', line: lineNum, system: isSystem })
    }

    // #define MACRO
    const defRe = /#\s*define\s+(\w+)/
    if ((m = defRe.exec(line))) {
      macros.push({ name: m[1], line: lineNum })
    }

    // Função: retorno nome( ... ) { ou ;
    const fnRe = /^\s*(?:static\s+)?(?:inline\s+)?(?:[\w\s*:]+\s+)(\w+)\s*\([^)]*\)\s*(?:\s*\{|\s*;)/m
    if ((m = fnRe.exec(line))) {
      const name = m[1]
      if (!['if', 'for', 'while', 'switch'].includes(name)) {
        functions.push({ name, line: lineNum })
      }
    }
  }

  return { functions, macros, includes }
}

/**
 * Busca símbolos por nome em conteúdo C (usa getSymbolsFromCFile e filtra por query)
 */
export function findSymbolsInCContent(content, filePath, query) {
  const { functions, macros } = getSymbolsFromCFile(content, filePath)
  const q = query.toLowerCase()
  const results = []
  for (const f of functions) {
    if (f.name.toLowerCase().includes(q)) {
      results.push({ type: 'function', name: f.name, line: f.line })
    }
  }
  for (const m of macros) {
    if (m.name.toLowerCase().includes(q)) {
      results.push({ type: 'macro', name: m.name, line: m.line })
    }
  }
  return results
}
