<template>
  <div
    v-if="visible"
    class="context-menu-overlay"
    :data-context-menu="items ? 'generic' : 'file-tree'"
    @pointerdown="close"
    @contextmenu.prevent
  >
    <div
      class="context-menu"
      :style="{
        left: x + 'px',
        top: y + 'px',
        width: (items ? 180 : width) + 'px'
      }"
      @pointerdown.stop
    >
    <!-- Items mode (AssetsManager, etc.) -->
    <template v-if="items?.length">
      <button
        v-for="item in items"
        :key="item.id"
        class="context-menu-item"
        :class="{ 'context-menu-item--danger': item.danger }"
        :disabled="item.disabled"
        @click="emit('action', item.action); emit('close')"
      >
        <span v-if="item.icon" :class="item.icon" class="ctx-icon"></span>
        {{ item.label }}
      </button>
    </template>
    <!-- File tree mode -->
    <template v-else>
      <button 
        class="context-menu-item" 
        :disabled="!node || node.kind !== 'file'" 
        @click="emit('open')"
      >
        Abrir
      </button>
      <template v-if="isRetroProject && node?.kind === 'file'">
        <button
          v-if="canEditImage && imageEditorPath"
          class="context-menu-item"
          @click="emit('editExternalImage')"
        >
          Editar com {{ editorImageName }}
        </button>
        <button
          v-else-if="isImageFile && !imageEditorPath"
          class="context-menu-item context-menu-item--muted"
          disabled
        >
          Configurar Editor de Imagens...
        </button>
        <button
          v-if="canEditMap && mapEditorPath"
          class="context-menu-item"
          @click="emit('editExternalMap')"
        >
          Editar com {{ editorMapName }}
        </button>
        <button
          v-else-if="isMapFile && !mapEditorPath"
          class="context-menu-item context-menu-item--muted"
          disabled
        >
          Configurar Editor de Mapas...
        </button>
      </template>
      <button 
        class="context-menu-item" 
        :disabled="!hasTree"
        @click="emit('refresh')"
      >
        Atualizar
      </button>

      <div class="context-menu-sep" />

      <button class="context-menu-item" @click="emit('newFile')">
        Novo Arquivo
      </button>
      <button class="context-menu-item" @click="emit('newFolder')">
        Nova Pasta
      </button>

      <div class="context-menu-sep" />

      <button
        class="context-menu-item"
        :disabled="!node || isRoot"
        @click="emit('rename')"
      >
        Renomear
      </button>
      <button
        class="context-menu-item context-menu-item--danger"
        :disabled="!node || isRoot"
        @click="emit('delete')"
      >
        Excluir
      </button>

      <div class="context-menu-sep" />

      <button
        class="context-menu-item"
        :disabled="!node"
        @click="emit('copyPath')"
      >
        Copiar Caminho
      </button>
      <button
        class="context-menu-item"
        :disabled="!node"
        @click="emit('copyRelativePath')"
      >
        Copiar Caminho Relativo
      </button>
    </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tga', 'pal', 'pcx']
const MAP_EXTS = ['json', 'tmx', 'res', 'map']

function getEditorName(path) {
  if (!path) return ''
  const name = path.split(/[/\\]/).pop() || ''
  return name.replace(/\.[^.]+$/, '') || name
}

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  show: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  width: { type: Number, default: 200 },
  node: { type: Object, default: null },
  rootPath: { type: String, default: '' },
  hasTree: { type: Boolean, default: false },
  isRetroProject: { type: Boolean, default: false },
  imageEditorPath: { type: String, default: '' },
  mapEditorPath: { type: String, default: '' },
  items: { type: Array, default: null }
})

const visible = computed(() => props.isOpen || props.show)

const emit = defineEmits(['close', 'open', 'refresh', 'newFile', 'newFolder', 'rename', 'delete', 'copyPath', 'copyRelativePath', 'editExternalImage', 'editExternalMap', 'action'])

const isImageFile = computed(() => {
  if (!props.node?.path) return false
  const ext = props.node.path.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.includes(ext)
})

const isMapFile = computed(() => {
  if (!props.node?.path) return false
  const ext = props.node.path.split('.').pop()?.toLowerCase() || ''
  return MAP_EXTS.includes(ext)
})

const canEditImage = computed(() => isImageFile.value && props.imageEditorPath)
const canEditMap = computed(() => isMapFile.value && props.mapEditorPath)
const editorImageName = computed(() => getEditorName(props.imageEditorPath))
const editorMapName = computed(() => getEditorName(props.mapEditorPath))

const isRoot = computed(() => {
  return props.node?.path === props.rootPath
})

function close() {
  emit('close')
}
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.context-menu {
  position: fixed;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 160px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s ease;
}

.context-menu-item:hover:not(:disabled) {
  background: var(--list-hover);
}

.context-menu-item:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.5;
}

.context-menu-item--danger {
  color: var(--danger);
}

.context-menu-item--danger:hover:not(:disabled) {
  background: rgba(241, 76, 76, 0.1);
}

.context-menu-item--muted {
  font-style: italic;
}

.context-menu-sep {
  height: 1px;
  background: var(--border);
  margin: 6px 0;
}
</style>
