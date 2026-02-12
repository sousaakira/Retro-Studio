export const TERMINAL_PROFILES = {
  BUILD: {
    id: 'BUILD',
    name: 'Build',
    icon: 'fa-hammer',
    color: '#4CAF50',
    defaultCommands: [
      'make clean',
      'make',
      'make run',
      'make debug'
    ],
    shortcuts: [
      { key: 'Ctrl+B', action: 'build' },
      { key: 'Ctrl+Shift+B', action: 'rebuild' }
    ],
    theme: {
      background: '#1a1a1a',
      foreground: '#4CAF50',
      cursor: '#81C784'
    },
    sgdkOptimized: true,
    description: 'Optimized for SGDK build processes'
  },
  
  DEBUG: {
    id: 'DEBUG',
    name: 'Debug',
    icon: 'fa-bug',
    color: '#2196F3',
    defaultCommands: [
      'gdb out/rom.out',
      'make debug',
      'objdump -d out/rom.out'
    ],
    shortcuts: [
      { key: 'F9', action: 'breakpoint' },
      { key: 'F5', action: 'continue' },
      { key: 'F10', action: 'step' },
      { key: 'F11', action: 'step_into' }
    ],
    theme: {
      background: '#0d1117',
      foreground: '#58A6FF',
      cursor: '#79C0FF'
    },
    sgdkOptimized: true,
    description: 'Ready for debugging with GDB'
  },
  
  GIT: {
    id: 'GIT',
    name: 'Git',
    icon: 'fa-code-branch',
    color: '#FF6B35',
    defaultCommands: [
      'git status',
      'git add .',
      'git commit -m ""',
      'git push',
      'git pull',
      'git log --oneline -10'
    ],
    shortcuts: [
      { key: 'Ctrl+G', action: 'git_status' },
      { key: 'Ctrl+Shift+C', action: 'git_commit' }
    ],
    theme: {
      background: '#0f0f0f',
      foreground: '#FF6B35',
      cursor: '#FF8A65'
    },
    sgdkOptimized: false,
    description: 'Git version control operations'
  },
  
  CUSTOM: {
    id: 'CUSTOM',
    name: 'Terminal',
    icon: 'fa-terminal',
    color: '#9C27B0',
    defaultCommands: [],
    shortcuts: [],
    theme: {
      background: '#121212',
      foreground: '#cccccc',
      cursor: '#00ff00'
    },
    sgdkOptimized: false,
    description: 'General purpose terminal'
  }
}

export const TERMINAL_SHORTCUTS = {
  TAB_OPERATIONS: {
    'Ctrl+T': 'createTerminal',
    'Ctrl+W': 'closeTerminal',
    'Ctrl+Tab': 'nextTerminal',
    'Ctrl+Shift+Tab': 'prevTerminal',
    'Ctrl+1': 'switchToTerminal1',
    'Ctrl+2': 'switchToTerminal2',
    'Ctrl+3': 'switchToTerminal3',
    'Ctrl+4': 'switchToTerminal4',
    'Ctrl+5': 'switchToTerminal5',
    'Ctrl+6': 'switchToTerminal6',
    'Ctrl+7': 'switchToTerminal7',
    'Ctrl+8': 'switchToTerminal8',
    'Ctrl+9': 'switchToTerminal9',
    'Ctrl+0': 'switchToTerminal10'
  },
  
  PROFILE_OPERATIONS: {
    'Alt+B': 'createBuildTerminal',
    'Alt+D': 'createDebugTerminal', 
    'Alt+G': 'createGitTerminal',
    'Alt+T': 'createCustomTerminal',
    'Ctrl+Shift+T': 'createTerminalWithProfile'
  },
  
  TERMINAL_OPERATIONS: {
    'Ctrl+C': 'copyOrInterrupt',
    'Ctrl+V': 'paste',
    'Ctrl+L': 'clearTerminal',
    'Ctrl+A': 'selectAll',
    'Ctrl+F': 'findInTerminal',
    'Ctrl+Plus': 'increaseFontSize',
    'Ctrl+Minus': 'decreaseFontSize',
    'Ctrl+0': 'resetFontSize',
    'Ctrl+R': 'searchHistory',
    'Ctrl+D': 'duplicateTab',
    'Alt+W': 'closeOtherTabs'
  }
}

export function getProfileById(profileId) {
  return TERMINAL_PROFILES[profileId] || TERMINAL_PROFILES.CUSTOM
}

export function getProfiles() {
  return Object.values(TERMINAL_PROFILES)
}

export function getProfileShortcuts(profileId) {
  const profile = getProfileById(profileId)
  return profile?.shortcuts || []
}

export function createTerminalCommand(command, profile = 'CUSTOM') {
  const profileObj = getProfileById(profile)
  
  if (profileObj.sgdkOptimized) {
    // SGDK-specific command optimization
    return optimizeSGDKCommand(command)
  }
  
  return command
}

export function optimizeSGDKCommand(command) {
  // Common SGDK optimizations
  const optimizations = {
    'make': 'make -j4', // Parallel build
    'make clean': 'make clean && rm -f out/*',
    'make run': 'make && gen_sdl2 out/rom.bin',
    'make debug': 'make DEBUG=1'
  }
  
  return optimizations[command.trim()] || command
}

export function getSGDKPatterns() {
  return {
    error: /^(.*?):(\d+):\d+?:\s*error:\s*(.*)$/,
    warning: /^(.*?):(\d+):\d+?:\s*warning:\s*(.*)$/,
    note: /^(.*?):(\d+):\d+?:\s*note:\s*(.*)$/,
    sgdkError: /^Error:\s*(.*)$/,
    sgdkWarning: /^Warning:\s*(.*)$/,
    buildComplete: /build\s+complete/i,
    linkComplete: /link\s+complete/i,
    compilationComplete: /compilation\s+complete/i
  }
}

export function parseSGDKOutput(output) {
  const patterns = getSGDKPatterns()
  const lines = output.split('\n')
  const parsed = []
  
  lines.forEach((line, index) => {
    const lineData = { text: line, line: index + 1 }
    
    // Check for error patterns
    for (const [type, pattern] of Object.entries(patterns)) {
      const match = line.match(pattern)
      if (match) {
        lineData.type = type
        lineData.severity = getSeverity(type)
        lineData.file = match[1]
        lineData.lineNumber = parseInt(match[2])
        lineData.message = match[3] || match[1] // For patterns without file/line
        
        // Create clickable action
        if (lineData.file && lineData.lineNumber) {
          lineData.action = {
            type: 'openFile',
            file: lineData.file,
            line: lineData.lineNumber,
            column: 0
          }
        }
        
        break
      }
    }
    
    parsed.push(lineData)
  })
  
  return parsed
}

function getSeverity(type) {
  const severityMap = {
    error: 'error',
    warning: 'warning', 
    note: 'info',
    sgdkError: 'error',
    sgdkWarning: 'warning',
    buildComplete: 'success',
    linkComplete: 'success',
    compilationComplete: 'success'
  }
  
  return severityMap[type] || 'info'
}