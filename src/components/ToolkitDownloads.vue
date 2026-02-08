<template>
  <div class="toolkit-downloads">
    <p class="toolkit-downloads-desc">
      Baixe MarsDev, SGDK e emuladores para <code>~/.retrostudio/toolkit</code> (Linux) ou equivalente no Windows.
      Pacotes hospedados em retrostudio.dev.
    </p>
    <div v-if="loading" class="toolkit-loading">
      <i class="fas fa-spinner fa-spin"></i> Carregando lista...
    </div>
    <div v-else class="toolkit-list">
      <div
        v-for="pkg in packages"
        :key="pkg.id"
        class="toolkit-item"
        :class="{ installed: pkg.installed, unavailable: !pkg.available }"
      >
        <div class="toolkit-item-info">
          <span class="toolkit-item-name">{{ pkg.name }}</span>
          <span class="toolkit-item-category">{{ pkg.category === 'toolkit' ? 'Toolkit' : 'Emulador' }}</span>
          <p class="toolkit-item-desc">{{ pkg.description }}</p>
          <p v-if="pkg.installed && pkg.installPath" class="toolkit-item-path">
            <i class="fas fa-folder"></i> {{ pkg.installPath }}
          </p>
        </div>
        <div class="toolkit-item-actions">
          <template v-if="pkg.installed">
            <span class="toolkit-badge"><i class="fas fa-check"></i> Instalado</span>
          </template>
          <template v-else-if="pkg.available">
            <button
              class="btn-download"
              :disabled="downloadingId === pkg.id"
              @click="download(pkg)"
            >
              <template v-if="downloadingId === pkg.id">
                <i class="fas fa-spinner fa-spin"></i>
                {{ progressPercent !== null ? `${progressPercent}%` : '...' }}
              </template>
              <template v-else>
                <i class="fas fa-download"></i> Baixar
              </template>
            </button>
          </template>
          <template v-else>
            <span class="toolkit-badge unavailable">Indisponível para {{ platform }}</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useStore } from 'vuex'

const store = useStore()
const loading = ref(true)
const packages = ref([])
const platform = ref('')
const downloadingId = ref(null)
const progressPercent = ref(null)

async function loadPackages() {
  loading.value = true
  try {
    const result = await window.ipc?.invoke('get-downloadable-packages')
    if (result?.success) {
      packages.value = result.packages || []
      platform.value = result.platform || ''
    }
  } catch (e) {
    console.error('get-downloadable-packages failed:', e)
  } finally {
    loading.value = false
  }
}

function onProgress(payload) {
  if (payload.packageId !== downloadingId.value) return
  progressPercent.value = payload.percent ?? null
}

async function download(pkg) {
  if (downloadingId.value) return
  downloadingId.value = pkg.id
  progressPercent.value = 0
  const off = () => {
    window.ipc?.off?.('download-package-progress', onProgress)
  }
  window.ipc?.on?.('download-package-progress', onProgress)

  try {
    const result = await window.ipc?.invoke('download-package', { packageId: pkg.id })
    if (result?.success) {
      store.dispatch('showNotification', {
        type: 'success',
        title: `${pkg.name} instalado`,
        message: result.installPath || 'Instalação concluída.',
      })
      if (pkg.id === 'marsdev' && result.installPath) {
        store.dispatch('setToolkitPath', result.installPath)
      }
      await loadPackages()
      store.dispatch('fetchEmulators')
    } else {
      store.dispatch('showNotification', {
        type: 'error',
        title: 'Erro ao baixar',
        message: result?.error || 'Falha no download.',
      })
    }
  } catch (e) {
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Erro',
      message: e?.message || 'Falha no download.',
    })
  } finally {
    off()
    downloadingId.value = null
    progressPercent.value = null
  }
}

onMounted(() => {
  loadPackages()
})
</script>

<style scoped>
.toolkit-downloads {
  margin-bottom: 8px;
}
.toolkit-downloads-desc {
  color: #aaa;
  font-size: 12px;
  margin: 0 0 12px 0;
}
.toolkit-downloads-desc code {
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
}
.toolkit-loading {
  color: #888;
  font-size: 13px;
}
.toolkit-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toolkit-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 10px 12px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
}
.toolkit-item.installed {
  border-color: #0a4;
}
.toolkit-item.unavailable {
  opacity: 0.7;
}
.toolkit-item-info {
  flex: 1;
  min-width: 0;
}
.toolkit-item-name {
  font-weight: 600;
  color: #dce3f2;
  margin-right: 8px;
}
.toolkit-item-category {
  font-size: 11px;
  color: #0066cc;
  text-transform: uppercase;
}
.toolkit-item-desc {
  font-size: 12px;
  color: #888;
  margin: 4px 0 0 0;
}
.toolkit-item-path {
  font-size: 11px;
  color: #666;
  margin: 4px 0 0 0;
  word-break: break-all;
}
.toolkit-item-actions {
  flex-shrink: 0;
  margin-left: 12px;
}
.btn-download {
  background: #0066cc;
  color: #fff;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.btn-download:hover:not(:disabled) {
  background: #0077dd;
}
.btn-download:disabled {
  opacity: 0.8;
  cursor: not-allowed;
}
.toolkit-badge {
  font-size: 12px;
  color: #0a4;
}
.toolkit-badge.unavailable {
  color: #888;
}
</style>
