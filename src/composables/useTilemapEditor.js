/**
 * Abrir editor de tilemaps
 */
export function useTilemapEditor({ projectConfig, workspacePath }) {
  async function openTilemapEditorForFile(filePath) {
    const projectPath = projectConfig?.value?.path ?? workspacePath?.value ?? ''
    if (!projectPath || !window.retroStudio?.openTilemapEditor) return
    const base = projectPath.replace(/[/\\]+$/, '')
    const sep = filePath.includes('\\') ? '\\' : '/'
    const relativePath = filePath.startsWith(base) ? filePath.slice(base.length).replace(/^[/\\]/, '').replace(/\\/g, '/') : filePath.split(sep).pop() || filePath
    const name = relativePath.split('/').pop()?.replace(/\.tmx$/i, '') || 'map'
    const asset = { path: relativePath, name, type: 'tilemap' }
    let assets = []
    try { assets = (await window.retroStudio?.retro?.getProjectConfig?.(projectPath))?.assets || [] } catch (_) {}
    window.retroStudio.openTilemapEditor({ asset, projectPath, assets })
  }

  async function openTilemapEditorFromBar() {
    const path = projectConfig?.value?.path ?? workspacePath?.value ?? ''
    if (!path) return
    let assets = []
    try { assets = (await window.retroStudio?.retro?.getProjectConfig?.(path))?.assets || [] } catch (_) {}
    window.retroStudio?.openTilemapEditor?.({ asset: null, projectPath: path, assets })
  }

  return { openTilemapEditorForFile, openTilemapEditorFromBar }
}
