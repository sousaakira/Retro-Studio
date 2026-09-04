/**
 * Definição dos comandos do Command Palette (Ctrl+Shift+P).
 *
 * Cada comando tem: id, label, icon, category, keybinding?, description?, action (função)
 * As actions são injetadas pelo App.vue ao construir o array.
 *
 * Uso: buildCommandPaletteCommands(actions) retorna o array de comandos.
 */
export function buildCommandPaletteCommands(actions, t = (k) => k) {
  return [
    { id: 'file.new', label: t('palette.fileNew'), icon: '📄', category: 'file', keybinding: 'Ctrl+N', action: actions.createNewFile },
    { id: 'file.newFolder', label: t('palette.fileNewFolder'), icon: '📁', category: 'file', action: actions.createNewFolder },
    { id: 'file.save', label: t('palette.fileSave'), icon: '💾', category: 'file', keybinding: 'Ctrl+S', action: actions.saveActive },
    { id: 'file.saveAll', label: t('palette.fileSaveAll'), icon: '💾', category: 'file', keybinding: 'Ctrl+K S', action: actions.saveAll },
    { id: 'edit.find', label: t('palette.editFind'), icon: '🔍', category: 'edit', keybinding: 'Ctrl+F', action: actions.triggerFindInMonaco },
    { id: 'view.explorer', label: t('palette.viewExplorer'), icon: '📂', category: 'view', keybinding: 'Ctrl+Shift+E', action: () => actions.setActiveView('explorer') },
    { id: 'view.search', label: t('palette.viewSearch'), icon: '🔍', category: 'view', keybinding: 'Ctrl+Shift+F', action: () => actions.setActiveView('search') },
    { id: 'view.git', label: t('palette.viewGit'), icon: '🌿', category: 'view', action: () => actions.setActiveView('git') },
    { id: 'view.resources', label: t('palette.viewResources'), icon: '🖼️', category: 'view', action: () => actions.setActiveView('resources') },
    { id: 'view.help', label: t('palette.viewHelp'), icon: '❓', category: 'view', action: actions.showHelp },
    { id: 'view.terminal', label: t('palette.viewTerminal'), icon: '💻', category: 'view', keybinding: 'Ctrl+`', action: actions.openTerminal },
    { id: 'view.ai', label: t('palette.viewAi'), icon: '🤖', category: 'view', keybinding: 'Ctrl+L', action: actions.openAITerminal },
    { id: 'view.store', label: t('palette.viewStore'), icon: '🛒', category: 'view', action: actions.showStoreModal },
    { id: 'git.commit', label: t('palette.gitCommit'), icon: '✔️', category: 'git', description: t('palette.gitCommitDesc'), action: actions.gitCommit },
    { id: 'git.push', label: t('palette.gitPush'), icon: '⬆️', category: 'git', description: t('palette.gitPushDesc'), action: actions.gitPush },
    { id: 'git.pull', label: t('palette.gitPull'), icon: '⬇️', category: 'git', description: t('palette.gitPullDesc'), action: actions.gitPull },
    { id: 'git.refresh', label: t('palette.gitRefresh'), icon: '🔄', category: 'git', action: actions.loadGitStatus },
    { id: 'settings.open', label: t('palette.settingsOpen'), icon: '⚙️', category: 'settings', action: actions.openSettings },
    { id: 'window.reload', label: t('palette.windowReload'), icon: '🔄', category: 'window', action: () => location.reload() },
    { id: 'ai.undoCheckpoint', label: t('palette.aiUndo'), icon: '↩️', category: 'ai', description: t('palette.aiUndoDesc'), action: () => actions.undoLastChange(actions.getActivePath()) },
    { id: 'ai.toggleAutocomplete', label: t('palette.aiAutocomplete'), icon: '✨', category: 'ai', action: actions.toggleAutocomplete }
  ]
}
