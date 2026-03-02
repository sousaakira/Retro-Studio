<template>
  <Teleport to="body">
    <Transition name="open-workspace-modal">
      <div v-if="isOpen" class="open-workspace-overlay" @click.self="close">
        <div class="open-workspace-panel">
          <div class="open-workspace-header">
            <h2>Abrir Pasta</h2>
            <button class="open-workspace-close" @click="close" title="Fechar">
              <span class="icon-xmark"></span>
            </button>
          </div>
          <div class="open-workspace-body">
            <p class="open-workspace-hint">Selecione uma pasta recente ou procure em seu computador.</p>
            <div v-if="recent.length > 0" class="recent-list">
              <label class="form-label">Pastas recentes</label>
              <div class="recent-scroll">
                <button
                  v-for="item in recent"
                  :key="getPath(item)"
                  class="recent-item"
                  @click="pick(getPath(item))"
                >
                  <span class="recent-icon">
                    <span class="icon-folder-tree"></span>
                  </span>
                  <span class="recent-info">
                    <span class="recent-name">{{ getFolderName(getPath(item)) }}</span>
                    <span class="recent-path" :title="getPath(item)">{{ getPath(item) }}</span>
                  </span>
                </button>
              </div>
            </div>
            <div v-else class="empty-recent">
              <span class="empty-icon"><span class="icon-folder-tree"></span></span>
              <span>Nenhuma pasta recente</span>
            </div>
          </div>
          <div class="open-workspace-actions">
            <button class="btn-secondary" @click="close">Cancelar</button>
            <button class="btn-primary" @click="browse">
              <span class="icon-folder-open"></span>
              Procurar pasta...
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isOpen: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'pick', 'browse'])

const recent = ref([])

function getPath(item) {
  return typeof item === 'string' ? item : item?.path || ''
}

function getFolderName(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

function pick(path) {
  emit('pick', path)
}

function browse() {
  emit('browse')
}

function close() {
  emit('close')
}

async function loadRecent() {
  try {
    recent.value = await window.retroStudio?.workspace?.getRecent?.() || []
  } catch (_) {
    recent.value = []
  }
}

watch(() => props.isOpen, (v) => {
  if (v) loadRecent()
})
</script>

<style scoped>
.open-workspace-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.open-workspace-panel {
  width: 440px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.open-workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}

.open-workspace-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.open-workspace-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}

.open-workspace-close:hover {
  background: var(--hover);
  color: var(--text);
}

.open-workspace-body {
  padding: 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.open-workspace-hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
}

.form-label {
  display: block;
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.recent-scroll {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: border-color 0.15s, background 0.15s;
}

.recent-item:hover {
  border-color: var(--accent);
  background: var(--hover);
}

.recent-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tab);
  border-radius: 8px;
  flex-shrink: 0;
}

.recent-item:hover .recent-icon {
  background: var(--border);
}

.recent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-path {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-recent {
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tab);
  border-radius: 12px;
  opacity: 0.6;
}
.empty-icon .icon-folder-tree {
  width: 24px;
  height: 24px;
}

.open-workspace-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
}

.btn-secondary,
.btn-primary {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
}

.btn-secondary {
  background: var(--tab);
  color: var(--text);
}

.btn-secondary:hover {
  background: var(--hover);
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  opacity: 0.92;
}

.open-workspace-modal-enter-active,
.open-workspace-modal-leave-active {
  transition: opacity 0.2s ease;
}

.open-workspace-modal-enter-active .open-workspace-panel,
.open-workspace-modal-leave-active .open-workspace-panel {
  transition: transform 0.2s ease;
}

.open-workspace-modal-enter-from,
.open-workspace-modal-leave-to {
  opacity: 0;
}

.open-workspace-modal-enter-from .open-workspace-panel,
.open-workspace-modal-leave-to .open-workspace-panel {
  transform: scale(0.96);
}
</style>
