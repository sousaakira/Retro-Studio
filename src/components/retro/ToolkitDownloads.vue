<template>
  <div class="toolkit-downloads">
    <div class="toolkit-list">
      <div v-for="pkg in packages" :key="pkg.id" class="toolkit-item">
        <div class="toolkit-info">
          <span class="toolkit-name">{{ pkg.name }}</span>
          <span class="toolkit-desc">{{ pkg.description }}</span>
          <span v-if="pkg.installed" class="toolkit-badge installed">Instalado</span>
          <span v-else-if="pkg.downloading" class="toolkit-badge">Baixando...</span>
        </div>
        <button
          class="btn-download"
          :disabled="!pkg.available || pkg.installed || pkg.downloading"
          @click="downloadPackage(pkg.id)"
        >
          {{ pkg.installed ? 'OK' : pkg.downloading ? '...' : 'Baixar' }}
        </button>
      </div>
    </div>
    <p v-if="packages.length === 0" class="toolkit-empty">Carregando pacotes...</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const packages = ref([])

async function loadPackages() {
  try {
    const res = await window.retroStudio?.retro?.getDownloadablePackages?.()
    if (res?.success) {
      packages.value = res.packages
    }
  } catch (e) {
    console.error('Erro ao carregar pacotes:', e)
  }
}

async function downloadPackage(packageId) {
  const pkg = packages.value.find((p) => p.id === packageId)
  if (!pkg || pkg.downloading || pkg.installed) return

  pkg.downloading = true
  try {
    const res = await window.retroStudio?.retro?.downloadPackage?.(packageId)
    if (res?.success) {
      await loadPackages()
      window.retroStudioToast?.success?.(`${pkg.name} instalado em ${res.installPath}`)
    } else {
      window.retroStudioToast?.error?.(res?.error || 'Falha no download')
    }
  } catch (e) {
    window.retroStudioToast?.error?.(e?.message || 'Erro ao baixar')
  } finally {
    pkg.downloading = false
  }
}

onMounted(() => {
  loadPackages()
  window.retroStudio?.retro?.onDownloadProgress?.((data) => {
    const pkg = packages.value.find((p) => p.id === data.packageId)
    if (pkg) pkg.progress = data.percent
  })
})
</script>

<style scoped>
.toolkit-downloads {
  padding: 8px 0;
}

.toolkit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toolkit-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.toolkit-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toolkit-name {
  font-weight: 500;
  color: var(--text);
}

.toolkit-desc {
  font-size: 11px;
  color: var(--muted);
}

.toolkit-badge {
  font-size: 10px;
  color: var(--muted);
  margin-top: 4px;
}

.toolkit-badge.installed {
  color: #3fb950;
}

.btn-download {
  padding: 6px 12px;
  font-size: 12px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-download:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolkit-empty {
  color: var(--muted);
  font-size: 12px;
}
</style>
