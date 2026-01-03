/**
 * Palette Preview Generator
 * Gera preview visual de paletas em .pal, .act e .png
 */

/**
 * Extrai cores de um arquivo .pal (formato JASC PAL)
 * Formato: JASC-PAL (texto com header)
 */
export async function extractColorsFromPal(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const text = e.target.result
        const lines = text.split('\n')

        // Validar header JASC-PAL
        if (!lines[0]?.trim().startsWith('JASC-PAL')) {
          throw new Error('Arquivo não é um PAL válido (header JASC-PAL não encontrado)')
        }

        // Linha 1 geralmente é "0100" (versão)
        // Linha 2 é o número de cores
        const colorCount = parseInt(lines[2])
        if (isNaN(colorCount) || colorCount <= 0) {
          throw new Error('Contagem de cores inválida')
        }

        const colors = []
        for (let i = 0; i < colorCount && 3 + i < lines.length; i++) {
          const line = lines[3 + i].trim()
          if (!line) continue

          const parts = line.split(/\s+/)
          if (parts.length >= 3) {
            const r = parseInt(parts[0])
            const g = parseInt(parts[1])
            const b = parseInt(parts[2])

            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
              const hex = `#${[r, g, b]
                .map((x) => {
                  const hex = Math.min(255, Math.max(0, x)).toString(16)
                  return hex.length === 1 ? '0' + hex : hex
                })
                .join('')
                .toUpperCase()}`

              colors.push({
                r,
                g,
                b,
                hex,
                index: i
              })
            }
          }
        }

        resolve({
          colors,
          count: colors.length,
          format: 'JASC-PAL'
        })
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
    reader.readAsText(file)
  })
}

/**
 * Extrai cores de um arquivo .act (formato Adobe Color Table)
 * Formato: Binário puro de 768 bytes (256 cores × 3 bytes RGB)
 */
export async function extractColorsFromAct(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)

        if (data.length < 768) {
          throw new Error(`Arquivo .act deve ter 768 bytes, recebido ${data.length}`)
        }

        const colors = []
        for (let i = 0; i < 256; i++) {
          const r = data[i * 3]
          const g = data[i * 3 + 1]
          const b = data[i * 3 + 2]

          const hex = `#${[r, g, b]
            .map((x) => {
              const hex = x.toString(16)
              return hex.length === 1 ? '0' + hex : hex
            })
            .join('')
            .toUpperCase()}`

          colors.push({
            r,
            g,
            b,
            hex,
            index: i
          })
        }

        resolve({
          colors,
          count: 256,
          format: 'ACT'
        })
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Extrai cores únicas de uma imagem PNG (para paletas exportadas como PNG)
 */
export async function extractColorsFromImage(file) {
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
        const colorMap = new Map()

        // Extrair cores únicas
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]

          // Ignorar pixels totalmente transparentes
          if (a > 128) {
            const key = `${r},${g},${b}`
            if (!colorMap.has(key)) {
              colorMap.set(key, { r, g, b })
            }
          }
        }

        const colors = Array.from(colorMap.values()).map((color, index) => ({
          ...color,
          hex: `#${[color.r, color.g, color.b]
            .map((x) => {
              const hex = x.toString(16)
              return hex.length === 1 ? '0' + hex : hex
            })
            .join('')
            .toUpperCase()}`,
          index
        }))

        resolve({
          colors,
          count: colors.length,
          format: 'PNG'
        })
      }

      img.onerror = () => reject(new Error('Falha ao carregar imagem'))
      img.src = e.target.result
    }

    reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
    reader.readAsDataURL(file)
  })
}

/**
 * Extrai cores baseado na extensão do arquivo
 */
export async function extractPaletteColors(file) {
  const ext = file.name.toLowerCase().split('.').pop()

  try {
    let result
    if (ext === 'pal') {
      result = await extractColorsFromPal(file)
    } else if (ext === 'act') {
      result = await extractColorsFromAct(file)
    } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      result = await extractColorsFromImage(file)
    } else {
      throw new Error(`Formato não suportado: .${ext}`)
    }

    return result
  } catch (error) {
    console.error('[palettePreviewGenerator] Erro ao extrair cores:', error)
    throw error
  }
}

/**
 * Gera preview HTML de uma paleta
 */
export function generatePalettePreviewHTML(colors, maxPerRow = 16) {
  const rows = []

  for (let i = 0; i < colors.length; i += maxPerRow) {
    const rowColors = colors.slice(i, i + maxPerRow)
    const rowHTML = rowColors
      .map(
        (color) => `
      <div 
        class="palette-color" 
        style="background-color: ${color.hex};"
        title="${color.hex} (${color.r}, ${color.g}, ${color.b})"
      ></div>
    `
      )
      .join('')

    rows.push(`<div class="palette-row">${rowHTML}</div>`)
  }

  return `
    <div class="palette-preview">
      ${rows.join('')}
    </div>
  `
}

/**
 * Cria canvas preview de paleta
 */
export function generatePaletteCanvas(colors, squareSize = 20, maxPerRow = 16) {
  const canvas = document.createElement('canvas')
  const cols = Math.min(colors.length, maxPerRow)
  const rows = Math.ceil(colors.length / maxPerRow)

  canvas.width = cols * squareSize
  canvas.height = rows * squareSize

  const ctx = canvas.getContext('2d')

  colors.forEach((color, index) => {
    const row = Math.floor(index / maxPerRow)
    const col = index % maxPerRow
    const x = col * squareSize
    const y = row * squareSize

    ctx.fillStyle = color.hex
    ctx.fillRect(x, y, squareSize, squareSize)

    // Adicionar borda
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, squareSize, squareSize)
  })

  return canvas.toDataURL('image/png')
}
