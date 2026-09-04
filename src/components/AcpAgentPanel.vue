<template>
  <div class="acp-panel">
    <div class="acp-toolbar">
      <div class="acp-toolbar-left">
        <span class="acp-badge" :class="status">{{ statusLabel }}</span>
        <span v-if="agentTitle" class="acp-agent">{{ agentTitle }}</span>
        <span v-if="modelLabel" class="acp-model" :title="modelLabel">{{ modelLabel }}</span>
      </div>
      <div class="acp-toolbar-right">
        <button class="acp-btn" :disabled="busy || status === 'starting'" @click="restart">↻</button>
        <button class="acp-btn" :disabled="!busy" @click="cancel" title="Cancelar">■</button>
      </div>
    </div>

    <div ref="scrollEl" class="acp-messages">
      <div v-if="!entries.length && status === 'ready'" class="acp-empty">
        {{ t('acp.emptyHint') }}
      </div>
      <div v-for="(entry, i) in entries" :key="i" class="acp-entry" :class="entry.kind">
        <div class="acp-entry-label">{{ entryLabel(entry) }}</div>
        <pre v-if="entry.kind === 'tool'" class="acp-tool">{{ entry.title }} <span class="acp-tool-status">{{ entry.status }}</span></pre>
        <div v-else-if="entry.kind === 'diff'" class="acp-diff">
          <div class="acp-diff-path">{{ entry.path }}</div>
          <pre class="acp-diff-body">{{ entry.preview }}</pre>
          <button class="acp-link" @click="openPath(entry.path)">{{ t('acp.openFile') }}</button>
        </div>
        <div v-else class="acp-text" v-html="renderText(entry.text)"></div>
      </div>
    </div>

    <div v-if="permission" class="acp-permission">
      <div class="acp-permission-title">{{ t('acp.permissionTitle') }}</div>
      <div class="acp-permission-body">{{ permissionToolLabel }}</div>
      <div class="acp-permission-actions">
        <button
          v-for="opt in permission.options || []"
          :key="opt.optionId"
          class="acp-perm-btn"
          :class="opt.kind"
          @click="answerPermission(opt.optionId)"
        >
          {{ opt.name }}
        </button>
      </div>
    </div>

    <div class="acp-input-row">
      <textarea
        ref="inputEl"
        v-model="input"
        class="acp-input"
        rows="2"
        :placeholder="t('acp.placeholder')"
        :disabled="status !== 'ready' && status !== 'error'"
        @keydown="onKeydown"
      />
      <button class="acp-send" :disabled="!canSend" @click="send">{{ t('acp.send') }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'

const { t } = useI18n()

const props = defineProps({
  active: { type: Boolean, default: false }
})

const status = ref('idle') // idle | starting | ready | busy | error
const agentTitle = ref('')
const modelLabel = ref('')
const input = ref('')
const entries = ref([])
const permission = ref(null)
const scrollEl = ref(null)
const inputEl = ref(null)
const busy = computed(() => status.value === 'busy' || status.value === 'starting')
const canSend = computed(() => status.value === 'ready' && input.value.trim().length > 0)

const statusLabel = computed(() => {
  const map = {
    idle: t('acp.statusIdle'),
    starting: t('acp.statusStarting'),
    ready: t('acp.statusReady'),
    busy: t('acp.statusBusy'),
    error: t('acp.statusError')
  }
  return map[status.value] || status.value
})

const permissionToolLabel = computed(() => {
  const tc = permission.value?.toolCall
  return tc?.title || tc?.toolCallId || t('acp.permissionGeneric')
})

let unsubs = []

function entryLabel(entry) {
  if (entry.kind === 'user') return t('acp.you')
  if (entry.kind === 'agent') return 'OpenCode'
  if (entry.kind === 'thought') return t('acp.thought')
  if (entry.kind === 'tool') return t('acp.tool')
  if (entry.kind === 'diff') return t('acp.diff')
  if (entry.kind === 'system') return 'System'
  return entry.kind
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
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

function pushSystem(text) {
  entries.value.push({ kind: 'system', text })
  scrollBottom()
}

function appendAgentChunk(text) {
  const last = entries.value[entries.value.length - 1]
  if (last?.kind === 'agent') {
    last.text += text
  } else {
    entries.value.push({ kind: 'agent', text })
  }
  scrollBottom()
}

function appendThoughtChunk(text) {
  const last = entries.value[entries.value.length - 1]
  if (last?.kind === 'thought') {
    last.text += text
  } else {
    entries.value.push({ kind: 'thought', text })
  }
  scrollBottom()
}

function upsertTool(update) {
  const id = update.toolCallId
  let entry = entries.value.find((e) => e.kind === 'tool' && e.toolCallId === id)
  if (!entry) {
    entry = {
      kind: 'tool',
      toolCallId: id,
      title: update.title || id,
      status: update.status || 'pending'
    }
    entries.value.push(entry)
  } else {
    if (update.title) entry.title = update.title
    if (update.status) entry.status = update.status
  }
  // Diffs dentro do tool content
  const contents = update.content || []
  for (const block of contents) {
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

function diffPreview(oldText, newText) {
  const neu = String(newText ?? '')
  const lines = neu.split('\n')
  const head = lines.slice(0, 40).join('\n')
  return lines.length > 40 ? head + `\n… (+${lines.length - 40} linhas)` : head
}

function handleUpdate(params) {
  const update = params?.update || {}
  const kind = update.sessionUpdate
  if (kind === 'agent_message_chunk' && update.content?.text) {
    appendAgentChunk(update.content.text)
  } else if (kind === 'agent_thought_chunk' && update.content?.text) {
    appendThoughtChunk(update.content.text)
  } else if (kind === 'user_message_chunk' && update.content?.text) {
    const last = entries.value[entries.value.length - 1]
    if (last?.kind === 'user') last.text += update.content.text
    else entries.value.push({ kind: 'user', text: update.content.text })
    scrollBottom()
  } else if (kind === 'tool_call' || kind === 'tool_call_update') {
    upsertTool(update)
  } else if (kind === 'plan' && Array.isArray(update.entries)) {
    const text = update.entries.map((e) => `- [${e.status || 'pending'}] ${e.content}`).join('\n')
    entries.value.push({ kind: 'system', text: `${t('acp.plan')}\n${text}` })
    scrollBottom()
  }
}

function bindEvents() {
  unsubs.forEach((u) => u?.())
  unsubs = []
  const acp = window.retroStudio?.acp
  if (!acp) return
  unsubs.push(acp.onUpdate?.(handleUpdate))
  unsubs.push(acp.onPermission?.((payload) => {
    permission.value = payload
  }))
  unsubs.push(acp.onFileWritten?.(async (payload) => {
    const filePath = payload?.path
    if (!filePath) return
    try {
      const content = await window.retroStudio.readTextFile(filePath)
      window.retroStudioEditor?.updateFileContent?.(filePath, content, { fromAI: true })
      pushSystem(t('acp.fileUpdated', { file: filePath.split(/[/\\]/).pop() }))
    } catch (e) {
      pushSystem(`write: ${e.message || e}`)
    }
  }))
  unsubs.push(acp.onExit?.(() => {
    status.value = 'error'
    pushSystem(t('acp.processExited'))
  }))
  unsubs.push(acp.onStderr?.(() => { /* quiet */ }))
}

async function startSession() {
  if (!window.retroStudio?.acp?.start) {
    status.value = 'error'
    pushSystem(t('acp.apiMissing'))
    return
  }
  status.value = 'starting'
  permission.value = null
  try {
    const cwd = await window.retroStudio.terminal?.getCwd?.()
    const settings = await window.retroStudio.settings?.load?.()
    const commandPath = settings?.aiTerminal?.opencode?.commandPath || ''
    const info = await window.retroStudio.acp.start({
      workspacePath: cwd,
      commandPath
    })
    agentTitle.value = info?.agentInfo?.title || info?.agentInfo?.name || 'OpenCode'
    const modelOpt = (info?.configOptions || []).find((o) => o.id === 'model' || o.category === 'model')
    modelLabel.value = modelOpt?.currentValue || ''
    status.value = 'ready'
    pushSystem(t('acp.sessionReady', { id: info?.sessionId || '—' }))
  } catch (e) {
    status.value = 'error'
    pushSystem(e?.message || String(e))
  }
}

async function stopSession() {
  try {
    await window.retroStudio?.acp?.stop?.()
  } catch (_) { /* ignore */ }
  status.value = 'idle'
}

async function restart() {
  entries.value = []
  await stopSession()
  await startSession()
}

async function cancel() {
  await window.retroStudio?.acp?.cancel?.()
}

async function answerPermission(optionId) {
  if (!permission.value?.id) return
  await window.retroStudio.acp.resolvePermission(permission.value.id, {
    outcome: { outcome: 'selected', optionId }
  })
  permission.value = null
}

async function send() {
  const text = input.value.trim()
  if (!text || !canSend.value) return
  entries.value.push({ kind: 'user', text })
  input.value = ''
  status.value = 'busy'
  await scrollBottom()

  const currentFilePath = window.retroStudioEditor?.getCurrentFile?.() || null
  let currentFileContent = null
  try {
    currentFileContent = window.retroStudioEditor?.getCurrentFileContent?.() || null
  } catch (_) { /* ignore */ }

  try {
    const result = await window.retroStudio.acp.prompt({
      text,
      currentFilePath,
      currentFileContent: currentFileContent && currentFileContent.length < 80000
        ? currentFileContent
        : (currentFileContent ? currentFileContent.slice(0, 80000) : null)
    })
    if (result?.stopReason) {
      pushSystem(`${t('acp.stopReason')}: ${result.stopReason}`)
    }
  } catch (e) {
    pushSystem(e?.message || String(e))
  } finally {
    if (status.value === 'busy') status.value = 'ready'
    permission.value = null
  }
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

watch(() => props.active, async (active) => {
  if (active) {
    bindEvents()
    if (status.value === 'idle' || status.value === 'error') {
      entries.value = []
      await startSession()
    }
    nextTick(() => inputEl.value?.focus())
  } else {
    // Mantém sessão viva ao trocar para TUI; só para no unmount
  }
})

onMounted(async () => {
  bindEvents()
  if (props.active) await startSession()
})

onUnmounted(async () => {
  unsubs.forEach((u) => u?.())
  unsubs = []
  await stopSession()
})

defineExpose({ restart, startSession, stopSession })
</script>

<style scoped>
.acp-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #1e1e1e;
}

.acp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.acp-toolbar-left,
.acp-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.acp-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
}

.acp-badge.ready { color: #23d18b; }
.acp-badge.busy, .acp-badge.starting { color: #e5e510; }
.acp-badge.error { color: #f14c4c; }

.acp-agent,
.acp-model {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.acp-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.acp-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.acp-btn:disabled { opacity: 0.4; cursor: default; }

.acp-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
}

.acp-empty {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.acp-entry {
  margin-bottom: 12px;
}

.acp-entry-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 4px;
}

.acp-text :deep(p) { margin: 0 0 0.5em; }
.acp-text :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  padding: 8px;
  border-radius: 4px;
  overflow: auto;
  font-size: 12px;
}

.acp-entry.thought .acp-text {
  opacity: 0.75;
  font-style: italic;
}

.acp-entry.system .acp-text,
.acp-tool {
  font-size: 12px;
  color: var(--muted);
  white-space: pre-wrap;
  margin: 0;
}

.acp-tool-status { color: #3b8eea; }

.acp-diff {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.25);
}

.acp-diff-path {
  font-size: 11px;
  color: #3b8eea;
  margin-bottom: 6px;
  word-break: break-all;
}

.acp-diff-body {
  margin: 0;
  font-size: 11px;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
}

.acp-link {
  margin-top: 6px;
  background: none;
  border: none;
  color: #3b8eea;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}

.acp-permission {
  border-top: 1px solid var(--border);
  padding: 10px 12px;
  background: rgba(229, 229, 16, 0.06);
  flex-shrink: 0;
}

.acp-permission-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}

.acp-permission-body {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
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
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.acp-perm-btn.allow_once,
.acp-perm-btn.allow_always {
  border-color: rgba(35, 209, 139, 0.5);
}

.acp-perm-btn.reject_once,
.acp-perm-btn.reject_always {
  border-color: rgba(241, 76, 76, 0.5);
}

.acp-input-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.acp-input {
  flex: 1;
  resize: none;
  background: var(--bg, #252526);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 8px;
  font-size: 13px;
  font-family: inherit;
}

.acp-send {
  align-self: flex-end;
  background: #0e639c;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 12px;
}

.acp-send:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
