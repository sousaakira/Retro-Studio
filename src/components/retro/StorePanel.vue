<template>
  <div class="store-panel">
    <div class="store-toolbar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Buscar assets..."
        class="store-search"
        @keyup.enter="loadAssets"
      />
      <button class="btn-refresh" @click="refreshStore" :disabled="loading" title="Atualizar">
        <span class="icon-arrows-rotate"></span>
      </button>
    </div>

    <div v-if="!storeApiUrl" class="store-empty">
      <p>Configure a URL da API em Configurações > Conta.</p>
    </div>

    <div v-else-if="loading && !assets.length" class="store-loading">
      Carregando...
    </div>

    <div v-else-if="error" class="store-error">
      {{ error }}
    </div>

    <div v-else class="store-grid">
      <div
        v-for="asset in assets"
        :key="asset._id"
        class="store-card"
      >
        <div class="store-card-preview">
          <img
            v-if="asset.previewUrl"
            :src="asset.previewUrl"
            :alt="asset.title"
            loading="lazy"
          />
          <div v-else class="store-card-placeholder">?</div>
        </div>
        <div class="store-card-body">
          <h4 class="store-card-title">{{ asset.title }}</h4>
          <p class="store-card-price">
            {{ asset.price === 0 ? 'Grátis' : `R$ ${(asset.price / 100).toFixed(2)}` }}
          </p>
          <div class="store-card-actions">
            <button
              v-if="isOwned(asset._id)"
              class="btn-install"
              :disabled="!projectPath || installingId === asset._id"
              @click="installAsset(asset)"
            >
              {{ installingId === asset._id ? 'Instalando…' : 'Instalar' }}
            </button>
            <template v-else>
              <button
                v-if="asset.price === 0"
                class="btn-obtain"
                :disabled="!storeUser || obtainingId === asset._id"
                @click="obtainFree(asset)"
              >
                {{ obtainingId === asset._id ? '…' : 'Obter grátis' }}
              </button>
              <button
                v-else
                class="btn-buy"
                disabled
                title="Integração de pagamento em breve"
              >
                Comprar
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="assets.length && pagination?.totalPages > 1" class="store-pagination">
      <button
        :disabled="pagination.page <= 1"
        @click="goPage(pagination.page - 1)"
      >
        Anterior
      </button>
      <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button
        :disabled="pagination.page >= pagination.totalPages"
        @click="goPage(pagination.page + 1)"
      >
        Próxima
      </button>
    </div>

    <p v-if="!storeUser && assets.length" class="store-hint">
      Faça login em Configurações > Conta para obter assets grátis.
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  projectPath: { type: String, default: '' }
})

const searchQuery = ref('')
const assets = ref([])
const pagination = ref(null)
const loading = ref(false)
const error = ref('')
const obtainingId = ref(null)
const installingId = ref(null)
const storeApiUrl = ref('https://api.retrostudio.dev')
const storeUser = ref(null)
const ownedAssetIds = ref(new Set())
const isOwned = (id) => ownedAssetIds.value.has(String(id))

async function loadStoreConfig() {
  try {
    const settings = await window.retroStudio?.settings?.load?.()
    storeApiUrl.value = settings?.store?.apiUrl || 'https://api.retrostudio.dev'
    const r = await window.retroStudio?.store?.me?.()
    storeUser.value = r?.user ?? null
    if (storeUser.value) {
      const purchases = await window.retroStudio?.store?.myPurchases?.()
      const data = purchases?.data || []
      ownedAssetIds.value = new Set(data.map(p => String(p.assetId?._id || p.assetId)))
    } else {
      ownedAssetIds.value = new Set()
    }
  } catch {
    storeUser.value = null
    ownedAssetIds.value = new Set()
  }
}

async function loadAssets(page = 1) {
  const apiUrl = storeApiUrl.value
  if (!apiUrl) return
  loading.value = true
  error.value = ''
  try {
    const params = { page, limit: 12 }
    if (searchQuery.value.trim()) params.q = searchQuery.value.trim()
    const json = await window.retroStudio?.store?.listAssets?.(apiUrl, params)
    assets.value = json?.data || []
    pagination.value = json?.pagination || null
  } catch (e) {
    error.value = e?.message || 'Erro ao carregar'
    assets.value = []
  } finally {
    loading.value = false
  }
}

function goPage(page) {
  loadAssets(page)
}

async function refreshStore() {
  await loadStoreConfig()
  loadAssets(pagination.value?.page || 1)
}

async function obtainFree(asset) {
  if (!props.storeUser) return
  obtainingId.value = asset._id
  error.value = ''
  try {
    const json = await window.retroStudio?.store?.purchase?.(asset._id)
    if (json?.success && json?.downloadUrl) {
      await doInstall(asset, json.downloadUrl)
    } else if (json?.success) {
      ownedAssetIds.value = new Set([...ownedAssetIds.value, String(asset._id)])
    } else {
      error.value = json?.message || 'Falha ao obter'
    }
  } catch (e) {
    error.value = e?.message || 'Erro'
  } finally {
    obtainingId.value = null
  }
}

async function installAsset(asset) {
  if (!props.projectPath) return
  installingId.value = asset._id
  error.value = ''
  try {
    const purchases = await window.retroStudio?.store?.myPurchases?.()
    const data = purchases?.data || []
    const purchase = data.find(p => String(p.assetId?._id || p.assetId) === String(asset._id))
    if (!purchase) {
      error.value = 'Compra não encontrada'
      return
    }
    const info = await window.retroStudio?.store?.download?.(purchase._id)
    if (info?.downloadUrl) {
      await doInstall(asset, info.downloadUrl)
    } else {
      error.value = 'URL de download não disponível'
    }
  } catch (e) {
    error.value = e?.message || 'Erro ao baixar'
  } finally {
    installingId.value = null
  }
}

async function doInstall(asset, downloadUrl) {
  if (!props.projectPath || !window.retroStudio?.store?.installAsset) {
    error.value = 'Instalação não disponível'
    return
  }
  try {
    await window.retroStudio.store.installAsset(props.projectPath, asset, downloadUrl)
    if (pagination.value) await loadAssets(pagination.value.page)
  } catch (e) {
    error.value = e?.message || 'Erro ao instalar'
  }
}

onMounted(async () => {
  await loadStoreConfig()
  loadAssets()
})
</script>

<style scoped>
.store-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  padding: 8px;
}

.store-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.store-search {
  flex: 1;
  padding: 8px 12px;
  font-size: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}

.store-search::placeholder {
  color: var(--muted);
}

.btn-refresh {
  padding: 8px;
  background: var(--tab);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
}

.btn-refresh:hover:not(:disabled) {
  background: var(--hover);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.store-empty,
.store-loading,
.store-error {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.store-error {
  color: var(--danger);
}

.store-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.store-card {
  background: var(--tab);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.store-card-preview {
  aspect-ratio: 1;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.store-card-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.store-card-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--muted);
}

.store-card-body {
  padding: 8px;
}

.store-card-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.store-card-price {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--muted);
}

.store-card-actions button {
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  border: none;
}

.btn-obtain,
.btn-install {
  background: var(--accent);
  color: white;
}

.btn-obtain:disabled:not(:hover),
.btn-install:disabled:not(:hover) {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-buy {
  background: var(--tab);
  color: var(--muted);
  cursor: not-allowed;
}

.store-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
  font-size: 12px;
}

.store-pagination button {
  padding: 4px 12px;
  font-size: 12px;
}

.store-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--muted);
  text-align: center;
}
</style>
