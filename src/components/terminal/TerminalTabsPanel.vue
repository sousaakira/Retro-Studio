<template>
  <div class="terminal-tabs-panel">
    <!-- Profile Bar -->
    <div class="profile-bar">
      <button 
        v-for="profile in profiles" 
        :key="profile.id"
        class="profile-btn"
        :class="{ active: selectedProfile === profile.id }"
        @click="selectedProfile = profile.id"
        :title="profile.description"
      >
        <i :class="`fas ${profile.icon}`" :style="{ color: profile.color }"></i>
        <span>{{ profile.name }}</span>
      </button>
      
      <div class="profile-actions">

        <!-- New terminal button -->
        <button 
          class="settings-btn"
          @click="createNewTerminal"
          title="New terminal (Ctrl+T)"
        >
          <i class="fas fa-plus"></i>
        </button>

        <!-- Standard actions -->
        <button 
          class="settings-btn"
          @click="showProfileSettings = !showProfileSettings"
          title="Terminal settings"
        >
          <i class="fas fa-cog"></i>
        </button>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="tab-bar" ref="tabBar">
      <div class="tabs-container" @wheel="handleTabScroll">
        <button
          v-for="terminal in filteredTerminals"
          :key="terminal.id"
          class="tab"
          :class="{ 
            active: terminal.isActive,
            [terminal.profile.toLowerCase()]: true 
          }"
          @click="switchToTab(terminal.id)"
          @contextmenu.prevent="showTabContextMenu($event, terminal)"
          :title="`${terminal.name} (${terminal.profile})`"
        >
          <i 
            :class="`fas ${getProfileIcon(terminal.profile)}`"
            :style="{ color: getProfileColor(terminal.profile) }"
          ></i>
          <span class="tab-name">{{ terminal.name }}</span>
          <button 
            class="tab-close"
            @click.stop="closeTerminal(terminal.id)"
            title="Close terminal"
          >
            <i class="fas fa-times"></i>
          </button>
        </button>
      </div>
    </div>

    <!-- Tab Context Menu -->
    <div 
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <button 
        class="context-menu-item"
        @click="duplicateTab"
        :disabled="!contextMenu.terminal"
      >
        <i class="fas fa-copy"></i> Duplicate Tab
      </button>
      <button 
        class="context-menu-item"
        @click="renameTab"
        :disabled="!contextMenu.terminal"
      >
        <i class="fas fa-edit"></i> Rename
      </button>
      <div class="context-menu-separator"></div>
      <button 
        class="context-menu-item"
        @click="closeTab"
        :disabled="!contextMenu.terminal"
      >
        <i class="fas fa-times"></i> Close Tab
      </button>
      <button 
        class="context-menu-item"
        @click="closeOtherTabs"
        :disabled="!contextMenu.terminal || filteredTerminals.length <= 1"
      >
        <i class="fas fa-times-circle"></i> Close Other Tabs
      </button>
      <div class="context-menu-separator"></div>
      <button 
        class="context-menu-item"
        @click="changeProfile"
        :disabled="!contextMenu.terminal"
      >
        <i class="fas fa-exchange-alt"></i> Change Profile
      </button>
    </div>

    <!-- Profile Settings Modal -->
    <div v-if="showProfileSettings" class="profile-settings-overlay" @click="showProfileSettings = false">
      <div class="profile-settings" @click.stop>
        <h3>Terminal Settings</h3>
        <div class="setting-group">
          <label>Default Font Size</label>
          <input 
            type="number" 
            v-model="defaultFontSize" 
            min="8" 
            max="24"
            class="setting-input"
          >
        </div>
        <div class="setting-group">
          <label>Max History</label>
          <input 
            type="number" 
            v-model="maxHistory" 
            min="100" 
            max="5000"
            class="setting-input"
          >
        </div>
        <div class="setting-group">
          <label class="checkbox-label">
            <input 
              type="checkbox" 
              v-model="syncWithIDETheme"
            >
            Sync with IDE Theme
          </label>
        </div>
        <div class="setting-actions">
          <button @click="showProfileSettings = false">Cancel</button>
          <button @click="saveSettings" class="primary">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useTerminalManager } from './TerminalManager.js'
import { TERMINAL_PROFILES, TERMINAL_SHORTCUTS } from './TerminalProfiles.js'

const emit = defineEmits(['tab-changed', 'terminal-created', 'terminal-closed'])

// Terminal Manager
const terminalManager = useTerminalManager()

// Reactive data
const selectedProfile = ref('CUSTOM')
const showProfileSettings = ref(false)
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  terminal: null
})
const tabBar = ref(null)
const defaultFontSize = ref(13)
const maxHistory = ref(1000)
const syncWithIDETheme = ref(true)

// Computed
const profiles = computed(() => Object.values(TERMINAL_PROFILES))
const terminals = computed(() => terminalManager.getAllTerminals())
const filteredTerminals = computed(() => {
  if (selectedProfile.value === 'ALL') {
    return terminals.value.sort((a, b) => b.lastActive - a.lastActive)
  }
  return terminals.value
    .filter(term => term.profile === selectedProfile.value)
    .sort((a, b) => b.lastActive - a.lastActive)
})


// Methods
const createNewTerminal = () => {
  const terminal = terminalManager.createTerminal('CUSTOM')
  emit('terminal-created', terminal)
}

const createTerminalWithProfile = () => {
  const terminal = terminalManager.createTerminal(selectedProfile.value)
  emit('terminal-created', terminal)
}

const switchToTab = (tabId) => {
  terminalManager.switchToTab(tabId)
  emit('tab-changed', tabId)
}

const closeTerminal = (tabId) => {
  terminalManager.closeTerminal(tabId)
  emit('terminal-closed', tabId)
}

const duplicateTab = () => {
  if (contextMenu.value.terminal) {
    const original = contextMenu.value.terminal
    const newTerminal = terminalManager.createTerminal(
      original.profile, 
      `${original.name} (Copy)`,
      original.cwd
    )
    emit('terminal-created', newTerminal)
  }
  hideContextMenu()
}

const renameTab = () => {
  if (contextMenu.value.terminal) {
    const newName = prompt('Enter terminal name:', contextMenu.value.terminal.name)
    if (newName && newName.trim()) {
      terminalManager.updateTerminal(contextMenu.value.terminal.id, {
        name: newName.trim()
      })
    }
  }
  hideContextMenu()
}

const closeTab = () => {
  if (contextMenu.value.terminal) {
    closeTerminal(contextMenu.value.terminal.id)
  }
  hideContextMenu()
}

const closeOtherTabs = () => {
  if (contextMenu.value.terminal) {
    const targetId = contextMenu.value.terminal.id
    const allTerminals = terminalManager.getAllTerminals()
    allTerminals.forEach(terminal => {
      if (terminal.id !== targetId) {
        closeTerminal(terminal.id)
      }
    })
  }
  hideContextMenu()
}

const changeProfile = () => {
  if (contextMenu.value.terminal) {
    // Open profile selector dialog
    const profiles = Object.values(TERMINAL_PROFILES)
    const profileNames = profiles.map(p => p.name).join('\n')
    const selectedIndex = prompt(`Select profile:\n${profileNames}`, '0')
    
    if (selectedIndex !== null && profiles[selectedIndex]) {
      terminalManager.updateTerminal(contextMenu.value.terminal.id, {
        profile: profiles[selectedIndex].id
      })
    }
  }
  hideContextMenu()
}

const getProfileIcon = (profileId) => {
  const profile = TERMINAL_PROFILES[profileId]
  return profile?.icon || 'fa-terminal'
}

const getProfileColor = (profileId) => {
  const profile = TERMINAL_PROFILES[profileId]
  return profile?.color || '#9C27B0'
}

const showTabContextMenu = (event, terminal) => {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    terminal
  }
}

const hideContextMenu = () => {
  contextMenu.value.visible = false
}

const handleTabScroll = (event) => {
  if (tabBar.value) {
    tabBar.value.scrollLeft += event.deltaY
  }
}

const saveSettings = () => {
  // Save terminal settings
  localStorage.setItem('retro-studio-terminal-settings', JSON.stringify({
    defaultFontSize: defaultFontSize.value,
    maxHistory: maxHistory.value,
    syncWithIDETheme: syncWithIDETheme.value
  }))
  
  // Apply to existing terminals
  terminals.value.forEach(terminal => {
    terminalManager.updateTerminal(terminal.id, {
      fontSize: defaultFontSize.value
    })
  })
  
  showProfileSettings.value = false
}



const loadSettings = () => {
  try {
    const settings = JSON.parse(localStorage.getItem('retro-studio-terminal-settings') || '{}')
    defaultFontSize.value = settings.defaultFontSize || 13
    maxHistory.value = settings.maxHistory || 1000
    syncWithIDETheme.value = settings.syncWithIDETheme !== false
  } catch (error) {
    console.warn('[TerminalTabsPanel] Error loading settings:', error)
  }
}

// Keyboard shortcuts
const handleKeyDown = (event) => {
  // Don't handle if in input field
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return
  
  let key = event.key
  
  if (event.ctrlKey || event.metaKey) {
    key = (event.ctrlKey ? 'Ctrl' : 'Cmd') + '+' + event.key
  } else if (event.altKey) {
    key = 'Alt+' + event.key
  }

  if (key === 'Ctrl+Tab') {
    event.preventDefault()
    const terminals = filteredTerminals.value
    const currentIndex = terminals.findIndex(t => t.isActive)
    const nextIndex = (currentIndex + 1) % terminals.length
    if (terminals[nextIndex]) {
      switchToTab(terminals[nextIndex].id)
    }
  } else if (key === 'Ctrl+Shift+Tab') {
    event.preventDefault()
    const terminals = filteredTerminals.value
    const currentIndex = terminals.findIndex(t => t.isActive)
    const prevIndex = currentIndex <= 0 ? terminals.length - 1 : currentIndex - 1
    if (terminals[prevIndex]) {
      switchToTab(terminals[prevIndex].id)
    }
  }
}

// Lifecycle
onMounted(() => {
  loadSettings()
  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('click', hideContextMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('click', hideContextMenu)
})

// Watch for profile changes
watch(selectedProfile, (newProfile) => {
  // Auto-switch to a terminal of the selected profile
  const terminals = terminalManager.getTerminalsByProfile(newProfile)
  if (terminals.length > 0 && !terminals.some(t => t.isActive)) {
    switchToTab(terminals[0].id)
  }
})
</script>

<style scoped>
.terminal-tabs-panel {
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
}

/* Profile Bar */
.profile-bar {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background: #252526;
  border-bottom: 1px solid #333;
  gap: 4px;
}

.profile-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.profile-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.profile-btn.active {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.profile-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: center;
}



.new-terminal-btn, .settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #ccc;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.2s;
}

.new-terminal-btn:hover, .settings-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Tab Bar */
.tab-bar {
  display: flex;
  align-items: center;
  overflow-x: auto;
  background: #2d2d30;
  min-height: 32px;
}

.tabs-container {
  display: flex;
  align-items: center;
  flex: 1;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: #ccc;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  transition: all 0.2s;
  margin-right: 2px;
  white-space: nowrap;
  position: relative;
  min-width: 0;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tab.active {
  background: #1e1e1e;
  color: #fff;
}

.tab.build {
  border-left: 3px solid #4CAF50;
}

.tab.debug {
  border-left: 3px solid #2196F3;
}

.tab.git {
  border-left: 3px solid #FF6B35;
}

.tab.custom {
  border-left: 3px solid #9C27B0;
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: #ccc;
  border-radius: 2px;
  opacity: 0.7;
  transition: all 0.2s;
  margin-left: 4px;
  flex-shrink: 0;
}

.tab-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.2);
}

.new-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 2px;
  border: 1px solid #555;
  background: transparent;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.new-tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: #777;
}

/* Context Menu */
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  padding: 4px 0;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: #cccccc;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.context-menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.context-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.context-menu-separator {
  height: 1px;
  background: #454545;
  margin: 4px 0;
}

/* Profile Settings */
.profile-settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
}

.profile-settings {
  background: #2d2d30;
  border: 1px solid #454545;
  border-radius: 6px;
  padding: 20px;
  min-width: 300px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.profile-settings h3 {
  margin: 0 0 16px 0;
  color: #fff;
  font-size: 16px;
}

.setting-group {
  margin-bottom: 16px;
}

.setting-group label {
  display: block;
  margin-bottom: 6px;
  color: #ccc;
  font-size: 13px;
}

.setting-input {
  width: 100%;
  padding: 6px 8px;
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
}

.setting-input:focus {
  outline: none;
  border-color: #007acc;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.setting-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.setting-actions button {
  padding: 6px 12px;
  border: 1px solid #555;
  background: transparent;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.setting-actions button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.setting-actions button.primary {
  background: #007acc;
  border-color: #007acc;
  color: #fff;
}

.setting-actions button.primary:hover {
  background: #005a9e;
}
</style>