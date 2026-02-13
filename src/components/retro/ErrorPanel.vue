<template>
  <div v-if="errors.length > 0" class="error-panel">
    <div class="error-header" :class="{ collapsed: isCollapsed }">
      <button class="toggle-btn" @click="isCollapsed = !isCollapsed">
        <span class="icon-chevron" :class="{ right: isCollapsed }">▼</span>
      </button>
      <div class="error-summary">
        <span class="total">{{ stats.total }} Issue{{ stats.total !== 1 ? 's' : '' }}</span>
        <span v-if="stats.errors > 0" class="count error-count">{{ stats.errors }} erro(s)</span>
        <span v-if="stats.warnings > 0" class="count warning-count">{{ stats.warnings }} aviso(s)</span>
      </div>
      <button class="close-btn" @click="$emit('close')">×</button>
    </div>
    <div v-if="!isCollapsed" class="error-list">
      <div
        v-for="(error, index) in displayedErrors"
        :key="index"
        class="error-item"
        :class="'severity-' + (error.severity || 'error')"
        @click="handleErrorClick(error)"
      >
        <div class="error-icon">
          <span v-if="error.severity === 'error'" class="icon-error">✕</span>
          <span v-else-if="error.severity === 'warning'" class="icon-warn">⚠</span>
          <span v-else class="icon-info">ℹ</span>
        </div>
        <div class="error-content">
          <div class="error-location">{{ getFileName(error.file) }}:{{ error.line }}:{{ error.column }}</div>
          <div class="error-type">{{ (error.type || 'error').toUpperCase() }}</div>
          <div class="error-message">{{ error.message }}</div>
        </div>
        <div class="error-action">
          <span class="icon-arrow">→</span>
        </div>
      </div>
      <div v-if="errors.length > MAX_DISPLAYED" class="show-more">
        <button @click="showAll = !showAll">
          {{ showAll ? 'Mostrar menos' : `Mostrar mais ${errors.length - MAX_DISPLAYED}` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { getErrorStats } from '@/utils/retro/errorParser.js'

const props = defineProps({
  errors: { type: Array, default: () => [] },
  projectPath: { type: String, default: '' }
})

const emit = defineEmits(['close', 'error-click'])

const MAX_DISPLAYED = 5
const isCollapsed = ref(false)
const showAll = ref(false)

const stats = computed(() => getErrorStats(props.errors))

const displayedErrors = computed(() => {
  if (showAll.value) return props.errors
  return (props.errors || []).slice(0, MAX_DISPLAYED)
})

function getFileName(filePath) {
  if (!filePath) return 'unknown'
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

function handleErrorClick(error) {
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
  background: var(--panel);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  max-height: 40vh;
  overflow: hidden;
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.error-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  gap: 12px;
  user-select: none;
}

.toggle-btn, .close-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
}

.toggle-btn:hover, .close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.icon-chevron { font-size: 10px; }
.icon-chevron.right { transform: rotate(-90deg); display: inline-block; }

.error-summary {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
}

.total { font-weight: 600; color: var(--text); }

.count {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.error-count {
  background: rgba(244, 76, 76, 0.15);
  color: #f44c4c;
}

.warning-count {
  background: rgba(220, 130, 23, 0.15);
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
  gap: 8px;
  border-bottom: 1px solid var(--border);
}

.error-item:hover {
  background: rgba(244, 76, 76, 0.1);
}

.error-item.severity-warning {
  border-left-color: #dca217;
  background: rgba(220, 130, 23, 0.05);
}

.error-item.severity-warning:hover {
  background: rgba(220, 130, 23, 0.1);
}

.error-item.severity-info {
  border-left-color: var(--accent);
  background: rgba(0, 122, 204, 0.05);
}

.error-icon { flex-shrink: 0; width: 20px; text-align: center; font-size: 12px; }
.error-item.severity-error .error-icon { color: #f44c4c; }
.error-item.severity-warning .error-icon { color: #dca217; }
.error-item.severity-info .error-icon { color: var(--accent); }

.error-content { flex: 1; min-width: 0; }

.error-location {
  font-size: 11px;
  color: var(--muted);
  font-family: ui-monospace, monospace;
}

.error-type {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  margin-top: 2px;
}

.error-message {
  font-size: 12px;
  color: var(--text);
  margin-top: 4px;
  word-break: break-word;
}

.error-action {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
}

.show-more {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  text-align: center;
}

.show-more button {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}

.show-more button:hover { opacity: 0.9; }

.error-list::-webkit-scrollbar { width: 8px; }
.error-list::-webkit-scrollbar-thumb { background: rgba(121, 121, 121, 0.4); border-radius: 4px; }
</style>
