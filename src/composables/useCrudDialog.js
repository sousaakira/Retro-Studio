/**
 * useCrudDialog - Estado e handlers do diálogo CRUD (criar/renomear/deletar arquivo/pasta).
 */
import { ref } from 'vue'

export function useCrudDialog(options = {}) {
  const {
    refreshTree,
    openFile,
    lastError,
    workspacePath,
    tabs,
    activePath,
    selectedNode,
    tree
  } = options

  const crudDialogOpen = ref(false)
  const crudDialogMode = ref(null)
  const crudDialogTitle = ref('')
  const crudDialogLabel = ref('')
  const crudDialogValue = ref('')
  const crudDialogTargetPath = ref(null)
  const crudDialogTargetKind = ref(null)

  function getSelectedDirPath() {
    if (!selectedNode?.value) return workspacePath?.value
    if (selectedNode.value.kind === 'dir') return selectedNode.value.path
    return selectedNode.value.path.split('/').slice(0, -1).join('/') || workspacePath?.value
  }

  function isSameOrInside(targetPath, basePath) {
    if (targetPath === basePath) return true
    const prefix = basePath.endsWith('/') ? basePath : basePath + '/'
    return targetPath.startsWith(prefix)
  }

  function openNewFile() {
    const parentDir = getSelectedDirPath()
    if (!parentDir) return
    crudDialogOpen.value = true
    crudDialogMode.value = 'newFile'
    crudDialogTitle.value = 'New file'
    crudDialogLabel.value = 'File name'
    crudDialogValue.value = ''
    crudDialogTargetPath.value = parentDir
    crudDialogTargetKind.value = 'dir'
  }

  function openNewFolder() {
    const parentDir = getSelectedDirPath()
    if (!parentDir) return
    crudDialogOpen.value = true
    crudDialogMode.value = 'newFolder'
    crudDialogTitle.value = 'New folder'
    crudDialogLabel.value = 'Folder name'
    crudDialogValue.value = ''
    crudDialogTargetPath.value = parentDir
    crudDialogTargetKind.value = 'dir'
  }

  function openRename() {
    if (!selectedNode?.value || selectedNode.value.path === workspacePath?.value) return
    crudDialogOpen.value = true
    crudDialogMode.value = 'rename'
    crudDialogTitle.value = 'Rename'
    crudDialogLabel.value = 'New name'
    crudDialogValue.value = selectedNode.value.name
    crudDialogTargetPath.value = selectedNode.value.path
    crudDialogTargetKind.value = selectedNode.value.kind
  }

  function openDelete() {
    if (!selectedNode?.value || selectedNode.value.path === workspacePath?.value) return
    crudDialogOpen.value = true
    crudDialogMode.value = 'delete'
    crudDialogTitle.value = 'Delete'
    crudDialogLabel.value = `Delete ${selectedNode.value.kind === 'dir' ? 'folder' : 'file'}: ${selectedNode.value.name}?`
    crudDialogValue.value = ''
    crudDialogTargetPath.value = selectedNode.value.path
    crudDialogTargetKind.value = selectedNode.value.kind
  }

  function closeCrudDialog() {
    crudDialogOpen.value = false
    crudDialogMode.value = null
    crudDialogTitle.value = ''
    crudDialogLabel.value = ''
    crudDialogValue.value = ''
    crudDialogTargetPath.value = null
    crudDialogTargetKind.value = null
  }

  async function handleCrudConfirm(value) {
    crudDialogValue.value = value
    await confirmCrudDialog()
  }

  async function confirmCrudDialog() {
    if (!crudDialogMode.value) return
    lastError.value = null

    try {
      if (crudDialogMode.value === 'newFile') {
        const parentDir = crudDialogTargetPath.value
        if (!parentDir) throw new Error('No target directory')
        const name = crudDialogValue.value.trim()
        if (!name) throw new Error('Name is required')
        const newPath = await window.retroStudio.createFile(parentDir, name)
        closeCrudDialog()
        await refreshTree()
        await openFile(newPath)
        return
      }

      if (crudDialogMode.value === 'newFolder') {
        const parentDir = crudDialogTargetPath.value
        if (!parentDir) throw new Error('No target directory')
        const name = crudDialogValue.value.trim()
        if (!name) throw new Error('Name is required')
        await window.retroStudio.createFolder(parentDir, name)
        closeCrudDialog()
        await refreshTree()
        return
      }

      if (crudDialogMode.value === 'rename') {
        const oldPath = crudDialogTargetPath.value
        if (!oldPath) throw new Error('No target path')
        const newName = crudDialogValue.value.trim()
        if (!newName) throw new Error('Name is required')
        const newPath = await window.retroStudio.renamePath(oldPath, newName)

        for (const t of tabs.value) {
          if (isSameOrInside(t.path, oldPath)) {
            t.path = newPath + t.path.slice(oldPath.length)
            if (t.path === newPath) t.name = newName
          }
        }
        if (activePath.value && isSameOrInside(activePath.value, oldPath)) {
          activePath.value = newPath + activePath.value.slice(oldPath.length)
        }

        closeCrudDialog()
        await refreshTree()
        return
      }

      if (crudDialogMode.value === 'delete') {
        const targetPath = crudDialogTargetPath.value
        if (!targetPath) throw new Error('No target path')
        await window.retroStudio.deletePath(targetPath)

        const remainingTabs = tabs.value.filter((t) => !isSameOrInside(t.path, targetPath))
        tabs.value.splice(0, tabs.value.length, ...remainingTabs)
        if (activePath.value && isSameOrInside(activePath.value, targetPath)) {
          activePath.value = tabs.value[0]?.path ?? null
        }

        closeCrudDialog()
        await refreshTree()
        selectedNode.value = tree.value
        return
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('confirmCrudDialog failed', e)
      lastError.value = msg
    }
  }

  return {
    crudDialogOpen,
    crudDialogMode,
    crudDialogTitle,
    crudDialogLabel,
    crudDialogValue,
    crudDialogTargetPath,
    crudDialogTargetKind,
    closeCrudDialog,
    handleCrudConfirm,
    openNewFile,
    openNewFolder,
    openRename,
    openDelete
  }
}
