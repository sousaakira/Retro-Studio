<template>
  <div class="diff-viewer-container">
    <div v-if="title" class="diff-header">
      <span class="diff-title">{{ title }}</span>
      <span class="diff-stats">
        <span class="diff-stat-added">+{{ stats.added }}</span>
        <span class="diff-stat-removed">-{{ stats.removed }}</span>
      </span>
      <div class="diff-actions">
        <button v-if="showAccept" class="diff-btn diff-btn-accept" @click="$emit('accept')" title="Aceitar mudanças">
          <span class="icon-check"></span> Aceitar
        </button>
        <button v-if="showReject" class="diff-btn diff-btn-reject" @click="$emit('reject')" title="Rejeitar mudanças">
          <span class="icon-xmark"></span> Rejeitar
        </button>
      </div>
    </div>
    
    <div class="diff-content" :class="{ 'diff-inline': mode === 'inline', 'diff-split': mode === 'split' }">
      <!-- Modo Inline (unified) -->
      <template v-if="mode === 'inline'">
        <div 
          v-for="(line, idx) in diffLines" 
          :key="idx"
          :class="['diff-line', 'diff-line-' + line.type]"
        >
          <span class="diff-line-number diff-line-old">{{ line.lineOld || '' }}</span>
          <span class="diff-line-number diff-line-new">{{ line.lineNew || '' }}</span>
          <span class="diff-line-marker">{{ getMarker(line.type) }}</span>
          <span class="diff-line-text"><pre>{{ line.text }}</pre></span>
        </div>
      </template>
      
      <!-- Modo Split (side-by-side) -->
      <template v-else>
        <div class="diff-split-view">
          <div class="diff-split-left">
            <div 
              v-for="(line, idx) in leftLines" 
              :key="'left-' + idx"
              :class="['diff-line', 'diff-line-' + line.type]"
            >
              <span class="diff-line-number">{{ line.lineNum || '' }}</span>
              <span class="diff-line-text"><pre>{{ line.text }}</pre></span>
            </div>
          </div>
          <div class="diff-split-right">
            <div 
              v-for="(line, idx) in rightLines" 
              :key="'right-' + idx"
              :class="['diff-line', 'diff-line-' + line.type]"
            >
              <span class="diff-line-number">{{ line.lineNum || '' }}</span>
              <span class="diff-line-text"><pre>{{ line.text }}</pre></span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { generateDiffView, countChanges } from '../utils/diff.js'

const props = defineProps({
  originalCode: {
    type: String,
    required: true
  },
  newCode: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: ''
  },
  mode: {
    type: String,
    default: 'inline', // 'inline' ou 'split'
    validator: (v) => ['inline', 'split'].includes(v)
  },
  showAccept: {
    type: Boolean,
    default: true
  },
  showReject: {
    type: Boolean,
    default: true
  },
  contextLines: {
    type: Number,
    default: 3
  }
})

defineEmits(['accept', 'reject'])

const diffLines = computed(() => {
  return generateDiffView(props.originalCode, props.newCode, props.contextLines)
})

const stats = computed(() => {
  return countChanges(props.originalCode, props.newCode)
})

// Para modo split: separar linhas em left (original) e right (novo)
const leftLines = computed(() => {
  const result = []
  let lineNum = 1
  
  for (const line of diffLines.value) {
    if (line.type === 'unchanged') {
      result.push({ type: 'unchanged', lineNum, text: line.text })
      lineNum++
    } else if (line.type === 'removed') {
      result.push({ type: 'removed', lineNum, text: line.text })
      lineNum++
    } else if (line.type === 'added') {
      result.push({ type: 'empty', lineNum: '', text: '' })
    } else if (line.type === 'collapse') {
      result.push({ type: 'collapse', lineNum: '', text: line.text })
      lineNum += line.count || 0
    }
  }
  
  return result
})

const rightLines = computed(() => {
  const result = []
  let lineNum = 1
  
  for (const line of diffLines.value) {
    if (line.type === 'unchanged') {
      result.push({ type: 'unchanged', lineNum, text: line.text })
      lineNum++
    } else if (line.type === 'added') {
      result.push({ type: 'added', lineNum, text: line.text })
      lineNum++
    } else if (line.type === 'removed') {
      result.push({ type: 'empty', lineNum: '', text: '' })
    } else if (line.type === 'collapse') {
      result.push({ type: 'collapse', lineNum: '', text: line.text })
      lineNum += line.count || 0
    }
  }
  
  return result
})

function getMarker(type) {
  switch (type) {
    case 'added': return '+'
    case 'removed': return '-'
    case 'collapse': return '⋮'
    default: return ' '
  }
}
</script>

<style scoped>
.diff-viewer-container {
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--sidebar);
  border-bottom: 1px solid var(--border);
}

.diff-title {
  font-weight: 600;
  color: var(--text);
  flex: 1;
}

.diff-stats {
  display: flex;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
}

.diff-stat-added {
  color: #3fb950;
}

.diff-stat-removed {
  color: #f85149;
}

.diff-actions {
  display: flex;
  gap: 8px;
}

.diff-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.diff-btn-accept {
  background: #238636;
  color: white;
}

.diff-btn-accept:hover {
  background: #2ea043;
}

.diff-btn-reject {
  background: #da3633;
  color: white;
}

.diff-btn-reject:hover {
  background: #f85149;
}

.diff-content {
  max-height: 400px;
  overflow: auto;
}

.diff-line {
  display: flex;
  align-items: stretch;
  min-height: 20px;
}

.diff-line-number {
  display: inline-block;
  min-width: 40px;
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  background: rgba(0, 0, 0, 0.1);
  border-right: 1px solid var(--border);
  user-select: none;
}

.diff-line-marker {
  display: inline-block;
  width: 20px;
  text-align: center;
  font-weight: bold;
  user-select: none;
}

.diff-line-text {
  flex: 1;
  padding: 0 8px;
}

.diff-line-text pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
}

/* Cores para os tipos de linha */
.diff-line-unchanged {
  background: transparent;
}

.diff-line-added {
  background: rgba(46, 160, 67, 0.15);
}

.diff-line-added .diff-line-marker {
  color: #3fb950;
}

.diff-line-added .diff-line-number {
  background: rgba(46, 160, 67, 0.2);
  color: #3fb950;
}

.diff-line-removed {
  background: rgba(248, 81, 73, 0.15);
}

.diff-line-removed .diff-line-marker {
  color: #f85149;
}

.diff-line-removed .diff-line-number {
  background: rgba(248, 81, 73, 0.2);
  color: #f85149;
}

.diff-line-collapse {
  background: var(--sidebar);
  color: var(--muted);
  font-style: italic;
  justify-content: center;
}

.diff-line-empty {
  background: rgba(128, 128, 128, 0.05);
}

/* Modo Split */
.diff-split-view {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.diff-split-left,
.diff-split-right {
  overflow: hidden;
}

.diff-split-left {
  border-right: 1px solid var(--border);
}

.diff-split-left .diff-line-number {
  background: rgba(248, 81, 73, 0.1);
}

.diff-split-right .diff-line-number {
  background: rgba(46, 160, 67, 0.1);
}
</style>
