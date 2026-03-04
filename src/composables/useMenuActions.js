/**
 * Handler de ações do menu da aplicação
 */
export function useMenuActions({
  createNewFile,
  createNewFolder,
  showOpenWorkspaceModal,
  showNewRetroProjectModal,
  toggleAIChat,
  toggleTerminal,
  triggerFindInMonaco,
  triggerReplaceInMonaco,
  executeMonacoAction,
  getMonacoInstance,
  editorSettings,
  saveSettingsToFile,
  openSettings
}) {
  return function handleMenuAction(action) {
    switch (action) {
      case 'newFile': createNewFile(); break
      case 'newFolder': createNewFolder(); break
      case 'openFolder': showOpenWorkspaceModal.value = true; break
      case 'newRetroProject': showNewRetroProjectModal.value = true; break
      case 'toggleAIChat': toggleAIChat(); break
      case 'toggleTerminal': toggleTerminal(); break
      case 'find': triggerFindInMonaco(); break
      case 'replace': triggerReplaceInMonaco(); break
      case 'undo': executeMonacoAction('undo'); break
      case 'redo': executeMonacoAction('redo'); break
      case 'cut': executeMonacoAction('editor.action.clipboardCutAction'); break
      case 'copy': executeMonacoAction('editor.action.clipboardCopyAction'); break
      case 'paste':
        navigator.clipboard.readText()
          .then((text) => {
            const m = getMonacoInstance()
            if (m) m.trigger('keyboard', 'paste', { text })
          })
          .catch(() => executeMonacoAction('editor.action.clipboardPasteAction'))
        break
      case 'selectAll': executeMonacoAction('editor.action.selectAll'); break
      case 'zoomIn':
        editorSettings.value.fontSize = Math.min(30, editorSettings.value.fontSize + 1)
        saveSettingsToFile()
        break
      case 'zoomOut':
        editorSettings.value.fontSize = Math.max(10, editorSettings.value.fontSize - 1)
        saveSettingsToFile()
        break
      case 'resetZoom':
        editorSettings.value.fontSize = 14
        saveSettingsToFile()
        break
      case 'toggleFullscreen':
        document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
        break
      case 'about':
        alert('Retro Studio\nVersão 0.6.0\n\nIDE para desenvolvimento de jogos Sega Mega Drive\nElectron + Vue 3 + Monaco Editor + SGDK')
        break
      default: console.log('Menu action not implemented:', action)
    }
  }
}
