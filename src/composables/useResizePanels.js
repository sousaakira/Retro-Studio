/**
 * Resize de painéis: sidebar, AI chat, terminal
 */
import { ref, computed } from 'vue'

export function useResizePanels({ layoutMonaco, fitTerminal, saveSettings }) {
  const sidebarWidth = ref(280)
  const isResizing = ref(false)
  const minSidebarWidth = 180
  const maxSidebarWidth = 600

  const aiChatWidth = ref(400)
  const isResizingAIChat = ref(false)
  const minAIChatWidth = 300
  const maxAIChatWidth = 800

  const terminalHeight = ref(250)
  const isResizingTerminal = ref(false)
  const minTerminalHeight = 100
  const maxTerminalHeight = 600

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

  function startResizeAIChat(e) {
    isResizingAIChat.value = true
    document.addEventListener('mousemove', onResizeAIChat)
    document.addEventListener('mouseup', stopResizeAIChat)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  function onResizeAIChat(e) {
    if (!isResizingAIChat.value) return
    aiChatWidth.value = Math.max(minAIChatWidth, Math.min(maxAIChatWidth, window.innerWidth - e.clientX))
    layoutMonaco?.()
  }

  function stopResizeAIChat() {
    isResizingAIChat.value = false
    document.removeEventListener('mousemove', onResizeAIChat)
    document.removeEventListener('mouseup', stopResizeAIChat)
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

  const gridTemplateColumns = computed(() => `36px ${sidebarWidth.value}px 4px 1fr`)

  return {
    sidebarWidth,
    isResizing,
    aiChatWidth,
    isResizingAIChat,
    terminalHeight,
    isResizingTerminal,
    gridTemplateColumns,
    startResize,
    startResizeAIChat,
    startResizeTerminal,
    setSidebarWidth: (w) => { sidebarWidth.value = w },
    setAiChatWidth: (w) => { aiChatWidth.value = w },
    setTerminalHeight: (h) => { terminalHeight.value = h }
  }
}
