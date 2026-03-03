<template>
  <div class="te-titlebar" @dblclick="state.toggleMaximize">
    <div class="te-titlebar-left">
      <div class="te-window-controls">
        <button class="te-tb-btn te-close" title="Fechar" @click="$emit('close')">
          <span class="icon-xmark"></span>
        </button>
        <button class="te-tb-btn" title="Minimizar" @click="state.minimize">
          <span class="icon-window-minimize"></span>
        </button>
        <button class="te-tb-btn" :title="state.isMaximized.value ? 'Restaurar' : 'Maximizar'" @click="state.toggleMaximize">
          <span v-if="!state.isMaximized.value" class="icon-window-maximize"></span>
          <span v-else class="icon-window-restore"></span>
        </button>
      </div>
      <div class="te-app-title">
        <span class="te-logo">◫</span>
        <span>Editor de Mapas</span>
      </div>
    </div>
    <div class="te-titlebar-center">{{ state.currentMapName.value }}</div>
    <div class="te-titlebar-right">
      <button class="te-tb-btn" title="Abrir mapa" @click="state.openMap">
        <span class="icon-folder-open"></span>
      </button>
      <button
        class="te-tb-btn"
        @click="state.saveMap"
        :disabled="!state.canSave.value || state.saving.value"
        :title="state.savePathHint.value"
      >
        <span class="icon-floppy-disk"></span>
      </button>
      <button
        class="te-tb-btn"
        @click="state.saveMapAs"
        :disabled="!state.canSave.value || state.saving.value"
        title="Salvar como..."
      >
        <span class="icon-file-plus"></span>
      </button>
      <button
        class="te-tb-btn"
        @click="state.exportToC"
        :disabled="!state.canSave.value || state.saving.value"
        title="Exportar para C (array)"
      >
        C
      </button>
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

defineEmits(['close'])
</script>

<style scoped>
.te-titlebar {
  height: 36px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  background: linear-gradient(180deg, #2d2d30 0%, #252526 100%);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  padding: 0 8px;
}
.te-titlebar-left,
.te-titlebar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.te-titlebar-left { justify-self: start; }
.te-titlebar-right { justify-self: end; }
.te-titlebar-center {
  justify-self: center;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.te-window-controls {
  display: flex;
  margin-right: 12px;
}
.te-app-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.te-logo {
  font-size: 14px;
  color: var(--accent);
  opacity: 0.9;
}
.te-tb-btn {
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
  -webkit-app-region: no-drag;
}
.te-tb-btn:hover { background: rgba(255,255,255,0.08); color: var(--text); }
.te-tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.te-tb-btn.te-close:hover { background: rgba(255, 92, 92, 0.85); color: #111; }
</style>
