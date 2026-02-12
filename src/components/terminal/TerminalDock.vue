<template>
  <div class="terminal-dock" :style="{ height: height + 'px' }">
    <!-- Terminal Resizer -->
    <div class="terminal-resizer" @mousedown="startTerminalResize"></div>
    
    <!-- Terminal Tabs Panel -->
    <TerminalTabsPanel 
      @tab-changed="handleTabChanged"
      @terminal-created="handleTerminalCreated"
      @terminal-closed="handleTerminalClosed"
    />
    
    <!-- Terminal Content Area -->
    <div class="terminal-content">
      <EnhancedTerminalPanel
        v-if="activeTerminal && activeTerminal.id && activeTerminal.terminalId"
        :key="activeTerminal.id"
        :terminal-id="activeTerminal.terminalId"
        :profile="activeTerminal.profile"
        :cwd="activeTerminal.cwd"
        :font-size="activeTerminal.fontSize"
        :is-active="true"
      />
    </div>
    
    <!-- Status Bar -->
    <div class="terminal-status">
      <div class="status-left">
        <span class="status-item">
          <i :class="`fas ${getProfileIcon(activeTerminal?.profile)}`" 
             :style="{ color: getProfileColor(activeTerminal?.profile) }"></i>
          {{ activeTerminal?.name || 'No Terminal' }}
        </span>
        <span class="status-item">
          {{ activeTerminal?.cwd || 'No Directory' }}
        </span>
      </div>
      <div class="status-right">
        <span class="status-item">
          {{ terminals.length }} terminal{{ terminals.length !== 1 ? 's' : '' }}
        </span>
        <span class="status-item">
          {{ formatTime(activeTerminal?.lastActive) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useTerminalManager } from './TerminalManager.js';
import TerminalTabsPanel from './TerminalTabsPanel.vue';
import EnhancedTerminalPanel from './EnhancedTerminalPanel.vue';
import { getProfileById } from './TerminalProfiles.js';

const props = defineProps({
  height: {
    type: Number,
    default: 300
  }
});

const emit = defineEmits(['resize']);

// Composables
const store = useStore();
const terminalManager = useTerminalManager();

// Reactive data
const isResizing = ref(false);
const startY = ref(0);
const startHeight = ref(props.height);

// Computed
const terminals = computed(() => {
  try {
    return terminalManager.getAllTerminals()
  } catch (error) {
    console.error('[TerminalDock] Error getting terminals:', error)
    return []
  }
});

const activeTerminal = computed(() => {
  try {
    return terminalManager.getActiveTerminal()
  } catch (error) {
    console.error('[TerminalDock] Error getting active terminal:', error)
    return null
  }
});

// Methods
const handleTabChanged = (tabId) => {
  console.log(`[TerminalDock] Tab changed to ${tabId}`);
};

const handleTerminalCreated = (terminal) => {
  console.log(`[TerminalDock] Terminal created: ${terminal.name}`);
};

const handleTerminalClosed = (terminalId) => {
  console.log(`[TerminalDock] Terminal closed: ${terminalId}`);
};

const getProfileIcon = (profileId) => {
  const profile = getProfileById(profileId);
  return profile?.icon || 'fa-terminal';
};

const getProfileColor = (profileId) => {
  const profile = getProfileById(profileId);
  return profile?.color || '#9C27B0';
};

const formatTime = (timestamp) => {
  if (!timestamp) return 'Never';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) {
    return `${Math.floor(diff / 1000)}s ago`;
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  } else {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  }
};

const startTerminalResize = (event) => {
  isResizing.value = true;
  startY.value = event.clientY;
  startHeight.value = props.height;
  
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
};

const handleResize = (event) => {
  if (!isResizing.value) return;
  
  const deltaY = startY.value - event.clientY;
  const newHeight = Math.max(100, Math.min(800, startHeight.value + deltaY));
  
  emit('resize', newHeight);
};

const stopResize = () => {
  isResizing.value = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

// Keyboard shortcuts for terminal management
const ensureActiveTerminal = () => {
  const activeTerminal = terminalManager.getActiveTerminal();
  if (!activeTerminal) {
    // Create a default terminal if none exists
    terminalManager.createTerminal('CUSTOM');
    return terminalManager.getActiveTerminal();
  }
  return activeTerminal;
}

const handleKeyDown = (event) => {
  // Don't handle if in input field
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
  
  // Terminal-specific shortcuts
  if (event.ctrlKey || event.metaKey) {
    switch (event.key) {
      case 't':
        event.preventDefault();
        // Create new terminal with active profile
        const activeTerminal = ensureActiveTerminal();
        terminalManager.createTerminal(
          activeTerminal?.profile || 'CUSTOM',
          null,
          activeTerminal?.cwd
        );
        break;
        
      case 'w':
        event.preventDefault();
        // Close active terminal
        const currentActive = terminalManager.getActiveTerminal();
        if (currentActive && currentActive.id) {
          terminalManager.closeTerminal(currentActive.id);
        }
        break;
        
      case '`':
        event.preventDefault();
        // Toggle focus between editor and terminal
        // This will be handled by parent component
        break;
    }
  }
};

// Lifecycle
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  // Clean up resize listeners if still active
  if (isResizing.value) {
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});
</script>

<style scoped>
.terminal-dock {
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  border-top: 1px solid #333;
  position: relative;
  z-index: 100;
  min-height: 100px;
  max-height: 800px;
}

.terminal-resizer {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
  z-index: 101;
  background: transparent;
  transition: background 0.2s;
}

.terminal-resizer:hover {
  background: rgba(255, 255, 255, 0.1);
}

.terminal-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.terminal-hidden {
  position: absolute;
  top: -9999px;
  left: -9999px;
  visibility: hidden;
}

.terminal-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  background: #252526;
  border-top: 1px solid #333;
  padding: 0 12px;
  font-size: 11px;
  color: #ccc;
  flex-shrink: 0;
}

.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.8;
}

.status-item i {
  font-size: 10px;
}


</style>