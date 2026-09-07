/**
 * Resize de painéis: sidebar, terminal, painel IA (ACP)
 */
import { ref, computed } from 'vue'

export function useResizePanels({ layoutMonaco, fitTerminal, saveSettings }) {
  const sidebarWidth = ref(280)
  const isResizing = ref(false)
  const minSidebarWidth = 180
  const maxSidebarWidth = 600

  const terminalHeight = ref(250)
  const isResizingTerminal = ref(false)
  const minTerminalHeight = 100
  const maxTerminalHeight = 600

  const aiTerminalWidth = ref(450)
  const isResizingAITerminal = ref(false)
  const minAITerminalWidth = 300
  const maxAITerminalWidth = 800

  function startResize(e) {
    isResizing.value = true
    document.addEventListener('mousemove', onResize)
    document.addEventListener('mouseup', stopResize)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  function onResize(e) {
    if (!isResizing.value) return
    sidebarWidth.value = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, e.clientX))
    layoutMonaco?.()
  }

  function stopResize() {
    isResizing.value = false
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    layoutMonaco?.()
    saveSettings?.()
  }

  function startResizeTerminal(e) {
    isResizingTerminal.value = true
    document.addEventListener('mousemove', onResizeTerminal)
    document.addEventListener('mouseup', stopResizeTerminal)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  function onResizeTerminal(e) {
    if (!isResizingTerminal.value) return
    const appHeight = window.innerHeight - 36 - 22
    const mouseY = e.clientY - 36
    terminalHeight.value = Math.max(minTerminalHeight, Math.min(maxTerminalHeight, appHeight - mouseY))
    layoutMonaco?.()
    fitTerminal?.()
  }

  function stopResizeTerminal() {
    isResizingTerminal.value = false
    document.removeEventListener('mousemove', onResizeTerminal)
    document.removeEventListener('mouseup', stopResizeTerminal)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    layoutMonaco?.()
    fitTerminal?.()
    saveSettings?.()
  }

  function startResizeAITerminal(e) {
    isResizingAITerminal.value = true
    document.addEventListener('mousemove', onResizeAITerminal)
    document.addEventListener('mouseup', stopResizeAITerminal)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  function onResizeAITerminal(e) {
    if (!isResizingAITerminal.value) return
    aiTerminalWidth.value = Math.max(minAITerminalWidth, Math.min(maxAITerminalWidth, window.innerWidth - e.clientX))
  }

  function stopResizeAITerminal() {
    isResizingAITerminal.value = false
    document.removeEventListener('mousemove', onResizeAITerminal)
    document.removeEventListener('mouseup', stopResizeAITerminal)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    saveSettings?.()
  }

  const gridTemplateColumns = computed(() => `36px ${sidebarWidth.value}px 4px 1fr`)

  return {
    sidebarWidth,
    isResizing,
    terminalHeight,
    isResizingTerminal,
    aiTerminalWidth,
    isResizingAITerminal,
    gridTemplateColumns,
    startResize,
    startResizeTerminal,
    startResizeAITerminal,
    setSidebarWidth: (w) => { sidebarWidth.value = w },
    setTerminalHeight: (h) => { terminalHeight.value = h },
    setAiTerminalWidth: (w) => { aiTerminalWidth.value = w }
  }
}
