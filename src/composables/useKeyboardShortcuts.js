/**
 * Atalhos de teclado globais
 */
export function useKeyboardShortcuts({
  showInlineDiff,
  rejectInlineDiff,
  showCtrlKPopup,
  cancelCtrlK,
  acceptInlineDiff,
  closeContextMenu,
  isRetroProject,
  showHelpViewer,
  saveActive,
  activeTab,
  triggerFindInMonaco,
  toggleAIChat,
  openSettings,
  toggleTerminal,
  showCommandPalette,
  handleBuildRetro
}) {
  return function onKeyDown(e) {
    if (!e.isTrusted) return
    if (e.key === 'Escape') {
      if (showInlineDiff.value) { rejectInlineDiff(); return }
      if (showCtrlKPopup.value) { cancelCtrlK(); return }
      closeContextMenu()
      return
    }
    if (e.key === 'Enter' && showInlineDiff.value) {
      e.preventDefault()
      acceptInlineDiff()
      return
    }
    const isCmdOrCtrl = e.metaKey || e.ctrlKey
    if (e.key === 'F1') {
      e.preventDefault()
      if (isRetroProject.value) showHelpViewer.value = true
    }
    if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
      e.preventDefault()
      saveActive()
    }
    if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
      const targetEl = e.target
      if (targetEl?.closest('.monaco-editor') && targetEl.matches('textarea.inputarea')) return
      e.preventDefault()
      if (activeTab.value) triggerFindInMonaco()
    }
    if (isCmdOrCtrl && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      toggleAIChat()
    }
    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === ',') {
      e.preventDefault()
      openSettings()
    }
    if (isCmdOrCtrl && e.key === '`') {
      e.preventDefault()
      toggleTerminal()
    }
    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault()
      showCommandPalette.value = true
    }
    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'b') {
      if (isRetroProject.value) {
        e.preventDefault()
        handleBuildRetro()
      }
    }
  }
}
