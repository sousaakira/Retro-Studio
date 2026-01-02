<template>
  <teleport to="body">
    <div
      v-if="show"
      class="fs-name-prompt-overlay"
      @click.self="handleCancel"
    >
      <div class="fs-name-prompt" @click.stop>
        <div class="prompt-title">{{ title }}</div>
        <input
          ref="inputRef"
          v-model="localValue"
          class="prompt-input"
          :placeholder="placeholder"
          spellcheck="false"
          @keydown.enter.prevent="handleConfirm"
          @keydown.esc.prevent="handleCancel"
        />
        <div class="prompt-actions">
          <button class="btn ghost" @click="handleCancel">Cancelar (Esc)</button>
          <button class="btn primary" :disabled="!localValue.trim()" @click="handleConfirm">
            Confirmar (Enter)
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { ref, watch, nextTick, defineProps, defineEmits } from 'vue'

const props = defineProps({
  show: Boolean,
  title: {
    type: String,
    default: 'Nome'
  },
  placeholder: {
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

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      localValue.value = props.initialValue || ''
      nextTick(() => {
        inputRef.value?.focus()
        // Seleciona nome sem extensão para facilitar renomeação
        const value = localValue.value
        if (value) {
          const dotIndex = value.lastIndexOf('.')
          if (dotIndex > 0) {
            inputRef.value?.setSelectionRange(0, dotIndex)
          } else {
            inputRef.value?.select()
          }
        }
      })
    } else {
      localValue.value = ''
    }
  }
)

const handleCancel = () => {
  emit('cancel')
}

const handleConfirm = () => {
  const trimmed = localValue.value.trim()
  if (!trimmed) return
  emit('confirm', trimmed)
}
</script>

<style scoped>
.fs-name-prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10002;
}

.fs-name-prompt {
  width: min(420px, 90vw);
  background: #1f1f1f;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
}

.prompt-title {
  font-size: 15px;
  margin-bottom: 12px;
  color: #e0e0e0;
}

.prompt-input {
  width: 100%;
  padding: 10px 12px;
  background: #151515;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  outline: none;
}

.prompt-input:focus {
  border-color: #0b84ff;
  box-shadow: 0 0 0 2px rgba(11, 132, 255, 0.25);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  border: none;
  border-radius: 4px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.2s ease, color 0.2s ease;
}

.btn.ghost {
  background: transparent;
  color: #aaa;
}

.btn.ghost:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.btn.primary {
  background: #0b84ff;
  color: #fff;
}

.btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn.primary:not(:disabled):hover {
  background: #1c92ff;
}
</style>
