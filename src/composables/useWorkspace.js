/**
 * Workspace: open, pick, handlers
 */
export function useWorkspace({ workspacePath, tabs, activePath, lastError, refreshTree }) {
  async function openWorkspace(path) {
    if (!path) return
    lastError.value = null
    try {
      const openedPath = await window.retroStudio.workspace.openRecent(path)
      if (openedPath) {
        if (workspacePath.value !== openedPath) { tabs.value = []; activePath.value = null }
        workspacePath.value = openedPath
        await refreshTree()
        window.retroStudioToast?.success(`Workspace aberto: ${openedPath.split(/[/\\]/).pop() || openedPath}`, { duration: 2000 })
      }
    } catch (e) {
      console.error('Failed to open workspace:', e)
      window.retroStudioToast?.error(`Erro ao abrir workspace: ${e.message}`)
    }
  }

  async function pickWorkspace() {
    lastError.value = null
    try {
      const selected = await window.retroStudio.selectWorkspace()
      if (selected) await openWorkspace(selected)
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      console.error('pickWorkspace failed', e)
    }
  }

  return { openWorkspace, pickWorkspace }
}
