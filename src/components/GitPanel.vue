<script setup>
import { ref, computed, inject, reactive, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showStaged = ref(true)
const showChanges = ref(true)

const props = defineProps({
  active: Boolean,
  isGitRepo: Boolean,
  isLoading: Boolean,
  branch: { type: String, default: '' },
  commitMessage: { type: String, default: '' },
  branches: { type: Array, default: () => [] },
  showBranchesPanel: Boolean,
  commits: { type: Array, default: () => [] },
  showCommitsPanel: Boolean,
  isLoadingCommits: Boolean,
  stagedFiles: { type: Array, default: () => [] },
  unstagedFiles: { type: Array, default: () => [] },
  formatCommitDate: { type: Function, default: (d) => d },
  getGitStatusIcon: { type: Function, default: () => '?' }
})
defineEmits([
  'update:commitMessage',
  'pull', 'push', 'refresh',
  'init', 'checkout', 'create-branch', 'delete-branch',
  'toggle-branches', 'toggle-commits', 'load-commits',
  'open-branch-dialog', 'commit',
  'stage', 'unstage', 'stage-all', 'unstage-all', 'discard', 'open-file', 'show-diff'
])
const ui = reactive(inject('retroGitUi'))
const visibleStaged = computed(() => props.stagedFiles.filter(file => file.path.toLowerCase().includes(ui.filter.toLowerCase())))
const visibleUnstaged = computed(() => props.unstagedFiles.filter(file => file.path.toLowerCase().includes(ui.filter.toLowerCase())))
const canCommit = computed(() => !ui.busy && !!props.commitMessage.trim() && props.stagedFiles.length > 0 && !ui.conflicts.length)
watch(() => props.active, active => { ui.panelActive = active }, { immediate: true })
onBeforeUnmount(() => { ui.panelActive = false })
</script>

<template>
  <div class="git-shell" :aria-busy="ui.busy || isLoading">
    <header class="git-repo-header">
      <strong :title="ui.workspacePath">{{ (ui.workspacePath || '').split(/[\\/]/).pop() || t('git.noRepo') }}</strong>
      <span class="git-branch-name" :title="branch">⑂ {{ branch || '—' }}</span>
      <button type="button" :disabled="ui.busy || isLoading" :title="t('git.refreshCommits')" @click="$emit('refresh')">↻</button>
    </header>
    <div v-if="ui.error" class="git-feedback git-feedback-error" role="alert">
      <span>{{ ui.error }}</span><button type="button" :aria-label="t('git.ui.dismiss')" @click="ui.error = ''">×</button>
    </div>
    <div v-if="ui.notice" class="git-feedback" role="status">{{ ui.notice }}</div>
    <div v-if="ui.confirmation" class="git-confirmation">
      <p>{{ ui.confirmation.message }}</p>
      <button type="button" :disabled="ui.busy" @click="ui.confirmation.action()">{{ t('git.ui.confirm') }}</button>
      <button type="button" @click="ui.confirmation = null">{{ t('git.ui.cancel') }}</button>
    </div>
    <div v-if="ui.busy || isLoading" class="git-progress" role="status">{{ t('git.loading') }}</div>
    <fieldset class="git-controls" :disabled="ui.busy || ui.needsRestart">
  <div v-if="!isGitRepo && !ui.needsRestart" class="git-panel">
    <div class="git-empty-state">
      <span class="git-empty-icon icon-code-branch" aria-hidden="true"></span>
      <p>{{ t('git.noRepo') }}</p>
      <button class="git-init-btn" :disabled="isLoading || !ui.workspacePath" @click="$emit('init')">
        {{ t('git.initRepo') }}
      </button>
    </div>
  </div>
  <div v-else-if="isGitRepo" class="git-panel">
    <nav class="git-network-actions" :aria-label="t('git.ui.network')">
      <button type="button" @click="ui.gitFetch()">Fetch</button>
      <button type="button" @click="$emit('pull')">Pull</button>
      <button type="button" @click="$emit('push')">Push</button>
      <button type="button" @click="ui.openIdentity()">{{ t('git.ui.identity') }}</button>
      <button type="button" @click="ui.openRemote()">{{ t('git.ui.remote') }}</button>
    </nav>
    <form v-if="ui.remoteOpen" class="git-identity" @submit.prevent="ui.saveRemote()">
      <strong>{{ t('git.ui.remoteTitle') }}</strong>
      <label>URL<input v-model="ui.remoteUrl" placeholder="git@github.com:usuario/projeto.git" required spellcheck="false" /></label>
      <small>{{ t('git.ui.remoteHint') }}</small>
      <button type="submit" :disabled="!ui.remoteUrl.trim()">{{ t('git.ui.saveRemote') }}</button>
      <button type="button" @click="ui.remoteOpen = false">{{ t('git.ui.cancel') }}</button>
    </form>
    <form v-if="ui.identityOpen" class="git-identity" @submit.prevent="ui.saveIdentity()">
      <strong>{{ t('git.ui.identityTitle') }}</strong>
      <label>{{ t('git.ui.name') }}<input v-model="ui.userName" autocomplete="name" required /></label>
      <label>{{ t('git.ui.email') }}<input v-model="ui.userEmail" type="email" autocomplete="email" required /></label>
      <small>{{ t('git.ui.localIdentity') }}</small>
      <button type="submit" :disabled="!ui.userName.trim() || !ui.userEmail.trim()">{{ t('git.ui.saveIdentity') }}</button>
      <button type="button" @click="ui.identityOpen = false">{{ t('git.ui.cancel') }}</button>
    </form>
    <div class="git-commit-section">
      <textarea
        :value="commitMessage"
        :placeholder="t('git.commitPlaceholder')"
        class="git-commit-input"
        rows="3"
        :aria-label="t('git.commitPlaceholder')"
        @keydown.ctrl.enter.prevent="canCommit && $emit('commit')"
        @keydown.meta.enter.prevent="canCommit && $emit('commit')"
        @input="$emit('update:commitMessage', $event.target.value)"
      ></textarea>
      <button
        class="git-commit-btn"
        :disabled="!canCommit"
        @click="$emit('commit')"
      >
        <span class="icon-check" aria-hidden="true"></span>
        {{ t('git.commitBtn', { n: stagedFiles.length }) }}
      </button>
      <small class="git-commit-help">{{ ui.conflicts.length ? t('git.ui.resolveConflicts') : stagedFiles.length ? t('git.ui.commitHint') : t('git.ui.stageHint') }}</small>
    </div>
    <input v-model="ui.filter" class="git-filter" type="search" :placeholder="t('git.ui.filter')" :aria-label="t('git.ui.filter')" />
    <section class="git-section">
      <div class="git-group-heading">
        <button class="git-group-toggle" @click="showStaged = !showStaged" :aria-expanded="showStaged">
          <span class="git-chevron" :class="{ expanded: showStaged }" aria-hidden="true"></span>
          <span>{{ t('git.stagedHeader', { n: stagedFiles.length }) }}</span>
        </button>
        <button v-if="stagedFiles.length" class="git-toolbar-button" :title="t('git.unstageAll')" @click="$emit('unstage-all')">−</button>
      </div>
      <div v-if="showStaged">
        <div v-for="file in visibleStaged" :key="`staged-${file.path}`" class="git-file-item">
          <button type="button" class="git-file-info" @click="$emit('show-diff', file.path, true)" :title="t('git.viewDiff')">
            <span :class="'git-status-' + (file.indexStatus || file.status)">{{ getGitStatusIcon(file.indexStatus || file.status) }}</span>
            <span class="git-file-path" :title="file.oldPath ? file.oldPath + ' → ' + file.path : file.path">{{ file.path }}</span>
          </button>
          <div class="git-file-actions">
            <button class="git-file-action" :disabled="file.status === 'deleted'" @click.stop="$emit('open-file', file.path)" :title="t('git.openFile')">↗</button>
            <button class="git-file-action" @click.stop="$emit('unstage', file.path)" :title="t('git.unstage')">−</button>
          </div>
        </div>
      </div>
    </section>

    <section class="git-section">
      <div class="git-group-heading">
        <button class="git-group-toggle" @click="showChanges = !showChanges" :aria-expanded="showChanges">
          <span class="git-chevron" :class="{ expanded: showChanges }" aria-hidden="true"></span>
          <span>{{ t('git.changesHeader', { n: unstagedFiles.length }) }}</span>
        </button>
        <button v-if="unstagedFiles.length" class="git-toolbar-button" :title="t('git.stageAll')" @click="$emit('stage-all')">＋</button>
      </div>
      <div v-if="showChanges">
        <div v-for="file in visibleUnstaged" :key="`change-${file.path}`" class="git-file-item">
          <button type="button" class="git-file-info" @click="$emit('show-diff', file.path, false)" :title="t('git.viewDiff')">
            <span :class="'git-status-' + (file.conflict ? 'conflict' : file.worktreeStatus || file.status)">{{ getGitStatusIcon(file.conflict ? 'conflict' : file.worktreeStatus || file.status) }}</span>
            <span class="git-file-path" :title="file.oldPath ? file.oldPath + ' → ' + file.path : file.path">{{ file.path }}</span>
          </button>
          <div class="git-file-actions">
            <button class="git-file-action" :disabled="file.status === 'deleted'" @click.stop="$emit('open-file', file.path)" :title="t('git.openFile')">↗</button>
            <button class="git-file-action" @click.stop="$emit('stage', file.path)" :title="t('git.stage')">＋</button>
            <button class="git-file-action git-discard-action" :disabled="file.conflict" @click.stop="$emit('discard', file.path)" :title="t('git.discard')">×</button>
          </div>
        </div>
      </div>
    </section>

    <div v-if="stagedFiles.length === 0 && unstagedFiles.length === 0" class="git-no-changes">
      <span aria-hidden="true">✓</span> {{ t('git.noChanges') }}
    </div>

    <section class="git-section git-secondary-section">
      <div class="git-group-heading">
        <button class="git-group-toggle" @click="$emit('toggle-branches')" :aria-expanded="showBranchesPanel">
          <span class="git-chevron" :class="{ expanded: showBranchesPanel }" aria-hidden="true"></span>
          <span>{{ t('git.branches') }}</span>
          <span v-if="branch" class="git-current-branch">{{ branch }}</span>
        </button>
        <button class="git-toolbar-button" @click.stop="$emit('open-branch-dialog')" :title="t('git.createBranchBtn')">＋</button>
      </div>
      <div v-if="showBranchesPanel" style="margin-top: 8px;">
        <div v-if="branches.length === 0" style="padding: 8px; color: var(--muted); font-size: 11px; text-align: center;">{{ t('git.loadingBranches') }}</div>
        <div
          v-for="branch in branches"
          :key="branch.name"
          class="git-file-item"
          :style="{ backgroundColor: branch.current ? 'var(--accent-bg)' : 'transparent' }"
        >
          <div class="git-file-info" @click="!branch.current && $emit('checkout', branch.name)" :style="{ cursor: branch.current ? 'default' : 'pointer' }">
            <span class="git-branch-dot" :class="{ current: branch.current }" aria-hidden="true"></span>
            <span class="git-file-path" :style="{ fontWeight: branch.current ? '600' : '400' }">{{ branch.name }}</span>
            <span v-if="branch.remote" class="git-remote-label">{{ t('git.remoteSuffix') }}</span>
          </div>
          <button
            v-if="!branch.current && !branch.remote"
            class="git-file-action"
            @click="$emit('delete-branch', branch.name)"
            :title="t('git.deleteBranchBtn')"
            style="color: var(--error);"
          >✕</button>
        </div>
      </div>
    </section>

    <section class="git-section git-secondary-section">
      <div class="git-group-heading">
        <button class="git-group-toggle" @click="$emit('toggle-commits')" :aria-expanded="showCommitsPanel">
          <span class="git-chevron" :class="{ expanded: showCommitsPanel }" aria-hidden="true"></span>
          <span>{{ t('git.commits') }}</span>
        </button>
        <button class="git-toolbar-button" @click.stop="$emit('load-commits', true)" :title="t('git.refreshCommits')" :disabled="isLoadingCommits">↻</button>
      </div>
      <div v-if="showCommitsPanel" style="margin-top: 8px; max-height: 400px; overflow-y: auto;">
        <div v-if="isLoadingCommits && commits.length === 0" style="padding: 8px; color: var(--muted); font-size: 11px; text-align: center;">{{ t('git.loadingCommits') }}</div>
        <div v-else-if="commits.length === 0" style="padding: 8px; color: var(--muted); font-size: 11px; text-align: center;">{{ t('git.noCommits') }}</div>
        <div v-else>
          <div v-for="commit in commits" :key="commit.hash" class="git-commit-item">
            <div class="git-commit-header">
              <span class="git-commit-hash" :title="commit.hash">{{ commit.shortHash }}</span>
              <span class="git-commit-date">{{ formatCommitDate(commit.date) }}</span>
            </div>
            <div class="git-commit-subject">{{ commit.subject }}</div>
            <div class="git-commit-author">{{ commit.author }}</div>
          </div>
          <button
            v-if="commits.length >= 20"
            @click="$emit('load-commits', false)"
            :disabled="isLoadingCommits"
            style="width: 100%; padding: 8px; margin-top: 4px; font-size: 11px; background: transparent;"
          >
            {{ isLoadingCommits ? t('git.loading') : t('git.loadMore') }}
          </button>
        </div>
      </div>
    </section>
  </div>
    </fieldset>
  </div>
</template>

<style scoped>
.git-shell { display:flex; flex-direction:column; min-width:0; height:100%; overflow:auto; }
.git-repo-header { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--border); }
.git-repo-header strong { min-width:0; overflow:hidden; text-overflow:ellipsis; flex:1; font-size:12px; }
.git-branch-name { max-width:45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font:11px monospace; }
.git-controls { margin:0; padding:0; border:0; min-width:0; }
.git-panel { height:auto; overflow:visible; }
.git-network-actions { display:flex; gap:4px; flex-wrap:wrap; padding:8px 0; }
.git-network-actions button { flex:1; min-height:28px; font-size:11px; }
.git-feedback { display:flex; gap:8px; justify-content:space-between; white-space:pre-wrap; overflow-wrap:anywhere; padding:10px 12px; font-size:12px; border-bottom:1px solid var(--border); }
.git-feedback-error { color:var(--error, #f48771); border-left:3px solid currentColor; }
.git-feedback button { align-self:flex-start; }
.git-progress { font-size:11px; color:var(--muted); padding:4px 12px; }
.git-identity { display:grid; gap:8px; padding:10px; border:1px solid var(--border); margin-bottom:10px; }
.git-identity label { display:grid; gap:4px; font-size:12px; }
.git-identity input, .git-filter { width:100%; min-width:0; box-sizing:border-box; padding:7px; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:3px; }
.git-filter { margin:8px 0; }
.git-commit-help { display:block; margin-top:7px; line-height:1.5; color:var(--muted); font-size:11px; }
.git-commit-input { min-height:76px; resize:vertical; }
.git-file-info { text-align:left; border:0; background:transparent; color:inherit; padding:3px 0; min-width:0; flex:1; }
.git-file-actions { flex-shrink:0; opacity:1; }
.git-file-item { gap:5px; min-height:30px; }
.git-file-action { min-width:24px; min-height:24px; }
.git-file-path { direction:rtl; text-align:left; }
.git-confirmation { padding:10px 12px; border-bottom:1px solid var(--border); font-size:12px; }
.git-confirmation button { margin-right:8px; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
button:disabled { opacity:.45; cursor:default; }
</style>
