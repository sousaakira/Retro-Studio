import { ref, computed, watch } from 'vue'
import { importAssetToProject } from '@/utils/retro/projectAssetManager.js'

const ASSET_TYPES = ['sprite', 'tile', 'tilemap', 'palette', 'sound', 'background']
const TYPE_NAMES = {
  sprite: 'Sprite',
  tile: 'Tile',
  tilemap: 'Tilemap',
  palette: 'Paleta',
  sound: 'Som',
  background: 'Background'
}

export function useAssets(projectPathRef) {
  const assets = ref([])
  const selectedAsset = ref(null)
  const isLoading = ref(false)

  const projectPath = computed(() => {
    const v = projectPathRef
    if (!v) return ''
    return typeof v === 'function' ? v() : (v.value ?? v)
  })

  const loadAssets = async () => {
    const path = projectPath.value
    if (!path || !window.retroStudio?.retro) return
    isLoading.value = true
    try {
      const config = await window.retroStudio.retro.getProjectConfig(path)
      assets.value = config?.assets || []
      for (let i = 0; i < assets.value.length; i++) {
        const a = assets.value[i]
        if (a.path && ['sprite', 'tile', 'background'].includes(a.type)) {
          const r = await window.retroStudio.retro.getAssetPreview(path, a.path)
          if (r?.success) assets.value[i] = { ...a, preview: r.preview }
        }
      }
    } catch (e) {
      console.error('[useAssets] load error:', e)
      assets.value = []
    } finally {
      isLoading.value = false
    }
  }

  const saveAssets = async () => {
    const path = projectPath.value
    if (!path || !window.retroStudio?.retro) return
    const config = await window.retroStudio.retro.getProjectConfig(path)
    const toSave = assets.value.map(({ preview, ...a }) => a)
    await window.retroStudio.retro.saveProjectConfig(path, { ...config, assets: toSave })
  }

  const refreshAssets = async () => {
    const path = projectPath.value
    if (!path || !window.retroStudio?.retro) return
    const result = await window.retroStudio.retro.scanResources(path)
    if (result?.newAssets?.length) {
      for (const a of result.newAssets) {
        if (!assets.value.some((x) => x.path === a.path)) {
          assets.value.push({ ...a, id: a.id || `asset_${Date.now()}_${Math.random().toString(36).slice(2)}` })
        }
      }
      await saveAssets()
    }
    await loadAssets()
  }

  const importFiles = async (files, type) => {
    const path = projectPath.value
    if (!path || !files?.length) return
    for (const file of files) {
      const asset = {
        id: `asset_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type,
        size: file.size,
        path: '',
        createdAt: new Date().toISOString(),
        metadata: {}
      }
      try {
        await importAssetToProject(file, path, asset)
        assets.value.push(asset)
      } catch (e) {
        window.retroStudioToast?.error?.(e.message || 'Erro ao importar')
      }
    }
    await saveAssets()
  }

  const importFromPaths = async (filePaths, type) => {
    const path = projectPath.value
    if (!path || !filePaths?.length || !window.retroStudio?.retro?.importAssetFromPath) return
    for (const assetPath of filePaths) {
      const name = assetPath.split(/[/\\]/).pop() || 'asset'
      const asset = {
        id: `asset_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name,
        type,
        size: 0,
        path: '',
        createdAt: new Date().toISOString(),
        metadata: {}
      }
      try {
        const result = await window.retroStudio.retro.importAssetFromPath({ projectPath: path, assetPath, asset })
        if (result?.success) {
          asset.path = result.assetPath
          assets.value.push(asset)
        } else {
          window.retroStudioToast?.error?.(result?.error || 'Erro ao importar')
        }
      } catch (e) {
        window.retroStudioToast?.error?.(e.message || 'Erro ao importar')
      }
    }
    await saveAssets()
  }

  const removeAsset = async (assetId) => {
    const path = projectPath.value
    if (!path) return
    await window.retroStudio?.retro?.removeAssetFromConfig?.(path, assetId)
    assets.value = assets.value.filter((a) => a.id !== assetId)
  }

  const getTypeName = (t) => TYPE_NAMES[t] || t
  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  if (projectPathRef) {
    watch(
      () => projectPath.value,
      (p) => p && loadAssets(),
      { immediate: true }
    )
  }

  return {
    assets,
    selectedAsset,
    isLoading,
    ASSET_TYPES,
    loadAssets,
    saveAssets,
    refreshAssets,
    importFiles,
    importFromPaths,
    removeAsset,
    getTypeName,
    formatFileSize
  }
}
