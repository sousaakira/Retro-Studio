<template>
  <Teleport to="body">
    <Transition name="store-modal">
      <div v-if="isOpen" class="store-modal-overlay" @click.self="$emit('close')">
        <div class="store-modal-panel">
          <div class="store-modal-header">
            <div class="store-modal-title">
              <span class="store-modal-icon">🛒</span>
              <h2>Loja de Assets</h2>
            </div>
            <button class="store-modal-close" @click="$emit('close')" title="Fechar">
              <span class="icon-xmark"></span>
            </button>
          </div>
          <div class="store-modal-body">
            <StorePanel
              :project-path="projectPath"
              @installed="onInstalled"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { onUnmounted, watch } from 'vue'
import StorePanel from './StorePanel.vue'

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  projectPath: { type: String, default: '' }
})

const emit = defineEmits(['close'])

function onInstalled() {
  window.retroStudioToast?.success?.('Asset instalado com sucesso!')
}

function onEscape(e) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.isOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onEscape)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onEscape)
    document.body.style.overflow = ''
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onEscape)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.store-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 24px;
}

.store-modal-panel {
  width: min(720px, 95vw);
  max-height: 85vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.store-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
  flex-shrink: 0;
}

.store-modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.store-modal-icon {
  font-size: 22px;
}

.store-modal-title h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.store-modal-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}

.store-modal-close:hover {
  background: var(--hover);
  color: var(--text);
}

.store-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* StorePanel dentro do modal - grid maior */
.store-modal-body :deep(.store-grid) {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.store-modal-body :deep(.store-card) {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.store-modal-body :deep(.store-card:hover) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.store-modal-body :deep(.store-card-title) {
  font-size: 13px;
}

.store-modal-body :deep(.store-card-actions button) {
  padding: 8px 12px;
  font-size: 12px;
}

/* Transitions */
.store-modal-enter-active,
.store-modal-leave-active {
  transition: opacity 0.2s ease;
}

.store-modal-enter-active .store-modal-panel,
.store-modal-leave-active .store-modal-panel {
  transition: transform 0.2s ease;
}

.store-modal-enter-from,
.store-modal-leave-to {
  opacity: 0;
}

.store-modal-enter-from .store-modal-panel,
.store-modal-leave-to .store-modal-panel {
  transform: scale(0.96);
}
</style>
