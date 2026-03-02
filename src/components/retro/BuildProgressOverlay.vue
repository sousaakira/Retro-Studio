<template>
  <Teleport to="body">
    <Transition name="build-progress">
      <div v-if="visible" class="build-progress-overlay">
        <div class="build-progress-panel">
          <div class="build-progress-spinner"></div>
          <div class="build-progress-content">
            <div class="build-progress-title">{{ title }}</div>
            <div v-if="message" class="build-progress-message">{{ message }}</div>
          </div>
          <button v-if="isCompiling" class="build-progress-close" @click="$emit('stop')" title="Parar build">
            <span class="icon-stop"></span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  isCompiling: { type: Boolean, default: false },
  isPackaging: { type: Boolean, default: false },
  progressMessage: { type: String, default: '' }
})

defineEmits(['stop'])

const visible = computed(() => props.isCompiling || props.isPackaging)

const title = computed(() => {
  if (props.isPackaging) return 'Empacotando para Steam'
  if (props.isCompiling) return 'Compilando projeto'
  return ''
})

const message = computed(() => props.progressMessage || null)
</script>

<style scoped>
.build-progress-overlay {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
}

.build-progress-panel {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  min-width: 320px;
}

.build-progress-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: build-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes build-spin {
  to { transform: rotate(360deg); }
}

.build-progress-content {
  flex: 1;
  min-width: 0;
}

.build-progress-title {
  font-size: 14px;
  font-weight: 600;
}

.build-progress-message {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.build-progress-close {
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
  flex-shrink: 0;
}

.build-progress-close:hover {
  background: var(--hover);
  color: var(--danger, #f85149);
}

.build-progress-enter-active,
.build-progress-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.build-progress-enter-from,
.build-progress-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
