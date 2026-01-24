<template>
  <Modal 
    ref="modalRef" 
    title="Novo Projeto" 
    w="500px" 
    h="auto" 
    icon="fas fa-plus-circle"
  >
    <div class="new-project-form">
      <div class="form-field">
        <label>Nome do Projeto:</label>
        <input 
          v-model="name" 
          type="text" 
          placeholder="Ex: MeuJogo"
          class="dialog-input"
          @keyup.enter="handleCreate"
        />
      </div>

      <div class="form-field">
        <label>Localização:</label>
        <div class="path-input-group">
          <input 
            v-model="path" 
            type="text" 
            placeholder="Selecione a pasta..."
            class="dialog-input"
            readonly
          />
          <button class="btn-browse" @click="browseLocation">
            <i class="fas fa-folder-open"></i>
          </button>
        </div>
      </div>

      <div class="form-field">
        <label>Template:</label>
        <select v-model="template" class="dialog-input">
          <option value="md-skeleton">Mega Drive Skeleton (Marsdev)</option>
          <option value="32x-skeleton">32X Skeleton (Marsdev)</option>
          <option value="sgdk-skeleton">SGDK Skeleton</option>
          <option value="sgdk-stage9-sample">SGDK Stage9 Sample</option>
        </select>
      </div>

      <div class="form-footer">
        <button class="btn-cancel" @click="close">Cancelar</button>
        <button 
          class="btn-confirm" 
          @click="handleCreate" 
          :disabled="!name.trim() || !path"
        >
          Criar Projeto
        </button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { ref, defineExpose } from 'vue'
import { useStore } from 'vuex'
import Modal from './ModalPage.vue'

const store = useStore()
const modalRef = ref(null)

const name = ref('')
const path = ref('')
const template = ref('md-skeleton')

const open = () => {
  name.value = ''
  path.value = ''
  template.value = 'md-skeleton'
  modalRef.value?.openModal()
}

const close = () => {
  modalRef.value?.closeModal()
}

const browseLocation = () => {
  window.ipc?.send('select-folder', { title: 'Selecionar local do projeto' })
  window.ipc?.once('folder-selected', (result) => {
    if (result && result.path) {
      path.value = result.path
    }
  })
}

const handleCreate = () => {
  if (!name.value.trim() || !path.value) return

  const projectPath = window.ipc?.sendSync('create-project', {
    name: name.value.trim(),
    path: path.value,
    template: template.value
  })

  if (projectPath && projectPath.success) {
    store.dispatch('loadProject', {
      name: name.value.trim(),
      path: projectPath.path
    })
    close()
  } else {
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Erro na Criação',
      message: projectPath?.error || 'Falha ao criar o projeto'
    })
  }
}

defineExpose({ open })
</script>

<style scoped>
.new-project-form {
  padding: 20px;
}

.form-field {
  margin-bottom: 20px;
}

.form-field label {
  display: block;
  margin-bottom: 8px;
  color: #ccc;
  font-size: 13px;
  font-weight: 500;
}

.dialog-input {
  width: 100%;
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
}

.dialog-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}

.path-input-group {
  display: flex;
  gap: 8px;
}

.path-input-group .dialog-input {
  flex: 1;
}

.btn-browse {
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-browse:hover {
  background: #1b2334;
  border-color: #304159;
}

.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #333;
}

.btn-cancel {
  background: transparent;
  border: 1px solid #333;
  color: #888;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #333;
  color: #fff;
}

.btn-confirm {
  background: #0066cc;
  border: none;
  color: white;
  padding: 8px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-confirm:hover:not(:disabled) {
  background: #0088ff;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
