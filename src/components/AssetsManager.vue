<template>
  <div class="assets-manager">
    <!-- Toolbar -->
    <div class="assets-toolbar">
      <div class="toolbar-left">
        <button class="toolbar-btn" @click="showImportDialog = true" title="Importar Assets (Ctrl+I)">
          <i class="fas fa-plus"></i> Importar
        </button>
        <button class="toolbar-btn" @click="refreshAssets" title="Atualizar">
          <i class="fas fa-sync"></i>
        </button>
      </div>

      <div class="toolbar-center">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Buscar assets..."
          class="search-input"
        />
      </div>

      <div class="toolbar-right">
        <select v-model="sortBy" class="sort-select">
          <option value="name">Por Nome</option>
          <option value="date">Por Data</option>
          <option value="type">Por Tipo</option>
          <option value="size">Por Tamanho</option>
        </select>

        <button class="view-btn" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'" title="Visualização em Grid">
          <i class="fas fa-th"></i>
        </button>
        <button class="view-btn" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'" title="Visualização em Lista">
          <i class="fas fa-list"></i>
        </button>
      </div>
    </div>

    <!-- Filter Tabs -->
    <div class="filter-tabs">
      <button
        v-for="type in assetTypes"
        :key="type"
        class="filter-tab"
        :class="{ active: selectedType === type }"
        @click="selectedType = type"
      >
        <i :class="getTypeIcon(type)"></i>
        {{ getTypeName(type) }} ({{ getAssetCount(type) }})
      </button>
      <button
        class="filter-tab"
        :class="{ active: selectedType === 'all' }"
        @click="selectedType = 'all'"
      >
        <i class="fas fa-box"></i>
        Todos ({{ totalAssets }})
      </button>
    </div>

    <!-- Assets Grid/List View -->
    <div class="assets-container" :class="`view-${viewMode}`">
      <div v-if="filteredAssets && filteredAssets.length === 0" class="empty-state">
        <i class="fas fa-inbox"></i>
        <p>Nenhum asset encontrado</p>
      </div>

      <div v-else-if="filteredAssets" class="assets-grid">
        <div
          v-for="asset in filteredAssets"
          :key="asset.id"
          class="asset-card"
          :class="{ selected: selectedAsset?.id === asset.id }"
          @click="selectAsset(asset)"
          @dblclick="editAsset(asset)"
        >
          <!-- Preview -->
          <div class="asset-preview">
            <img
              v-if="asset.preview"
              :src="asset.preview"
              :alt="asset.name"
              class="preview-image"
            />
            <div v-else class="preview-placeholder">
              <i :class="getTypeIcon(asset.type)"></i>
            </div>
          </div>

          <!-- Info -->
          <div class="asset-info">
            <div class="asset-name" :title="asset.name">{{ asset.name }}</div>
            <div class="asset-meta">
              <span class="asset-type">{{ getTypeName(asset.type) }}</span>
              <span class="asset-size">{{ formatFileSize(asset.size) }}</span>
            </div>
            <div v-if="asset.metadata" class="asset-dims">
              {{ asset.metadata.width }}×{{ asset.metadata.height }}px
            </div>
          </div>

          <!-- Actions -->
          <div class="asset-actions">
            <button class="action-btn" @click.stop="editAsset(asset)" title="Editar">
              <i class="fas fa-edit"></i>
            </button>
            <button class="action-btn" @click.stop="duplicateAssetAction(asset)" title="Duplicar">
              <i class="fas fa-clone"></i>
            </button>
            <button class="action-btn delete" @click.stop="deleteAsset(asset)" title="Deletar">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <Teleport to="body">
      <div v-if="showImportDialog" class="modal-overlay" @click="showImportDialog = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h2>Importar Assets</h2>
            <button class="close-btn" @click="showImportDialog = false">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="modal-body">
            <div class="type-selector">
              <label>Tipo de Asset:</label>
              <select v-model="importType">
                <option v-for="type in assetTypes" :key="type" :value="type">
                  {{ getTypeName(type) }}
                </option>
              </select>
            </div>

            <div class="drop-zone" @dragover.prevent @drop.prevent="handleDrop">
              <i class="fas fa-cloud-upload-alt"></i>
              <p>Arraste arquivos aqui ou clique para selecionar</p>
              <input
                ref="fileInput"
                type="file"
                multiple
                :accept="getAcceptedExtensions(importType)"
                style="display: none"
                @change="handleFileSelect"
              />
              <button class="browse-btn" @click="$refs.fileInput.click()">
                Selecionar Arquivos
              </button>
            </div>

            <div v-if="importProgress" class="progress-bar">
              <div class="progress-fill" :style="{ width: importProgress + '%' }"></div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-cancel" @click="showImportDialog = false">Cancelar</button>
            <button class="btn-import" @click="confirmImport" :disabled="!filesToImport.length">
              Importar {{ filesToImport.length }} arquivo(s)
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Edit Asset Modal -->
    <Teleport to="body">
      <div v-if="showEditDialog" class="modal-overlay" @click="showEditDialog = false">
        <div class="modal-content modal-large" @click.stop>
          <div class="modal-header">
            <h2>Editar Asset</h2>
            <button class="close-btn" @click="closeEditDialog">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="modal-body edit-body" v-if="editingAsset">
            <!-- Preview -->
            <div class="edit-preview">
              <img
                v-if="editingAsset.preview && ['sprite', 'tile', 'palette'].includes(editingAsset.type)"
                :src="editingAsset.preview"
                :alt="editingAsset.name"
                class="preview-large"
              />
              <div v-else class="preview-large-placeholder">
                <i :class="getTypeIcon(editingAsset.type)"></i>
                <p>{{ editingAsset.name }}</p>
              </div>
            </div>

            <!-- Metadata Form -->
            <div class="edit-form">
              <div class="form-group">
                <label>Nome:</label>
                <input v-model="editingAsset.name" type="text" class="form-input" />
              </div>

              <div class="form-group">
                <label>Tipo:</label>
                <span class="form-value">{{ getTypeName(editingAsset.type) }}</span>
              </div>

              <div class="form-group">
                <label>Tamanho:</label>
                <span class="form-value">{{ formatFileSize(editingAsset.size) }}</span>
              </div>

              <div v-if="editingAsset.metadata" class="form-group">
                <label>Dimensões:</label>
                <span class="form-value">{{ editingAsset.metadata.width }}×{{ editingAsset.metadata.height }}px</span>
              </div>

              <div class="form-group">
                <label>Descrição:</label>
                <textarea v-model="editingAsset.description" class="form-textarea" placeholder="Descreva o asset..."></textarea>
              </div>

              <div class="form-group">
                <label>Tags:</label>
                <input
                  v-model="tagInput"
                  type="text"
                  class="form-input"
                  placeholder="Digite e pressione Enter"
                  @keydown.enter="addTag"
                />
                <div class="tags-list">
                  <span v-for="(tag, idx) in (editingAsset.tags || [])" :key="idx" class="tag">
                    {{ tag }}
                    <button @click="editingAsset.tags.splice(idx, 1)" class="tag-remove">×</button>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-cancel" @click="closeEditDialog">Cancelar</button>
            <button class="btn-save" @click="saveAssetMetadata">Salvar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, defineExpose } from 'vue'
import { useStore } from 'vuex'
import {
  ASSET_TYPES,
  searchAssets,
  sortAssets,
  duplicateAsset as duplicateAssetUtil,
  formatFileSize,
  processAssetFile
} from '@/utils/assetManager'
import { importAssetToProject } from '@/utils/projectAssetManager'

const store = useStore()

// State
const assets = ref([])
const selectedAsset = ref(null)
const selectedType = ref('all')
const searchQuery = ref('')
const sortBy = ref('name')
const viewMode = ref('grid')
const showImportDialog = ref(false)
const importType = ref('sprite')
const filesToImport = ref([])
const importProgress = ref(0)
const showEditDialog = ref(false)
const editingAsset = ref(null)
const tagInput = ref('')

// Helper: Salvar assets no localStorage (SEM preview base64)
const saveAssets = () => {
  try {
    const assetsData = assets.value.map(asset => {
      // eslint-disable-next-line no-unused-vars
      const { preview, ...assetWithoutPreview } = asset
      return assetWithoutPreview
    })
    localStorage.setItem('projectAssets', JSON.stringify(assetsData))
    console.log('[AssetsManager] Assets salvos no localStorage:', assetsData.length)
  } catch (error) {
    console.error('[AssetsManager] Erro ao salvar assets:', error)
  }
}

// Helper: Carregar assets do localStorage
const loadAssets = () => {
  try {
    const saved = localStorage.getItem('projectAssets')
    if (saved) {
      assets.value = JSON.parse(saved)
      console.log('[AssetsManager] Assets carregados do localStorage:', assets.value.length)
    }
  } catch (error) {
    console.error('[AssetsManager] Erro ao carregar assets:', error)
    assets.value = []
  }
}

const assetTypes = Object.values(ASSET_TYPES)

// Computed
const filteredAssets = computed(() => {
  let result = assets.value

  // Filter by type
  if (selectedType.value !== 'all') {
    result = result.filter(a => a.type === selectedType.value)
  }

  // Search
  result = searchAssets(result, searchQuery.value)

  // Sort
  result = sortAssets(result, sortBy.value)

  return result
})

const totalAssets = computed(() => assets.value.length)

// Methods
const getTypeIcon = (type) => {
  const icons = {
    sprite: 'fas fa-image',
    tile: 'fas fa-th',
    tilemap: 'fas fa-border-all',
    palette: 'fas fa-palette',
    sound: 'fas fa-volume-up'
  }
  return icons[type] || 'fas fa-box'
}

const getTypeName = (type) => {
  const names = {
    sprite: 'Sprites',
    tile: 'Tiles',
    tilemap: 'Mapas',
    palette: 'Paletas',
    sound: 'Sons'
  }
  return names[type] || type
}

const getAssetCount = (type) => {
  return assets.value.filter(a => a.type === type).length
}

const selectAsset = (asset) => {
  selectedAsset.value = asset
}

const editAsset = (asset) => {
  console.log('[AssetsManager] Editar asset:', asset.name)
  const assetCopy = JSON.parse(JSON.stringify(asset))
  assetCopy.description = assetCopy.description || ''
  assetCopy.tags = assetCopy.tags || []
  
  // Recuperar o nome real do arquivo da pasta res/
  const project = JSON.parse(localStorage.getItem('project'))
  if (project?.path) {
    console.log('[AssetsManager] Buscando nome real do arquivo na pasta res/', project.path)
    
    // Usar Promise para melhor controle
    new Promise((resolve) => {
      const handler = (result) => {
        console.log('[AssetsManager] get-res-files-result recebido:', result)
        window.ipc?.removeListener?.('get-res-files-result', handler)
        resolve(result)
      }
      
      window.ipc?.once?.('get-res-files-result', handler)
      
      // Timeout de segurança (1 segundo apenas)
      setTimeout(() => {
        window.ipc?.removeListener?.('get-res-files-result', handler)
        resolve({ success: false, files: [] })
      }, 1000)
      
      window.ipc?.send('get-res-files', project.path)
    }).then(result => {
      if (result.success && result.files && Array.isArray(result.files)) {
        console.log('[AssetsManager] Arquivos na pasta res/:', result.files)
        
        // Procurar arquivo com mesmo nome (sem extensão)
        const getExt = (filename) => {
          const lastDot = filename.lastIndexOf('.')
          return lastDot > 0 ? filename.substring(lastDot) : ''
        }
        const getBaseName = (filename) => {
          const lastDot = filename.lastIndexOf('.')
          return lastDot > 0 ? filename.substring(0, lastDot) : filename
        }
        
        const ext = getExt(asset.name)
        const baseName = getBaseName(asset.name)
        
        const realFileName = result.files.find(f => {
          const fExt = getExt(f)
          const fBase = getBaseName(f)
          return fBase === baseName && fExt === ext
        })
        
        if (realFileName) {
          console.log('[AssetsManager] Nome real encontrado:', realFileName)
          assetCopy.name = realFileName
        } else {
          console.warn('[AssetsManager] Nome real não encontrado para:', asset.name)
        }
      }
      
      // Abrir modal com os dados atualizados
      editingAsset.value = assetCopy
      showEditDialog.value = true
      console.log('[AssetsManager] Modal aberto')
    })
  } else {
    editingAsset.value = assetCopy
    showEditDialog.value = true
    console.log('[AssetsManager] Modal aberto (sem busca de arquivo)')
  }
}

const closeEditDialog = () => {
  showEditDialog.value = false
  editingAsset.value = null
  tagInput.value = ''
}

const addTag = () => {
  const tag = tagInput.value.trim()
  if (tag && editingAsset.value && !editingAsset.value.tags.includes(tag)) {
    editingAsset.value.tags.push(tag)
    tagInput.value = ''
  }
}

const saveAssetMetadata = () => {
  if (!editingAsset.value) {
    console.error('[AssetsManager] editingAsset nulo')
    return
  }
  
  try {
    const current = editingAsset.value
    const assetIndex = assets.value.findIndex(a => a.id === current.id)
    if (assetIndex === -1) return
    
    const original = assets.value[assetIndex]
    const oldName = original.name
    const nm = current.name || 'Asset'
    const project = JSON.parse(localStorage.getItem('project'))
    
    // Atualizar metadados do asset
    assets.value[assetIndex].name = nm
    assets.value[assetIndex].description = current.description || ''
    assets.value[assetIndex].tags = current.tags || []
    assets.value[assetIndex].updatedAt = new Date().toISOString()
    
    // Se o nome mudou, renomear na pasta
    if (oldName !== nm && project?.path) {
      console.log('[AssetsManager] Renomeando arquivo:', { oldName, nm })
      
      // Usar Promise para melhor controle e garantir que o listener seja registrado
      new Promise((resolve) => {
        const renameHandler = (result) => {
          console.log('[AssetsManager] ✅ RESPOSTA RECEBIDA - rename-asset-result:', result)
          window.ipc?.removeListener?.('rename-asset-result', renameHandler)
          resolve(result)
        }
        
        console.log('[AssetsManager] 📤 Enviando comando: rename-asset-file')
        // Registrar listener com .once() para uma única resposta
        window.ipc?.once?.('rename-asset-result', renameHandler)
        
        // Timeout de segurança
        setTimeout(() => {
          window.ipc?.removeListener?.('rename-asset-result', renameHandler)
          resolve({ success: false, error: 'Timeout na renomeação (10s)' })
        }, 10000)
        
        // Enviar o comando
        window.ipc?.send('rename-asset-file', {
          projectPath: project.path,
          oldFileName: oldName,
          newName: nm,
          assetType: original.type
        })
      }).then(result => {
        if (result.success) {
          console.log('[AssetsManager] Arquivo renomeado com sucesso:', result.newPath)
          // Atualizar o caminho do asset
          if (result.newPath) {
            assets.value[assetIndex].path = result.newPath
          }
          saveAssets()
          store.dispatch('showNotification', {
            type: 'success',
            title: 'Asset Atualizado',
            message: `${nm} foi atualizado com sucesso`
          })
        } else {
          console.error('[AssetsManager] Erro ao renomear arquivo:', result.error)
          // Manter o nome antigo no localStorage se falhar
          assets.value[assetIndex].name = oldName
          saveAssets()
          store.dispatch('showNotification', {
            type: 'error',
            title: 'Erro ao Renomear',
            message: `Falha ao renomear na pasta: ${result.error}`
          })
        }
        closeEditDialog()
      })
    } else {
      // Se não mudou o nome ou não tem projeto, salvar direto
      saveAssets()
      store.dispatch('showNotification', {
        type: 'success',
        title: 'Asset Atualizado',
        message: `${nm} foi atualizado com sucesso`
      })
      closeEditDialog()
    }
  } catch (error) {
    console.error('[AssetsManager] Erro:', error)
  }
}

const duplicateAssetAction = (asset) => {
  const duplicate = duplicateAssetUtil(asset)
  assets.value.push(duplicate)
  saveAssets()
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Asset Duplicado',
    message: `${asset.name} foi duplicado com sucesso`
  })
}

const deleteAsset = (asset) => {
  if (confirm(`Tem certeza que deseja deletar "${asset.name}"?`)) {
    assets.value = assets.value.filter(a => a.id !== asset.id)
    if (selectedAsset.value?.id === asset.id) {
      selectedAsset.value = null
    }
    saveAssets()
    store.dispatch('showNotification', {
      type: 'success',
      title: 'Asset Deletado',
      message: `${asset.name} foi removido`
    })
  }
}

const refreshAssets = () => {
  console.log('[AssetsManager] Atualizando assets')
  store.dispatch('showNotification', {
    type: 'info',
    title: 'Assets Atualizados',
    message: `Total: ${totalAssets.value} assets`
  })
}

const getAcceptedExtensions = (type) => {
  const exts = {
    sprite: '.png,.jpg,.jpeg,.gif,.bmp',
    tile: '.png,.jpg,.jpeg',
    tilemap: '.png,.jpg,.json',
    palette: '.pal,.act,.png',
    sound: '.wav,.mp3,.vgm'
  }
  return exts[type] || '*'
}

const handleDrop = (e) => {
  filesToImport.value = Array.from(e.dataTransfer.files)
}

const handleFileSelect = (e) => {
  filesToImport.value = Array.from(e.target.files)
}

const confirmImport = async () => {
  if (!filesToImport.value.length) return

  try {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path) {
      throw new Error('Projeto não carregado. Abra um projeto antes de importar assets.')
    }

    for (let i = 0; i < filesToImport.value.length; i++) {
      const file = filesToImport.value[i]
      const asset = await processAssetFile(file, importType.value)
      
      await importAssetToProject(file, project.path, asset)
      
      assets.value.push(asset)
      importProgress.value = Math.round((i + 1) / filesToImport.value.length * 100)
    }

    saveAssets()

    store.dispatch('showNotification', {
      type: 'success',
      title: 'Assets Importados',
      message: `${filesToImport.value.length} asset(s) importado(s) com sucesso na pasta res/`
    })

    showImportDialog.value = false
    filesToImport.value = []
    importProgress.value = 0
  } catch (error) {
    console.error('[AssetsManager] Erro ao importar:', error)
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Erro na Importação',
      message: error.message
    })
  }
}

onMounted(() => {
  loadAssets()

  window.ipc?.on?.('read-files', () => {
    console.log('[AssetsManager] Projeto alterado, recarregando assets')
    loadAssets()
  })

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !e.shiftKey) {
      e.preventDefault()
      showImportDialog.value = true
    }
    if (e.key === 'Delete' && selectedAsset.value) {
      deleteAsset(selectedAsset.value)
    }
  })
})

defineExpose({
  assets,
  selectedAsset,
  refreshAssets
})
</script>

<style scoped>
.assets-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
  color: #ccc;
}

.assets-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #252525;
  border-bottom: 1px solid #333;
  flex-wrap: wrap;
}

.toolbar-left, .toolbar-center, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-center {
  flex: 1;
  min-width: 150px;
}

.toolbar-btn {
  background: transparent;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.toolbar-btn:hover {
  background: #333;
  border-color: #555;
  color: #fff;
}

.search-input {
  background: #1e1e1e;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 10px;
  border-radius: 3px;
  font-size: 12px;
  width: 100%;
}

.search-input:focus {
  outline: none;
  border-color: #0066cc;
  box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.1);
}

.sort-select, .filter-tab {
  background: #1e1e1e;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 10px;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
}

.sort-select:focus {
  outline: none;
  border-color: #0066cc;
}

.view-btn {
  background: transparent;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.view-btn:hover {
  background: #333;
  border-color: #555;
}

.view-btn.active {
  background: #0066cc;
  border-color: #0066cc;
  color: #fff;
}

.filter-tabs {
  display: flex;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  overflow-x: auto;
}

.filter-tab {
  flex: 1;
  background: transparent;
  border: none;
  color: #888;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  font-size: 11px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.filter-tab:hover {
  background: #252525;
  color: #ccc;
}

.filter-tab.active {
  color: #0066cc;
  border-bottom-color: #0066cc;
  background: #1a1a1a;
}

.assets-container {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 48px;
}

.empty-state p {
  margin-top: 12px;
  font-size: 14px;
  color: #888;
}

.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 12px;
}

.view-list .assets-grid {
  grid-template-columns: 1fr;
}

.asset-card {
  display: flex;
  flex-direction: column;
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
}

.asset-card:hover {
  background: #2a2a2a;
  border-color: #444;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.asset-card.selected {
  border-color: #0066cc;
  box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.2);
}

.asset-preview {
  width: 100%;
  aspect-ratio: 1;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #555;
  font-size: 32px;
}

.asset-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  flex: 1;
}

.asset-name {
  font-size: 11px;
  font-weight: 600;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.asset-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: #888;
}

.asset-type {
  text-transform: uppercase;
}

.asset-size {
  margin-left: auto;
}

.asset-dims {
  font-size: 10px;
  color: #666;
}

.asset-actions {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-top: 1px solid #333;
  background: #1a1a1a;
}

.action-btn {
  flex: 1;
  background: transparent;
  border: none;
  color: #888;
  padding: 4px;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.2s;
  font-size: 10px;
}

.action-btn:hover {
  background: #333;
  color: #ccc;
}

.action-btn.delete:hover {
  background: #b00020;
  color: #fff;
}

/* Modal Styles */
:global(.modal-overlay) {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

:global(.modal-content) {
  background: #2a2a2a;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.9);
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
}

:global(.modal-large) {
  max-width: 600px !important;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #333;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  color: #ccc;
}

.close-btn {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 18px;
  padding: 0;
  transition: color 0.2s;
}

.close-btn:hover {
  color: #ccc;
}

.modal-body {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.edit-body {
  display: flex !important;
  gap: 20px !important;
}

.type-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.type-selector label {
  font-size: 12px;
  color: #888;
}

.type-selector select {
  background: #1e1e1e;
  border: 1px solid #444;
  color: #ccc;
  padding: 8px;
  border-radius: 4px;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  border: 2px dashed #444;
  border-radius: 4px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.drop-zone:hover {
  border-color: #0066cc;
  background: rgba(0, 102, 204, 0.05);
}

.drop-zone i {
  font-size: 32px;
  color: #666;
}

.drop-zone p {
  margin: 0;
  font-size: 12px;
  color: #888;
}

.browse-btn {
  background: #0066cc;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.browse-btn:hover {
  background: #0088ff;
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #0066cc;
  transition: width 0.3s;
}

.modal-footer {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #333;
  background: #1a1a1a;
}

.btn-cancel {
  flex: 1;
  background: #333;
  color: #ccc;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #444;
}

.btn-import {
  flex: 1;
  background: #0066cc;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.btn-import:hover:not(:disabled) {
  background: #0088ff;
}

.btn-import:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.edit-preview {
  flex: 0 0 250px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  border-radius: 4px;
  border: 1px solid #333;
}

.preview-large {
  max-width: 100%;
  max-height: 250px;
  object-fit: contain;
}

.preview-large-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 250px;
  color: #555;
  font-size: 48px;
}

.preview-large-placeholder p {
  margin-top: 10px;
  font-size: 12px;
  color: #666;
}

.edit-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 11px;
  color: #888;
  font-weight: 600;
  text-transform: uppercase;
}

.form-input,
.form-textarea {
  background: #1e1e1e;
  border: 1px solid #444;
  color: #ccc;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #0066cc;
  box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.1);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
  font-family: monospace;
}

.form-value {
  color: #ccc;
  font-size: 12px;
  padding: 6px 0;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #0066cc;
  color: #fff;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
}

.tag-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
}

.tag-remove:hover {
  opacity: 0.7;
}

.btn-save {
  flex: 1;
  background: #00aa00;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.btn-save:hover:not(:disabled) {
  background: #00cc00;
}
</style>
