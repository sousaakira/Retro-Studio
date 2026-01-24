<template>
  <div v-if="show" class="command-palette-overlay" @click.self="close">
    <div class="command-palette">
      <div class="palette-header">
        <i class="fas fa-terminal"></i>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Type a command or search..."
          class="palette-input"
          @input="filterCommands"
          @keydown.down="navigateDown"
          @keydown.up="navigateUp"
          @keydown.enter="executeSelected"
          @keydown.esc="close"
        />
      </div>
      
      <div class="palette-results" v-if="filteredCommands.length > 0">
        <div
          v-for="(command, index) in filteredCommands"
          :key="command.id"
          class="command-item"
          :class="{ selected: selectedIndex === index }"
          @click="executeCommand(command)"
        >
          <i :class="command.icon"></i>
          <div class="command-info">
            <div class="command-label">{{ command.label }}</div>
            <div class="command-description" v-if="command.description">
              {{ command.description }}
            </div>
          </div>
          <span v-if="command.shortcut" class="command-shortcut">
            {{ command.shortcut }}
          </span>
        </div>
      </div>
      
      <div v-else class="no-results">
        No commands found
      </div>
    </div>
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['close', 'execute'])

const inputRef = ref(null)
const query = ref('')
const selectedIndex = ref(0)

const commands = [
  { id: 'new-project', label: 'New Project', icon: 'fas fa-plus-circle', description: 'Create a new project from template' },
  { id: 'new-scene', label: 'New Scene', icon: 'fas fa-plus-circle', shortcut: 'Ctrl+N', description: 'Create a new scene' },
  { id: 'open-project', label: 'Open Project', icon: 'fas fa-folder-open', shortcut: 'Ctrl+O', description: 'Open a project folder' },
  { id: 'save', label: 'Save', icon: 'fas fa-save', shortcut: 'Ctrl+S', description: 'Save current file/scene' },
  { id: 'save-all', label: 'Save All', icon: 'fas fa-save', shortcut: 'Ctrl+K S', description: 'Save all open files' },
  { id: 'search', label: 'Search', icon: 'fas fa-search', shortcut: 'Ctrl+F', description: 'Search in files and resources' },
  { id: 'play', label: 'Play Game', icon: 'fas fa-play', shortcut: 'F5', description: 'Build and run the game' },
  { id: 'settings', label: 'Settings', icon: 'fas fa-cog', shortcut: 'Ctrl+,', description: 'Open settings' },
  { id: 'new-sprite', label: 'New Sprite', icon: 'fas fa-image', description: 'Create a new sprite resource' },
  { id: 'new-tile', label: 'New Tile', icon: 'fas fa-th', description: 'Create a new tile resource' },
  { id: 'new-palette', label: 'New Palette', icon: 'fas fa-palette', description: 'Create a new palette' },
  { id: 'export-scene', label: 'Export Scene', icon: 'fas fa-download', description: 'Export scene to C code' }
]

const filteredCommands = computed(() => {
  if (!query.value) return commands.slice(0, 10)
  
  const q = query.value.toLowerCase()
  return commands.filter(cmd => 
    cmd.label.toLowerCase().includes(q) ||
    cmd.description?.toLowerCase().includes(q) ||
    cmd.id.toLowerCase().includes(q)
  ).slice(0, 10)
})

const filterCommands = () => {
  selectedIndex.value = 0
}

const navigateDown = (e) => {
  e.preventDefault()
  selectedIndex.value = Math.min(selectedIndex.value + 1, filteredCommands.value.length - 1)
}

const navigateUp = (e) => {
  e.preventDefault()
  selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
}

const executeSelected = () => {
  if (filteredCommands.value[selectedIndex.value]) {
    executeCommand(filteredCommands.value[selectedIndex.value])
  }
}

const executeCommand = (command) => {
  emit('execute', command.id)
  close()
}

const close = () => {
  query.value = ''
  selectedIndex.value = 0
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})

// Keyboard shortcut: Ctrl+K or Cmd+K
const handleKeyDown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    if (props.show) {
      close()
    } else {
      emit('open')
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
.command-palette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 100px;
  z-index: 10003;
  backdrop-filter: blur(2px);
}

.command-palette {
  width: 600px;
  max-width: 90vw;
  background: #252525;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.palette-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
}

.palette-header i {
  color: #0066cc;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #ccc;
  font-size: 16px;
  outline: none;
}

.palette-input::placeholder {
  color: #666;
}

.palette-results {
  max-height: 400px;
  overflow-y: auto;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 1px solid #1e1e1e;
}

.command-item:hover,
.command-item.selected {
  background: #2a2a2a;
}

.command-item i {
  width: 20px;
  text-align: center;
  color: #0066cc;
}

.command-info {
  flex: 1;
  min-width: 0;
}

.command-label {
  color: #ccc;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 2px;
}

.command-description {
  color: #888;
  font-size: 12px;
}

.command-shortcut {
  color: #666;
  font-size: 11px;
  font-family: monospace;
  background: #1e1e1e;
  padding: 4px 8px;
  border-radius: 4px;
}

.no-results {
  padding: 40px;
  text-align: center;
  color: #666;
  font-size: 14px;
}
</style>
