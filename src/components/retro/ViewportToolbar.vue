<template>
  <div class="viewport-toolbar">
    <button
      v-for="t in tools"
      :key="t.id"
      class="tool-btn"
      :class="{ active: currentTool === t.id }"
      :title="t.label"
      @click="$emit('tool-change', t.id)"
    >
      <span :class="t.icon"></span>
    </button>
    <span class="separator"></span>
    <button @click="$emit('zoom-in')" title="Zoom +">+</button>
    <button @click="$emit('zoom-out')" title="Zoom -">−</button>
    <button @click="$emit('reset-zoom')" title="Reset">100%</button>
    <span class="separator"></span>
    <label>
      <input type="checkbox" :checked="showGrid" @change="$emit('toggle-show-grid')" />
      Grid
    </label>
    <label>
      <input type="checkbox" :checked="snapToGrid" @change="$emit('toggle-snap-grid')" />
      Snap
    </label>
  </div>
</template>

<script setup>
defineProps({
  currentTool: { type: String, default: 'select' },
  zoom: { type: Number, default: 2 },
  showGrid: { type: Boolean, default: true },
  snapToGrid: { type: Boolean, default: true }
})

defineEmits(['tool-change', 'zoom-in', 'zoom-out', 'reset-zoom', 'toggle-show-grid', 'toggle-snap-grid'])

const tools = [
  { id: 'select', label: 'Selecionar', icon: 'icon-cursor-default' },
  { id: 'move', label: 'Mover', icon: 'icon-arrows-up-down-left-right' },
  { id: 'sprite', label: 'Sprite', icon: 'icon-image' }
]
</script>

<style scoped>
.viewport-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.tool-btn,
button {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.tool-btn.active,
.tool-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.separator {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 4px;
}
label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}
</style>
