/**
 * Project Asset Manager - Retro Studio (Monarco)
 * Usa retroStudio.retro para copy/register
 */

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
  await registerAssetInResources(projectPath, asset)
  return { success: true, path: assetPath }
}
