<template>
  <div v-if="isOpen" class="updates-overlay" @click.self="emit('close')">
    <div class="updates-panel" role="dialog" aria-modal="true" :aria-label="t('updates.title')">
      <header class="updates-header">
        <div>
          <h2>{{ t('updates.title') }}</h2>
          <p class="updates-sub">
            {{ t('updates.currentVersion', { version: appVersion || '…' }) }}
          </p>
        </div>
        <button type="button" class="updates-close" :title="t('common.close')" @click="emit('close')">✕</button>
      </header>

      <div class="updates-toolbar">
        <button type="button" class="btn btn--primary" :disabled="checking" @click="runCheck">
          {{ checking ? t('updates.checking') : t('updates.checkButton') }}
        </button>
        <button type="button" class="btn btn--secondary" :disabled="loadingNotes" @click="loadNotes">
          {{ loadingNotes ? t('updates.loadingNotes') : t('updates.refreshNotes') }}
        </button>
        <button
          v-if="updateInfo?.releasesUrl"
          type="button"
          class="btn btn--secondary"
          @click="openUrl(updateInfo.releasesUrl)"
        >
          {{ t('updates.openReleases') }}
        </button>
      </div>

      <div v-if="error" class="updates-error">{{ error }}</div>

      <div v-if="updateInfo" class="updates-status" :class="{ available: updateInfo.updateAvailable }">
        <template v-if="updateInfo.updateAvailable">
          <strong>{{ t('updates.updateAvailable', { version: updateInfo.latestVersion }) }}</strong>
          <button
            v-if="updateInfo.latest?.url"
            type="button"
            class="btn btn--primary btn-sm"
            @click="openUrl(updateInfo.latest.url)"
          >
            {{ t('updates.download') }}
          </button>
        </template>
        <template v-else>
          {{ t('updates.upToDate') }}
        </template>
      </div>

      <div class="updates-list" v-if="releases.length">
        <article v-for="rel in releases" :key="rel.tag" class="updates-release">
          <header class="updates-release-head">
            <h3>{{ rel.name || rel.tag }}</h3>
            <span class="updates-tag">{{ rel.tag }}</span>
            <span v-if="rel.publishedAt" class="updates-date">{{ formatDate(rel.publishedAt) }}</span>
            <button type="button" class="updates-link" @click="openUrl(rel.url)">{{ t('updates.viewOnGithub') }}</button>
          </header>
          <pre class="updates-body">{{ rel.body || t('updates.noNotes') }}</pre>
          <ul v-if="rel.assets?.length" class="updates-assets">
            <li v-for="asset in rel.assets" :key="asset.url">
              <button type="button" class="updates-link" @click="openUrl(asset.url)">{{ asset.name }}</button>
            </li>
          </ul>
        </article>
      </div>
      <p v-else-if="!loadingNotes && !error" class="updates-empty">{{ t('updates.empty') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  autoCheck: { type: Boolean, default: true }
})
const emit = defineEmits(['close'])
const { t } = useI18n()

const appVersion = ref('')
const checking = ref(false)
const loadingNotes = ref(false)
const error = ref('')
const updateInfo = ref(null)
const releases = ref([])

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

async function openUrl(url) {
  if (!url) return
  try {
    await window.retroStudio?.openExternal?.(url)
  } catch {
    window.retroStudio?.retro?.openExternalUrl?.(url)
  }
}

async function loadAppInfo() {
  try {
    const info = await window.retroStudio?.getAppInfo?.()
    appVersion.value = info?.version || ''
    if (info?.releasesUrl && !updateInfo.value) {
      updateInfo.value = { releasesUrl: info.releasesUrl, updateAvailable: false, currentVersion: info.version }
    }
  } catch { /* ignore */ }
}

async function runCheck() {
  checking.value = true
  error.value = ''
  try {
    updateInfo.value = await window.retroStudio?.checkUpdates?.()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    checking.value = false
  }
}

async function loadNotes() {
  loadingNotes.value = true
  error.value = ''
  try {
    releases.value = await window.retroStudio?.getChangelog?.({ limit: 12 }) || []
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loadingNotes.value = false
  }
}

watch(() => props.isOpen, async (open) => {
  if (!open) return
  await loadAppInfo()
  if (!releases.value.length) await loadNotes()
  if (props.autoCheck) await runCheck()
})

onMounted(() => {
  loadAppInfo()
})
</script>

<style scoped>
.updates-overlay {
  position: fixed;
  inset: 0;
  z-index: 10050;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.updates-panel {
  width: min(720px, 100%);
  max-height: min(80vh, 900px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--panel, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.updates-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border, #333);
}
.updates-header h2 {
  margin: 0;
  font-size: 16px;
}
.updates-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted, #9aa4b2);
}
.updates-close {
  all: unset;
  cursor: pointer;
  opacity: 0.7;
  padding: 4px 8px;
}
.updates-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 18px;
}
.updates-status {
  margin: 0 18px 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.updates-status.available {
  background: rgba(46, 160, 67, 0.15);
  border: 1px solid rgba(63, 185, 80, 0.35);
}
.updates-error {
  margin: 0 18px 8px;
  color: #f85149;
  font-size: 12px;
}
.updates-list {
  overflow: auto;
  padding: 0 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.updates-release {
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 12px;
  background: var(--panel-2, #252526);
}
.updates-release-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.updates-release-head h3 {
  margin: 0;
  font-size: 14px;
}
.updates-tag {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #58a6ff;
}
.updates-date {
  font-size: 11px;
  color: var(--muted, #9aa4b2);
}
.updates-body {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text, #e6edf3);
  max-height: 220px;
  overflow: auto;
}
.updates-assets {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.updates-link {
  all: unset;
  cursor: pointer;
  color: #58a6ff;
  font-size: 12px;
  text-decoration: underline;
}
.updates-empty {
  padding: 0 18px 18px;
  color: var(--muted, #9aa4b2);
  font-size: 13px;
}
.btn {
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.btn--primary {
  background: #238636;
  color: #fff;
}
.btn--secondary {
  background: transparent;
  border-color: var(--border, #444);
  color: var(--text, #e6edf3);
}
.btn-sm {
  padding: 5px 10px;
  font-size: 11px;
}
</style>
