<template>
  <div class="quick-actions" v-if="show">
    <div class="actions-list">
      <div 
        v-for="action in actions" 
        :key="action.id"
        class="action-item"
        :class="{ disabled: action.disabled }"
        @click="!action.disabled && executeAction(action)"
      >
        <i :class="action.icon"></i>
        <span class="action-label">{{ action.label }}</span>
        <span v-if="action.shortcut" class="action-shortcut">{{ action.shortcut }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  context: {
    type: String,
    default: 'general' // 'general', 'node', 'resource', 'file'
  }
})

const emit = defineEmits(['action'])

const generalActions = [
  { id: 'new-scene', label: 'New Scene', icon: 'fas fa-plus-circle', shortcut: 'Ctrl+N' },
  { id: 'open-project', label: 'Open Project', icon: 'fas fa-folder-open', shortcut: 'Ctrl+O' },
  { id: 'save', label: 'Save', icon: 'fas fa-save', shortcut: 'Ctrl+S' },
  { id: 'search', label: 'Search', icon: 'fas fa-search', shortcut: 'Ctrl+F' },
  { id: 'settings', label: 'Settings', icon: 'fas fa-cog', shortcut: 'Ctrl+,', separator: true },
  { id: 'play', label: 'Play Game', icon: 'fas fa-play', shortcut: 'F5' }
]

const nodeActions = [
  { id: 'copy', label: 'Copy', icon: 'fas fa-copy', shortcut: 'Ctrl+C' },
  { id: 'paste', label: 'Paste', icon: 'fas fa-paste', shortcut: 'Ctrl+V' },
  { id: 'duplicate', label: 'Duplicate', icon: 'fas fa-clone', shortcut: 'Ctrl+D' },
  { id: 'delete', label: 'Delete', icon: 'fas fa-trash', shortcut: 'Del', separator: true },
  { id: 'rename', label: 'Rename', icon: 'fas fa-edit', shortcut: 'F2' }
]

const actions = computed(() => {
  switch(props.context) {
    case 'node':
      return nodeActions
    case 'resource':
      return [
        { id: 'edit', label: 'Edit', icon: 'fas fa-edit', shortcut: 'Enter' },
        { id: 'duplicate', label: 'Duplicate', icon: 'fas fa-clone', shortcut: 'Ctrl+D' },
        { id: 'delete', label: 'Delete', icon: 'fas fa-trash', shortcut: 'Del', separator: true },
        { id: 'rename', label: 'Rename', icon: 'fas fa-edit', shortcut: 'F2' }
      ]
    case 'file':
      return [
        { id: 'open', label: 'Open', icon: 'fas fa-folder-open', shortcut: 'Enter' },
        { id: 'reveal', label: 'Reveal in Explorer', icon: 'fas fa-folder', shortcut: '' },
        { id: 'delete', label: 'Delete', icon: 'fas fa-trash', shortcut: 'Del', separator: true },
        { id: 'rename', label: 'Rename', icon: 'fas fa-edit', shortcut: 'F2' }
      ]
    default:
      return generalActions
  }
})

const executeAction = (action) => {
  emit('action', action.id)
}
</script>

<style scoped>
.quick-actions {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #252525;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  z-index: 10002;
  min-width: 300px;
  max-width: 400px;
  overflow: hidden;
}

.actions-list {
  max-height: 400px;
  overflow-y: auto;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 1px solid #1e1e1e;
}

.action-item:hover:not(.disabled) {
  background: #2a2a2a;
}

.action-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-item i {
  width: 20px;
  text-align: center;
  color: #0066cc;
}

.action-label {
  flex: 1;
  color: #ccc;
  font-size: 14px;
}

.action-shortcut {
  color: #666;
  font-size: 11px;
  font-family: monospace;
  background: #1e1e1e;
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
