<template>
  <div v-if="isOpen" class="dialog-overlay" @click.self="close">
    <div class="dialog-panel retro-new-project">
      <div class="dialog-title">Novo Projeto Retro Studio</div>
      <div class="dialog-body">
        <div class="form-field">
          <label>Nome do Projeto</label>
          <input v-model="name" type="text" placeholder="Ex: MeuJogo" class="input" @keyup.enter="handleCreate" />
        </div>
        <div class="form-field">
          <label>Localização</label>
          <div class="path-input-group">
            <input v-model="path" type="text" placeholder="Selecione a pasta..." class="input" readonly />
            <button type="button" class="btn-icon" @click="browseLocation" title="Procurar">
              <span class="icon-folder-open"></span>
            </button>
          </div>
        </div>
        <div class="form-field">
          <label>Template</label>
          <select v-model="template" class="input">
            <option value="md-skeleton">Mega Drive Skeleton (Marsdev)</option>
            <option value="32x-skeleton">32X Skeleton (Marsdev)</option>
            <option value="sgdk-skeleton">SGDK Skeleton</option>
            <option value="sgdk-stage9-sample">SGDK Stage9 Sample</option>
          </select>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn--secondary" @click="close">Cancelar</button>
        <button class="btn btn--primary" :disabled="!name.trim() || !path" @click="handleCreate">
          Criar Projeto
        </button>
      </div>
    </div>
  </div>
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
.retro-new-project {
  min-width: 420px;
}

.dialog-body {
  padding: 16px 0;
}

.form-field {
  margin-bottom: 16px;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
}

.path-input-group {
  display: flex;
  gap: 8px;
}

.path-input-group .input {
  flex: 1;
}

.btn-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}

.btn-icon:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
}

.input:focus {
  outline: none;
  border-color: var(--accent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>
