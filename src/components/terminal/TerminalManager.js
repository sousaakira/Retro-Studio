import { ref, reactive, computed } from 'vue'
import { useStore } from 'vuex'
import os from 'os'

export class TerminalManager {
  constructor() {
    this.terminals = reactive(new Map())
    this.activeTabId = ref(null)
    this.nextId = 1
    this.store = useStore()
    
    // Load saved terminals from localStorage
    this.loadFromStorage()
  }

  createTerminal(profile = 'CUSTOM', name = null, cwd = null) {
    const tabId = `term_${this.nextId++}`
    const terminalId = `terminal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Use provided cwd or get project path or home directory
    const terminalCwd = cwd || this.store.state.projectConfig?.path || os.homedir();
    
    const terminalInstance = reactive({
      id: tabId,
      terminalId, // Unique ID for backend PTY
      name: name || this.generateTerminalName(profile),
      profile: profile,
      cwd: terminalCwd,
      isActive: false,
      history: [],
      historyPosition: -1,
      fontSize: 13,
      theme: 'dark',
      created: Date.now(),
      lastActive: Date.now()
    })

    this.terminals.set(tabId, terminalInstance)
    
    // Auto-switch to new terminal
    this.switchToTab(tabId)
    
    // Save to storage
    this.saveToStorage()
    
    // Initialize terminal in backend
    this.initializeTerminal(terminalInstance)
    
    return terminalInstance
  }

  closeTerminal(tabId) {
    const terminal = this.terminals.get(tabId)
    if (!terminal) return

    // Cleanup backend terminal
    this.cleanupTerminal(terminal)
    
    // Remove from map
    this.terminals.delete(tabId)
    
    // If closing active terminal, switch to another
    if (this.activeTabId.value === tabId) {
      const remainingTerminals = Array.from(this.terminals.keys())
      if (remainingTerminals.length > 0) {
        this.switchToTab(remainingTerminals[remainingTerminals.length - 1])
      } else {
        this.activeTabId.value = null
      }
    }
    
    // Save to storage
    this.saveToStorage()
  }

  switchToTab(tabId) {
    if (!this.terminals.has(tabId)) return
    
    // Deactivate all terminals
    this.terminals.forEach(terminal => {
      terminal.isActive = false
    })
    
    // Activate selected terminal
    const terminal = this.terminals.get(tabId)
    terminal.isActive = true
    terminal.lastActive = Date.now()
    
    this.activeTabId.value = tabId
    
    // Focus terminal in backend
    this.focusTerminal(terminal)
  }

  getTerminal(tabId) {
    return this.terminals.get(tabId)
  }

  getActiveTerminal() {
    return this.terminals.get(this.activeTabId.value)
  }

  getAllTerminals() {
    return Array.from(this.terminals.values())
  }

  getTerminalsByProfile(profile) {
    return this.getAllTerminals().filter(term => term.profile === profile)
  }

  updateTerminal(tabId, updates) {
    const terminal = this.terminals.get(tabId)
    if (terminal) {
      Object.assign(terminal, updates)
      this.saveToStorage()
    }
  }

  addToHistory(tabId, command) {
    const terminal = this.terminals.get(tabId)
    if (!terminal) return
    
    // Avoid duplicates
    const history = terminal.history
    if (history.length === 0 || history[history.length - 1] !== command) {
      history.push(command)
      if (history.length > 1000) {
        history.shift() // Keep last 1000 commands
      }
    }
    
    terminal.historyPosition = history.length
    this.saveToStorage()
  }

  getPreviousCommand(tabId) {
    const terminal = this.terminals.get(tabId)
    if (!terminal) return null
    
    if (terminal.historyPosition > 0) {
      terminal.historyPosition--
      return terminal.history[terminal.historyPosition]
    }
    return null
  }

  getNextCommand(tabId) {
    const terminal = this.terminals.get(tabId)
    if (!terminal) return null
    
    if (terminal.historyPosition < terminal.history.length - 1) {
      terminal.historyPosition++
      return terminal.history[terminal.historyPosition]
    }
    
    terminal.historyPosition = terminal.history.length
    return ''
  }

  resetHistoryPosition(tabId) {
    const terminal = this.terminals.get(tabId)
    if (terminal) {
      terminal.historyPosition = terminal.history.length
    }
  }

  generateTerminalName(profile) {
    const profileNames = {
      'BUILD': 'Build Terminal',
      'DEBUG': 'Debug Terminal',
      'GIT': 'Git Terminal',
      'CUSTOM': 'Terminal'
    }
    
    const baseName = profileNames[profile] || 'Terminal'
    const count = this.getTerminalsByProfile(profile).length + 1
    
    return count > 1 ? `${baseName} ${count}` : baseName
  }

  initializeTerminal(terminal) {
    // Send initialization command to backend
    window.ipc?.send('terminal-spawn', {
      terminalId: terminal.terminalId,
      cwd: terminal.cwd,
      profile: terminal.profile
    })
  }

  cleanupTerminal(terminal) {
    // Send cleanup command to backend
    window.ipc?.send('terminal-cleanup', {
      terminalId: terminal.terminalId
    })
  }

  focusTerminal(terminal) {
    // Send focus command to backend
    window.ipc?.send('terminal-focus', {
      terminalId: terminal.terminalId
    })
  }

  saveToStorage() {
    try {
      const terminalsData = Array.from(this.terminals.values()).map(terminal => ({
        id: terminal.id,
        name: terminal.name,
        profile: terminal.profile,
        cwd: terminal.cwd,
        fontSize: terminal.fontSize,
        theme: terminal.theme,
        created: terminal.created,
        lastActive: terminal.lastActive
      }))
      
      localStorage.setItem('retro-studio-terminals', JSON.stringify({
        terminals: terminalsData,
        activeTabId: this.activeTabId.value,
        lastSaved: Date.now()
      }))
    } catch (error) {
      console.warn('[TerminalManager] Error saving to storage:', error)
    }
  }

  loadFromStorage() {
    try {
      const savedData = localStorage.getItem('retro-studio-terminals')
      if (!savedData) {
        // Create initial terminal if no saved data
        this.createTerminal('CUSTOM', 'Terminal')
        return
      }
      
      const data = JSON.parse(savedData)
      
      // Restore terminals and initialize them
      data.terminals?.forEach(terminalData => {
        // Generate new terminalId for backend
        const newTerminalId = `terminal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const terminal = reactive({
          ...terminalData,
          terminalId: newTerminalId, // Generate new ID for backend
          isActive: false,
          history: [],
          historyPosition: -1
        })
        this.terminals.set(terminal.id, terminal)
        
        // Initialize the terminal in backend
        this.initializeTerminal(terminal)
        
        // Update nextId to avoid conflicts
        const match = terminal.id.match(/term_(\d+)/)
        if (match) {
          this.nextId = Math.max(this.nextId, parseInt(match[1]) + 1)
        }
      })
      
      // Set active terminal
      if (data.activeTabId && this.terminals.has(data.activeTabId)) {
        this.switchToTab(data.activeTabId)
      } else if (this.terminals.size === 0) {
        // Create terminal if none exist
        this.createTerminal('CUSTOM', 'Terminal')
      }
    } catch (error) {
      console.warn('[TerminalManager] Error loading from storage:', error)
    }
  }

  clearStorage() {
    try {
      localStorage.removeItem('retro-studio-terminals')
    } catch (error) {
      console.warn('[TerminalManager] Error clearing storage:', error)
    }
  }

  // Computed properties
  get terminalCount() {
    return computed(() => this.terminals.size)
  }

  get activeTerminalId() {
    return computed(() => this.activeTabId.value)
  }
}

// Singleton instance
let terminalManagerInstance = null

export function useTerminalManager() {
  if (!terminalManagerInstance) {
    terminalManagerInstance = new TerminalManager()
  }
  return terminalManagerInstance
}