<template>
  <Teleport to="body">
    <Transition name="new-project-modal">
      <div v-if="isOpen" class="new-project-overlay" @click.self="close">
        <div class="new-project-panel">
          <div class="new-project-header">
            <div class="new-project-icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="4" y="6" width="16" height="12" rx="1" />
                <rect x="6" y="8" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>
            <div class="new-project-title-wrap">
              <h2>Novo Projeto</h2>
              <p class="new-project-subtitle">Retro Studio · Mega Drive / SGDK</p>
            </div>
            <button class="new-project-close" @click="close" title="Fechar">
              <span class="icon-xmark"></span>
            </button>
          </div>
          <div class="new-project-body">
            <div class="form-field">
              <label>Nome do Projeto</label>
              <input v-model="name" type="text" placeholder="Ex: MeuJogo" class="form-input" @keyup.enter="handleCreate" />
            </div>
            <div class="form-field">
              <label>Localização</label>
              <div class="path-input-group">
                <input v-model="path" type="text" placeholder="Selecione a pasta..." class="form-input" readonly />
                <button type="button" class="btn-browse" @click="browseLocation" title="Procurar">
                  <span class="icon-folder-open"></span>
                </button>
              </div>
            </div>
            <div class="form-field">
              <label>Template</label>
              <select v-model="template" class="form-select">
                <option value="md-skeleton">Mega Drive Skeleton (Marsdev)</option>
                <option value="32x-skeleton">32X Skeleton (Marsdev)</option>
                <option value="sgdk-skeleton">SGDK Skeleton</option>
                <option value="sgdk-stage9-sample">SGDK Stage9 Sample</option>
              </select>
            </div>
          </div>
          <div class="new-project-actions">
            <button class="btn-cancel" @click="close">Cancelar</button>
            <button class="btn-create" :disabled="!name.trim() || !path" @click="handleCreate">
              <span class="icon-plus"></span> Criar Projeto
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

const emit = defineEmits(['close', 'created'])

const name = ref('')
const path = ref('')
const template = ref('md-skeleton')

const browseLocation = async () => {
  const result = await window.retroStudio?.retro?.selectFolder?.({ title: 'Selecionar local do projeto' })
  if (result?.path) {
    path.value = result.path
  }
}

const handleCreate = async () => {
  if (!name.value.trim() || !path.value) return

  try {
    const result = await window.retroStudio?.retro?.createProject?.({
      name: name.value.trim(),
      path: path.value,
      template: template.value
    })

    if (result?.success) {
      emit('created', { name: name.value.trim(), path: result.path })
      close()
    } else {
      window.retroStudioToast?.error?.(result?.error || 'Falha ao criar o projeto')
    }
  } catch (e) {
    window.retroStudioToast?.error?.(e?.message || 'Erro ao criar projeto')
  }
}

const close = () => {
  name.value = ''
  path.value = ''
  template.value = 'md-skeleton'
  emit('close')
}

watch(() => props.isOpen, (v) => {
  if (v) {
    name.value = ''
    path.value = ''
    template.value = 'md-skeleton'
  }
})
</script>

<style scoped>
.new-project-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.new-project-panel {
  width: min(440px, 95vw);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.new-project-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 20px 16px;
  background: linear-gradient(135deg, rgba(255, 107, 53, 0.08) 0%, rgba(76, 175, 80, 0.05) 100%);
  border-bottom: 1px solid var(--border);
}

.new-project-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 107, 53, 0.15);
  border-radius: 10px;
  color: #ff6b35;
}

.new-project-title-wrap {
  flex: 1;
}

.new-project-title-wrap h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.new-project-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.new-project-close {
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

.new-project-close:hover {
  background: var(--hover);
  color: var(--text);
}

.new-project-body {
  padding: 20px;
}

.form-field {
  margin-bottom: 18px;
}

.form-field:last-child {
  margin-bottom: 0;
}

.form-field label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
}

.form-input,
.form-select {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.15);
}

.form-select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23888' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}

.path-input-group {
  display: flex;
  gap: 10px;
}

.path-input-group .form-input {
  flex: 1;
}

.btn-browse {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
}

.btn-browse:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(76, 175, 80, 0.08);
}

.new-project-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
}

.btn-cancel {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--hover);
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(135deg, #4caf50 0%, #43a047 100%);
  border: none;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
}

.btn-create:hover:not(:disabled) {
  background: linear-gradient(135deg, #43a047 0%, #388e3c 100%);
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.35);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.new-project-modal-enter-active,
.new-project-modal-leave-active {
  transition: opacity 0.2s ease;
}

.new-project-modal-enter-active .new-project-panel,
.new-project-modal-leave-active .new-project-panel {
  transition: transform 0.2s ease;
}

.new-project-modal-enter-from,
.new-project-modal-leave-to {
  opacity: 0;
}

.new-project-modal-enter-from .new-project-panel,
.new-project-modal-leave-to .new-project-panel {
  transform: scale(0.96);
}
</style>
