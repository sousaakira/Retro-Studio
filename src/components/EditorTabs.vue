<template>
  <div class="tabs">
    <div
      v-for="tab in tabs"
      :key="tab.path"
      class="tab"
      :class="{ active: tab.path === activePath }"
      @click="$emit('select', tab.path)"
    >
      <span v-if="tab.dirty" class="dirty" />
      <span class="label">{{ tab.name }}</span>
      <button class="close" @click.stop="$emit('close', tab.path)">×</button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  tabs: {
    type: Array,
    default: () => []
  },
  activePath: {
    type: String,
    default: null
  }
})

defineEmits(['select', 'close'])
</script>

<style scoped>
.tabs {
  display: flex;
  gap: 0;
  overflow-x: auto;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  min-height: 36px;
  flex-shrink: 0;
  
  /* Ocultar scrollbar */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  height: 36px;
  background: var(--tab-inactive-bg, var(--monaco-tab-inactive-bg, #2d2d2d));
  color: var(--tab-inactive-fg, var(--monaco-tab-inactive-fg, rgba(255, 255, 255, 0.5)));
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  border-right: 1px solid var(--border);
  transition: background 0.15s ease;
  user-select: none;
}

.tab:hover {
  background: var(--list-hover);
}

.tab.active {
  background: var(--tab-active-bg, var(--monaco-tab-active-bg, var(--panel)));
  color: var(--tab-active-fg, var(--monaco-tab-active-fg, #fff));
  border-bottom: 2px solid var(--accent);
  height: 35px;
  padding-bottom: 1px;
}

.tab .dirty {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  flex-shrink: 0;
}

.tab .label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab .close {
  width: 18px;
  height: 18px;
  padding: 0;
  margin-left: 4px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.1s ease, background 0.1s ease;
}

.tab:hover .close {
  opacity: 1;
}

.tab .close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.tab.active .close {
  opacity: 1;
}
</style>
