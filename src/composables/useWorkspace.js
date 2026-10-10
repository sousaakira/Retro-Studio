/**
 * Workspace: open, pick, handlers
 */
export function useWorkspace({ workspacePath, tabs, activePath, lastError, refreshTree, beforeOpen, afterOpen }) {
  let opening = false
  async function openWorkspace(path) {
    if (!path || opening) return false
    opening = true
    let prepared = false
    lastError.value = null
    try {
      if (path !== workspacePath.value && beforeOpen) {
        prepared = await beforeOpen(path)
        if (!prepared) return false
      }
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
    } finally {
      opening = false
      afterOpen?.({ prepared })
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
