<template>
  <div class="assets-manager">
    <div class="assets-toolbar">
      <button class="toolbar-btn" @click="showImport = true" title="Importar">
        <span class="icon-plus"></span> Importar
      </button>
      <button class="toolbar-btn" @click="refreshAssets" title="Atualizar">
        <span class="icon-arrows-rotate"></span>
      </button>
      <input v-model="searchQuery" type="text" placeholder="Buscar..." class="search-input" />
    </div>
    <div class="assets-grid" @contextmenu.prevent="onBgContextMenu">
      <div v-if="isLoading" class="empty-state">Carregando...</div>
      <div v-else-if="!filteredAssets.length" class="empty-state">Nenhum asset</div>
      <div
        v-else
        v-for="asset in filteredAssets"
        :key="asset.id"
        class="asset-card"
        :class="{ selected: selectedAsset?.id === asset.id }"
        @click="selectedAsset = asset"
        @dblclick="asset.type === 'tilemap' ? emit('edit-tilemap', asset) : emit('edit', asset)"
        @contextmenu.stop="onAssetContextMenu(asset, $event)"
      >
        <div class="asset-preview">
          <img v-if="asset.preview" :src="asset.preview" :alt="asset.name" class="preview-img" />
          <div v-else class="preview-placeholder">
            <span class="icon-image"></span>
          </div>
        </div>
        <div class="asset-info">
          <div class="asset-name" :title="asset.name">{{ asset.name }}</div>
          <div class="asset-meta">{{ getTypeName(asset.type) }} · {{ formatFileSize(asset.size) }}</div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="showImport" class="modal-overlay" @click="showImport = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h2>Importar Assets</h2>
            <button class="close-btn" @click="showImport = false">×</button>
          </div>
          <div class="modal-body">
            <label>Tipo:</label>
            <select v-model="importType" class="form-select">
              <option v-for="t in ASSET_TYPES" :key="t" :value="t">{{ getTypeName(t) }}</option>
            </select>
            <div class="drop-zone" @dragover.prevent @drop.prevent="onDrop">
              Arraste arquivos ou
              <input v-if="!canUseNativeDialog" ref="fileInput" type="file" multiple style="display:none" @change="onFileSelect" />
              <button @click="onSelectFiles">Selecionar</button>
            </div>
          </div>
          <div class="modal-footer">
            <button @click="showImport = false">Cancelar</button>
            <button @click="doImport" :disabled="!filesToImport.length">Importar {{ filesToImport.length }}</button>
          </div>
        </div>
      </div>
    </Teleport>
    <ContextMenu
      v-if="ctx.visible"
      :show="ctx.visible"
      :x="ctx.x"
      :y="ctx.y"
      :items="ctxItems"
      @action="onCtxAction"
      @close="ctx.visible = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import ContextMenu from '../ContextMenu.vue'

const props = defineProps({
  projectPath: { type: String, default: '' },
  assets: { type: Array, default: () => [] },
  selectedAsset: { type: Object, default: null },
  isLoading: { type: Boolean, default: false },
  ASSET_TYPES: { type: Array, default: () => [] },
  getTypeName: { type: Function, default: (t) => t },
  formatFileSize: { type: Function, default: (b) => b + ' B' },
  imageEditorPath: { type: String, default: '' },
  mapEditorPath: { type: String, default: '' }
})

const emit = defineEmits(['update:selectedAsset', 'refresh', 'import', 'importPaths', 'remove', 'edit', 'edit-tilemap', 'editExternal'])

const searchQuery = ref('')
const showImport = ref(false)
const importType = ref('sprite')
const filesToImport = ref([])
const fileInput = ref(null)
const ctx = ref({ visible: false, x: 0, y: 0, asset: null })

const filteredAssets = computed(() => {
  const q = searchQuery.value?.toLowerCase() || ''
  if (!q) return props.assets
  return props.assets.filter((a) => a.name?.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q))
})

function getEditorName(path) {
  if (!path) return ''
  const name = path.split(/[/\\]/).pop() || ''
  return name.replace(/\.[^.]+$/, '') || name
}

const ctxItems = computed(() => {
  const a = ctx.value.asset
  if (a) {
    const items = [
      { id: 'edit', action: 'edit', label: 'Editar', icon: 'icon-pen-to-square' }
    ]
    const isImage = ['sprite', 'tile', 'background'].includes(a.type)
    const isMap = a.type === 'tilemap'
    if (isMap) {
      items.push({ id: 'edit-tilemap', action: 'edit-tilemap', label: 'Editar no Editor de Mapas', icon: 'icon-grid-2' })
    }
    if (isImage && props.imageEditorPath) {
      items.push({ id: 'edit-external-image', action: 'edit-external-image', label: `Editar com ${getEditorName(props.imageEditorPath)}`, icon: 'icon-image' })
    } else if (isImage) {
      items.push({ id: 'config-image', action: 'config-image', label: 'Configurar Editor de Imagens...', icon: 'icon-gear', disabled: true })
    }
    if (isMap && props.mapEditorPath) {
      items.push({ id: 'edit-external-map', action: 'edit-external-map', label: `Editar com ${getEditorName(props.mapEditorPath)}`, icon: 'icon-grid-2' })
    } else if (isMap) {
      items.push({ id: 'config-map', action: 'config-map', label: 'Configurar Editor de Mapas...', icon: 'icon-gear', disabled: true })
    }
    items.push({ id: 'remove', action: 'remove', label: 'Remover', icon: 'icon-trash', danger: true })
    return items
  }
  return [
    { id: 'import', action: 'import', label: 'Importar', icon: 'icon-plus' },
    { id: 'refresh', action: 'refresh', label: 'Atualizar', icon: 'icon-arrows-rotate' }
  ]
})

const selectedAsset = computed({
  get: () => props.selectedAsset,
  set: (v) => emit('update:selectedAsset', v)
})

function onBgContextMenu(e) {
  ctx.value = { visible: true, x: e.clientX, y: e.clientY, asset: null }
}
function onAssetContextMenu(asset, e) {
  ctx.value = { visible: true, x: e.clientX, y: e.clientY, asset }
}
async function onCtxAction(action) {
  const a = ctx.value.asset
  ctx.value.visible = false
  if (action === 'import') showImport.value = true
  else if (action === 'refresh') emit('refresh')
  else if (action === 'remove' && a) emit('remove', a.id)
  else if (action === 'edit' && a) emit('edit', a)
  else if (action === 'edit-tilemap' && a) emit('edit-tilemap', a)
  else if ((action === 'edit-external-image' || action === 'edit-external-map') && a?.path && props.projectPath) {
    const fullPath = `${props.projectPath}/${a.path}`.replace(/\/+/g, '/')
    const editorPath = action === 'edit-external-image' ? props.imageEditorPath : props.mapEditorPath
    if (editorPath) await window.retroStudio?.retro?.openExternalEditor?.(editorPath, fullPath)
  }
}

const canUseNativeDialog = !!window.retroStudio?.retro?.selectMultipleFiles

function refreshAssets() {
  emit('refresh')
}
function onDrop(e) {
  filesToImport.value = [...(e.dataTransfer?.files || [])]
}
function onFileSelect(e) {
  filesToImport.value = [...(e.target?.files || [])]
}
async function onSelectFiles() {
  if (canUseNativeDialog) {
    const extByType = {
      sprite: ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
      tile: ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
      tilemap: ['tmx'],
      palette: ['pal', 'act'],
      sound: ['wav', 'mp3', 'ogg', 'vgm', 'vgz'],
      background: ['png', 'jpg', 'jpeg', 'gif', 'bmp']
    }
    const exts = extByType[importType.value] || ['*']
    const result = await window.retroStudio.retro.selectMultipleFiles({
      context: 'asset-import',
      title: 'Selecionar arquivos para importar',
      filters: exts[0] === '*' ? [{ name: 'Todos', extensions: ['*'] }] : [{ name: importType.value, extensions: exts }, { name: 'Todos', extensions: ['*'] }]
    })
    if (result?.success && result.paths?.length) {
      emit('importPaths', result.paths, importType.value)
      showImport.value = false
    }
  } else {
    fileInput.value?.click()
  }
}
async function doImport() {
  if (!filesToImport.value.length) return
  emit('import', filesToImport.value, importType.value)
  filesToImport.value = []
  showImport.value = false
}
</script>

<style scoped>
.assets-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel);
}
.assets-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  align-items: center;
}
.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.toolbar-btn:hover {
  opacity: 0.9;
}
.toolbar-btn-accent {
  background: var(--accent);
  font-weight: 600;
}
.search-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}
.assets-grid {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  align-content: start;
}
.asset-card {
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
}
.asset-card:hover,
.asset-card.selected {
  border-color: var(--accent);
}
.asset-preview {
  aspect-ratio: 1;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.preview-placeholder {
  color: var(--muted);
  font-size: 24px;
}
.asset-info {
  padding: 4px 6px;
  font-size: 11px;
}
.asset-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-meta {
  color: var(--muted);
  font-size: 10px;
}
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 24px;
  color: var(--muted);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: var(--panel);
  border-radius: 8px;
  min-width: 320px;
  max-width: 90vw;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.close-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
}
.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
.drop-zone button {
  margin-left: 8px;
  padding: 4px 12px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.modal-footer button {
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}
.modal-footer button:last-child {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.form-select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}
</style>
