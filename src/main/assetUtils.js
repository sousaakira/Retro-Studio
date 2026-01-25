import path from 'path'
import fs from 'fs'
import { getProjectConfig } from './projectUtils.js'

export function getResourcePath(projectPath) {
  const config = getProjectConfig(projectPath)
  return path.join(projectPath, config.resourcePath || 'res')
}

/** Detectar tipo de asset pela extensão do arquivo */
export function detectAssetType(filename) {
  const ext = path.extname(filename).toLowerCase()
  
  // Paletas
  if (['.pal', '.act'].includes(ext)) return 'palette'
  
  // Sons
  if (['.wav', '.mp3', '.ogg', '.vgm', '.vgz'].includes(ext)) return 'sound'
  
  // Tilemaps (JSON e arquivo .res)
  if (['.json', '.res'].includes(ext)) return 'tilemap'
  
  // Imagens genéricas - retornar null para o usuário escolher
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) return null
  
  // Padrão
  return null
}

/** Escanear pasta de recursos e detectar assets (recursivamente) */
export function scanResourcesFolder(projectPath) {
  try {
    const resDir = getResourcePath(projectPath)
    const config = getProjectConfig(projectPath)
    
    if (!fs.existsSync(resDir)) {
      return {
        success: true,
        newAssets: [],
        unidentifiedAssets: []
      }
    }
    
    // Obter lista de arquivos na pasta (recursivamente)
    const getAllFiles = (dir) => {
      const files = []
      const entries = fs.readdirSync(dir)
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        try {
          const stats = fs.statSync(fullPath)
          if (stats.isFile()) {
            files.push(fullPath)
          } else if (stats.isDirectory()) {
            // Escanear subdiretório recursivamente
            files.push(...getAllFiles(fullPath))
          }
        } catch (e) {
          console.warn('[IPC] Erro ao acessar:', fullPath, e.message)
        }
      }
      
      return files
    }
    
    const allFiles = getAllFiles(resDir)
    
    // Filtrar arquivos já indexados (comparar por caminho relativo)
    const existingPaths = (config.assets || []).map(a => a.path)
    const newFiles = allFiles.filter(f => {
      const relPath = path.relative(projectPath, f)
      return !existingPaths.includes(relPath)
    })
    
    // Separar assets identificáveis dos que precisam de escolha
    const newAssets = []
    const unidentifiedAssets = []
    
    for (const fullPath of newFiles) {
      const filename = path.basename(fullPath)
      const stats = fs.statSync(fullPath)
      const detectedType = detectAssetType(filename)
      
      const assetInfo = {
        name: filename,
        size: stats.size,
        path: path.relative(projectPath, fullPath),
        createdAt: (stats.birthtime && stats.birthtime.toISOString()) || new Date().toISOString(),
        updatedAt: (stats.mtime && stats.mtime.toISOString()) || new Date().toISOString()
      }
      
      if (detectedType) {
        // Assets identificados automaticamente
        newAssets.push({
          ...assetInfo,
          type: detectedType,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          metadata: detectedType === 'palette' ? {} : {}
        })
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(path.extname(filename).toLowerCase())) {
        // Imagens que precisam de identificação
        unidentifiedAssets.push(assetInfo)
      }
    }
    
    console.log(`[IPC] Escaneo de recursos: ${newAssets.length} identificados, ${unidentifiedAssets.length} aguardando classificação`)
    
    return {
      success: true,
      newAssets,
      unidentifiedAssets
    }
  } catch (error) {
    console.error('[IPC] Erro ao escanear recursos:', error)
    return {
      success: false,
      error: error.message,
      newAssets: [],
      unidentifiedAssets: []
    }
  }
}
