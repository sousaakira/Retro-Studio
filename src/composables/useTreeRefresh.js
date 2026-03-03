/**
 * Refresh da árvore de arquivos do workspace
 */
export function useTreeRefresh({ workspacePath, tree, selectedNode, lastError }) {
  return async function refreshTree() {
    if (!workspacePath.value) return
    lastError.value = null
    try {
      const selectedPath = selectedNode.value?.path ?? null
      tree.value = await window.retroStudio.listWorkspaceTree()
      if (!selectedPath || !tree.value) {
        selectedNode.value = tree.value
        return
      }
      const findByPath = (node) => {
        if (node.path === selectedPath) return node
        if (node.kind === 'dir' && node.children) {
          for (const c of node.children) {
            const found = findByPath(c)
            if (found) return found
          }
        }
        return null
      }
      selectedNode.value = findByPath(tree.value) ?? tree.value
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      console.error('refreshTree failed', e)
    }
  }
}
