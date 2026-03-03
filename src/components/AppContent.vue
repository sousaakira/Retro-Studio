<!--
  AppContent - Área principal do app (grid): ActivityBar + Sidebar + Editor + AI Chat.
  
  Layout: CSS Grid com colunas dinâmicas baseadas em sidebarWidth e aiChatWidth.
  
  SLOTS:
  - default: Conteúdo do MainEditorArea (editor Monaco + terminal)
  
  PROPS: Estados do sidebar, activeView, tree, search, git, tabs, etc.
  EVENTS: Todas as ações (open-file, git-*, search, etc.)
-->
<script setup>
import { ref } from 'vue'
import ActivityBar from './ActivityBar.vue'
import AppSidebar from './AppSidebar.vue'
import ContextMenu from './ContextMenu.vue'
import MainEditorArea from './MainEditorArea.vue'

defineProps({
  gridTemplateColumns: { type: String, default: '' },
  activeView: { type: String, default: 'explorer' },
  activityBarItems: { type: Array, default: () => [] },
  tree: { type: Object, default: null },
  selectedNode: { type: Object, default: null },
  expandedMap: { type: Object, default: () => ({}) },
  projectPath: { type: String, default: '' },
  imageEditorPath: { type: String, default: '' },
  mapEditorPath: { type: String, default: '' },
  workspacePath: { type: String, default: '' },
  isRetroProject: Boolean,
  // Search
  searchQuery: { type: String, default: '' },
  searchResults: { type: Array, default: () => [] },
  isSearching: Boolean,
  searchInContent: Boolean,
  searchCaseSensitive: Boolean,
  searchUseRegex: Boolean,
  // Git
  isGitRepo: Boolean,
  isLoadingGit: Boolean,
  gitBranch: { type: String, default: '' },
  gitCommitMessage: { type: String, default: '' },
  gitBranches: { type: Array, default: () => [] },
  showBranchesPanel: Boolean,
  gitCommits: { type: Array, default: () => [] },
  showCommitsPanel: Boolean,
  isLoadingCommits: Boolean,
  stagedFiles: { type: Array, default: () => [] },
  unstagedFiles: { type: Array, default: () => [] },
  formatCommitDate: { type: Function, default: (d) => d },
  getGitStatusIcon: { type: Function, default: () => '?' },
  // Context menu
  contextMenu: { type: Object, default: () => ({ open: false, x: 0, y: 0, node: null }) },
  contextMenuWidth: { type: Number, default: 240 },
  // Main editor
  activeTab: { type: Object, default: null },
  tabs: { type: Array, default: () => [] },
  activePath: { type: String, default: null },
  isTerminalOpen: Boolean,
  terminalHeight: { type: Number, default: 250 },
  compilationErrors: { type: Array, default: () => [] },
  statusLineCol: { type: Object, default: () => ({ line: 1, col: 1 }) },
  pickedColor: { type: String, default: null },
  autocompleteEnabled: Boolean,
  autocompleteLoading: Boolean,
  lastError: { type: String, default: null }
})
const mainEditorAreaRef = ref(null)
defineExpose({ mainEditorAreaRef })

defineEmits([
  'activity-bar-select', 'activity-bar-settings',
  'sidebar-resize-start',
  'sidebar-open-file', 'sidebar-select-node', 'sidebar-toggle-dir', 'sidebar-context', 'sidebar-tree-context', 'sidebar-drop-files',
  'sidebar-cartridge-close',
  'sidebar-update-search-query', 'sidebar-update-search-in-content', 'sidebar-update-search-case-sensitive', 'sidebar-update-search-use-regex',
  'sidebar-search', 'sidebar-open-search-result',
  'sidebar-update-git-commit', 'sidebar-git-pull', 'sidebar-git-push', 'sidebar-load-git', 'sidebar-git-init',
  'sidebar-git-checkout', 'sidebar-git-create-branch', 'sidebar-git-delete-branch',
  'sidebar-toggle-branches', 'sidebar-toggle-commits', 'sidebar-load-commits', 'sidebar-open-branch-dialog',
  'sidebar-git-commit', 'sidebar-git-stage', 'sidebar-git-unstage', 'sidebar-git-discard',
  'sidebar-open-git-file', 'sidebar-show-file-diff',
  'context-close', 'context-open', 'context-refresh', 'context-new-file', 'context-new-folder',
  'context-rename', 'context-delete', 'context-copy-path', 'context-copy-relative',
  'context-edit-external-image', 'context-edit-external-map', 'context-edit-tilemap',
  'main-update-active-path', 'main-close-tab', 'main-close-terminal', 'main-resize-terminal',
  'main-clear-errors', 'main-error-click',
  'main-activate-eyedropper', 'main-toggle-color-palette', 'main-copy-color', 'main-clear-picked-color', 'main-toggle-autocomplete'
])
</script>

<template>
  <div class="app" :style="{ gridTemplateColumns }">
    <ActivityBar
      :active-view="activeView"
      :items="activityBarItems"
      @select="$emit('activity-bar-select', $event)"
      @settings="$emit('activity-bar-settings')"
    />
    <AppSidebar
      :active-view="activeView"
      :tree="tree"
      :selected-node="selectedNode"
      :expanded-map="expandedMap"
      :project-path="projectPath"
      :image-editor-path="imageEditorPath"
      :map-editor-path="mapEditorPath"
      :search-query="searchQuery"
      :search-results="searchResults"
      :is-searching="isSearching"
      :search-in-content="searchInContent"
      :search-case-sensitive="searchCaseSensitive"
      :search-use-regex="searchUseRegex"
      :is-git-repo="isGitRepo"
      :is-loading-git="isLoadingGit"
      :git-branch="gitBranch"
      :git-commit-message="gitCommitMessage"
      :git-branches="gitBranches"
      :show-branches-panel="showBranchesPanel"
      :git-commits="gitCommits"
      :show-commits-panel="showCommitsPanel"
      :is-loading-commits="isLoadingCommits"
      :staged-files="stagedFiles"
      :unstaged-files="unstagedFiles"
      :format-commit-date="formatCommitDate"
      :get-git-status-icon="getGitStatusIcon"
      @open-file="$emit('sidebar-open-file', $event)"
      @select-node="$emit('sidebar-select-node', $event)"
      @toggle-dir="$emit('sidebar-toggle-dir', $event)"
      @context="$emit('sidebar-context', $event)"
      @tree-context-menu="$emit('sidebar-tree-context')"
      @drop-files="$emit('sidebar-drop-files', $event)"
      @cartridge-close="$emit('sidebar-cartridge-close')"
      @update:searchQuery="$emit('sidebar-update-search-query', $event)"
      @update:searchInContent="$emit('sidebar-update-search-in-content', $event)"
      @update:searchCaseSensitive="$emit('sidebar-update-search-case-sensitive', $event)"
      @update:searchUseRegex="$emit('sidebar-update-search-use-regex', $event)"
      @search="$emit('sidebar-search')"
      @open-search-result="$emit('sidebar-open-search-result', $event)"
      @update:gitCommitMessage="$emit('sidebar-update-git-commit', $event)"
      @git-pull="$emit('sidebar-git-pull')"
      @git-push="$emit('sidebar-git-push')"
      @load-git-status="$emit('sidebar-load-git')"
      @git-init="$emit('sidebar-git-init')"
      @git-checkout="$emit('sidebar-git-checkout', $event)"
      @git-create-branch="$emit('sidebar-git-create-branch')"
      @git-delete-branch="$emit('sidebar-git-delete-branch', $event)"
      @toggle-branches="$emit('sidebar-toggle-branches')"
      @toggle-commits="$emit('sidebar-toggle-commits')"
      @load-commits="$emit('sidebar-load-commits', $event)"
      @open-branch-dialog="$emit('sidebar-open-branch-dialog')"
      @git-commit="$emit('sidebar-git-commit')"
      @git-stage="$emit('sidebar-git-stage', $event)"
      @git-unstage="$emit('sidebar-git-unstage', $event)"
      @git-discard="$emit('sidebar-git-discard', $event)"
      @open-git-file="$emit('sidebar-open-git-file', $event)"
      @show-file-diff="(path, staged) => $emit('sidebar-show-file-diff', path, staged)"
    />
    <div class="sidebar-resizer" @mousedown="$emit('sidebar-resize-start')"></div>
    <ContextMenu
      :is-open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :width="contextMenuWidth"
      :node="contextMenu.node"
      :root-path="workspacePath"
      :has-tree="!!tree"
      :is-retro-project="isRetroProject"
      :image-editor-path="imageEditorPath"
      :map-editor-path="mapEditorPath"
      @close="$emit('context-close')"
      @open="$emit('context-open')"
      @refresh="$emit('context-refresh')"
      @new-file="$emit('context-new-file')"
      @new-folder="$emit('context-new-folder')"
      @rename="$emit('context-rename')"
      @delete="$emit('context-delete')"
      @copy-path="$emit('context-copy-path')"
      @copy-relative-path="$emit('context-copy-relative-path')"
      @edit-external-image="$emit('context-edit-external-image')"
      @edit-external-map="$emit('context-edit-external-map')"
      @edit-tilemap="$emit('context-edit-tilemap')"
    />
    <MainEditorArea
      ref="mainEditorAreaRef"
      :active-tab="activeTab"
      :tabs="tabs"
      :active-path="activePath"
      :is-terminal-open="isTerminalOpen"
      :terminal-height="terminalHeight"
      :compilation-errors="compilationErrors"
      :project-path="projectPath"
      :status-line-col="statusLineCol"
      :picked-color="pickedColor"
      :autocomplete-enabled="autocompleteEnabled"
      :autocomplete-loading="autocompleteLoading"
      :last-error="lastError"
      @update:activePath="$emit('main-update-active-path', $event)"
      @close-tab="$emit('main-close-tab', $event)"
      @close-terminal="$emit('main-close-terminal')"
      @start-resize-terminal="$emit('main-resize-terminal')"
      @clear-compilation-errors="$emit('main-clear-errors')"
      @compilation-error-click="$emit('main-error-click', $event)"
      @activate-eyedropper="$emit('main-activate-eyedropper')"
      @toggle-color-palette="$emit('main-toggle-color-palette')"
      @copy-color="$emit('main-copy-color', $event)"
      @clear-picked-color="$emit('main-clear-picked-color')"
      @toggle-autocomplete="$emit('main-toggle-autocomplete')"
    >
      <slot />
    </MainEditorArea>
  </div>
</template>
