<template>
  <div 
    v-if="isOpen"
    class="dialog-overlay"
    @click.self="onCancel"
  >
    <div class="dialog-panel">
      <div class="dialog-title">{{ title }}</div>
      <div class="dialog-label">{{ label }}</div>

      <input
        v-if="mode !== 'delete'"
        ref="inputRef"
        v-model="localValue"
        type="text"
        class="dialog-input"
        @keydown.enter.prevent="onConfirm"
      />

      <div class="dialog-actions">
        <button class="btn btn--secondary" @click="onCancel">Cancelar</button>
        <button class="btn" :class="mode === 'delete' ? 'btn--danger' : 'btn--primary'" @click="onConfirm">
          {{ mode === 'delete' ? 'Deletar' : 'Confirmar' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  mode: {
    type: String, // 'newFile' | 'newFolder' | 'rename' | 'delete'
    default: 'newFile'
  },
  title: {
    type: String,
    default: ''
  },
  label: {
    type: String,
    default: ''
  },
  initialValue: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['confirm', 'cancel'])

const localValue = ref('')
const inputRef = ref(null)

watch(() => props.isOpen, (open) => {
  if (open) {
    localValue.value = props.initialValue
    nextTick(() => {
      if (inputRef.value) {
        inputRef.value.focus()
        inputRef.value.select()
      }
    })
  }
})

watch(() => props.initialValue, (val) => {
  localValue.value = val
})

function onConfirm() {
  emit('confirm', localValue.value.trim())
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 60;
  display: grid;
  place-items: center;
}

.dialog-panel {
  width: 440px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.dialog-title {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 14px;
}

.dialog-label {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 12px;
}

.dialog-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  font-size: 13px;
  margin-bottom: 14px;
  outline: none;
  transition: border-color 0.15s ease;
}

.dialog-input:focus {
  border-color: var(--accent);
}

.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.btn--secondary {
  background: var(--panel-2);
  border-color: var(--border);
  color: var(--text);
}

.btn--secondary:hover {
  background: rgba(255, 255, 255, 0.08);
}

.btn--primary {
  background: var(--accent);
  color: #fff;
}

.btn--primary:hover {
  background: #1a8ad4;
}

.btn--danger {
  background: var(--danger);
  color: #fff;
}

.btn--danger:hover {
  background: #e03535;
}
</style>
