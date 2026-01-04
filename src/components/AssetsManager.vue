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
              <select v-model="importType" @change="filesToImport = []">
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
                v-if="editingAsset.preview"
                :src="editingAsset.preview"
                :alt="editingAsset.name"
                class="preview-large"
              />
              <div v-else-if="editingAsset.type === 'palette' && editingAsset.metadata && editingAsset.metadata.colors" class="palette-colors-grid">
                <div 
                  v-for="(color, idx) in editingAsset.metadata.colors" 
                  :key="idx" 
                  class="palette-color-item"
                  :style="{ backgroundColor: color.hex }"
                  :title="`${color.hex} (R:${color.r}, G:${color.g}, B:${color.b})`"
                ></div>
              </div>
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

    <!-- Asset Type Detection Dialog -->
    <Teleport to="body">
      <div v-if="showDetectionDialog" class="modal-overlay" @click="showDetectionDialog = false">
        <div class="modal-content modal-large" @click.stop>
          <div class="modal-header">
            <h2>Definir Tipo de Imagem</h2>
            <button class="close-btn" @click="showDetectionDialog = false">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="modal-body">
            <p style="margin-bottom: 16px; color: #aaa">Selecione o tipo para cada imagem detectada:</p>
            
            <div v-for="(asset, idx) in detectedAssets" :key="idx" class="detection-item">
              <div class="detection-file-info">
                <i class="fas fa-image"></i>
                <span class="file-name">{{ asset.name }}</span>
                <span class="file-size">({{ formatFileSize(asset.size) }})</span>
              </div>
              <select v-model="assetTypeSelection[asset.name]" class="type-select">
                <option value="sprite">Sprite</option>
                <option value="tile">Tile</option>
                <option value="tilemap">Tilemap</option>
              </select>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-cancel" @click="showDetectionDialog = false">Cancelar</button>
            <button class="btn-save" @click="confirmImageTypeSelection">Confirmar</button>
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
import { extractPaletteColors, generatePaletteCanvas } from '@/utils/palettePreviewGenerator'

const store = useStore()

// State
const assets = ref([])
const selectedAsset = ref(null)
const selectedType = ref('all')
const searchQuery = ref('')
const sortBy = ref('name')
const viewMode = ref('grid')
const showImportDialog = ref(false)
const importType = ref('palette')
const filesToImport = ref([])
const importProgress = ref(0)
const showEditDialog = ref(false)
const editingAsset = ref(null)
const tagInput = ref('')
const showDetectionDialog = ref(false)
const detectedAssets = ref([])
const assetTypeSelection = ref({})
const currentDetectionIndex = ref(0)

// Helper: Salvar assets na config do projeto (retro-studio.json)
const saveAssets = () => {
  try {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path) {
      console.warn('[AssetsManager] Projeto não disponível para salvar assets')
      return
    }

    // Remover previews e preparar dados para salvar
    const assetsData = assets.value.map(asset => {
      // eslint-disable-next-line no-unused-vars
      const { preview, ...assetWithoutPreview } = asset
      return assetWithoutPreview
    })

    // Usar Promise para melhor controle
    new Promise((resolve) => {
      const handler = (result) => {
        console.log('[AssetsManager] save-project-config-result recebido:', result)
        window.ipc?.removeListener?.('save-project-config-result', handler)
        resolve(result)
      }

      window.ipc?.once?.('save-project-config-result', handler)

      // Timeout de segurança (5 segundos)
      setTimeout(() => {
        window.ipc?.removeListener?.('save-project-config-result', handler)
        resolve({ success: false, error: 'Timeout ao salvar config (5s)' })
      }, 5000)

    // Enviar comando IPC
    window.ipc?.send('save-project-config', JSON.parse(JSON.stringify({
      projectPath: project.path,
      config: {
        name: project.name,
        template: project.template,
        createdAt: project.createdAt,
        resourcePath: project.resourcePath || 'res',
        assets: assetsData
      }
    })))
    }).then(result => {
      if (result.success) {
        console.log('[AssetsManager] Assets salvos em retro-studio.json:', assetsData.length)
      } else {
        console.error('[AssetsManager] Erro ao salvar assets:', result.error)
      }
    })
  } catch (error) {
    console.error('[AssetsManager] Erro ao salvar assets:', error)
  }
}

// Helper: Carregar assets da config do projeto (retro-studio.json)
const loadAssets = () => {
  try {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path) {
      console.warn('[AssetsManager] Projeto não disponível para carregar assets')
      assets.value = []
      return
    }

    // Usar Promise para melhor controle
    new Promise((resolve) => {
      const handler = (result) => {
        console.log('[AssetsManager] project-config recebido:', result)
        window.ipc?.removeListener?.('project-config', handler)
        resolve(result)
      }

      window.ipc?.once?.('project-config', handler)

      // Timeout de segurança (5 segundos)
      setTimeout(() => {
        window.ipc?.removeListener?.('project-config', handler)
        resolve({ assets: [] })
      }, 5000)

      // Enviar comando IPC
      window.ipc?.send('get-project-config', project.path)
    }).then(async (config) => {
      if (config.assets && Array.isArray(config.assets)) {
        assets.value = config.assets
        console.log('[AssetsManager] Assets carregados de retro-studio.json:', config.assets.length)
        
        // Carregar previews faltantes SEQUENCIALMENTE para evitar bugs de IPC
        for (let i = 0; i < config.assets.length; i++) {
          const asset = config.assets[i]
          if (!asset.preview && asset.path) {
            if (['sprite', 'tile'].includes(asset.type)) {
              const preview = await loadAssetPreview(asset.path)
              if (preview) assets.value[i].preview = preview
            } else if (asset.type === 'palette') {
              const colors = await loadPaletteColors(asset.path)
              if (colors && colors.length > 0) {
                // Gerar um canvas pequeno para o preview da grade
                const preview = generatePaletteCanvas(colors, 8, 8)
                assets.value[i].preview = preview
                assets.value[i].metadata = { ...assets.value[i].metadata, colors }
              }
            }
          }
        }
      } else {
        assets.value = []
        console.log('[AssetsManager] Nenhum asset encontrado em retro-studio.json')
      }
    })
  } catch (error) {
    console.error('[AssetsManager] Erro ao carregar assets:', error)
    assets.value = []
  }
}

// Helper: Carregar preview de um asset via IPC
const loadAssetPreview = (assetPath) => {
  return new Promise((resolve) => {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path || !assetPath) return resolve(null)

    const handler = (result) => {
      // Verificar se a resposta é para o asset que pedimos
      if (result.assetPath === assetPath) {
        window.ipc?.removeListener?.('get-asset-preview-result', handler)
        if (result.success) {
          resolve(result.preview)
        } else {
          console.warn('[AssetsManager] Falha ao carregar preview:', result.error)
          resolve(null)
        }
      }
    }

    // Usar .on em vez de .once para poder filtrar o caminho correto, 
    // mas remover logo após encontrar
    window.ipc?.on?.('get-asset-preview-result', handler)
    
    window.ipc?.send('get-asset-preview', {
      projectPath: project.path,
      assetPath: assetPath
    })

    // Timeout de segurança
    setTimeout(() => {
      window.ipc?.removeListener?.('get-asset-preview-result', handler)
      resolve(null)
    }, 5000)
  })
}

// Helper: Carregar cores de uma paleta via IPC
const loadPaletteColors = (assetPath) => {
  return new Promise((resolve) => {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path || !assetPath) return resolve([])

    const handler = (result) => {
      if (result.assetPath === assetPath) {
        window.ipc?.removeListener?.('get-palette-colors-result', handler)
        if (result.success) {
          resolve(result.colors)
        } else {
          console.warn('[AssetsManager] Falha ao carregar cores da paleta:', result.error)
          resolve([])
        }
      }
    }

    window.ipc?.on?.('get-palette-colors-result', handler)
    window.ipc?.send('get-palette-colors', {
      projectPath: project.path,
      assetPath: assetPath
    })

    setTimeout(() => {
      window.ipc?.removeListener?.('get-palette-colors-result', handler)
      resolve([])
    }, 5000)
  })
}

// Helper: Escanear recursos e detectar novos assets
const scanResources = () => {
  try {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path) {
      console.warn('[AssetsManager] Projeto não disponível para escanear recursos')
      return
    }

    console.log('[AssetsManager] Iniciando escaneo de recursos...')

    // Usar Promise para melhor controle
    new Promise((resolve) => {
      const handler = (result) => {
        console.log('[AssetsManager] scan-resources-result recebido:', result)
        window.ipc?.removeListener?.('scan-resources-result', handler)
        resolve(result)
      }

      window.ipc?.once?.('scan-resources-result', handler)

      // Timeout de segurança (10 segundos)
      setTimeout(() => {
        window.ipc?.removeListener?.('scan-resources-result', handler)
        resolve({ success: false, error: 'Timeout ao escanear recursos (10s)', newAssets: [], unidentifiedAssets: [] })
      }, 10000)

      // Enviar comando IPC
      window.ipc?.send('scan-resources', project.path)
    }).then(result => {
      if (result.success) {
        console.log(`[AssetsManager] Escaneo concluído: ${result.newAssets.length} identificados, ${result.unidentifiedAssets.length} aguardando`)
        
        // Adicionar automaticamente os identificados
        if (result.newAssets && result.newAssets.length > 0) {
          addDetectedAssets(result.newAssets)
        }
        
        // Se houver imagens não identificadas, mostrar dialog
        if (result.unidentifiedAssets && result.unidentifiedAssets.length > 0) {
          detectedAssets.value = result.unidentifiedAssets
          assetTypeSelection.value = {}
          currentDetectionIndex.value = 0
          showDetectionDialog.value = true
        }
      } else {
        console.error('[AssetsManager] Erro ao escanear recursos:', result.error)
        store.dispatch('showNotification', {
          type: 'error',
          title: 'Erro ao Escanear',
          message: result.error || 'Erro desconhecido'
        })
      }
    })
  } catch (error) {
    console.error('[AssetsManager] Erro ao iniciar escaneo:', error)
  }
}

// Helper: Adicionar assets detectados à config
const addDetectedAssets = (newAssets) => {
  try {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path) {
      console.warn('[AssetsManager] Projeto não disponível')
      return
    }

    new Promise((resolve) => {
      const handler = (result) => {
        console.log('[AssetsManager] add-detected-assets-result recebido:', result)
        window.ipc?.removeListener?.('add-detected-assets-result', handler)
        resolve(result)
      }

      window.ipc?.once?.('add-detected-assets-result', handler)

      // Timeout de segurança
      setTimeout(() => {
        window.ipc?.removeListener?.('add-detected-assets-result', handler)
        resolve({ success: false, error: 'Timeout' })
      }, 5000)

      window.ipc?.send('add-detected-assets', {
        projectPath: project.path,
        assets: newAssets
      })
    }).then(result => {
      if (result.success) {
        console.log(`[AssetsManager] ${newAssets.length} asset(s) adicionado(s) com sucesso`)
        // Recarregar assets
        loadAssets()
        store.dispatch('showNotification', {
          type: 'success',
          title: 'Assets Detectados',
          message: `${newAssets.length} novo(s) asset(s) adicionado(s)`
        })
      } else {
        console.error('[AssetsManager] Erro ao adicionar assets:', result.error)
      }
    })
  } catch (error) {
    console.error('[AssetsManager] Erro ao adicionar assets detectados:', error)
  }
}

// Helper: Confirmar seleção de tipos de imagens
const confirmImageTypeSelection = () => {
  try {
    const imagesToAdd = detectedAssets.value.map(asset => {
      const selectedType = assetTypeSelection.value[asset.name]
      return {
        ...asset,
        type: selectedType || 'sprite',
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        metadata: {}
      }
    })

    addDetectedAssets(imagesToAdd)
    showDetectionDialog.value = false
    detectedAssets.value = []
    assetTypeSelection.value = {}
  } catch (error) {
    console.error('[AssetsManager] Erro ao confirmar seleção:', error)
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

const editAsset = async (asset) => {
  console.log('[AssetsManager] Editar asset:', asset.name)
  const assetCopy = JSON.parse(JSON.stringify(asset))
  assetCopy.description = assetCopy.description || ''
  assetCopy.tags = assetCopy.tags || []
  
  const project = JSON.parse(localStorage.getItem('project'))
  if (project?.path) {
    try {
      // 1. Obter lista de arquivos para validar caminhos
      const result = await new Promise((resolve) => {
        const handler = (res) => {
          window.ipc?.removeListener?.('get-res-files-result', handler)
          resolve(res)
        }
        window.ipc?.once?.('get-res-files-result', handler)
        window.ipc?.send('get-res-files', project.path)
        setTimeout(() => {
          window.ipc?.removeListener?.('get-res-files-result', handler)
          resolve({ success: false, files: [] })
        }, 1500)
      })

      if (result.success && Array.isArray(result.files)) {
        const getExt = (f) => f.substring(f.lastIndexOf('.')).toLowerCase()
        const getBase = (f) => f.substring(0, f.lastIndexOf('.'))
        
        const ext = getExt(asset.name)
        const baseName = getBase(asset.name)
        
        let realPath = asset.path || ''
        if (!realPath || !result.files.includes(realPath)) {
          const found = result.files.find(f => {
            const fName = f.split(/[/\\]/).pop()
            return getBase(fName) === baseName && getExt(fName) === ext
          })
          if (found) realPath = found
        }

        if (realPath) {
          assetCopy.path = realPath
          assetCopy.name = realPath.split(/[/\\]/).pop()
          
          // 2. Carregar preview de imagem se necessário
          if (!assetCopy.preview && ['sprite', 'tile'].includes(assetCopy.type)) {
            const preview = await loadAssetPreview(realPath)
            if (preview) assetCopy.preview = preview
          }

          // 3. Carregar cores se for paleta
          if (assetCopy.type === 'palette') {
            const colors = await loadPaletteColors(realPath)
            assetCopy.metadata = assetCopy.metadata || {}
            assetCopy.metadata.colors = colors
          }
        }
      }
    } catch (error) {
      console.error('[AssetsManager] Erro ao preparar edição:', error)
    }
  }

  editingAsset.value = assetCopy
  showEditDialog.value = true
  console.log('[AssetsManager] Modal aberto com data carregada')
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
          assetType: original.type,
          oldPath: original.path
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

  console.log('[AssetsManager] Iniciando importação com tipo:', importType.value)
  console.log('[AssetsManager] Arquivos para importar:', filesToImport.value.map(f => f.name))

  try {
    const project = JSON.parse(localStorage.getItem('project'))
    if (!project?.path) {
      throw new Error('Projeto não carregado. Abra um projeto antes de importar assets.')
    }

    for (let i = 0; i < filesToImport.value.length; i++) {
      const file = filesToImport.value[i]
      console.log(`[AssetsManager] Processando arquivo ${i + 1}/${filesToImport.value.length}:`, file.name, `com tipo:`, importType.value)
      const asset = await processAssetFile(file, importType.value)
      
      // Se é paleta, gerar preview das cores
      if (importType.value === 'palette' && ['pal', 'act', 'png', 'jpg', 'jpeg'].includes(file.name.toLowerCase().split('.').pop())) {
        try {
          console.log('[AssetsManager] Processando paleta:', file.name)
          const paletteData = await extractPaletteColors(file)
          const previewCanvas = generatePaletteCanvas(paletteData.colors, 16, 16)
          asset.preview = previewCanvas
          asset.metadata = {
            colorCount: paletteData.count,
            format: paletteData.format,
            colors: paletteData.colors
          }
          console.log('[AssetsManager] Paleta processada com sucesso:', paletteData.count, 'cores')
        } catch (error) {
          console.warn('[AssetsManager] Erro ao processar paleta, continuando sem preview:', error.message)
        }
      }
      
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
  // Carregar assets quando componente monta
  loadAssets()

  // Escanear novos recursos na primeira carga
  setTimeout(() => {
    scanResources()
  }, 500)

  // Listener para quando projeto é alterado (via FileExplorer ou MenuComponent)
  window.ipc?.on?.('read-files', () => {
    console.log('[AssetsManager] Projeto alterado, recarregando assets')
    loadAssets()
    // Escanear novos recursos
    setTimeout(() => {
      scanResources()
    }, 500)
  })

  // Listener para quando configuração do projeto é atualizada
  window.ipc?.on?.('project-config', (config) => {
    console.log('[AssetsManager] Configuração do projeto atualizada:', config)
    if (config.assets && Array.isArray(config.assets)) {
      assets.value = config.assets
    }
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

.palette-colors-grid {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  width: 100%;
  max-width: 250px;
  background: #000;
  gap: 1px;
  border: 1px solid #333;
  padding: 2px;
}

.palette-color-item {
  aspect-ratio: 1;
  width: 100%;
  border: 1px solid rgba(255,255,255,0.05);
}

.palette-color-item:hover {
  transform: scale(1.5);
  z-index: 10;
  border: 1px solid #fff;
  box-shadow: 0 0 10px rgba(0,0,0,0.5);
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

/* Detection Dialog Styles */
.detection-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  margin-bottom: 8px;
}

.detection-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.detection-file-info i {
  color: #888;
  font-size: 14px;
}

.file-name {
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 10px;
  color: #666;
  white-space: nowrap;
}

.type-select {
  background: #252525;
  border: 1px solid #444;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  min-width: 100px;
}

.type-select:focus {
  outline: none;
  border-color: #0066cc;
}
</style>