<template>
  <div v-if="errors.length > 0" class="error-panel">
    <!-- Header -->
    <div class="error-header" :class="{ collapsed: isCollapsed }">
      <button class="toggle-btn" @click="isCollapsed = !isCollapsed">
        <i :class="isCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down'"></i>
      </button>
      
      <div class="error-summary">
        <span class="total">{{ stats.total }} Issue{{ stats.total !== 1 ? 's' : '' }}</span>
        <span v-if="stats.errors > 0" class="count error-count">
          <i class="fas fa-times-circle"></i> {{ stats.errors }}
        </span>
        <span v-if="stats.warnings > 0" class="count warning-count">
          <i class="fas fa-exclamation-triangle"></i> {{ stats.warnings }}
        </span>
      </div>

      <button class="close-btn" @click="$emit('close')">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <!-- Errors List -->
    <div v-if="!isCollapsed" class="error-list">
      <div 
        v-for="(error, index) in displayedErrors" 
        :key="index"
        class="error-item"
        :class="`severity-${error.severity}`"
        @click="handleErrorClick(error)"
      >
        <div class="error-icon">
          <i v-if="error.severity === 'error'" class="fas fa-times-circle"></i>
          <i v-else-if="error.severity === 'warning'" class="fas fa-exclamation-triangle"></i>
          <i v-else class="fas fa-info-circle"></i>
        </div>

        <div class="error-content">
          <div class="error-location">
            {{ getFileName(error.file) }}:{{ error.line }}:{{ error.column }}
          </div>
          <div class="error-type">
            {{ error.type.toUpperCase() }}
          </div>
          <div class="error-message">
            {{ error.message }}
          </div>
        </div>

        <div class="error-action">
          <i class="fas fa-arrow-right"></i>
        </div>
      </div>

      <!-- Show More -->
      <div v-if="errors.length > MAX_DISPLAYED" class="show-more">
        <button @click="showAll = !showAll">
          {{ showAll ? 'Show Less' : `Show ${errors.length - MAX_DISPLAYED} More` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, defineProps, defineEmits } from 'vue'
import { getErrorStats } from '@/utils/errorParser'

const props = defineProps({
  errors: {
    type: Array,
    default: () => []
  },
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'error-click'])

const MAX_DISPLAYED = 5
const isCollapsed = ref(false)
const showAll = ref(false)

const stats = computed(() => getErrorStats(props.errors))

const displayedErrors = computed(() => {
  if (showAll.value) return props.errors
  return props.errors.slice(0, MAX_DISPLAYED)
})

const getFileName = (filePath) => {
  if (!filePath) return 'unknown'
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

const handleErrorClick = (error) => {
  emit('error-click', {
    file: error.file,
    line: error.line,
    column: error.column,
    message: error.message
  })
}
</script>

<style scoped>
.error-panel {
  background: #1e1e1e;
  border-top: 1px solid #3e3e42;
  display: flex;
  flex-direction: column;
  max-height: 40vh;
  overflow: hidden;
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.error-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #252526;
  border-bottom: 1px solid #3e3e42;
  gap: 12px;
  user-select: none;
}

.toggle-btn,
.close-btn {
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  transition: all 0.2s;
}

.toggle-btn:hover,
.close-btn:hover {
  background: #3e3e42;
  color: #ffffff;
}

.error-summary {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
}

.total {
  font-weight: 600;
  color: #ffffff;
}

.count {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 500;
}

.error-count {
  background: rgba(244, 76, 76, 0.1);
  color: #f44c4c;
}

.warning-count {
  background: rgba(220, 130, 23, 0.1);
  color: #dca217;
}

.error-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.error-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-left: 3px solid #f44c4c;
  background: rgba(244, 76, 76, 0.05);
  cursor: pointer;
  transition: all 0.2s;
  gap: 8px;
  border-bottom: 1px solid #2d2d2d;
}

.error-item:hover {
  background: rgba(244, 76, 76, 0.1);
  transform: translateX(4px);
}

.error-item.severity-warning {
  border-left-color: #dca217;
  background: rgba(220, 130, 23, 0.05);
}

.error-item.severity-warning:hover {
  background: rgba(220, 130, 23, 0.1);
}

.error-item.severity-info {
  border-left-color: #007acc;
  background: rgba(0, 122, 204, 0.05);
}

.error-item.severity-info:hover {
  background: rgba(0, 122, 204, 0.1);
}

.error-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.error-item.severity-error .error-icon {
  color: #f44c4c;
}

.error-item.severity-warning .error-icon {
  color: #dca217;
}

.error-item.severity-info .error-icon {
  color: #007acc;
}

.error-content {
  flex: 1;
  min-width: 0;
}

.error-location {
  font-size: 11px;
  color: #858585;
  font-family: 'Courier New', monospace;
}

.error-type {
  font-size: 10px;
  color: #9d9d9d;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

.error-message {
  font-size: 12px;
  color: #cccccc;
  margin-top: 4px;
  word-break: break-word;
}

.error-action {
  flex-shrink: 0;
  color: #858585;
  font-size: 12px;
  opacity: 0;
  transition: all 0.2s;
}

.error-item:hover .error-action {
  opacity: 1;
  color: #cccccc;
}

.show-more {
  padding: 8px 12px;
  border-top: 1px solid #3e3e42;
  text-align: center;
}

.show-more button {
  background: #0e639c;
  color: #ffffff;
  border: none;
  padding: 4px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.show-more button:hover {
  background: #1177bb;
}

/* Scrollbar styles */
.error-list::-webkit-scrollbar {
  width: 8px;
}

.error-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.error-list::-webkit-scrollbar-thumb {
  background: #464647;
  border-radius: 4px;
}

.error-list::-webkit-scrollbar-thumb:hover {
  background: #5a5a5a;
}
</style>
