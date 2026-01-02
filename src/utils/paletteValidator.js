/**
 * Palette Validator para Mega Drive
 * Valida se imagens têm paletas compatíveis com Mega Drive (max 16 cores)
 */

/**
 * Extrai cores únicas de uma imagem
 */
export async function extractImageColors(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      const img = new Image()
      
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        
        const imageData = ctx.getImageData(0, 0, img.width, img.height)
        const data = imageData.data
        const colors = new Set()
        
        // Extrair cores (RGB)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          
          // Ignorar pixels transparentes
          if (a > 128) {
            colors.add(`${r},${g},${b}`)
          }
        }
        
        resolve({
          count: colors.size,
          colors: Array.from(colors).map(c => {
            const [r, g, b] = c.split(',').map(Number)
            return {
              r, g, b,
              hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
            }
          })
        })
      }
      
      img.onerror = () => reject(new Error('Falha ao carregar imagem para análise de cores'))
      img.src = e.target.result
    }
    
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
    reader.readAsDataURL(file)
  })
}

/**
 * Valida se imagem pode ser usada no Mega Drive (máx 16 cores por paleta)
 */
export async function validateImageForMegaDrive(file) {
  try {
    const { count, colors } = await extractImageColors(file)
    
    const isValid = count <= 16
    
    return {
      valid: isValid,
      colorCount: count,
      maxColors: 16,
      colors,
      message: isValid 
        ? `Imagem válida (${count} cores)`
        : `Imagem tem ${count} cores, máximo permitido é 16. Comprima a paleta antes de importar.`,
      severity: isValid ? 'success' : 'error'
    }
  } catch (error) {
    console.error('[paletteValidator] Erro ao validar imagem:', error)
    return {
      valid: false,
      colorCount: 0,
      error: error.message,
      message: `Erro ao validar imagem: ${error.message}`,
      severity: 'error'
    }
  }
}

/**
 * Valida múltiplas imagens
 */
export async function validateMultipleImages(files) {
  const results = []
  
  for (const file of files) {
    const validation = await validateImageForMegaDrive(file)
    results.push({
      filename: file.name,
      ...validation
    })
  }
  
  return {
    all_valid: results.every(r => r.valid),
    results,
    invalid_count: results.filter(r => !r.valid).length,
    total_count: results.length
  }
}

/**
 * Recomendações para reduzir cores
 */
export function getColorReductionTips(colorCount) {
  const tips = [
    'Use ferramentas como ImageMagick, GIMP ou Aseprite para reduzir cores',
    'Configure a imagem para 256 cores (8-bit) ou menos',
    'Use dithering se necessário para melhorar qualidade',
    'Considere usar sprites monocromáticos ou com paletas limitadas',
    'Para Mega Drive, máximo 16 cores opaco por paleta é o ideal'
  ]
  
  return {
    colorCount,
    maxAllowed: 16,
    excess: colorCount - 16,
    tips: tips,
    estimate: `Você precisa reduzir ${colorCount - 16} cores`
  }
}
