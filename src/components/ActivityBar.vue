<template>
  <div class="activity-bar">
    <div class="activity-bar-actions">
      <button
        v-for="item in items"
        :key="item.id"
        class="activity-bar-item"
        :class="{ active: activeView === item.id }"
        :title="item.label"
        @click="$emit('select', item.id)">
        <span :class="item.icon"></span>
      </button>
    </div>

    <div class="activity-bar-footer">
      <button
        class="activity-bar-item"
        title="Settings"
        @click="$emit('settings')"
      >
        <span class="icon-gear"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activeView: {
    type: String,
    default: 'explorer'
  },
  items: {
    type: Array,
    default: () => [
      { id: 'explorer', label: 'Explorer (Ctrl+Shift+E)', icon: 'icon-folder-tree' },
      { id: 'search', label: 'Search (Ctrl+Shift+F)', icon: 'icon-magnifying-glass' },
      { id: 'git', label: 'Source Control', icon: 'icon-code-branch' },
      { id: 'debug', label: 'Run and Debug', icon: 'icon-bug' },
      { id: 'extensions', label: 'Extensions', icon: 'icon-grid-2' }
    ]
  }
})

defineEmits(['select', 'settings'])
</script>

<style scoped>
.activity-bar {
  width: 36px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  flex-shrink: 0;
}

.activity-bar-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.activity-bar-footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  margin-top: auto;
}

.activity-bar-item {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  transition: all 0.1s ease;
  position: relative;
}

.activity-bar-item:hover {
  color: var(--text);
}

.activity-bar-item.active {
  color: var(--text);
  border-left-color: var(--accent);
}

.activity-bar-item.active::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
}
</style>
