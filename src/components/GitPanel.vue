<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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
  'stage', 'unstage', 'discard', 'open-file', 'show-diff'
])
</script>

<template>
  <div v-if="isLoading" class="emptyState" style="padding: 20px; text-align: center;">
    {{ t('git.loading') }}
  </div>
  <div v-else-if="!isGitRepo" class="git-panel">
    <div class="emptyState" style="padding: 20px; text-align: center;">
      <p>{{ t('git.noRepo') }}</p>
      <button style="margin-top: 12px;" @click="$emit('init')">
        {{ t('git.initRepo') }}
      </button>
    </div>
  </div>
  <div v-else class="git-panel">
    <div class="git-section" style="border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
      <div class="git-section-header" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between;" @click="$emit('toggle-branches')">
        <div>
          <span style="margin-right: 4px;">{{ showBranchesPanel ? '▼' : '▶' }}</span>
          <span>{{ t('git.branches') }}</span>
        </div>
        <button @click.stop="$emit('open-branch-dialog')" :title="t('git.createBranchBtn')" style="padding: 2px 6px; font-size: 11px;">+</button>
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
            <span style="margin-right: 4px;">{{ branch.current ? '●' : '○' }}</span>
            <span class="git-file-path" :style="{ fontWeight: branch.current ? '600' : '400' }">{{ branch.name }}</span>
            <span v-if="branch.remote" style="margin-left: 4px; font-size: 9px; color: var(--muted);">{{ t('git.remoteSuffix') }}</span>
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
    </div>

    <div class="git-section" style="border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
      <div class="git-section-header" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between;" @click="$emit('toggle-commits')">
        <div>
          <span style="margin-right: 4px;">{{ showCommitsPanel ? '▼' : '▶' }}</span>
          <span>{{ t('git.commits') }}</span>
        </div>
        <button @click.stop="$emit('load-commits', true)" :title="t('git.refreshCommits')" :disabled="isLoadingCommits" style="padding: 2px 6px; font-size: 11px;">🔄</button>
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
    </div>

    <div class="git-commit-section">
      <textarea
        :value="commitMessage"
        :placeholder="t('git.commitPlaceholder')"
        class="git-commit-input"
        rows="3"
        @input="$emit('update:commitMessage', $event.target.value)"
      ></textarea>
      <button
        class="git-commit-btn"
        :disabled="!stagedFiles.length || !commitMessage.trim()"
        @click="$emit('commit')"
      >
        {{ t('git.commitBtn', { n: stagedFiles.length }) }}
      </button>
    </div>

    <div v-if="stagedFiles.length > 0" class="git-section">
      <div class="git-section-header">{{ t('git.stagedHeader', { n: stagedFiles.length }) }}</div>
      <div v-for="file in stagedFiles" :key="file.path" class="git-file-item">
        <div class="git-file-info" @click="$emit('show-diff', file.path, true)" style="cursor: pointer;" :title="t('git.viewDiff')">
          <span :class="'git-status-' + file.status">{{ getGitStatusIcon(file.status) }}</span>
          <span class="git-file-path">{{ file.path }}</span>
        </div>
        <div class="git-file-actions">
          <button class="git-file-action" @click.stop="$emit('open-file', file.path)" :title="t('git.openFile')">📄</button>
          <button class="git-file-action" @click.stop="$emit('unstage', file.path)" :title="t('git.unstage')">-</button>
        </div>
      </div>
    </div>

    <div v-if="unstagedFiles.length > 0" class="git-section">
      <div class="git-section-header">{{ t('git.changesHeader', { n: unstagedFiles.length }) }}</div>
      <div v-for="file in unstagedFiles" :key="file.path" class="git-file-item">
        <div class="git-file-info" @click="$emit('show-diff', file.path, false)" style="cursor: pointer;" :title="t('git.viewDiff')">
          <span :class="'git-status-' + file.status">{{ getGitStatusIcon(file.status) }}</span>
          <span class="git-file-path">{{ file.path }}</span>
        </div>
        <div class="git-file-actions">
          <button class="git-file-action" @click.stop="$emit('open-file', file.path)" :title="t('git.openFile')">📄</button>
          <button class="git-file-action" @click.stop="$emit('stage', file.path)" :title="t('git.stage')">+</button>
          <button class="git-file-action" @click.stop="$emit('discard', file.path)" :title="t('git.discard')">✕</button>
        </div>
      </div>
    </div>

    <div v-if="stagedFiles.length === 0 && unstagedFiles.length === 0" class="emptyState" style="padding: 20px; text-align: center;">
      {{ t('git.noChanges') }}
    </div>
  </div>
</template>
