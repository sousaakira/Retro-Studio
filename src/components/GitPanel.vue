<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showStaged = ref(true)
const showChanges = ref(true)

defineProps({
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
</script>

<template>
  <div v-if="isLoading" class="emptyState" style="padding: 20px; text-align: center;">
    {{ t('git.loading') }}
  </div>
  <div v-else-if="!isGitRepo" class="git-panel">
    <div class="git-empty-state">
      <span class="git-empty-icon icon-code-branch" aria-hidden="true"></span>
      <p>{{ t('git.noRepo') }}</p>
      <button class="git-init-btn" @click="$emit('init')">
        {{ t('git.initRepo') }}
      </button>
    </div>
  </div>
  <div v-else class="git-panel">
    <div class="git-commit-section">
      <textarea
        :value="commitMessage"
        :placeholder="t('git.commitPlaceholder')"
        class="git-commit-input"
        rows="2"
        @input="$emit('update:commitMessage', $event.target.value)"
      ></textarea>
      <button
        class="git-commit-btn"
        :disabled="!stagedFiles.length || !commitMessage.trim()"
        @click="$emit('commit')"
      >
        <span class="icon-check" aria-hidden="true"></span>
        {{ t('git.commitBtn', { n: stagedFiles.length }) }}
      </button>
    </div>

    <section class="git-section">
      <div class="git-group-heading">
        <button class="git-group-toggle" @click="showStaged = !showStaged" :aria-expanded="showStaged">
          <span class="git-chevron" :class="{ expanded: showStaged }" aria-hidden="true"></span>
          <span>{{ t('git.stagedHeader', { n: stagedFiles.length }) }}</span>
        </button>
        <button v-if="stagedFiles.length" class="git-toolbar-button" :title="t('git.unstageAll')" @click="$emit('unstage-all')">−</button>
      </div>
      <div v-if="showStaged">
        <div v-for="file in stagedFiles" :key="`staged-${file.path}`" class="git-file-item">
          <div class="git-file-info" @click="$emit('show-diff', file.path, true)" :title="t('git.viewDiff')">
            <span :class="'git-status-' + file.status">{{ getGitStatusIcon(file.status) }}</span>
            <span class="git-file-path">{{ file.path }}</span>
          </div>
          <div class="git-file-actions">
            <button class="git-file-action" @click.stop="$emit('open-file', file.path)" :title="t('git.openFile')">↗</button>
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
        <div v-for="file in unstagedFiles" :key="`change-${file.path}`" class="git-file-item">
          <div class="git-file-info" @click="$emit('show-diff', file.path, false)" :title="t('git.viewDiff')">
            <span :class="'git-status-' + file.status">{{ getGitStatusIcon(file.status) }}</span>
            <span class="git-file-path">{{ file.path }}</span>
          </div>
          <div class="git-file-actions">
            <button class="git-file-action" @click.stop="$emit('open-file', file.path)" :title="t('git.openFile')">↗</button>
            <button class="git-file-action" @click.stop="$emit('stage', file.path)" :title="t('git.stage')">＋</button>
            <button class="git-file-action git-discard-action" @click.stop="$emit('discard', file.path)" :title="t('git.discard')">×</button>
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
</template>
