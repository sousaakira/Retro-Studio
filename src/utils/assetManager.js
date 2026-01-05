/**
 * Asset Manager para Retro Studio
 * Gerencia sprites, tiles, paletas e sons para Mega Drive
 */

/**
 * Tipos de assets suportados
 */
export const ASSET_TYPES = {
  SPRITE: 'sprite',
  TILE: 'tile',
  TILEMAP: 'tilemap',
  PALETTE: 'palette',
  SOUND: 'sound',
  BACKGROUND: 'background'
}

/**
 * Extensões de arquivo suportadas por tipo
 */
export const SUPPORTED_EXTENSIONS = {
  sprite: ['.png', '.jpg', '.jpeg', '.gif', '.bmp'],
  tile: ['.png', '.jpg', '.jpeg'],
  tilemap: ['.png', '.jpg', '.json'],
  palette: ['.pal', '.act', '.png'],
  sound: ['.wav', '.mp3', '.vgm'],
  background: ['.png', '.jpg', '.jpeg']
}

/**
 * Tamanhos padrão de sprites para Mega Drive
 */
export const SPRITE_SIZES = {
  '1x1': { width: 8, height: 8, tiles: 1 },
  '2x1': { width: 16, height: 8, tiles: 2 },
  '1x2': { width: 8, height: 16, tiles: 2 },
  '2x2': { width: 16, height: 16, tiles: 4 },
  '3x2': { width: 24, height: 16, tiles: 6 },
  '2x3': { width: 16, height: 24, tiles: 6 },
  '3x3': { width: 24, height: 24, tiles: 9 },
  '4x4': { width: 32, height: 32, tiles: 16 }
}

/**
 * Cria um novo asset com metadados
 */
export function createAsset(file, type, metadata = {}) {
  const now = new Date().toISOString()
  
  return {
    id: generateAssetId(),
    name: file.name || 'unnamed',
    type,
    size: file.size,
    path: '',
    extension: getFileExtension(file.name),
    createdAt: now,
    updatedAt: now,
    metadata: {
      width: 0,
      height: 0,
      colors: 0,
      ...metadata
    },
    preview: null, // Base64 encoded preview
    tags: [],
    description: ''
  }
}

/**
 * Gera ID único para asset
 */
export function generateAssetId() {
  return `asset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Extrai extensão do arquivo
 */
export function getFileExtension(filename) {
  const match = filename.match(/\.[^.]*$/)
  return match ? match[0].toLowerCase() : ''
}

/**
 * Valida se arquivo é do tipo suportado
 */
export function isValidAssetFile(filename, type) {
  const ext = getFileExtension(filename)
  const validExts = SUPPORTED_EXTENSIONS[type] || []
  return validExts.includes(ext)
}

/**
 * Detecta tipo de asset pelo arquivo
 */
export function detectAssetType(filename) {
  const ext = getFileExtension(filename).toLowerCase()
  
  for (const [type, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return type
    }
  }
  
  return null
}

/**
 * Cria preview de imagem (para sprites e tiles)
 */
export async function generateImagePreview(file, maxWidth = 100, maxHeight = 100) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      const img = new Image()
      
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxWidth / img.width, maxHeight / img.height)
        
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        
        resolve({
          data: canvas.toDataURL('image/png'),
          width: img.width,
          height: img.height
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
 * Processa arquivo de asset
 */
export async function processAssetFile(file, type) {
  // Validar tipo
  if (!isValidAssetFile(file.name, type)) {
    const ext = getFileExtension(file.name)
    const supportedTypes = []
    for (const [assetType, exts] of Object.entries(SUPPORTED_EXTENSIONS)) {
      if (exts.includes(ext)) {
        supportedTypes.push(assetType)
      }
    }
    
    const hint = supportedTypes.length > 0 
      ? `\n\n💡 Dica: Este arquivo é compatível com tipo(s): ${supportedTypes.join(', ')}`
      : ''
    
    throw new Error(`Tipo de arquivo inválido para ${type}: ${file.name}${hint}`)
  }

  // Criar asset base
  const asset = createAsset(file, type)

  // Gerar preview para imagens
  if (['sprite', 'tile', 'palette', 'background'].includes(type)) {
    try {
      const preview = await generateImagePreview(file)
      asset.preview = preview.data
      asset.metadata.width = preview.width
      asset.metadata.height = preview.height
    } catch (error) {
      console.warn('Falha ao gerar preview:', error)
    }
  }

  return asset
}

/**
 * Agrupa assets por tipo
 */
export function groupAssetsByType(assets) {
  const grouped = {}
  
  for (const type of Object.values(ASSET_TYPES)) {
    grouped[type] = assets.filter(a => a.type === type)
  }
  
  return grouped
}

/**
 * Busca assets por critério
 */
export function searchAssets(assets, query) {
  if (!query) return assets
  
  const q = query.toLowerCase()
  return assets.filter(asset => 
    asset.name.toLowerCase().includes(q) ||
    asset.description.toLowerCase().includes(q) ||
    asset.tags.some(tag => tag.toLowerCase().includes(q))
  )
}

/**
 * Ordena assets por critério
 */
export function sortAssets(assets, sortBy = 'name', order = 'asc') {
  const sorted = [...assets]
  
  sorted.sort((a, b) => {
    let aVal, bVal
    
    switch (sortBy) {
      case 'name':
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        break
      case 'date':
        aVal = new Date(a.createdAt).getTime()
        bVal = new Date(b.createdAt).getTime()
        break
      case 'size':
        aVal = a.size
        bVal = b.size
        break
      case 'type':
        aVal = a.type
        bVal = b.type
        break
      default:
        return 0
    }
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1
    if (aVal > bVal) return order === 'asc' ? 1 : -1
    return 0
  })
  
  return sorted
}

/**
 * Duplica asset
 */
export function duplicateAsset(asset) {
  const duplicate = JSON.parse(JSON.stringify(asset))
  duplicate.id = generateAssetId()
  duplicate.name = `${asset.name} (cópia)`
  duplicate.createdAt = new Date().toISOString()
  duplicate.updatedAt = new Date().toISOString()
  
  return duplicate
}

/**
 * Valida tamanho do arquivo
 */
export function validateFileSize(file, maxSizeMB = 10) {
  const maxBytes = maxSizeMB * 1024 * 1024
  return file.size <= maxBytes
}

/**
 * Formata tamanho de arquivo em bytes para string legível
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Exporta assets para formato compatível com Mega Drive
 */
export function exportAssetsMetadata(assets) {
  return {
    version: '1.0',
    exportDate: new Date().toISOString(),
    assets: assets.map(asset => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      path: asset.path,
      metadata: asset.metadata,
      tags: asset.tags,
      description: asset.description
    }))
  }
}

/**
 * Importa metadados de assets
 */
export function importAssetsMetadata(data) {
  if (!data.assets || !Array.isArray(data.assets)) {
    throw new Error('Formato de importação inválido')
  }
  
  return data.assets.map(asset => ({
    ...asset,
    id: generateAssetId(), // Gerar novo ID
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preview: null // Preview será regenerado
  }))
}

/**
 * Valida asset completo
 */
export function validateAsset(asset) {
  const errors = []
  
  if (!asset.id) errors.push('ID é obrigatório')
  if (!asset.name || asset.name.trim() === '') errors.push('Nome é obrigatório')
  if (!asset.type || !Object.values(ASSET_TYPES).includes(asset.type)) {
    errors.push('Tipo de asset inválido')
  }
  
  if (asset.metadata) {
    if (asset.metadata.width < 0) errors.push('Largura não pode ser negativa')
    if (asset.metadata.height < 0) errors.push('Altura não pode ser negativa')
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}
