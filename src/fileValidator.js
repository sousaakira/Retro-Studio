/**
 * File Validator
 * Valida caminhos de arquivo antes de tentar lê-los
 */

const fs = require('fs')

/**
 * Valida se uma string é um caminho de arquivo válido
 */
export function isValidFilePath(filePath) {
  // Verificar tipo
  if (!filePath || typeof filePath !== 'string') {
    return false
  }

  // Remover espaços
  const cleaned = filePath.trim()

  // Rejeitar linhas de erro de make
  if (cleaned.startsWith('make:') || cleaned.includes('***') || cleaned.includes('Error:')) {
    return false
  }

  // Rejeitar strings muito curtas ou apenas números
  if (cleaned.length < 5) {
    return false
  }

  // Verificar se parece um caminho
  if (!cleaned.includes('/') && !cleaned.includes('\\') && !cleaned.includes('.')) {
    return false
  }

  return true
}

/**
 * Lê arquivo com validação segura
 */
export function readFileSafely(filePath) {
  try {
    // Validar caminho
    if (!isValidFilePath(filePath)) {
      console.error('[readFileSafely] Caminho inválido:', filePath)
      return null
    }

    const cleanPath = filePath.trim()

    // Verificar se existe
    if (!fs.existsSync(cleanPath)) {
      console.error('[readFileSafely] Arquivo não encontrado:', cleanPath)
      return null
    }

    console.log('[readFileSafely] Lendo arquivo:', cleanPath)
    const content = fs.readFileSync(cleanPath, 'utf-8')
    return content
  } catch (error) {
    console.error('[readFileSafely] Erro ao ler arquivo:', error.message)
    return null
  }
}
