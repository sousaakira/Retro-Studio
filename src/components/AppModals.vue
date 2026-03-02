<!--
  AppModals - Agrupa todos os modais/diálogos da aplicação.
  
  PROPS: Recebe todos os estados de visibilidade e dados dos modais.
  EVENTS: Repassa eventos de close, confirm, created, etc. para o pai.
  
  Modais incluídos:
  - NewProjectModal (criar projeto Retro)
  - OpenWorkspaceModal (abrir workspace)
  - StoreModal (loja de assets)
  - StoreLoginModal (login na loja)
  - BuildProgressOverlay (progresso de build/package)
  - HelpViewer (ajuda SGDK)
  - Settings (configurações)
  - CrudDialog (criar/renomear/deletar arquivo/pasta)
  - ConfirmDialog (confirmar fechar aba com alterações)
  - BranchDialog (criar branch Git)
  - DiffModal (visualizar diff Git)
-->
<script setup>
import NewProjectModal from './retro/NewProjectModal.vue'
import OpenWorkspaceModal from './OpenWorkspaceModal.vue'
import StoreModal from './retro/StoreModal.vue'
import StoreLoginModal from './retro/StoreLoginModal.vue'
import BuildProgressOverlay from './retro/BuildProgressOverlay.vue'
import HelpViewer from './retro/HelpViewer.vue'
import Settings from './Settings.vue'
import CrudDialog from './CrudDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import BranchDialog from './BranchDialog.vue'
import DiffModal from './DiffModal.vue'

defineProps({
  showNewRetroProjectModal: Boolean,
  showOpenWorkspaceModal: Boolean,
  showStoreModal: Boolean,
  showStoreLoginModal: Boolean,
  isRetroCompiling: Boolean,
  isPackaging: Boolean,
  buildProgressMessage: { type: String, default: '' },
  showHelpViewer: Boolean,
  settingsDialogOpen: Boolean,
  crudDialogOpen: Boolean,
  crudDialogMode: { type: String, default: null },
  crudDialogTitle: { type: String, default: '' },
  crudDialogLabel: { type: String, default: '' },
  crudDialogValue: { type: String, default: '' },
  closeConfirmOpen: Boolean,
  showBranchDialog: Boolean,
  newBranchName: { type: String, default: '' },
  showDiffModal: Boolean,
  diffFilePath: { type: String, default: '' },
  diffStaged: Boolean,
  parsedDiff: { type: Array, default: () => [] },
  projectPath: { type: String, default: '' },
  storeUser: { type: Object, default: null }
})
defineEmits([
  'close-new-project', 'retro-project-created',
  'close-open-workspace', 'open-workspace-pick', 'open-workspace-browse',
  'close-store',
  'close-store-login', 'store-logged-in', 'store-logged-out',
  'stop-build',
  'close-help',
  'close-settings', 'settings-save',
  'crud-confirm', 'crud-cancel',
  'close-confirm-save', 'close-confirm-cancel', 'close-confirm-discard',
  'branch-update-name', 'branch-create', 'branch-close',
  'diff-close'
])
</script>

<template>
  <NewProjectModal
    :is-open="showNewRetroProjectModal"
    @close="$emit('close-new-project')"
    @created="$emit('retro-project-created', $event)"
  />
  <OpenWorkspaceModal
    :is-open="showOpenWorkspaceModal"
    @close="$emit('close-open-workspace')"
    @pick="$emit('open-workspace-pick', $event)"
    @browse="$emit('open-workspace-browse')"
  />
  <StoreModal
    :is-open="showStoreModal"
    :project-path="projectPath"
    @close="$emit('close-store')"
  />
  <StoreLoginModal
    :is-open="showStoreLoginModal"
    :store-user="storeUser"
    @close="$emit('close-store-login')"
    @logged-in="$emit('store-logged-in', $event)"
    @logged-out="$emit('store-logged-out')"
  />
  <BuildProgressOverlay
    :is-compiling="isRetroCompiling"
    :is-packaging="isPackaging"
    :progress-message="buildProgressMessage"
    @stop="$emit('stop-build')"
  />
  <HelpViewer :show="showHelpViewer" @close="$emit('close-help')" />
  <Settings
    v-if="settingsDialogOpen"
    :is-open="settingsDialogOpen"
    @close="$emit('close-settings')"
    @save="$emit('settings-save', $event)"
  />
  <CrudDialog
    :is-open="crudDialogOpen"
    :mode="crudDialogMode"
    :title="crudDialogTitle"
    :label="crudDialogLabel"
    :initial-value="crudDialogValue"
    @confirm="$emit('crud-confirm', $event)"
    @cancel="$emit('crud-cancel')"
  />
  <ConfirmDialog
    :is-open="closeConfirmOpen"
    title="Alterações não salvas"
    message="Este arquivo possui alterações não salvas. O que deseja fazer?"
    confirm-text="Salvar"
    cancel-text="Cancelar"
    discard-text="Descartar"
    :show-discard="true"
    @confirm="$emit('close-confirm-save')"
    @cancel="$emit('close-confirm-cancel')"
    @discard="$emit('close-confirm-discard')"
  />
  <BranchDialog
    :is-open="showBranchDialog"
    :model-value="newBranchName"
    @update:modelValue="$emit('branch-update-name', $event)"
    @create="$emit('branch-create')"
    @close="$emit('branch-close')"
  />
  <DiffModal
    :is-open="showDiffModal"
    :file-path="diffFilePath"
    :staged="diffStaged"
    :parsed-diff="parsedDiff"
    @close="$emit('diff-close')"
  />
</template>
