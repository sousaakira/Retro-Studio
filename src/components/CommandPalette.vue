<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="isOpen" class="palette-overlay" @click="close">
        <div class="palette-container" @click.stop>
          <div class="palette-search">
            <span class="palette-icon">⌘</span>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              placeholder="Digite um comando ou busque arquivos..."
              @keydown="handleKeyDown"
              class="palette-input"
            />
          </div>
          
          <div v-if="filteredCommands.length > 0" class="palette-results">
            <div
              v-for="(cmd, idx) in filteredCommands"
              :key="cmd.id"
              :class="['palette-item', { active: idx === selectedIndex }]"
              @click="executeCommand(cmd)"
              @mouseenter="selectedIndex = idx"
            >
              <div class="palette-item-icon">{{ cmd.icon }}</div>
              <div class="palette-item-content">
                <div class="palette-item-title">{{ cmd.label }}</div>
                <div v-if="cmd.description" class="palette-item-description">
                  {{ cmd.description }}
                </div>
              </div>
              <div v-if="cmd.keybinding" class="palette-item-keybinding">
                {{ cmd.keybinding }}
              </div>
            </div>
          </div>
          
          <div v-else class="palette-empty">
            Nenhum comando encontrado
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  isOpen: Boolean,
  commands: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'execute'])

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref(null)

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedIndex.value = 0
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})

const filteredCommands = computed(() => {
  if (!query.value.trim()) {
    return props.commands.slice(0, 10)
  }
  
  const q = query.value.toLowerCase()
  return props.commands
    .filter(cmd => {
      return cmd.label.toLowerCase().includes(q) ||
             cmd.description?.toLowerCase().includes(q) ||
             cmd.category?.toLowerCase().includes(q)
    })
    .slice(0, 10)
})

watch(filteredCommands, () => {
  selectedIndex.value = 0
})

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredCommands.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const cmd = filteredCommands.value[selectedIndex.value]
    if (cmd) {
      executeCommand(cmd)
    }
  }
}

function executeCommand(cmd) {
  emit('execute', cmd)
  close()
}

function close() {
  emit('close')
}
</script>

<style scoped>
.palette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.palette-container {
  width: 600px;
  max-width: 90vw;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.palette-search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.palette-icon {
  font-size: 18px;
  color: var(--accent);
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 15px;
  font-family: inherit;
}

.palette-input::placeholder {
  color: var(--muted);
}

.palette-results {
  max-height: 400px;
  overflow-y: auto;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.1s ease;
  border-left: 2px solid transparent;
}

.palette-item:hover,
.palette-item.active {
  background: var(--hover);
  border-left-color: var(--accent);
}

.palette-item-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.palette-item-content {
  flex: 1;
  min-width: 0;
}

.palette-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 2px;
}

.palette-item-description {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-item-keybinding {
  font-size: 11px;
  color: var(--muted);
  font-family: monospace;
  background: var(--panel-2);
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.palette-empty {
  padding: 32px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

/* Animações */
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.2s ease;
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}

.palette-enter-active .palette-container,
.palette-leave-active .palette-container {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.palette-enter-from .palette-container,
.palette-leave-to .palette-container {
  opacity: 0;
  transform: translateY(-20px) scale(0.95);
}
</style>
