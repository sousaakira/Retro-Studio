/**
 * Comandos do Command Palette - factory que recebe as ações
 */
import { computed } from 'vue'

export function useCommandPalette(actions) {
  const commandPaletteCommands = computed(() => [
    { id: 'file.new', label: 'Novo Arquivo', icon: '📄', category: 'file', keybinding: 'Ctrl+N', action: actions.createNewFile },
    { id: 'file.newFolder', label: 'Nova Pasta', icon: '📁', category: 'file', action: actions.createNewFolder },
    { id: 'file.save', label: 'Salvar', icon: '💾', category: 'file', keybinding: 'Ctrl+S', action: actions.saveActive },
    { id: 'file.saveAll', label: 'Salvar Tudo', icon: '💾', category: 'file', keybinding: 'Ctrl+K S', action: actions.saveAll },
    { id: 'edit.find', label: 'Buscar no Arquivo', icon: '🔍', category: 'edit', keybinding: 'Ctrl+F', action: actions.triggerFindInMonaco },
    { id: 'view.explorer', label: 'Mostrar Explorer', icon: '📂', category: 'view', keybinding: 'Ctrl+Shift+E', action: () => { actions.setActiveView('explorer') } },
    { id: 'view.search', label: 'Mostrar Busca', icon: '🔍', category: 'view', keybinding: 'Ctrl+Shift+F', action: () => { actions.setActiveView('search') } },
    { id: 'view.git', label: 'Mostrar Git', icon: '🌿', category: 'view', action: () => { actions.setActiveView('git') } },
    { id: 'view.resources', label: 'Mostrar Recursos Retro', icon: '🖼️', category: 'view', action: () => { actions.setActiveView('resources') } },
    { id: 'view.help', label: 'Abrir Ajuda SGDK (F1)', icon: '❓', category: 'view', action: actions.showHelp },
    { id: 'view.terminal', label: 'Abrir Terminal', icon: '💻', category: 'view', keybinding: 'Ctrl+`', action: actions.openTerminal },
    { id: 'view.aiChat', label: 'Abrir Chat IA', icon: '🤖', category: 'view', action: actions.openAIChat },
    { id: 'view.store', label: 'Abrir Loja de Assets', icon: '🛒', category: 'view', action: actions.showStoreModal },
    { id: 'git.commit', label: 'Git: Commit', icon: '✔️', category: 'git', description: 'Criar commit com mudanças staged', action: actions.gitCommit },
    { id: 'git.push', label: 'Git: Push', icon: '⬆️', category: 'git', description: 'Enviar commits para o remote', action: actions.gitPush },
    { id: 'git.pull', label: 'Git: Pull', icon: '⬇️', category: 'git', description: 'Baixar mudanças do remote', action: actions.gitPull },
    { id: 'git.refresh', label: 'Git: Atualizar Status', icon: '🔄', category: 'git', action: actions.loadGitStatus },
    { id: 'settings.open', label: 'Abrir Configurações', icon: '⚙️', category: 'settings', action: actions.openSettings },
    { id: 'window.reload', label: 'Recarregar Janela', icon: '🔄', category: 'window', action: () => location.reload() },
    { id: 'ai.undoCheckpoint', label: 'AI: Desfazer Última Edição', icon: '↩️', category: 'ai', description: 'Restaurar checkpoint anterior', action: () => actions.undoLastChange(actions.getActivePath()) },
    { id: 'ai.toggleAutocomplete', label: 'AI: Toggle Autocomplete', icon: '✨', category: 'ai', action: actions.toggleAutocomplete }
  ])

  return { commandPaletteCommands }
}
