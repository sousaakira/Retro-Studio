<template>
  <div class="scene-hierarchy">
    <div class="hierarchy-header">Hierarquia</div>
    <div class="node-list">
      <div
        v-for="node in sceneNodes"
        :key="node.id"
        class="node-item"
        :class="{ selected: selectedNodeId === node.id }"
        @click="$emit('update:selectedNodeId', node.id)"
      >
        <span class="icon-image"></span>
        {{ node.name || node.type || 'Node' }}
      </div>
      <div v-if="!sceneNodes.length" class="empty">Nenhum nó</div>
    </div>
    <div class="hierarchy-actions">
      <button @click="$emit('add-sprite')" title="Adicionar Sprite">
        <span class="icon-plus"></span>
      </button>
      <button
        :disabled="!selectedNodeId"
        @click="$emit('remove-node', selectedNodeId)"
        title="Remover"
      >
        <span class="icon-trash"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  sceneNodes: { type: Array, default: () => [] },
  selectedNodeId: { type: String, default: null }
})

defineEmits(['update:selectedNodeId', 'add-sprite', 'remove-node'])
</script>

<style scoped>
.scene-hierarchy {
  display: flex;
  flex-direction: column;
  width: 200px;
  border-right: 1px solid var(--border);
  background: var(--panel);
}
.hierarchy-header {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.node-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.node-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}
.node-item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.node-item.selected {
  background: rgba(var(--accent-rgb, 100, 150, 255), 0.2);
}
.empty {
  padding: 12px;
  color: var(--muted);
  font-size: 12px;
}
.hierarchy-actions {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-top: 1px solid var(--border);
}
.hierarchy-actions button {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.hierarchy-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
