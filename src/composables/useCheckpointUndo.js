/**
 * Sistema de checkpoint/undo para desfazer edições da IA
 */
import { ref } from 'vue'

const maxCheckpoints = 10

export function useCheckpointUndo(tabs, activePath, getMonacoInstance) {
  const fileCheckpoints = ref(new Map())

  function saveCheckpoint(filePath, content) {
    if (!filePath || !content) return
    let checkpoints = fileCheckpoints.value.get(filePath) || []
    checkpoints.push({ content, timestamp: new Date(), description: 'Before AI edit' })
    if (checkpoints.length > maxCheckpoints) {
      checkpoints = checkpoints.slice(-maxCheckpoints)
    }
    fileCheckpoints.value.set(filePath, checkpoints)
  }

  function undoLastChange(filePath) {
    const checkpoints = fileCheckpoints.value.get(filePath)
    if (!checkpoints || checkpoints.length === 0) {
      window.retroStudioToast?.warning('Nenhum checkpoint disponível para este arquivo')
      return false
    }
    const lastCheckpoint = checkpoints.pop()
    fileCheckpoints.value.set(filePath, checkpoints)
    const tab = tabs.value.find(t => t.path === filePath)
    if (tab) {
      tab.value = lastCheckpoint.content
      tab.dirty = true
      const monaco = getMonacoInstance()
      if (activePath.value === filePath && monaco) {
        const position = monaco.getPosition()
        monaco.setValue(lastCheckpoint.content)
        if (position) monaco.setPosition(position)
      }
      window.retroStudioToast?.success('Checkpoint restaurado!')
      return true
    }
    return false
  }

  return { fileCheckpoints, saveCheckpoint, undoLastChange }
}
