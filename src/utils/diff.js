/**
 * Diff Utility - Utilitário para calcular diferenças entre strings
 * Baseado no algoritmo do Void Editor
 */

/**
 * Algoritmo de diff simplificado (LCS-based)
 * Compara duas strings linha por linha
 * 
 * @param {string} oldStr - Texto original
 * @param {string} newStr - Texto novo
 * @returns {Array<{value: string, added: boolean, removed: boolean, count: number}>}
 */
export function diffLines(oldStr, newStr) {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  
  // LCS (Longest Common Subsequence) matrix
  const m = oldLines.length
  const n = newLines.length
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  // Preenche a matriz LCS
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  // Reconstrói o diff a partir da matriz
  const result = []
  let i = m
  let j = n
  const tempResult = []
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Linha igual
      tempResult.push({ value: oldLines[i - 1], added: false, removed: false, count: 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Linha adicionada
      tempResult.push({ value: newLines[j - 1], added: true, removed: false, count: 1 })
      j--
    } else {
      // Linha removida
      tempResult.push({ value: oldLines[i - 1], added: false, removed: true, count: 1 })
      i--
    }
  }
  
  // Reverte pois construímos de trás pra frente
  return tempResult.reverse()
}

/**
 * Encontra as diferenças entre dois textos
 * Retorna blocos de mudanças com contexto
 * 
 * @param {string} oldStr - Texto original
 * @param {string} newStr - Texto novo
 * @returns {Array<{type: 'edit'|'insertion'|'deletion', startLine: number, endLine: number, originalStartLine: number, originalEndLine: number, code: string, originalCode: string}>}
 */
export function findDiffs(oldStr, newStr) {
  // Normaliza as strings
  if (!oldStr.endsWith('\n')) oldStr += '\n'
  if (!newStr.endsWith('\n')) newStr += '\n'
  
  const lineByLineChanges = diffLines(oldStr, newStr)
  lineByLineChanges.push({ value: '', added: false, removed: false, count: 0 })
  
  let oldFileLineNum = 1
  let newFileLineNum = 1
  
  let streakStartInNewFile = undefined
  let streakStartInOldFile = undefined
  
  const oldStrLines = ['', ...oldStr.split('\n')]
  const newStrLines = ['', ...newStr.split('\n')]
  
  const replacements = []
  
  for (const line of lineByLineChanges) {
    if (!line.added && !line.removed) {
      if (streakStartInNewFile !== undefined) {
        let type = 'edit'
        
        const startLine = streakStartInNewFile
        const endLine = newFileLineNum - 1
        
        const originalStartLine = streakStartInOldFile
        const originalEndLine = oldFileLineNum - 1
        
        const newContent = newStrLines.slice(startLine, endLine + 1).join('\n')
        const originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')
        
        if (endLine === startLine - 1) {
          type = 'deletion'
        } else if (originalEndLine === originalStartLine - 1) {
          type = 'insertion'
        }
        
        replacements.push({
          type,
          startLine,
          endLine,
          originalStartLine,
          originalEndLine,
          code: newContent,
          originalCode: originalContent
        })
        
        streakStartInNewFile = undefined
        streakStartInOldFile = undefined
      }
      oldFileLineNum += line.count ?? 1
      newFileLineNum += line.count ?? 1
    } else if (line.removed) {
      if (streakStartInNewFile === undefined) {
        streakStartInNewFile = newFileLineNum
        streakStartInOldFile = oldFileLineNum
      }
      oldFileLineNum += line.count ?? 1
    } else if (line.added) {
      if (streakStartInNewFile === undefined) {
        streakStartInNewFile = newFileLineNum
        streakStartInOldFile = oldFileLineNum
      }
      newFileLineNum += line.count ?? 1
    }
  }
  
  return replacements
}

/**
 * Gera uma visualização de diff linha por linha
 * Cada linha tem um tipo: 'unchanged', 'added', 'removed', 'header'
 * 
 * @param {string} oldStr - Texto original
 * @param {string} newStr - Texto novo
 * @param {number} contextLines - Número de linhas de contexto (default: 3)
 * @returns {Array<{type: string, lineOld: number|null, lineNew: number|null, text: string}>}
 */
export function generateDiffView(oldStr, newStr, contextLines = 3) {
  const lines = diffLines(oldStr, newStr)
  const result = []
  
  let oldLineNum = 1
  let newLineNum = 1
  
  for (const line of lines) {
    if (line.added) {
      result.push({
        type: 'added',
        lineOld: null,
        lineNew: newLineNum,
        text: line.value
      })
      newLineNum++
    } else if (line.removed) {
      result.push({
        type: 'removed',
        lineOld: oldLineNum,
        lineNew: null,
        text: line.value
      })
      oldLineNum++
    } else {
      result.push({
        type: 'unchanged',
        lineOld: oldLineNum,
        lineNew: newLineNum,
        text: line.value
      })
      oldLineNum++
      newLineNum++
    }
  }
  
  // Compacta linhas iguais consecutivas se houver muitas
  if (contextLines > 0 && result.length > contextLines * 4) {
    const compacted = []
    let unchangedStreak = []
    let lastWasChange = false
    
    for (let i = 0; i < result.length; i++) {
      const line = result[i]
      const isChange = line.type !== 'unchanged'
      
      if (isChange) {
        // Se vinha de uma streak de unchanged, mantém só as últimas N linhas
        if (unchangedStreak.length > contextLines) {
          // Adiciona marcador de linhas omitidas
          compacted.push({
            type: 'collapse',
            lineOld: null,
            lineNew: null,
            text: `... ${unchangedStreak.length - contextLines} linhas omitidas ...`,
            count: unchangedStreak.length - contextLines
          })
          // Adiciona as últimas N linhas de contexto
          compacted.push(...unchangedStreak.slice(-contextLines))
        } else {
          compacted.push(...unchangedStreak)
        }
        unchangedStreak = []
        compacted.push(line)
        lastWasChange = true
      } else {
        unchangedStreak.push(line)
        
        // Se já tem mudança e está acumulando contexto depois
        if (lastWasChange && unchangedStreak.length === contextLines) {
          compacted.push(...unchangedStreak)
          unchangedStreak = []
          lastWasChange = false
        }
      }
    }
    
    // Processa o resto
    if (unchangedStreak.length > contextLines && lastWasChange) {
      compacted.push(...unchangedStreak.slice(0, contextLines))
      if (unchangedStreak.length > contextLines) {
        compacted.push({
          type: 'collapse',
          lineOld: null,
          lineNew: null,
          text: `... ${unchangedStreak.length - contextLines} linhas omitidas ...`,
          count: unchangedStreak.length - contextLines
        })
      }
    } else {
      compacted.push(...unchangedStreak)
    }
    
    return compacted
  }
  
  return result
}

/**
 * Verifica se duas strings são diferentes
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
export function hasChanges(a, b) {
  return a !== b
}

/**
 * Conta o número de mudanças (linhas adicionadas + removidas)
 * @param {string} oldStr 
 * @param {string} newStr 
 * @returns {{added: number, removed: number, total: number}}
 */
export function countChanges(oldStr, newStr) {
  const lines = diffLines(oldStr, newStr)
  let added = 0
  let removed = 0
  
  for (const line of lines) {
    if (line.added) added++
    if (line.removed) removed++
  }
  
  return { added, removed, total: added + removed }
}
