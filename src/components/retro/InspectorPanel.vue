<template>
  <div class="inspector-panel">
    <div class="inspector-header">Inspetor</div>
    <div v-if="selectedNode" class="inspector-content">
      <div class="prop-row">
        <label>Nome</label>
        <input v-model="selectedNode.name" type="text" @input="emitChange" />
      </div>
      <div class="prop-row">
        <label>X</label>
        <input v-model.number="selectedNode.x" type="number" @input="emitChange" />
      </div>
      <div class="prop-row">
        <label>Y</label>
        <input v-model.number="selectedNode.y" type="number" @input="emitChange" />
      </div>
      <div class="prop-row">
        <label>Largura</label>
        <input v-model.number="selectedNode.width" type="number" @input="emitChange" />
      </div>
      <div class="prop-row">
        <label>Altura</label>
        <input v-model.number="selectedNode.height" type="number" @input="emitChange" />
      </div>
    </div>
    <div v-else class="inspector-empty">Selecione um nó</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  selectedNode: { type: Object, default: null }
})

const emit = defineEmits(['change'])

function emitChange() {
  emit('change', props.selectedNode)
}
</script>

<style scoped>
.inspector-panel {
  width: 220px;
  border-left: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  flex-direction: column;
}
.inspector-header {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.inspector-content {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.prop-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prop-row label {
  font-size: 11px;
  color: var(--muted);
}
.prop-row input {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}
.inspector-empty {
  padding: 24px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
</style>
