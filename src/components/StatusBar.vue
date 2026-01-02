<template>
  <div class="status-bar">
    <div class="status-left">
      <span v-if="statusMessage" class="status-message">
        <i :class="statusIcon"></i>
        {{ statusMessage }}
      </span>
      <span v-else class="status-ready">
        <i class="fas fa-check-circle"></i>
        Ready
      </span>
    </div>
    
    <div class="status-right">
      <span v-if="currentFile" class="file-info">
        <i class="fas fa-file-code"></i>
        {{ currentFileName }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const currentFile = computed(() => store.state.currentFile)

const statusMessage = computed(() => store.state.statusMessage)
const statusIcon = computed(() => {
  const status = store.state.statusType || 'info'
  const icons = {
    info: 'fas fa-info-circle',
    success: 'fas fa-check-circle',
    warning: 'fas fa-exclamation-triangle',
    error: 'fas fa-times-circle'
  }
  return icons[status] || icons.info
})

const currentFileName = computed(() => {
  if (!currentFile.value) return ''
  const path = currentFile.value.split(/[/\\]/)
  return path[path.length - 1]
})
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  background: #007acc;
  color: white;
  padding: 0 12px;
  font-size: 11px;
  border-top: 1px solid #005a9e;
}

.status-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-message,
.status-ready {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-ready i {
  color: #4ec9b0;
}

.file-info,
.scene-info {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.9;
}

.file-info i,
.scene-info i {
  opacity: 0.7;
}
</style>
