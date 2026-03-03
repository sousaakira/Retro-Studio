/**
 * Carregar/salvar configurações da aplicação
 */
import { ref } from 'vue'

export function useAppSettings() {
  const editorSettings = ref({ fontSize: 14, wordWrap: 'off', tabSize: 2, minimap: true, lineNumbers: 'on' })
  const uiSettings = ref({ windowControlsPosition: 'left', theme: 'dark' })
  const terminalSettings = ref({ fontSize: 13, fontFamily: 'monospace', cursorBlink: true, cursorStyle: 'block' })
  const settingsDraft = ref({ fontSize: 14, wordWrap: 'off', tabSize: 2 })
  const uiSettingsDraft = ref({ windowControlsPosition: 'left' })
  const settingsDialogOpen = ref(false)

  async function loadSettings(panelState) {
    try {
      if (!window.retroStudio?.settings) return
      const settings = await window.retroStudio.settings.load()
      if (settings.editor) {
        editorSettings.value = {
          fontSize: settings.editor.fontSize ?? 14,
          wordWrap: settings.editor.wordWrap ?? 'off',
          tabSize: settings.editor.tabSize ?? 2,
          minimap: settings.editor.minimap !== false,
          lineNumbers: settings.editor.lineNumbers ?? 'on'
        }
      }
      if (settings.appearance) {
        uiSettings.value = {
          windowControlsPosition: settings.appearance.windowControlsPosition ?? 'left',
          theme: settings.appearance.theme ?? 'dark'
        }
      }
      if (settings.terminal) {
        terminalSettings.value = {
          fontSize: settings.terminal.fontSize ?? 13,
          fontFamily: settings.terminal.fontFamily ?? 'monospace',
          cursorBlink: settings.terminal.cursorBlink !== false,
          cursorStyle: settings.terminal.cursorStyle ?? 'block'
        }
      }
      if (settings.panels && panelState) {
        if (settings.panels.aiChat) {
          panelState.isAIChatOpen.value = settings.panels.aiChat.open ?? false
          panelState.aiChatWidth.value = settings.panels.aiChat.width ?? 400
        }
        if (settings.panels.terminal) {
          panelState.isTerminalOpen.value = settings.panels.terminal.open ?? false
          panelState.terminalHeight.value = settings.panels.terminal.height ?? 250
        }
        if (settings.panels.sidebar) {
          panelState.sidebarWidth.value = settings.panels.sidebar.width ?? 280
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function saveSettingsToFile(override = {}, panelState) {
    try {
      if (!window.retroStudio?.settings) return
      const current = await window.retroStudio.settings.load().catch(() => ({}))
      const base = {
        editor: { ...(current.editor || {}), ...editorSettings.value },
        appearance: { ...(current.appearance || {}), ...uiSettings.value },
        terminal: { ...(current.terminal || {}), ...terminalSettings.value },
        panels: panelState ? {
          ...(current.panels || {}),
          aiChat: { open: panelState.isAIChatOpen.value, width: panelState.aiChatWidth.value },
          terminal: { open: panelState.isTerminalOpen.value, height: panelState.terminalHeight.value },
          sidebar: { width: panelState.sidebarWidth.value }
        } : (current.panels || {}),
        store: current.store || {},
        ai: current.ai || {},
        recentWorkspaces: current.recentWorkspaces || []
      }
      const payload = { ...base, ...override }
      if (override.ai) {
        payload.ai = {
          provider: override.ai.provider,
          apiKey: override.ai.apiKey,
          endpoint: override.ai.apiUrl ?? override.ai.endpoint,
          model: override.ai.model,
          temperature: override.ai.temperature,
          maxTokens: override.ai.maxTokens
        }
      }
      if (override.store) {
        payload.store = { ...(base.store || {}), ...override.store }
      }
      await window.retroStudio.settings.save(payload)
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  return {
    editorSettings,
    uiSettings,
    terminalSettings,
    settingsDraft,
    uiSettingsDraft,
    settingsDialogOpen,
    loadSettings,
    saveSettingsToFile
  }
}
