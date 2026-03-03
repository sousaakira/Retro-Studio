/**
 * Tabs: close, save, remove
 */
import { ref } from 'vue'

export function useTabs({ tabs, activePath, lastError }) {
  const closeConfirmOpen = ref(false)
  const closeConfirmTabPath = ref(null)
  const closeConfirmResolver = ref(null)

  function removeTab(filePath) {
    const idx = tabs.value.findIndex((t) => t.path === filePath)
    if (idx === -1) return
    const wasActive = activePath.value === filePath
    tabs.value.splice(idx, 1)
    if (wasActive) activePath.value = tabs.value[idx - 1]?.path ?? tabs.value[0]?.path ?? null
  }

  function askCloseDecision(filePath) {
    closeConfirmOpen.value = true
    closeConfirmTabPath.value = filePath
    return new Promise((resolve) => { closeConfirmResolver.value = resolve })
  }

  function resolveCloseDecision(decision) {
    closeConfirmOpen.value = false
    const r = closeConfirmResolver.value
    closeConfirmResolver.value = null
    closeConfirmTabPath.value = null
    r?.(decision)
  }

  async function closeTab(filePath) {
    const tab = tabs.value.find((t) => t.path === filePath)
    if (!tab) return
    if (!tab.dirty) { removeTab(filePath); return }
    const decision = await askCloseDecision(filePath)
    if (decision === 'cancel') return
    if (decision === 'save') {
      lastError.value = null
      try {
        await window.retroStudio.writeTextFile(tab.path, tab.value)
        tab.dirty = false
      } catch (e) {
        lastError.value = e instanceof Error ? e.message : String(e)
        console.error('closeTab save failed', e)
        return
      }
    }
    removeTab(filePath)
  }

  async function saveActive() {
    const tab = tabs.value.find((t) => t.path === activePath.value)
    if (!tab) return
    lastError.value = null
    try {
      await window.retroStudio.writeTextFile(tab.path, tab.value)
      tab.dirty = false
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      console.error('saveActive failed', e)
    }
  }

  async function saveAll() {
    lastError.value = null
    const dirty = tabs.value.filter((t) => t.dirty)
    for (const t of dirty) {
      await window.retroStudio.writeTextFile(t.path, t.value)
      t.dirty = false
    }
  }

  return {
    closeConfirmOpen,
    closeConfirmTabPath,
    closeConfirmResolver,
    removeTab,
    askCloseDecision,
    resolveCloseDecision,
    closeTab,
    saveActive,
    saveAll
  }
}
