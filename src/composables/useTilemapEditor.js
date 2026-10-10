/**
 * Abrir editor de tilemaps
 */
export function useTilemapEditor({ projectConfig, workspacePath, openEmbedded }) {
  async function openTilemapEditorForFile(filePath) {
    const projectPath = workspacePath?.value ?? projectConfig?.value?.path ?? ''
    if (!projectPath || (!openEmbedded && !window.retroStudio?.openTilemapEditor)) return
    const base = projectPath.replace(/[/\\]+$/, '')
    const sep = filePath.includes('\\') ? '\\' : '/'
    const relativePath = filePath.startsWith(base) ? filePath.slice(base.length).replace(/^[/\\]/, '').replace(/\\/g, '/') : filePath.split(sep).pop() || filePath
    const name = relativePath.split('/').pop()?.replace(/\.tmx$/i, '') || 'map'
    const asset = { path: relativePath, name, type: 'tilemap' }
    let assets = []
    try { assets = (await window.retroStudio?.retro?.getProjectConfig?.(projectPath))?.assets || [] } catch (_) {}
    if (workspacePath && workspacePath.value !== projectPath) return false
    if (openEmbedded) return await openEmbedded({ asset, projectPath, assets })
    window.retroStudio.openTilemapEditor({ asset, projectPath, assets })
  }

  async function openTilemapEditorFromBar() {
    const path = workspacePath?.value ?? projectConfig?.value?.path ?? ''
    if (!path) return
    let assets = []
    try { assets = (await window.retroStudio?.retro?.getProjectConfig?.(path))?.assets || [] } catch (_) {}
    if (workspacePath && workspacePath.value !== path) return false
    if (openEmbedded) return await openEmbedded({ asset: null, projectPath: path, assets })
    window.retroStudio?.openTilemapEditor?.({ asset: null, projectPath: path, assets })
  }

  return { openTilemapEditorForFile, openTilemapEditorFromBar }
}
