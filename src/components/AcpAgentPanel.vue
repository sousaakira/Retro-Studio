<template>
  <div class="acp-panel">
    <header class="acp-header">
      <div class="acp-header-main">
        <div class="acp-brand">
          <span class="acp-brand-mark" :class="{ busy }" aria-hidden="true"></span>
          <div class="acp-brand-text">
            <span class="acp-brand-title">{{ agentTitle || 'OpenCode' }}</span>
          </div>
        </div>
        <span class="acp-status" :class="status" :title="statusLabel">
          <span class="acp-status-dot"></span>
          <span class="acp-status-text">{{ statusLabel }}</span>
        </span>
      </div>
      <div class="acp-header-tools">
        <template v-if="isRetroProject">
          <button
            class="acp-icon-btn"
            :disabled="busy || buildBusy"
            :title="t('acp.actionBuild')"
            @click="runProjectAction('build')"
          >⚒</button>
          <button
            class="acp-icon-btn"
            :disabled="busy || buildBusy"
            :title="t('acp.actionPlay')"
            @click="runProjectAction('play')"
          >▶</button>
          <button
            class="acp-icon-btn danger"
            :disabled="!buildBusy"
            :title="t('acp.actionStop')"
            @click="runProjectAction('stop')"
          >■</button>
        </template>
        <button
          class="acp-icon-btn"
          :disabled="busy"
          :title="t('acp.newSession')"
          @click="createNewSession"
        >＋</button>
        <button
          class="acp-icon-btn acp-details-btn"
          :class="{ active: showDetails }"
          :title="showDetails ? t('acp.hideDetails') : t('acp.showDetails')"
          :aria-pressed="showDetails"
          @click="toggleDetails"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 6h16M4 12h10M4 18h16"/>
            <circle v-if="showDetails" cx="18" cy="12" r="2" fill="currentColor" stroke="none"/>
          </svg>
        </button>
        <button class="acp-icon-btn" :disabled="busy" :title="t('acp.restart')" @click="restart">↻</button>
        <button class="acp-icon-btn danger" :disabled="!busy || status === 'starting'" :title="t('acp.cancel')" @click="cancel">■</button>
        <button class="acp-icon-btn" :title="t('acp.settings')" @click="openSettings">⚙</button>
        <button class="acp-icon-btn" :title="t('acp.close')" @click="emit('close')">
          <span class="icon-xmark" aria-hidden="true"></span>
        </button>
      </div>
      <div
        class="acp-progress"
        :class="{ active: busy }"
        role="progressbar"
        :aria-hidden="!busy"
        :aria-busy="busy"
      >
        <span class="acp-progress-bar"></span>
      </div>
    </header>

    <div v-if="showAuthBanner" class="acp-auth-banner" role="status">
      <div class="acp-auth-copy">
        <strong>{{ t('acp.authTitle') }}</strong>
        <span>{{ authBannerMessage }}</span>
      </div>
      <div class="acp-auth-actions">
        <button type="button" class="acp-perm-btn allow_once" @click="runAuthLogin">{{ t('acp.authLogin') }}</button>
        <button type="button" class="acp-text-btn" @click="copyAuthCommand">{{ t('acp.authCopy') }}</button>
        <button type="button" class="acp-text-btn" @click="refreshAuthStatus">{{ t('acp.authRecheck') }}</button>
      </div>
    </div>

    <div ref="scrollEl" class="acp-messages" role="log" aria-live="polite">
      <div v-if="!visibleEntries.length && !activitySummary && status === 'ready' && !replaying" class="acp-empty">
        <p class="acp-empty-title">{{ t('acp.emptyTitle') }}</p>
        <p class="acp-empty-hint">{{ t('acp.emptyHint') }}</p>
        <ul class="acp-onboarding">
          <li>{{ t('acp.onboardInstall') }}</li>
          <li>{{ t('acp.onboardLogin') }}</li>
          <li>{{ t('acp.onboardCtrlL') }}</li>
          <li>{{ t('acp.onboardCtrlK') }}</li>
        </ul>
      </div>

      <article v-for="(entry, i) in visibleEntries" :key="entryKey(entry, i)" class="acp-entry" :class="entry.kind">
        <template v-if="entry.kind === 'tool'">
          <div class="acp-tool-row" :class="{ running: !isTerminalStatus(entry.status) }">
            <span class="acp-tool-dot" :data-status="entry.status"></span>
            <span class="acp-tool-title">{{ entry.title }}</span>
            <span class="acp-tool-status" :data-status="entry.status">{{ toolStatusLabel(entry.status) }}</span>
          </div>
        </template>

        <template v-else-if="entry.kind === 'thought'">
          <div class="acp-thought">
            <span class="acp-thought-label">{{ t('acp.thought') }}</span>
            <div class="acp-text" v-html="renderText(entry.text)"></div>
          </div>
        </template>

        <template v-else-if="entry.kind === 'diff'">
          <div class="acp-entry-meta">
            <span class="acp-avatar diff">Δ</span>
            <span class="acp-entry-label">{{ t('acp.diff') }}</span>
          </div>
          <div class="acp-diff">
            <div class="acp-diff-path">{{ shortPath(entry.path) }}</div>
            <pre class="acp-diff-body">{{ entry.preview }}</pre>
            <button type="button" class="acp-text-btn" @click="openPath(entry.path)">{{ t('acp.openFile') }}</button>
          </div>
        </template>

        <template v-else>
          <div class="acp-entry-meta">
            <span class="acp-avatar" :class="entry.kind">{{ avatarFor(entry.kind) }}</span>
            <span class="acp-entry-label">{{ entryLabel(entry) }}</span>
          </div>
          <div class="acp-text" v-html="renderText(entry.text)"></div>
        </template>
      </article>

      <div
        v-if="busy"
        class="acp-processing"
        role="status"
        aria-live="polite"
      >
        <span class="acp-processing-dots" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <span class="acp-processing-label">{{ processingLabel }}</span>
      </div>

      <button
        v-if="activitySummary"
        type="button"
        class="acp-activity"
        :class="{ clickable: !showDetails, busy }"
        :title="showDetails ? undefined : t('acp.showDetails')"
        @click="!showDetails && toggleDetails()"
      >
        <span class="acp-activity-pulse" v-if="busy"></span>
        <span>{{ activitySummary }}</span>
        <span v-if="!showDetails" class="acp-activity-hint">{{ t('acp.showDetailsShort') }}</span>
      </button>
    </div>

    <div v-if="permission" class="acp-permission" role="alertdialog" aria-labelledby="acp-perm-title">
      <div class="acp-permission-copy">
        <strong id="acp-perm-title">{{ t('acp.permissionTitle') }}</strong>
        <div class="acp-permission-meta">
          <span v-if="permissionKindLabel" class="acp-perm-kind" :data-kind="permissionToolKind">{{ permissionKindLabel }}</span>
          <span class="acp-perm-tool">{{ permissionToolLabel }}</span>
        </div>
        <span v-if="permissionLocationsLabel" class="acp-perm-paths" :title="permissionLocationsLabel">{{ permissionLocationsLabel }}</span>
        <span class="acp-perm-hint">{{ t('acp.permissionHint') }}</span>
      </div>
      <div class="acp-permission-actions">
        <button
          v-for="opt in sortedPermissionOptions"
          :key="opt.optionId"
          type="button"
          class="acp-perm-btn"
          :class="opt.kind"
          @click="answerPermission(opt)"
        >
          {{ permissionOptionLabel(opt) }}
        </button>
      </div>
    </div>

    <footer class="acp-composer">
      <div v-if="contextChips.length" class="acp-context-chips" role="group" :aria-label="t('acp.contextChips')">
        <button
          v-for="chip in contextChips"
          :key="chip.id"
          type="button"
          class="acp-chip"
          :class="{ active: chip.active, available: chip.available }"
          :disabled="!chip.available"
          :title="chip.title"
          @click="toggleChip(chip.id)"
        >
          <span class="acp-chip-label">{{ chip.label }}</span>
          <span v-if="chip.detail" class="acp-chip-detail">{{ chip.detail }}</span>
        </button>
      </div>
      <textarea
        ref="inputEl"
        v-model="input"
        class="acp-input"
        rows="2"
        :placeholder="t('acp.placeholder')"
        :disabled="status !== 'ready' && status !== 'error'"
        @keydown="onKeydown"
      />

      <div class="acp-composer-bar">
        <div class="acp-selectors">
          <!-- Session -->
          <div
            v-if="sessions.length"
            class="acp-select acp-select-session"
            @click.stop="toggleMenu('session')"
          >
            <span class="acp-select-label" :title="sessionDisplayName">{{ sessionDisplayName }}</span>
            <svg class="acp-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            <div v-if="openMenu === 'session'" class="acp-menu acp-menu-session" @click.stop>
              <button
                v-for="s in sessions"
                :key="s.sessionId"
                type="button"
                class="acp-menu-item"
                :class="{ active: s.sessionId === sessionId }"
                @click="loadExistingSession(s.sessionId)"
              >
                <span class="acp-menu-name">{{ formatSessionTitle(s) }}</span>
                <span v-if="s.updatedAt" class="acp-menu-desc">{{ formatSessionTime(s.updatedAt) }}</span>
              </button>
              <button type="button" class="acp-menu-item acp-menu-new" @click="createNewSession">
                <span class="acp-menu-name">{{ t('acp.newSession') }}</span>
              </button>
            </div>
          </div>

          <!-- Mode -->
          <div v-if="modeOption" class="acp-select" @click.stop="toggleMenu('mode')">
            <span class="acp-select-label">{{ modeDisplayName }}</span>
            <svg class="acp-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            <div v-if="openMenu === 'mode'" class="acp-menu">
              <button
                v-for="opt in modeOption.options || []"
                :key="opt.value"
                type="button"
                class="acp-menu-item"
                :class="{ active: opt.value === modeOption.currentValue }"
                @click.stop="selectConfig(modeOption.id, opt.value)"
              >
                <span class="acp-menu-name">{{ opt.name }}</span>
                <span v-if="opt.description" class="acp-menu-desc">{{ opt.description }}</span>
              </button>
            </div>
          </div>

          <!-- Model -->
          <div v-if="modelOption" class="acp-select acp-select-model" @click.stop="toggleMenu('model')">
            <span class="acp-select-label" :title="modelDisplayName">{{ modelDisplayName }}</span>
            <svg class="acp-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            <div v-if="openMenu === 'model'" class="acp-menu acp-menu-model" @click.stop>
              <input
                ref="modelSearchEl"
                v-model="modelQuery"
                class="acp-menu-search"
                type="search"
                :placeholder="t('acp.searchModels')"
                @keydown.esc.stop="closeMenus"
              />
              <div class="acp-menu-scroll">
                <template v-for="group in filteredModelGroups" :key="group.provider">
                  <div class="acp-menu-group">{{ group.provider }}</div>
                  <button
                    v-for="opt in group.options"
                    :key="opt.value"
                    type="button"
                    class="acp-menu-item"
                    :class="{ active: opt.value === modelOption.currentValue }"
                    @click="selectConfig(modelOption.id, opt.value)"
                  >
                    <span class="acp-menu-name">{{ opt.name }}</span>
                  </button>
                </template>
                <p v-if="!filteredModelGroups.length" class="acp-menu-empty">{{ t('acp.noModels') }}</p>
              </div>
            </div>
          </div>
        </div>

        <button type="button" class="acp-send" :disabled="!canSend" @click="send">
          {{ busy ? t('acp.working') : t('acp.send') }}
        </button>
      </div>
    </footer>

    <Teleport to="body">
      <div v-if="showSettings" class="acp-settings-overlay" @click.self="closeSettings">
        <div class="acp-settings-modal" role="dialog" :aria-label="t('acp.settings')">
          <div class="acp-settings-header">
            <h3>{{ t('acp.settingsTitle') }}</h3>
            <button type="button" class="acp-icon-btn" @click="closeSettings">×</button>
          </div>
          <div class="acp-settings-body">
            <label class="acp-settings-label">{{ t('acp.commandPath') }}</label>
            <p class="acp-settings-hint">{{ t('acp.commandPathHint') }}</p>
            <input
              v-model="commandPathDraft"
              class="acp-settings-input"
              type="text"
              placeholder="~/.opencode/bin/opencode"
            />
            <label class="acp-settings-label" style="margin-top: 14px">{{ t('acp.authSettingsTitle') }}</label>
            <p class="acp-settings-hint">
              {{
                authStatus?.hasCredentials
                  ? t('acp.authProviders', { count: authStatus.providers?.length || 0 })
                  : t('acp.authMissing')
              }}
            </p>
            <div class="acp-auth-actions" style="margin-top: 8px">
              <button type="button" class="acp-perm-btn allow_once" @click="runAuthLogin">{{ t('acp.authLogin') }}</button>
              <button type="button" class="acp-text-btn" @click="refreshAuthStatus">{{ t('acp.authRecheck') }}</button>
            </div>
          </div>
          <div class="acp-settings-footer">
            <button type="button" class="acp-text-btn" @click="closeSettings">{{ t('common.cancel') }}</button>
            <button type="button" class="acp-send" @click="saveSettings">{{ t('common.save') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'

const { t } = useI18n()
const emit = defineEmits(['close'])

const props = defineProps({
  active: { type: Boolean, default: false }
})

const status = ref('idle')
const agentTitle = ref('')
const input = ref('')
const entries = ref([])
const showDetails = ref(false)
const showSettings = ref(false)
const commandPathDraft = ref('')
const permission = ref(null)
/** @type {import('vue').Ref<Map<string, 'allow' | 'reject'>>} */
const permissionMemory = ref(new Map())
const configOptions = ref([])
const openMenu = ref(null) // 'mode' | 'model' | 'session' | null
const modelQuery = ref('')
const scrollEl = ref(null)
const inputEl = ref(null)
const modelSearchEl = ref(null)
const sessionId = ref(null)
const sessions = ref([])
const replaying = ref(false)
const openedMode = ref('new') // 'new' | 'load'
const authStatus = ref(null) // { hasCredentials, providers, loginCommand }
const authErrorHint = ref(false)
const chipState = ref({
  file: true,
  build: true,
  tilemap: true,
  rom: false
})
const chipTick = ref(0) // força refresh dos chips
const buildBusy = ref(false)
const isRetroProject = ref(false)

const busy = computed(() => status.value === 'busy' || status.value === 'starting')
const canSend = computed(() => status.value === 'ready' && input.value.trim().length > 0)

const showAuthBanner = computed(() => {
  if (authErrorHint.value) return true
  if (authStatus.value && authStatus.value.hasCredentials === false) return true
  return false
})

const authBannerMessage = computed(() => {
  if (authErrorHint.value) return t('acp.authErrorHint')
  return t('acp.authMissing')
})

function shortBase(p) {
  if (!p) return ''
  return String(p).split(/[/\\]/).pop() || p
}

const contextSnapshot = computed(() => {
  void chipTick.value
  const filePath = window.retroStudioEditor?.getCurrentFile?.() || null
  const errors = window.retroStudioContext?.getCompilationErrors?.() || []
  const tilemap = window.retroStudioContext?.getLastTilemap?.() || null
  const rom = window.retroStudioContext?.getLastRomPath?.() || null
  return {
    filePath,
    fileName: shortBase(filePath),
    errorCount: Array.isArray(errors) ? errors.length : 0,
    errors: Array.isArray(errors) ? errors : [],
    tilemap,
    romPath: rom,
    romName: shortBase(rom)
  }
})

const contextChips = computed(() => {
  const snap = contextSnapshot.value
  return [
    {
      id: 'file',
      label: t('acp.chipFile'),
      detail: snap.fileName || null,
      title: snap.filePath || t('acp.chipFileEmpty'),
      available: !!snap.filePath,
      active: !!chipState.value.file && !!snap.filePath
    },
    {
      id: 'build',
      label: t('acp.chipBuild'),
      detail: snap.errorCount ? String(snap.errorCount) : null,
      title: snap.errorCount ? t('acp.chipBuildTitle', { count: snap.errorCount }) : t('acp.chipBuildEmpty'),
      available: snap.errorCount > 0,
      active: !!chipState.value.build && snap.errorCount > 0
    },
    {
      id: 'tilemap',
      label: t('acp.chipTilemap'),
      detail: snap.tilemap?.name || null,
      title: snap.tilemap?.path || t('acp.chipTilemapEmpty'),
      available: !!snap.tilemap?.path || !!snap.tilemap?.name,
      active: !!chipState.value.tilemap && (!!snap.tilemap?.path || !!snap.tilemap?.name)
    },
    {
      id: 'rom',
      label: t('acp.chipRom'),
      detail: snap.romName || null,
      title: snap.romPath || t('acp.chipRomEmpty'),
      available: !!snap.romPath,
      active: !!chipState.value.rom && !!snap.romPath
    }
  ]
})

function toggleChip(id) {
  if (!(id in chipState.value)) return
  chipState.value = { ...chipState.value, [id]: !chipState.value[id] }
}

function refreshChips() {
  chipTick.value += 1
  isRetroProject.value = !!window.retroStudioContext?.getIsRetroProject?.()
  buildBusy.value = !!(window.retroStudioContext?.isBuilding?.() || window.retroStudioContext?.isPlaying?.())
}

function runProjectAction(action) {
  const ctx = window.retroStudioContext
  if (!ctx) return
  if (action === 'build') {
    pushSystem(t('acp.buildStarted'))
    buildBusy.value = true
    ctx.build?.()
    return
  }
  if (action === 'play') {
    pushSystem(t('acp.playStarted'))
    buildBusy.value = true
    ctx.play?.()
    return
  }
  if (action === 'stop') {
    ctx.stop?.()
    buildBusy.value = false
    pushSystem(t('acp.buildStopped'))
  }
}

function onAcpBuildResult(e) {
  buildBusy.value = false
  refreshChips()
  const detail = e?.detail || {}
  if (detail.ok) {
    const rom = detail.romPath ? shortBase(detail.romPath) : ''
    pushSystem(rom ? t('acp.buildOkRom', { rom }) : t('acp.buildOk'))
    return
  }
  const errors = detail.errors || []
  const n = errors.length
  pushSystem(t('acp.buildFailed', { count: n }))
  if (n && chipState.value.build !== false) {
    chipState.value = { ...chipState.value, build: true }
  }
}

function buildContextNotes() {
  const snap = contextSnapshot.value
  const notes = []
  if (chipState.value.build && snap.errorCount > 0) {
    const lines = snap.errors.slice(0, 20).map((e) => {
      const loc = [e.file, e.line, e.column].filter((x) => x != null && x !== '').join(':')
      return `- ${loc || '?'} ${e.message || e.type || ''}`.trim()
    })
    notes.push(`--- SGDK BUILD ERRORS (${snap.errorCount}) ---\n${lines.join('\n')}`)
  }
  if (chipState.value.tilemap && (snap.tilemap?.path || snap.tilemap?.name)) {
    notes.push(`--- TILEMAP ---\nname: ${snap.tilemap.name || ''}\npath: ${snap.tilemap.path || ''}`)
  }
  if (chipState.value.rom && snap.romPath) {
    notes.push(`--- LAST ROM ---\n${snap.romPath}`)
  }
  return notes
}

const sessionDisplayName = computed(() => {
  const current = sessions.value.find((s) => s.sessionId === sessionId.value)
  if (current) return formatSessionTitle(current)
  if (sessionId.value) return t('acp.currentSession')
  return t('acp.session')
})

const DETAIL_KINDS = new Set(['thought', 'tool'])

const visibleEntries = computed(() => {
  if (showDetails.value) return entries.value
  return entries.value.filter((e) => !DETAIL_KINDS.has(e.kind))
})

const hiddenTools = computed(() => entries.value.filter((e) => e.kind === 'tool'))
const hiddenThoughts = computed(() => entries.value.filter((e) => e.kind === 'thought'))

const activitySummary = computed(() => {
  if (showDetails.value) return ''
  const tools = hiddenTools.value
  const thoughts = hiddenThoughts.value
  if (!tools.length && !thoughts.length) return ''
  const active = tools.filter((e) => !isTerminalStatus(e.status))
  const parts = []
  if (active.length) parts.push(t('acp.activityRunning', { count: active.length }))
  else if (tools.length) parts.push(t('acp.activityTools', { count: tools.length }))
  if (thoughts.length) parts.push(t('acp.activityThoughts'))
  return parts.join(' · ')
})

const statusLabel = computed(() => {
  const map = {
    idle: t('acp.statusIdle'),
    starting: replaying.value ? t('acp.statusLoading') : t('acp.statusStarting'),
    ready: t('acp.statusReady'),
    busy: t('acp.statusBusy'),
    error: t('acp.statusError')
  }
  return map[status.value] || status.value
})

const processingLabel = computed(() => {
  if (replaying.value || status.value === 'starting') {
    return replaying.value ? t('acp.statusLoading') : t('acp.statusStarting')
  }
  return t('acp.statusBusy')
})

const permissionToolLabel = computed(() => {
  const tc = permission.value?.toolCall
  return tc?.title || tc?.toolCallId || t('acp.permissionGeneric')
})

const permissionToolKind = computed(() => permission.value?.toolCall?.kind || 'other')

const permissionKindLabel = computed(() => {
  const kind = permissionToolKind.value
  const key = `acp.toolKind.${kind}`
  const label = t(key)
  return label === key ? kind : label
})

const permissionLocationsLabel = computed(() => {
  const locs = permission.value?.toolCall?.locations
  if (!Array.isArray(locs) || !locs.length) return ''
  return locs
    .map((l) => {
      const p = l?.path || ''
      const base = p.split(/[/\\]/).pop() || p
      return l?.line != null ? `${base}:${l.line}` : base
    })
    .filter(Boolean)
    .join(', ')
})

const PERM_KIND_ORDER = {
  allow_always: 0,
  allow_once: 1,
  reject_once: 2,
  reject_always: 3
}

const sortedPermissionOptions = computed(() => {
  const opts = [...(permission.value?.options || [])]
  return opts.sort((a, b) => (PERM_KIND_ORDER[a.kind] ?? 9) - (PERM_KIND_ORDER[b.kind] ?? 9))
})

function permissionOptionLabel(opt) {
  if (!opt) return ''
  const key = `acp.perm.${opt.kind}`
  const label = t(key)
  return label === key ? (opt.name || opt.kind) : label
}

function permissionMemoryKey(toolCall) {
  const kind = toolCall?.kind || 'other'
  const locs = Array.isArray(toolCall?.locations) ? toolCall.locations : []
  const paths = locs.map((l) => l?.path).filter(Boolean).sort().join('|')
  if (paths) return `${kind}:${paths}`
  if (toolCall?.title) return `${kind}:${toolCall.title}`
  return `${kind}:*`
}

function findPermissionOption(options, kinds) {
  const list = options || []
  for (const kind of kinds) {
    const found = list.find((o) => o.kind === kind)
    if (found) return found
  }
  return null
}

async function autoResolvePermission(payload, decision) {
  const kinds = decision === 'allow'
    ? ['allow_always', 'allow_once']
    : ['reject_always', 'reject_once']
  const opt = findPermissionOption(payload?.options, kinds)
  if (!opt || payload?.id == null) return false
  await window.retroStudio.acp.resolvePermission(payload.id, {
    outcome: { outcome: 'selected', optionId: opt.optionId }
  })
  return true
}

async function handlePermissionRequest(payload) {
  const key = permissionMemoryKey(payload?.toolCall)
  const remembered = permissionMemory.value.get(key) || permissionMemory.value.get(`${payload?.toolCall?.kind || 'other'}:*`)
  if (remembered === 'allow' || remembered === 'reject') {
    const ok = await autoResolvePermission(payload, remembered)
    if (ok) {
      pushSystem(t(remembered === 'allow' ? 'acp.permissionAutoAllow' : 'acp.permissionAutoReject'))
      return
    }
  }
  permission.value = payload
}

const modelOption = computed(() =>
  configOptions.value.find((o) => o.category === 'model' || o.id === 'model') || null
)

const modeOption = computed(() =>
  configOptions.value.find((o) => o.category === 'mode' || o.id === 'mode') || null
)

const modelDisplayName = computed(() => {
  const opt = modelOption.value
  if (!opt) return t('acp.model')
  const found = (opt.options || []).find((o) => o.value === opt.currentValue)
  return found?.name || opt.currentValue || t('acp.model')
})

const modeDisplayName = computed(() => {
  const opt = modeOption.value
  if (!opt) return t('acp.mode')
  const found = (opt.options || []).find((o) => o.value === opt.currentValue)
  return found?.name || opt.currentValue || t('acp.mode')
})

const filteredModelGroups = computed(() => {
  const opt = modelOption.value
  if (!opt) return []
  const q = modelQuery.value.trim().toLowerCase()
  const list = (opt.options || []).filter((o) => {
    if (!q) return true
    return String(o.name || '').toLowerCase().includes(q) || String(o.value || '').toLowerCase().includes(q)
  })
  const groups = new Map()
  for (const item of list) {
    const provider = String(item.value || '').split('/')[0] || 'other'
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider).push(item)
  }
  return [...groups.entries()].map(([provider, options]) => ({ provider, options }))
})

let unsubs = []
let menuCloser = null

function isTerminalStatus(status) {
  const s = String(status || '').toLowerCase()
  return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'canceled'
}

function toolStatusLabel(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'completed') return t('acp.toolCompleted')
  if (s === 'failed') return t('acp.toolFailed')
  if (s === 'in_progress' || s === 'pending') return t('acp.toolRunning')
  return status || ''
}

function entryKey(entry, i) {
  if (entry.kind === 'tool' && entry.toolCallId) return `tool:${entry.toolCallId}`
  if (entry.kind === 'diff' && entry.path) return `diff:${entry.path}:${i}`
  return `${entry.kind}:${i}`
}

function avatarFor(kind) {
  if (kind === 'user') return 'U'
  if (kind === 'agent') return 'AI'
  if (kind === 'system') return '·'
  return '·'
}

function entryLabel(entry) {
  if (entry.kind === 'user') return t('acp.you')
  if (entry.kind === 'agent') return agentTitle.value || 'OpenCode'
  if (entry.kind === 'system') return 'System'
  return entry.kind
}

function shortPath(p) {
  if (!p) return ''
  const parts = String(p).replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

function renderText(text) {
  try {
    return marked.parse(String(text || ''))
  } catch {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

async function scrollBottom() {
  await nextTick()
  if (replaying.value) return
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

function formatSessionTitle(s) {
  if (!s) return t('acp.session')
  const title = String(s.title || '').trim()
  if (title && !/^New session/i.test(title)) return title
  if (s.updatedAt) return formatSessionTime(s.updatedAt)
  return s.sessionId?.slice(0, 12) || t('acp.session')
}

function formatSessionTime(iso) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return String(iso || '')
  }
}

function applySessionInfo(info) {
  sessionId.value = info?.sessionId || null
  sessions.value = Array.isArray(info?.sessions) ? info.sessions : sessions.value
  openedMode.value = info?.opened || 'new'
  agentTitle.value = info?.agentInfo?.title || info?.agentInfo?.name || agentTitle.value || 'OpenCode'
  applyConfigOptions(info?.configOptions || [])
}

function pushSystem(text) {
  entries.value.push({ kind: 'system', text })
  scrollBottom()
}

function appendAgentChunk(text) {
  const last = entries.value[entries.value.length - 1]
  if (last?.kind === 'agent') last.text += text
  else entries.value.push({ kind: 'agent', text })
  scrollBottom()
}

function appendThoughtChunk(text) {
  const last = entries.value[entries.value.length - 1]
  if (last?.kind === 'thought') last.text += text
  else entries.value.push({ kind: 'thought', text })
  scrollBottom()
}

function diffPreview(oldText, newText) {
  const neu = String(newText ?? '')
  const lines = neu.split('\n')
  const head = lines.slice(0, 40).join('\n')
  return lines.length > 40 ? head + `\n… (+${lines.length - 40} linhas)` : head
}

function upsertTool(update) {
  const id = update.toolCallId
  let entry = entries.value.find((e) => e.kind === 'tool' && e.toolCallId === id)
  if (!entry) {
    entry = { kind: 'tool', toolCallId: id, title: update.title || id, status: update.status || 'pending' }
    entries.value.push(entry)
  } else {
    if (update.title) entry.title = update.title
    if (update.status) entry.status = update.status
  }
  for (const block of update.content || []) {
    if (block?.type === 'diff') {
      entries.value.push({
        kind: 'diff',
        path: block.path,
        preview: diffPreview(block.oldText, block.newText)
      })
    }
  }
  scrollBottom()
}

function applyConfigOptions(options) {
  if (Array.isArray(options)) configOptions.value = options
}

function handleUpdate(params) {
  const update = params?.update || {}
  const kind = update.sessionUpdate
  if (kind === 'agent_message_chunk' && update.content?.text) appendAgentChunk(update.content.text)
  else if (kind === 'agent_thought_chunk' && update.content?.text) appendThoughtChunk(update.content.text)
  else if (kind === 'user_message_chunk' && update.content?.text) {
    const last = entries.value[entries.value.length - 1]
    if (last?.kind === 'user') last.text += update.content.text
    else entries.value.push({ kind: 'user', text: update.content.text })
    scrollBottom()
  } else if (kind === 'tool_call' || kind === 'tool_call_update') upsertTool(update)
  else if (kind === 'plan' && Array.isArray(update.entries)) {
    const text = update.entries.map((e) => `- [${e.status || 'pending'}] ${e.content}`).join('\n')
    entries.value.push({ kind: 'system', text: `${t('acp.plan')}\n${text}` })
    scrollBottom()
  } else if (kind === 'config_option_update') {
    applyConfigOptions(update.configOptions)
  }
}

function closeMenus() {
  openMenu.value = null
  modelQuery.value = ''
  if (menuCloser) {
    document.removeEventListener('click', menuCloser)
    menuCloser = null
  }
}

function toggleMenu(which) {
  if (openMenu.value === which) {
    closeMenus()
    return
  }
  openMenu.value = which
  if (menuCloser) document.removeEventListener('click', menuCloser)
  menuCloser = () => closeMenus()
  nextTick(() => {
    document.addEventListener('click', menuCloser, { once: true })
    if (which === 'model') modelSearchEl.value?.focus()
  })
}

async function selectConfig(configId, value) {
  closeMenus()
  try {
    const result = await window.retroStudio.acp.setConfigOption(configId, value)
    applyConfigOptions(result?.configOptions)
  } catch (e) {
    pushSystem(e?.message || String(e))
  }
}

function bindEvents() {
  unsubs.forEach((u) => u?.())
  unsubs = []
  const acp = window.retroStudio?.acp
  if (!acp) return
  unsubs.push(acp.onUpdate?.(handleUpdate))
  unsubs.push(acp.onPermission?.((payload) => { handlePermissionRequest(payload) }))
  unsubs.push(acp.onConfigOptions?.((payload) => applyConfigOptions(payload?.configOptions)))
  unsubs.push(acp.onReplaying?.(() => {
    replaying.value = true
    entries.value = []
    status.value = 'starting'
  }))
  unsubs.push(acp.onFileWritten?.(async (payload) => {
    if (replaying.value) return
    const filePath = payload?.path
    if (!filePath) return
    try {
      const reviewed = await window.retroStudioEditor?.reviewAiFileWrite?.({
        filePath,
        previousContent: payload.previousContent ?? '',
        newContent: payload.content ?? '',
        wasNewFile: !!payload.wasNewFile
      })
      if (reviewed) {
        pushSystem(t('acp.filePendingReview', { file: filePath.split(/[/\\]/).pop() }))
      } else {
        // Sem diff (conteúdo idêntico) — só sincroniza editor se aberto
        const content = payload.content ?? await window.retroStudio.readTextFile(filePath)
        window.retroStudioEditor?.updateFileContent?.(filePath, content, { fromAI: true, dirty: false })
        pushSystem(t('acp.fileUpdated', { file: filePath.split(/[/\\]/).pop() }))
      }
    } catch (e) {
      pushSystem(`write: ${e.message || e}`)
    }
  }))
  unsubs.push(acp.onExit?.(() => {
    status.value = 'error'
    replaying.value = false
    pushSystem(t('acp.processExited'))
  }))
  unsubs.push(acp.onStderr?.((payload) => {
    const text = payload?.text || ''
    if (looksLikeAuthError(text)) authErrorHint.value = true
  }))
}

async function refreshAuthStatus() {
  try {
    const settings = await window.retroStudio.settings?.load?.()
    const commandPath = settings?.aiTerminal?.opencode?.commandPath || ''
    authStatus.value = await window.retroStudio.acp?.authStatus?.({ commandPath }) || null
    if (authStatus.value?.hasCredentials) authErrorHint.value = false
  } catch (_) {
    authStatus.value = null
  }
}

function looksLikeAuthError(message) {
  const m = String(message || '').toLowerCase()
  return /auth|unauthor|api.?key|credential|login|not logged|provider.*missing|401|403/.test(m)
}

async function copyAuthCommand() {
  const cmd = authStatus.value?.loginCommand || 'opencode auth login'
  try {
    await navigator.clipboard.writeText(cmd)
    window.retroStudioToast?.success?.(t('acp.authCopied'))
  } catch (_) {
    pushSystem(cmd)
  }
}

async function runAuthLogin() {
  const cmd = authStatus.value?.loginCommand || 'opencode auth login'
  window.dispatchEvent(new CustomEvent('retroStudio:run-terminal-command', {
    detail: { command: cmd }
  }))
  pushSystem(t('acp.authLoginStarted'))
}

async function startSession({ mode = 'auto', sessionId: wantedId = null } = {}) {
  if (!window.retroStudio?.acp?.start) {
    status.value = 'error'
    pushSystem(t('acp.apiMissing'))
    return
  }
  status.value = 'starting'
  permission.value = null
  configOptions.value = []
  replaying.value = false
  try {
    await refreshAuthStatus()
    const cwd = await window.retroStudio.terminal?.getCwd?.()
    const settings = await window.retroStudio.settings?.load?.()
    const commandPath = settings?.aiTerminal?.opencode?.commandPath || ''
    const info = await window.retroStudio.acp.start({
      workspacePath: cwd,
      commandPath,
      mode,
      sessionId: wantedId
    })
    applySessionInfo(info)
    if (info?.opened === 'load') {
      pushSystem(t('acp.sessionResumed'))
    }
    status.value = 'ready'
  } catch (e) {
    status.value = 'error'
    const msg = e?.message || String(e)
    if (looksLikeAuthError(msg)) authErrorHint.value = true
    pushSystem(msg)
  } finally {
    replaying.value = false
    await nextTick()
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  }
}

async function stopSession() {
  try { await window.retroStudio?.acp?.stop?.() } catch (_) { /* ignore */ }
  status.value = 'idle'
  sessionId.value = null
}

/** Reinicia o processo ACP e recarrega a mesma sessão (histórico). */
async function restart() {
  closeMenus()
  const keepId = sessionId.value
  entries.value = []
  await stopSession()
  await startSession({ mode: keepId ? 'load' : 'auto', sessionId: keepId })
}

/** Cria uma conversa nova neste game/workspace. */
async function createNewSession() {
  closeMenus()
  if (busy.value) return
  entries.value = []
  if (status.value === 'ready' && window.retroStudio?.acp?.openSession) {
    status.value = 'starting'
    replaying.value = false
    permission.value = null
    try {
      const info = await window.retroStudio.acp.openSession({ mode: 'new' })
      applySessionInfo(info)
      pushSystem(t('acp.sessionCreated'))
      status.value = 'ready'
    } catch (e) {
      status.value = 'error'
      pushSystem(e?.message || String(e))
    }
    return
  }
  await stopSession()
  await startSession({ mode: 'new' })
}

/** Carrega outra sessão já usada neste workspace. */
async function loadExistingSession(id) {
  closeMenus()
  if (!id || id === sessionId.value || busy.value) return
  entries.value = []
  if (status.value === 'ready' && window.retroStudio?.acp?.openSession) {
    status.value = 'starting'
    replaying.value = true
    permission.value = null
    try {
      const info = await window.retroStudio.acp.openSession({ mode: 'load', sessionId: id })
      applySessionInfo(info)
      pushSystem(t('acp.sessionResumed'))
      status.value = 'ready'
    } catch (e) {
      status.value = 'error'
      pushSystem(e?.message || String(e))
    } finally {
      replaying.value = false
      await nextTick()
      if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    }
    return
  }
  await stopSession()
  await startSession({ mode: 'load', sessionId: id })
}

async function cancel() {
  if (permission.value?.id) {
    try {
      await window.retroStudio.acp.resolvePermission(permission.value.id, {
        outcome: { outcome: 'cancelled' }
      })
    } catch (_) { /* ignore */ }
    permission.value = null
  }
  await window.retroStudio?.acp?.cancel?.()
}

async function answerPermission(optOrId) {
  if (!permission.value?.id) return
  const opt = typeof optOrId === 'object' && optOrId
    ? optOrId
    : (permission.value.options || []).find((o) => o.optionId === optOrId)
  const optionId = opt?.optionId || optOrId
  if (!optionId) return

  if (opt?.kind === 'allow_always' || opt?.kind === 'reject_always') {
    const decision = opt.kind.startsWith('allow') ? 'allow' : 'reject'
    const key = permissionMemoryKey(permission.value.toolCall)
    permissionMemory.value.set(key, decision)
    // Também lembrar por kind genérico para execute sem path
    if (!permission.value.toolCall?.locations?.length) {
      permissionMemory.value.set(`${permission.value.toolCall?.kind || 'other'}:*`, decision)
    }
  }

  await window.retroStudio.acp.resolvePermission(permission.value.id, {
    outcome: { outcome: 'selected', optionId }
  })
  permission.value = null
}

async function send(overrideText = null) {
  const text = (overrideText != null ? String(overrideText) : input.value).trim()
  if (!text || status.value !== 'ready') return
  if (overrideText == null && !canSend.value) return

  // Atalhos locais: /build /play /stop
  const cmd = text.toLowerCase()
  if (cmd === '/build' || cmd === '/play' || cmd === '/stop') {
    if (overrideText == null) input.value = ''
    entries.value.push({ kind: 'user', text })
    runProjectAction(cmd.slice(1))
    return
  }

  closeMenus()
  refreshChips()
  entries.value.push({ kind: 'user', text })
  if (overrideText == null) input.value = ''
  status.value = 'busy'
  await scrollBottom()

  const includeFile = chipState.value.file
  const currentFilePath = includeFile ? (window.retroStudioEditor?.getCurrentFile?.() || null) : null
  let currentFileContent = null
  if (includeFile && currentFilePath) {
    try { currentFileContent = window.retroStudioEditor?.getCurrentFileContent?.() || null } catch (_) { /* ignore */ }
  }
  try {
    await window.retroStudioContext?.refreshRomInfo?.()
  } catch (_) { /* ignore */ }
  refreshChips()
  const contextNotes = buildContextNotes()

  try {
    const result = await window.retroStudio.acp.prompt({
      text,
      currentFilePath,
      currentFileContent: currentFileContent && currentFileContent.length < 80000
        ? currentFileContent
        : (currentFileContent ? currentFileContent.slice(0, 80000) : null),
      contextNotes
    })
    if (result?.stopReason && result.stopReason !== 'end_turn') {
      pushSystem(`${t('acp.stopReason')}: ${result.stopReason}`)
    }
  } catch (e) {
    const msg = e?.message || String(e)
    if (looksLikeAuthError(msg)) authErrorHint.value = true
    pushSystem(msg)
  } finally {
    if (status.value === 'busy') status.value = 'ready'
    permission.value = null
  }
}

async function queueEditSelection(detail = {}) {
  const instruction = String(detail.instruction || '').trim()
  const selectedCode = String(detail.selectedCode || '')
  const filePath = detail.filePath || window.retroStudioEditor?.getCurrentFile?.() || ''
  const selection = detail.selection
  if (!instruction) return

  for (let i = 0; i < 60; i++) {
    if (status.value === 'ready') break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (status.value !== 'ready') {
    pushSystem(t('acp.ctrlkNotReady'))
    input.value = instruction
    return
  }

  const loc = selection
    ? `linhas ${selection.startLineNumber}-${selection.endLineNumber}`
    : 'seleção'
  const prompt = [
    `Edite a ${loc} do arquivo \`${filePath || 'arquivo atual'}\` conforme a instrução:`,
    instruction,
    '',
    'Código selecionado:',
    '```',
    selectedCode,
    '```',
    '',
    'Aplique a alteração gravando o arquivo. Preserve o restante do arquivo. Depois explique brevemente o que mudou.'
  ].join('\n')

  chipState.value = { ...chipState.value, file: true }
  await send(prompt)
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function openPath(filePath) {
  if (filePath) window.retroStudioEditor?.openFile?.(filePath)
}

async function loadDetailPref() {
  try {
    const settings = await window.retroStudio?.settings?.load?.()
    const acp = settings?.aiTerminal?.acp || {}
    if (typeof acp.showDetails === 'boolean') showDetails.value = acp.showDetails
    else if (typeof acp.showThoughts === 'boolean') showDetails.value = acp.showThoughts
  } catch (_) { /* ignore */ }
}

async function toggleDetails() {
  showDetails.value = !showDetails.value
  try {
    const settings = await window.retroStudio?.settings?.load?.()
    const prev = settings?.aiTerminal || {}
    await window.retroStudio?.settings?.savePartial?.({
      aiTerminal: {
        ...prev,
        acp: { ...(prev.acp || {}), showDetails: showDetails.value }
      }
    })
  } catch (_) { /* ignore */ }
  await scrollBottom()
}

async function openSettings() {
  closeMenus()
  try {
    const settings = await window.retroStudio?.settings?.load?.()
    commandPathDraft.value = settings?.aiTerminal?.opencode?.commandPath || ''
  } catch (_) {
    commandPathDraft.value = ''
  }
  await refreshAuthStatus()
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
}

async function saveSettings() {
  try {
    const settings = await window.retroStudio?.settings?.load?.()
    const prev = settings?.aiTerminal || {}
    await window.retroStudio?.settings?.savePartial?.({
      aiTerminal: {
        ...prev,
        opencode: {
          ...(prev.opencode || {}),
          commandPath: String(commandPathDraft.value || '').trim()
        }
      }
    })
    showSettings.value = false
    pushSystem(t('acp.settingsSaved'))
  } catch (e) {
    pushSystem(e?.message || String(e))
  }
}

watch(() => props.active, async (active) => {
  if (active) {
    bindEvents()
    refreshChips()
    try { await window.retroStudioContext?.refreshRomInfo?.() } catch (_) { /* ignore */ }
    refreshChips()
    if (status.value === 'idle' || status.value === 'error') {
      entries.value = []
      await startSession()
    }
    nextTick(() => inputEl.value?.focus())
  } else {
    closeMenus()
  }
})

watch(busy, (isBusy) => {
  if (isBusy) scrollBottom()
})

onMounted(async () => {
  await loadDetailPref()
  bindEvents()
  window.addEventListener('retroStudio:acp-build-result', onAcpBuildResult)
  if (props.active) await startSession()
})

onUnmounted(async () => {
  closeMenus()
  window.removeEventListener('retroStudio:acp-build-result', onAcpBuildResult)
  unsubs.forEach((u) => u?.())
  unsubs = []
  await stopSession()
})

defineExpose({ restart, startSession, stopSession, queueEditSelection })
</script>

<style scoped>
.acp-panel {
  --acp-radius: 8px;
  --acp-ease: 140ms ease;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--panel-2, #1e1e1e);
  color: var(--text, #ccc);
}

.acp-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, #3c3c3c);
  background: var(--panel, #252526);
  flex-shrink: 0;
}

.acp-header-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.acp-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.acp-brand-mark {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--accent, #007acc);
  box-shadow: 0 0 0 3px rgba(0, 122, 204, 0.18);
  flex-shrink: 0;
}

.acp-brand-mark.busy {
  animation: acp-mark-pulse 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes acp-mark-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(0, 122, 204, 0.18); opacity: 1; }
  50% { box-shadow: 0 0 0 5px rgba(0, 122, 204, 0.28); opacity: 0.85; }
}

.acp-brand-text {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.acp-brand-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acp-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
  min-width: 0;
}

.acp-status-text {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acp-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  flex-shrink: 0;
}

.acp-status.ready .acp-status-dot { background: #23d18b; }
.acp-status.busy .acp-status-dot,
.acp-status.starting .acp-status-dot {
  background: #e5e510;
  animation: acp-dot-pulse 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.acp-status.error .acp-status-dot { background: #f14c4c; }

.acp-status.ready { color: #23d18b; }
.acp-status.busy,
.acp-status.starting { color: #c8c84a; }
.acp-status.error { color: #f14c4c; }

@keyframes acp-dot-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.acp-header-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.acp-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.acp-progress.active {
  opacity: 1;
}

.acp-progress-bar {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: 1px;
  background: var(--accent, #007acc);
  transform: translateX(-120%);
}

.acp-progress.active .acp-progress-bar {
  animation: acp-indeterminate 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes acp-indeterminate {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

.acp-icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background var(--acp-ease), color var(--acp-ease);
}

.acp-icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.acp-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.acp-icon-btn.active {
  background: rgba(0, 122, 204, 0.18);
  color: var(--text);
}

.acp-details-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.acp-icon-btn.danger:hover:not(:disabled) {
  color: #f14c4c;
}

.acp-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 12px 18px;
}

.acp-empty {
  padding: 28px 8px;
  text-align: center;
}

.acp-empty-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.acp-empty-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}

.acp-onboarding {
  margin: 14px auto 0;
  padding: 0 0 0 18px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
  text-align: left;
  max-width: 320px;
}

.acp-onboarding li {
  margin-bottom: 4px;
}

.acp-entry {
  margin-bottom: 14px;
  animation: acp-in 140ms ease both;
}

.acp-entry.tool {
  margin-bottom: 4px;
}

.acp-entry.thought {
  margin-bottom: 10px;
}

@keyframes acp-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .acp-entry { animation: none; }
  .acp-icon-btn,
  .acp-activity-pulse,
  .acp-brand-mark.busy,
  .acp-status.busy .acp-status-dot,
  .acp-status.starting .acp-status-dot,
  .acp-tool-dot[data-status="in_progress"],
  .acp-tool-dot[data-status="pending"],
  .acp-tool-row.running .acp-tool-title,
  .acp-progress.active .acp-progress-bar,
  .acp-processing-dots i,
  .acp-processing {
    transition: none;
    animation: none;
  }
  .acp-tool-row.running .acp-tool-title {
    background: none;
    color: var(--text);
    -webkit-background-clip: unset;
    background-clip: unset;
  }
  .acp-progress.active { opacity: 1; }
  .acp-progress.active .acp-progress-bar {
    width: 100%;
    transform: none;
    opacity: 0.55;
  }
}

.acp-entry-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.acp-avatar {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
}

.acp-avatar.user { background: rgba(0, 122, 204, 0.2); color: #6cb6ff; }
.acp-avatar.agent { background: rgba(35, 209, 139, 0.15); color: #23d18b; }
.acp-avatar.diff { background: rgba(0, 122, 204, 0.12); color: #6cb6ff; }

.acp-entry-label {
  font-size: 11px;
  color: var(--muted);
}

.acp-text {
  font-size: 13px;
  line-height: 1.55;
  padding-left: 28px;
}

.acp-text :deep(p) { margin: 0 0 0.55em; }
.acp-text :deep(p:last-child) { margin-bottom: 0; }
.acp-text :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  overflow: auto;
  font-size: 12px;
}

.acp-thought {
  margin-left: 4px;
  padding: 8px 10px;
  border-left: 2px solid rgba(255, 255, 255, 0.12);
}

.acp-thought-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 4px;
}

.acp-thought .acp-text {
  padding-left: 0;
  opacity: 0.78;
  font-style: italic;
  color: var(--muted);
  font-size: 12px;
}

.acp-entry.system .acp-text {
  font-size: 12px;
  color: var(--muted);
}

.acp-tool-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px 3px 8px;
  font-size: 12px;
  color: var(--muted);
}

.acp-tool-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--muted);
}

.acp-tool-dot[data-status="completed"] { background: #23d18b; }
.acp-tool-dot[data-status="failed"] { background: #f14c4c; }
.acp-tool-dot[data-status="in_progress"],
.acp-tool-dot[data-status="pending"] {
  background: #e5e510;
  animation: acp-dot-pulse 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.acp-tool-row.running .acp-tool-title {
  animation: acp-shimmer 1.6s linear infinite;
  background: linear-gradient(
    90deg,
    var(--muted) 0%,
    var(--text) 40%,
    var(--muted) 80%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  opacity: 1;
}

@keyframes acp-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.acp-tool-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  opacity: 0.85;
}

.acp-tool-status {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  flex-shrink: 0;
}

.acp-tool-status[data-status="completed"] { color: #23d18b; }
.acp-tool-status[data-status="failed"] { color: #f14c4c; }
.acp-tool-status[data-status="in_progress"],
.acp-tool-status[data-status="pending"] { color: #c8c84a; }

.acp-activity {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px 8px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 11px;
  font-family: inherit;
  text-align: left;
  cursor: default;
}

.acp-activity.clickable {
  cursor: pointer;
  border-color: rgba(255, 255, 255, 0.06);
}

.acp-activity.clickable:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.acp-activity-hint {
  color: var(--accent);
  opacity: 0.9;
}

.acp-activity-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e5e510;
  animation: acp-dot-pulse 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.acp-processing {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 4px 8px;
  padding: 4px 2px;
  color: var(--muted);
  font-size: 12px;
  animation: acp-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.acp-processing-label {
  letter-spacing: 0.01em;
}

.acp-processing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 12px;
}

.acp-processing-dots i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent, #007acc);
  opacity: 0.35;
  animation: acp-bounce 1.05s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.acp-processing-dots i:nth-child(2) { animation-delay: 0.14s; }
.acp-processing-dots i:nth-child(3) { animation-delay: 0.28s; }

@keyframes acp-bounce {
  0%, 70%, 100% { transform: translateY(0); opacity: 0.35; }
  35% { transform: translateY(-4px); opacity: 1; }
}

@keyframes acp-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.acp-diff {
  margin-left: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.25);
}

.acp-diff-path {
  font-size: 11px;
  color: var(--accent);
  margin-bottom: 6px;
  word-break: break-all;
}

.acp-diff-body {
  margin: 0;
  font-size: 11px;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
}

.acp-text-btn {
  margin-top: 8px;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}

.acp-auth-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(229, 229, 16, 0.3);
  background: rgba(229, 229, 16, 0.07);
  flex-shrink: 0;
}

.acp-auth-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}

.acp-auth-copy span { color: var(--muted); }

.acp-auth-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.acp-permission {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid rgba(229, 229, 16, 0.25);
  background: rgba(229, 229, 16, 0.06);
  flex-shrink: 0;
}

.acp-permission-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.acp-permission-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.acp-perm-kind {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--muted);
}

.acp-perm-kind[data-kind="edit"],
.acp-perm-kind[data-kind="delete"],
.acp-perm-kind[data-kind="execute"] {
  color: #e5e510;
  background: rgba(229, 229, 16, 0.12);
}

.acp-perm-tool { color: var(--text); font-weight: 500; }

.acp-perm-paths {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acp-perm-hint {
  color: var(--muted);
  font-size: 11px;
  opacity: 0.9;
}

.acp-permission-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.acp-perm-btn {
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.acp-perm-btn.allow_once,
.acp-perm-btn.allow_always {
  border-color: rgba(35, 209, 139, 0.45);
  background: rgba(35, 209, 139, 0.1);
}
.acp-perm-btn.allow_always { font-weight: 600; }
.acp-perm-btn.reject_once,
.acp-perm-btn.reject_always {
  border-color: rgba(241, 76, 76, 0.45);
  background: rgba(241, 76, 76, 0.08);
}

.acp-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.acp-context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.acp-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  opacity: 0.55;
}

.acp-chip.available {
  opacity: 0.85;
}

.acp-chip.active {
  opacity: 1;
  color: var(--text);
  border-color: rgba(35, 209, 139, 0.45);
  background: rgba(35, 209, 139, 0.1);
}

.acp-chip:disabled {
  cursor: default;
  opacity: 0.35;
}

.acp-chip-label { font-weight: 600; }
.acp-chip-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
  opacity: 0.85;
}

.acp-input {
  width: 100%;
  resize: none;
  box-sizing: border-box;
  background: var(--bg, #1e1e1e);
  border: 1px solid var(--border);
  border-radius: var(--acp-radius);
  color: var(--text);
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.45;
  outline: none;
  transition: border-color var(--acp-ease);
}

.acp-input:focus {
  border-color: rgba(0, 122, 204, 0.7);
}

.acp-input:disabled {
  opacity: 0.55;
}

.acp-composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acp-selectors {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.acp-select {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}

.acp-select:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.acp-select-session {
  max-width: 180px;
}

.acp-select-model {
  max-width: 220px;
}

.acp-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acp-chevron {
  flex-shrink: 0;
  opacity: 0.7;
}

.acp-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 220px;
  max-width: min(360px, 70vw);
  max-height: 280px;
  overflow: auto;
  background: var(--panel, #252526);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  z-index: 30;
  padding: 4px;
}

.acp-menu-session {
  min-width: 260px;
  max-height: 300px;
}

.acp-menu-session .acp-menu-item {
  padding: 9px 12px;
}

.acp-menu-new {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 8px;
}

.acp-menu-model {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden;
  min-width: 280px;
}

.acp-menu-search {
  margin: 4px;
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.acp-menu-search:focus {
  border-color: rgba(0, 122, 204, 0.7);
}

.acp-menu-scroll {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding-bottom: 4px;
}

.acp-menu-group {
  padding: 8px 10px 4px;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
  position: sticky;
  top: 0;
  background: var(--panel);
}

.acp-menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 12px;
}

.acp-menu-item:hover,
.acp-menu-item.active {
  background: rgba(0, 122, 204, 0.16);
}

.acp-menu-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.acp-menu-desc {
  font-size: 11px;
  color: var(--muted);
}

.acp-menu-empty {
  margin: 12px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}

.acp-send {
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: var(--accent, #007acc);
  color: #fff;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.acp-send:hover:not(:disabled) {
  filter: brightness(1.08);
}

.acp-send:disabled {
  opacity: 0.4;
  cursor: default;
}

.acp-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.acp-settings-modal {
  width: min(420px, 92vw);
  background: var(--panel, #252526);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  color: var(--text);
}

.acp-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.acp-settings-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.acp-settings-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acp-settings-label {
  font-size: 12px;
  font-weight: 600;
}

.acp-settings-hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}

.acp-settings-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg, #1e1e1e);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.acp-settings-input:focus {
  border-color: rgba(0, 122, 204, 0.7);
}

.acp-settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 14px;
}
</style>
