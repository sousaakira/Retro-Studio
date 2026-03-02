import path from 'path'
import fs from 'fs'
import { getProjectConfig } from './projectUtils.js'

export function getResourcePath(projectPath) {
  const config = getProjectConfig(projectPath)
  return path.join(projectPath, config.resourcePath || 'res')
}

export function detectAssetType(filename) {
  const ext = path.extname(filename).toLowerCase()
  if (['.pal', '.act'].includes(ext)) return 'palette'
  if (['.wav', '.mp3', '.ogg', '.vgm', '.vgz'].includes(ext)) return 'sound'
  if (['.tmx', '.json', '.res'].includes(ext)) return 'tilemap'
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) return null
  return null
}

export function scanResourcesFolder(projectPath) {
  try {
    const resDir = getResourcePath(projectPath)
    const mapsDir = path.join(projectPath, 'maps')
    const config = getProjectConfig(projectPath)

    const getAllFiles = (dir) => {
      const files = []
      const entries = fs.readdirSync(dir)
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        try {
          const stats = fs.statSync(fullPath)
          if (stats.isFile()) files.push(fullPath)
          else if (stats.isDirectory()) files.push(...getAllFiles(fullPath))
        } catch (e) {
          console.warn('[Retro] Erro ao acessar:', fullPath, e.message)
        }
      }
      return files
    }

    const dirsToScan = [resDir]
    if (fs.existsSync(mapsDir)) dirsToScan.push(mapsDir)
    const allFiles = dirsToScan.flatMap((d) => (fs.existsSync(d) ? getAllFiles(d) : []))
    const existingPaths = (config.assets || []).map((a) => a.path)
    const newFiles = allFiles.filter((f) => {
      const relPath = path.relative(projectPath, f)
      return !existingPaths.includes(relPath)
    })

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
        newAssets.push({
          ...assetInfo,
          type: detectedType,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          metadata: detectedType === 'palette' ? {} : {}
        })
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(path.extname(filename).toLowerCase())) {
        unidentifiedAssets.push(assetInfo)
      }
    }

    return { success: true, newAssets, unidentifiedAssets }
  } catch (error) {
    console.error('[Retro] Erro ao escanear recursos:', error)
    return { success: false, error: error.message, newAssets: [], unidentifiedAssets: [] }
  }
}
