/**
 * Project Asset Manager - Retro Studio (Monarco)
 * Usa retroStudio.retro para copy/register
 */

import { soundResourceEntry } from '../../../shared/retro/audioConfiguration.js'

/** '' means the file is kept in the project but has no rescomp line (audio previews). */
export function generateResourceEntry(asset) {
  const filename = asset.name.replace(/\.\w+$/, '')
  const typeMap = {
    sprite: 'IMAGE',
    tile: 'IMAGE',
    tilemap: 'TILEMAP',
    palette: 'PALETTE',
    sound: 'SOUND',
    background: 'IMAGE',
    scene: 'TILEMAP'
  }
  const type = typeMap[asset.type] || 'IMAGE'
  const resourceName = filename.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (asset.type === 'sound') return soundResourceEntry(resourceName, asset.name)
  return `${type} ${resourceName} "${asset.name}" 0`
}

export async function copyAssetToProject(file, projectPath) {
  const buffer = await file.arrayBuffer()
  const result = await window.retroStudio?.retro?.copyAssetToProject?.(
    projectPath,
    file.name,
    Array.from(new Uint8Array(buffer))
  )
  if (!result?.success) throw new Error(result?.error || 'Falha ao copiar')
  return result.assetPath
}

export async function registerAssetInResources(projectPath, asset) {
  const resourceEntry = generateResourceEntry(asset)
  if (!resourceEntry) return { success: true, skipped: true }
  const result = await window.retroStudio?.retro?.registerAssetResource?.(
    projectPath,
    resourceEntry,
    asset.name
  )
  if (!result?.success) throw new Error(result?.error || 'Falha ao registrar')
  return result
}

export async function importAssetToProject(file, projectPath, asset) {
  const assetPath = await copyAssetToProject(file, projectPath)
  asset.path = assetPath
  // #42: a file saved under another name (the original name held other content) is registered under the name it got.
  const savedName = String(assetPath || '').replace(/\\/g, '/').split('/').pop()
  if (savedName && savedName !== file.name) asset.name = savedName
  await registerAssetInResources(projectPath, asset)
  return { success: true, path: assetPath }
}
