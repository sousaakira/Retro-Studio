<template>
  <div class="te-toolbar-map">
    <div class="te-layer-select">
      <button
        class="te-tool-btn"
        :class="{ active: state.activeLayer.value === 'bg' }"
        title="Camada fundo (BG)"
        @click="state.activeLayer.value = 'bg'"
      >
        BG
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.activeLayer.value === 'fg' }"
        title="Camada frente (FG)"
        @click="state.activeLayer.value = 'fg'"
      >
        FG
      </button>
    </div>
    <div class="te-tools">
      <button
        v-for="t in state.drawTools"
        :key="t.id"
        class="te-tool-btn"
        :class="{ active: state.drawTool.value === t.id }"
        :title="t.title"
        @click="state.drawTool.value = t.id"
      >
        {{ t.icon }}
      </button>
    </div>
    <div class="te-debug-tools">
      <button
        class="te-tool-btn"
        :class="{ active: state.showGrid.value }"
        title="Mostrar/ocultar grade"
        @click="state.showGrid.value = !state.showGrid.value"
      >
        ⊞
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showTileIndices.value }"
        title="Mostrar índices dos tiles"
        @click="state.showTileIndices.value = !state.showTileIndices.value"
      >
        #
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showCollision.value }"
        title="Mostrar colisões"
        @click="state.showCollision.value = !state.showCollision.value"
      >
        ⬛
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editCollision.value }"
        title="Editar colisão (C) - clique para alternar"
        @click="state.editCollision.value = !state.editCollision.value"
      >
        ◼
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showPriority.value }"
        title="Mostrar prioridade"
        @click="state.showPriority.value = !state.showPriority.value"
      >
        △
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editPriority.value }"
        title="Editar prioridade (O) - tile na frente do sprite"
        @click="state.editPriority.value = !state.editPriority.value"
      >
        ▲
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showCoords.value }"
        title="Mostrar coordenadas ao passar o mouse"
        @click="state.showCoords.value = !state.showCoords.value"
      >
        ⌖
      </button>
    </div>
    <div class="te-selection-actions">
      <button
        class="te-tool-btn"
        :disabled="!state.selection.value?.w"
        title="Duplicar seleção (Ctrl+D) - cola à direita ou abaixo da região"
        @click="state.duplicateSelection"
      >
        ⊕
      </button>
    </div>
    <div class="te-undo-redo">
      <button class="te-tool-btn" :disabled="!state.canUndo.value" title="Desfazer (Ctrl+Z)" @click="state.undo">↶</button>
      <button class="te-tool-btn" :disabled="!state.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="state.redo">↷</button>
    </div>
    <div class="te-zoom">
      <button @click="state.zoom.value = Math.max(1, state.zoom.value - 1)">−</button>
      <span>{{ state.zoom.value }}×</span>
      <button @click="state.zoom.value = Math.min(8, state.zoom.value + 1)">+</button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  state: {
    type: Object,
    required: true
  }
})
</script>

<style scoped>
.te-toolbar-map {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.te-layer-select,
.te-tools,
.te-debug-tools,
.te-selection-actions,
.te-undo-redo {
  display: flex;
  align-items: center;
  gap: 2px;
}
.te-layer-select { margin-right: 8px; }

.te-tool-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.te-tool-btn:hover { background: rgba(255,255,255,0.08); color: var(--text); }
.te-tool-btn.active { background: var(--accent); color: #fff; }

.te-zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 0px;
  font-size: 12px;
}
.te-zoom button {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  cursor: pointer;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}
.te-zoom button:hover { background: var(--accent); color: #fff; }
</style>
