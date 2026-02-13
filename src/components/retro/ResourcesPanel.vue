<template>
  <div class="resources-panel">
    <AssetsManager
      :project-path="projectPathRef || ''"
      :assets="assets"
      :selected-asset="selectedAsset"
      :is-loading="isLoading"
      :ASSET_TYPES="ASSET_TYPES"
      :get-type-name="getTypeName"
      :format-file-size="formatFileSize"
      :image-editor-path="imageEditorPath ?? ''"
      :map-editor-path="mapEditorPath ?? ''"
      @update:selected-asset="selectedAsset = $event"
      @refresh="refreshAssets"
      @import="handleImport"
      @importPaths="handleImportPaths"
      @remove="handleRemove"
      @edit="handleEdit"
      @edit-tilemap="handleEditTilemap"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import AssetsManager from './AssetsManager.vue'
import { useAssets } from '@/composables/useAssets.js'

const props = defineProps({
  projectPath: { type: String, default: '' },
  imageEditorPath: { type: String, default: '' },
  mapEditorPath: { type: String, default: '' }
})

const projectPathRef = computed(() => props.projectPath)

const {
  assets,
  selectedAsset,
  isLoading,
  ASSET_TYPES,
  refreshAssets,
  importFiles,
  importFromPaths,
  removeAsset,
  getTypeName,
  formatFileSize,
  loadAssets
} = useAssets(projectPathRef)

async function handleImport(files, type) {
  await importFiles(files, type)
}

async function handleImportPaths(paths, type) {
  await importFromPaths(paths, type)
}

async function handleRemove(assetId) {
  await removeAsset(assetId)
}

function handleEdit(asset) {
  const path = projectPathRef?.value ?? projectPathRef
  if (asset?.path && path) {
    const fullPath = `${path}/${asset.path}`.replace(/\/+/g, '/')
    window.dispatchEvent?.(new CustomEvent('monarco:open-file', { detail: { path: fullPath } }))
  }
}

function handleEditTilemap(asset) {
  const path = projectPathRef?.value ?? projectPathRef
  window.dispatchEvent?.(new CustomEvent('monarco:edit-tilemap', {
    detail: { asset: asset || null, projectPath: path, assets: assets.value || [] }
  }))
}

defineExpose({ assetsManagerRef: null, refreshAssets, loadAssets })
</script>

<style scoped>
.resources-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel);
  border-right: 1px solid var(--border);
}
</style>
