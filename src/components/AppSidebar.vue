<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import FileTree from './FileTree.vue'

const CLEAR_DROP = 'retro-studio:clear-drop-targets'
function dispatchClearDrop() {
  try { globalThis.document?.dispatchEvent(new CustomEvent(CLEAR_DROP)) } catch (_) {}
}
import ResourcesPanel from './retro/ResourcesPanel.vue'
import CartridgeProgrammer from './retro/CartridgeProgrammer.vue'
import SearchPanel from './SearchPanel.vue'
import GitPanel from './GitPanel.vue'

const props = defineProps({
  activeView: { type: String, default: 'explorer' },
  tree: { type: Object, default: null },
  selectedNode: { type: Object, default: null },
  expandedMap: { type: Object, default: () => ({}) },
  projectPath: { type: String, default: '' },
  imageEditorPath: { type: String, default: '' },
  mapEditorPath: { type: String, default: '' },
  // Search
  searchQuery: { type: String, default: '' },
  searchResults: { type: Array, default: () => [] },
  isSearching: { type: Boolean, default: false },
  searchInContent: { type: Boolean, default: false },
  searchCaseSensitive: { type: Boolean, default: false },
  searchUseRegex: { type: Boolean, default: false },
  // Git
  isGitRepo: { type: Boolean, default: false },
  isLoadingGit: { type: Boolean, default: false },
  gitBranch: { type: String, default: '' },
  gitCommitMessage: { type: String, default: '' },
  gitBranches: { type: Array, default: () => [] },
  showBranchesPanel: { type: Boolean, default: false },
  gitCommits: { type: Array, default: () => [] },
  showCommitsPanel: { type: Boolean, default: false },
  isLoadingCommits: { type: Boolean, default: false },
  stagedFiles: { type: Array, default: () => [] },
  unstagedFiles: { type: Array, default: () => [] },
  formatCommitDate: { type: Function, default: (d) => d },
  getGitStatusIcon: { type: Function, default: () => '?' }
})

const emit = defineEmits([
  'open-file', 'select-node', 'toggle-dir', 'context', 'tree-context-menu', 'drop-files',
  'cartridge-close',
  'update:searchQuery', 'update:searchInContent', 'update:searchCaseSensitive', 'update:searchUseRegex',
  'search', 'open-search-result',
  'update:gitCommitMessage',
  'git-pull', 'git-push', 'load-git-status', 'git-init', 'git-checkout', 'git-create-branch', 'git-delete-branch',
  'toggle-branches', 'toggle-commits', 'load-commits', 'open-branch-dialog', 'git-commit',
  'git-stage', 'git-unstage', 'git-discard', 'open-git-file', 'show-file-diff'
])

const treeDropTarget = ref(false)
let treeDragCount = 0

function extractFilePaths(files) {
  const getPath = typeof window?.retroStudio?.getPathForFile === 'function'
    ? (f) => window.retroStudio.getPathForFile(f)
    : (f) => f.path || ''
  const paths = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const p = getPath(f)
    if (p && !f.type?.startsWith('inode/directory')) paths.push(p)
  }
  return paths
}

function onTreeAreaDragOver(e) {
  if (!props.tree) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  treeDropTarget.value = true
}

function onTreeAreaDragEnter(e) {
  if (!props.tree) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  treeDragCount++
  treeDropTarget.value = true
}

function onTreeAreaDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    treeDragCount--
    if (treeDragCount <= 0) { treeDragCount = 0; treeDropTarget.value = false }
  }
}

function clearTreeDropState() {
  treeDragCount = 0
  treeDropTarget.value = false
}

function onTreeAreaDrop(e) {
  clearTreeDropState()
  if (!props.tree?.path) return
  const filePaths = extractFilePaths(e.dataTransfer?.files || [])
  if (filePaths.length) emit('drop-files', { destDirPath: props.tree.path, filePaths })
  dispatchClearDrop()
}

function onChildDropFiles() {
  clearTreeDropState()
}

onMounted(() => {
  globalThis.document?.addEventListener(CLEAR_DROP, clearTreeDropState)
})
onUnmounted(() => {
  globalThis.document?.removeEventListener(CLEAR_DROP, clearTreeDropState)
})
</script>

<template>
  <aside class="sidebar">
    <div v-show="activeView === 'explorer'" class="sidebar-content">
      <div class="tree">
        <div
          class="treeArea"
          :class="{ 'treeArea--drop-target': treeDropTarget }"
          @contextmenu.prevent="$emit('tree-context-menu')"
          @dragover.prevent="onTreeAreaDragOver"
          @dragenter.prevent="onTreeAreaDragEnter"
          @dragleave="onTreeAreaDragLeave"
          @drop.prevent="onTreeAreaDrop"
        >
          <div v-if="!tree" class="emptyState">Select a folder to start.</div>
          <div v-else>
            <FileTree
              :node="tree"
              :selectedPath="selectedNode?.path ?? null"
              :expanded-map="expandedMap"
              @open="$emit('open-file', $event)"
              @select="$emit('select-node', $event)"
              @toggle="$emit('toggle-dir', $event)"
              @context="$emit('context', $event)"
              @drop-files="(e) => { onChildDropFiles(); dispatchClearDrop(); $emit('drop-files', e) }"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeView === 'resources'" class="sidebar-content">
      <div class="sidebarHeader">
        <h3 style="margin: 0; font-size: 13px; font-weight: 600;">RECURSOS</h3>
      </div>
      <ResourcesPanel
        :project-path="projectPath"
        :image-editor-path="imageEditorPath"
        :map-editor-path="mapEditorPath"
      />
    </div>

    <div v-show="activeView === 'cartridge'" class="sidebar-content">
      <div class="sidebarHeader">
        <h3 style="margin: 0; font-size: 13px; font-weight: 600;">CARTUCHO</h3>
      </div>
      <CartridgeProgrammer
        :project-path="projectPath"
        :show="true"
        @close="$emit('cartridge-close')"
      />
    </div>

    <div v-show="activeView === 'search'" class="sidebar-content">
      <div class="sidebarHeader">
        <h3 style="margin: 0; font-size: 13px; font-weight: 600;">SEARCH</h3>
      </div>
      <SearchPanel
        :query="searchQuery"
        :results="searchResults"
        :is-searching="isSearching"
        :search-in-content="searchInContent"
        :search-case-sensitive="searchCaseSensitive"
        :search-use-regex="searchUseRegex"
        @update:query="$emit('update:searchQuery', $event)"
        @update:search-in-content="$emit('update:searchInContent', $event)"
        @update:search-case-sensitive="$emit('update:searchCaseSensitive', $event)"
        @update:search-use-regex="$emit('update:searchUseRegex', $event)"
        @search="$emit('search')"
        @open-result="$emit('open-search-result', $event)"
      />
    </div>

    <div v-show="activeView === 'git'" class="sidebar-content">
      <div class="sidebarHeader">
        <h3 style="margin: 0; font-size: 13px; font-weight: 600;">SOURCE CONTROL</h3>
        <span v-if="gitBranch" style="font-size: 11px; color: var(--muted); margin-left: 8px;">{{ gitBranch }}</span>
        <div style="margin-left: auto; display: flex; gap: 4px;">
          <button @click="$emit('git-pull')" :disabled="isLoadingGit" title="Pull" style="padding: 4px 8px; font-size: 11px;">⬇️</button>
          <button @click="$emit('git-push')" :disabled="isLoadingGit" title="Push" style="padding: 4px 8px; font-size: 11px;">⬆️</button>
          <button @click="$emit('load-git-status')" :disabled="isLoadingGit" title="Refresh Git Status" style="padding: 4px 8px; font-size: 11px;">
            <span v-if="isLoadingGit">⟳</span>
            <span v-else>🔄</span>
          </button>
        </div>
      </div>
      <GitPanel
        :is-git-repo="isGitRepo"
        :is-loading="isLoadingGit"
        :branch="gitBranch"
        :commit-message="gitCommitMessage"
        :branches="gitBranches"
        :show-branches-panel="showBranchesPanel"
        :commits="gitCommits"
        :show-commits-panel="showCommitsPanel"
        :is-loading-commits="isLoadingCommits"
        :staged-files="stagedFiles"
        :unstaged-files="unstagedFiles"
        :format-commit-date="formatCommitDate"
        :get-git-status-icon="getGitStatusIcon"
        @update:commit-message="$emit('update:gitCommitMessage', $event)"
        @init="$emit('git-init')"
        @checkout="$emit('git-checkout', $event)"
        @create-branch="$emit('git-create-branch')"
        @delete-branch="$emit('git-delete-branch', $event)"
        @toggle-branches="$emit('toggle-branches')"
        @toggle-commits="$emit('toggle-commits')"
        @load-commits="$emit('load-commits', $event)"
        @open-branch-dialog="$emit('open-branch-dialog')"
        @commit="$emit('git-commit')"
        @stage="$emit('git-stage', $event)"
        @unstage="$emit('git-unstage', $event)"
        @discard="$emit('git-discard', $event)"
        @open-file="$emit('open-git-file', $event)"
        @show-diff="(path, staged) => $emit('show-file-diff', path, staged)"
      />
    </div>

    <div v-show="activeView === 'debug'" class="sidebar-content">
      <div class="sidebarHeader">
        <h3 style="margin: 0; font-size: 13px; font-weight: 600;">RUN AND DEBUG</h3>
      </div>
      <div class="emptyState" style="padding: 20px; text-align: center;">Debug functionality coming soon...</div>
    </div>

    <div v-show="activeView === 'extensions'" class="sidebar-content">
      <div class="sidebarHeader">
        <h3 style="margin: 0; font-size: 13px; font-weight: 600;">EXTENSIONS</h3>
      </div>
      <div class="emptyState" style="padding: 20px; text-align: center;">Extensions marketplace coming soon...</div>
    </div>
  </aside>
</template>
