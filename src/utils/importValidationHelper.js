/**
 * Import Validation Helper
 * Valida assets antes de importação
 */

import { validateImageForMegaDrive } from './paletteValidator'

/**
 * Valida files antes de importar
 */
export async function validateAssetsBeforeImport(files, assetType) {
  // Validar paleta para sprites/tiles
  if (['sprite', 'tile'].includes(assetType)) {
    const validationResults = []
    
    for (const file of files) {
      const validation = await validateImageForMegaDrive(file)
      validationResults.push({
        filename: file.name,
        ...validation
      })
    }
    
    // Verificar se todas as imagens são válidas
    const invalidResults = validationResults.filter(r => !r.valid)
    
    if (invalidResults.length > 0) {
      const errorMsg = invalidResults
        .map(r => `${r.filename}: ${r.message}`)
        .join('\n')
      
      return {
        valid: false,
        message: `Erro de validação de paleta:\n${errorMsg}`,
        details: validationResults
      }
    }
    
    return {
      valid: true,
      message: `Todas as imagens validadas (${files.length} arquivo(s))`,
      details: validationResults
    }
  }
  
  // Outros tipos de assets não requerem validação
  return {
    valid: true,
    message: `Assets validados (${files.length} arquivo(s))`,
    details: []
  }
}
