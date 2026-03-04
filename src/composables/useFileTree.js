/**
 * File tree: refresh, context menu, expanded state
 */
import { ref } from 'vue'

const CONTEXT_MENU_WIDTH = 240
const CONTEXT_MENU_HEIGHT = 250

export function useFileTree({
  workspacePath,
  tree,
  selectedNode,
  openFile,
  refreshTree,
  createNewFile,
  createNewFolder,
  renameSelected,
  deleteSelected,
  retroUiSettings,
  openTilemapEditorForFile
}) {
  const contextMenu = ref({ open: false, x: 0, y: 0, node: null })
  const expandedMap = ref({})

  function openContextMenu(payload) {
    selectedNode.value = payload.node
    const margin = 8
    const maxX = Math.max(margin, window.innerWidth - CONTEXT_MENU_WIDTH - margin)
    const maxY = Math.max(margin, window.innerHeight - CONTEXT_MENU_HEIGHT - margin)
    const x = Math.max(margin, Math.min(payload.x, maxX))
    const y = Math.max(margin, Math.min(payload.y, maxY))
    contextMenu.value = { open: true, x, y, node: payload.node }
  }

  function openTreeContextMenu(e) {
    if (!tree.value) return
    const node = selectedNode.value ?? tree.value
    openContextMenu({ node, x: e.clientX, y: e.clientY })
  }

  function closeContextMenu() {
    contextMenu.value = { open: false, x: 0, y: 0, node: null }
  }

  function onGlobalPointerDown(e) {
    if (!contextMenu.value.open) return
    if (e.target?.closest('[data-context-menu="file-tree"]')) return
    closeContextMenu()
  }

  function toggleDir(dirPath) {
    const isExpanded = expandedMap.value[dirPath] === true
    expandedMap.value = { ...expandedMap.value, [dirPath]: !isExpanded }
  }

  const contextMenuHandlers = {
    rename: () => { closeContextMenu(); renameSelected() },
    delete: () => { closeContextMenu(); deleteSelected() },
    newFile: () => { closeContextMenu(); createNewFile() },
    newFolder: () => { closeContextMenu(); createNewFolder() },
    open: () => {
      const n = contextMenu.value.node
      closeContextMenu()
      if (n?.kind === 'file') openFile(n.path)
    },
    refresh: async () => { closeContextMenu(); await refreshTree() },
    copyPath: () => {
      const n = contextMenu.value.node
      closeContextMenu()
      if (n) navigator.clipboard.writeText(n.path)
    },
    copyRelativePath: () => {
      const n = contextMenu.value.node
      closeContextMenu()
      if (n?.path && workspacePath.value) {
        navigator.clipboard.writeText(n.path.replace(workspacePath.value + '/', ''))
      }
    },
    editExternalImage: async () => {
      const n = contextMenu.value.node
      closeContextMenu()
      if (n?.path && retroUiSettings.value?.imageEditorPath) {
        await window.retroStudio?.retro?.openExternalEditor?.(retroUiSettings.value.imageEditorPath, n.path)
      }
    },
    editExternalMap: async () => {
      const n = contextMenu.value.node
      closeContextMenu()
      if (n?.path && retroUiSettings.value?.mapEditorPath) {
        await window.retroStudio?.retro?.openExternalEditor?.(retroUiSettings.value.mapEditorPath, n.path)
      }
    },
    editTilemap: async () => {
      const n = contextMenu.value.node
      closeContextMenu()
      if (n?.path) await openTilemapEditorForFile(n.path)
    }
  }

  return {
    contextMenu,
    contextMenuWidth: CONTEXT_MENU_WIDTH,
    expandedMap,
    openContextMenu,
    openTreeContextMenu,
    closeContextMenu,
    onGlobalPointerDown,
    toggleDir,
    contextMenuHandlers
  }
}
