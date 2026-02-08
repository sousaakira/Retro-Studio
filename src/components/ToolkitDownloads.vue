<template>
  <div class="toolkit-downloads">
    <p class="toolkit-desc">
      Baixe MarsDev, SGDK e emuladores em <code>~/.retrostudio/toolkit</code> (Linux) ou equivalente no Windows. Pacotes em retrostudio.dev.
    </p>
    <div v-if="loading" class="toolkit-loading">
      <i class="fas fa-spinner fa-spin"></i> Carregando...
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
          <span class="toolkit-item-cat">{{ pkg.category === 'toolkit' ? 'Toolkit' : 'Emulador' }}</span>
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
              type="button"
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
            <span class="toolkit-badge unavailable">Indisponível ({{ platform }})</span>
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
  --tk-bg: #0d1117;
  --tk-border: #30363d;
  --tk-accent: #58a6ff;
  --tk-text: #e6edf3;
  --tk-muted: #8b949e;
  --tk-success: #3fb950;
}
.toolkit-desc {
  color: var(--tk-muted);
  font-size: 12px;
  margin: 0 0 14px 0;
  line-height: 1.5;
}
.toolkit-desc code {
  background: rgba(110, 118, 129, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.toolkit-loading {
  color: var(--tk-muted);
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
  padding: 12px 14px;
  background: var(--tk-bg);
  border: 1px solid var(--tk-border);
  border-radius: 8px;
  transition: border-color 0.15s;
}
.toolkit-item.installed {
  border-color: rgba(63, 185, 80, 0.4);
}
.toolkit-item.unavailable {
  opacity: 0.75;
}
.toolkit-item-info {
  flex: 1;
  min-width: 0;
}
.toolkit-item-name {
  font-weight: 600;
  color: var(--tk-text);
  font-size: 13px;
  margin-right: 8px;
}
.toolkit-item-cat {
  display: inline-block;
  font-size: 10px;
  color: var(--tk-accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.toolkit-item-desc {
  font-size: 12px;
  color: var(--tk-muted);
  margin: 6px 0 0 0;
  line-height: 1.4;
}
.toolkit-item-path {
  font-size: 11px;
  color: var(--tk-muted);
  margin: 6px 0 0 0;
  word-break: break-all;
  font-family: ui-monospace, monospace;
}
.toolkit-item-actions {
  flex-shrink: 0;
  margin-left: 14px;
}
.btn-download {
  background: var(--tk-accent);
  color: #fff;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: filter 0.15s, opacity 0.15s;
}
.btn-download:hover:not(:disabled) {
  filter: brightness(1.1);
}
.btn-download:disabled {
  opacity: 0.85;
  cursor: not-allowed;
}
.toolkit-badge {
  font-size: 11px;
  color: var(--tk-success);
  font-weight: 500;
}
.toolkit-badge.unavailable {
  color: var(--tk-muted);
}
</style>
