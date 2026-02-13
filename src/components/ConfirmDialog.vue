<template>
  <div 
    v-if="isOpen"
    class="dialog-overlay"
    @click.self="onCancel"
  >
    <div class="dialog-panel">
      <div class="dialog-title">{{ title }}</div>
      <div class="dialog-message">{{ message }}</div>
      <div class="dialog-actions">
        <button class="btn btn--secondary" @click="onCancel">{{ cancelText }}</button>
        <button v-if="showDiscard" class="btn btn--secondary" @click="onDiscard">{{ discardText }}</button>
        <button class="btn btn--primary" @click="onConfirm">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: 'Confirmação'
  },
  message: {
    type: String,
    default: 'Tem certeza?'
  },
  confirmText: {
    type: String,
    default: 'Confirmar'
  },
  cancelText: {
    type: String,
    default: 'Cancelar'
  },
  discardText: {
    type: String,
    default: 'Descartar'
  },
  showDiscard: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm', 'cancel', 'discard'])

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}

function onDiscard() {
  emit('discard')
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 50;
  display: grid;
  place-items: center;
}

.dialog-panel {
  width: 420px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.dialog-title {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
}

.dialog-message {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.4;
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
</style>
