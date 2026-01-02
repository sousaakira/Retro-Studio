<template>
  <TransitionGroup name="toast" tag="div" class="toast-container">
    <div
      v-for="notification in notifications"
      :key="notification.id"
      class="toast"
      :class="notification.type"
      @click="removeNotification(notification.id)"
    >
      <div class="toast-icon">
        <i :class="getIcon(notification.type)"></i>
      </div>
      <div class="toast-content">
        <div class="toast-title">{{ notification.title }}</div>
        <div class="toast-message" v-if="notification.message">
          {{ notification.message }}
        </div>
      </div>
      <button class="toast-close" @click.stop="removeNotification(notification.id)">
        <i class="fas fa-times"></i>
      </button>
    </div>
  </TransitionGroup>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const notifications = computed(() => store.state.notifications || [])

const getIcon = (type) => {
  const icons = {
    success: 'fas fa-check-circle',
    error: 'fas fa-times-circle',
    warning: 'fas fa-exclamation-triangle',
    info: 'fas fa-info-circle'
  }
  return icons[type] || icons.info
}

const removeNotification = (id) => {
  store.dispatch('removeNotification', id)
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 60px;
  right: 20px;
  z-index: 10001;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 300px;
  max-width: 400px;
  padding: 12px 16px;
  background: #252525;
  border: 1px solid #333;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  pointer-events: all;
  transition: all 0.3s;
}

.toast:hover {
  transform: translateX(-4px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.toast.success {
  border-left: 4px solid #4ec9b0;
}

.toast.error {
  border-left: 4px solid #f48771;
}

.toast.warning {
  border-left: 4px solid #dcdcaa;
}

.toast.info {
  border-left: 4px solid #569cd6;
}

.toast-icon {
  flex-shrink: 0;
  font-size: 20px;
}

.toast.success .toast-icon {
  color: #4ec9b0;
}

.toast.error .toast-icon {
  color: #f48771;
}

.toast.warning .toast-icon {
  color: #dcdcaa;
}

.toast.info .toast-icon {
  color: #569cd6;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-weight: 500;
  color: #ccc;
  font-size: 13px;
  margin-bottom: 4px;
}

.toast-message {
  color: #aaa;
  font-size: 12px;
  line-height: 1.4;
}

.toast-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  transition: all 0.2s;
}

.toast-close:hover {
  background: #333;
  color: #fff;
}

/* Transitions */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>
