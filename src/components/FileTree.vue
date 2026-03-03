<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'

const CLEAR_DROP = 'retro-studio:clear-drop-targets'
function dispatchClearDrop() {
  try { globalThis.document?.dispatchEvent(new CustomEvent(CLEAR_DROP)) } catch (_) {}
}

const props = defineProps({ 
  node: Object,
  depth: { type: Number, default: 0 },
  selectedPath: String,
  expandedMap: Object
})

const emit = defineEmits(['open', 'select', 'toggle', 'context', 'drop-files'])

const isDropTarget = ref(false)
let dragCount = 0

// Usa shallowRef para evitar reatividade profunda desnecessária
const isNodeExpanded = computed(() => {
  // Por padrão, todos os nós começam COLAPSADOS (false)
  // Apenas expande se explicitamente definido como true
  return (props.expandedMap ?? {})[props.node?.path] === true
})

const isSelected = computed(() => 
  props.node?.path === props.selectedPath
)

const rowStyle = computed(() => ({
  paddingLeft: `${props.depth * 16 + 4}px`
}))

// Cache de mapeamento de ícones (definido fora para reutilizar)
const FOLDER_TYPES = {
  'src': 'folder_type_src',
  'source': 'folder_type_src',
  'component': 'folder_type_component',
  'components': 'folder_type_component',
  'test': 'folder_type_test',
  'tests': 'folder_type_test',
  'spec': 'folder_type_test',
  '__tests__': 'folder_type_test',
  'dist': 'folder_type_dist',
  'build': 'folder_type_dist',
  'out': 'folder_type_dist',
  'node_modules': 'folder_type_node',
  'electron': 'folder_type_electron',
  'docs': 'folder_type_docs',
  'doc': 'folder_type_docs',
  'assets': 'folder_type_asset',
  'public': 'folder_type_asset',
  'static': 'folder_type_asset',
  'images': 'folder_type_images',
  'img': 'folder_type_images',
  'server': 'folder_type_server',
  'api': 'folder_type_api',
  'config': 'folder_type_config',
  '.vscode': 'folder_type_vscode',
  '.git': 'folder_type_git',
  'fonts': 'folder_type_fonts'
}

const FILE_ICON_MAP = {
  'js': 'file_type_js', 'cjs': 'file_type_js', 'mjs': 'file_type_js',
  'ts': 'file_type_typescript', 'tsx': 'file_type_typescript',
  'html': 'file_type_html', 'css': 'file_type_css', 'scss': 'file_type_scss',
  'json': 'file_type_json', 'vue': 'file_type_vue', 'md': 'file_type_markdown',
  'py': 'file_type_python', 'go': 'file_type_go', 'java': 'file_type_java',
  'cpp': 'file_type_cpp', 'c': 'file_type_c', 'h': 'file_type_cheader',
  'cs': 'file_type_csharp', 'php': 'file_type_php', 'rb': 'file_type_ruby',
  'xml': 'file_type_xml', 'yaml': 'file_type_yaml', 'yml': 'file_type_yaml',
  'sql': 'file_type_db', 'svg': 'file_type_svg',
  'png': 'file_type_image', 'jpg': 'file_type_image', 'jpeg': 'file_type_image',
  'gif': 'file_type_image', 'webp': 'file_type_image',
  'pdf': 'file_type_pdf', 'zip': 'file_type_zip', 'rar': 'file_type_zip'
}

const getIconPath = computed(() => {
  const node = props.node
  
  let iconName = 'default_file.svg'
  if (node) {
    if (node.kind === 'dir') {
      const name = node.name.toLowerCase()
      const folderType = FOLDER_TYPES[name] || 'default_folder'
      const suffix = isNodeExpanded.value ? '_opened' : ''
      iconName = `${folderType}${suffix}.svg`
    } else {
      const ext = node.name.split('.').pop()?.toLowerCase() || ''
      iconName = `${FILE_ICON_MAP[ext] || 'default_file'}.svg`
    }
  }
  
  // Usar path relativo que funciona em HTTP (dev) e file:// (produção ASAR)
  // Path relativo é resolvido relativo à URL da página, não ao filesystem absoluto
  return `./icons/${iconName}`
})

function handleRowClick() {
  emit('select', props.node)
  if (props.node.kind === 'file') {
    emit('open', props.node.path)
  }
}

function handleToggle(e) {
  e.stopPropagation()
  emit('toggle', props.node.path)
}

function handleContext(e) {
  e.preventDefault()
  e.stopPropagation()
  emit('context', { node: props.node, x: e.clientX, y: e.clientY })
}

function handleDragOver(e) {
  if (props.node?.kind !== 'dir') return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  isDropTarget.value = true
}

function handleDragEnter(e) {
  if (props.node?.kind !== 'dir') return
  e.preventDefault()
  dragCount++
  isDropTarget.value = true
}

function handleDragLeave(e) {
  if (props.node?.kind !== 'dir') return
  if (!e.currentTarget.contains(e.relatedTarget)) {
    dragCount--
    if (dragCount <= 0) clearDropState()
  }
}

function handleDrop(e) {
  if (props.node?.kind !== 'dir') return
  e.preventDefault()
  e.stopPropagation()
  clearDropState()
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const getPath = typeof window?.retroStudio?.getPathForFile === 'function'
    ? (f) => window.retroStudio.getPathForFile(f)
    : (f) => f.path || ''
  const filePaths = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const p = getPath(f)
    if (p && !f.type?.startsWith('inode/directory')) filePaths.push(p)
  }
  if (filePaths.length) emit('drop-files', { destDirPath: props.node.path, filePaths })
  dispatchClearDrop()
}

function clearDropState() {
  dragCount = 0
  isDropTarget.value = false
}

onMounted(() => {
  globalThis.document?.addEventListener(CLEAR_DROP, clearDropState)
})
onUnmounted(() => {
  globalThis.document?.removeEventListener(CLEAR_DROP, clearDropState)
})
</script>

<template>
  <div class="tree-node">
    <!-- Row -->
    <div
      class="tree-row"
      :class="{ 'tree-row--selected': isSelected, 'tree-row--drop-target': isDropTarget }"
      :style="rowStyle"
      @click="handleRowClick"
      @dblclick="node.kind === 'dir' && handleToggle($event)"
      @contextmenu="handleContext"
      @dragover="handleDragOver"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Twistie Arrow -->
      <span 
        v-if="node.kind === 'dir'" 
        class="tree-twistie"
        :class="{ 'tree-twistie--expanded': isNodeExpanded }"
        @click="handleToggle"
      >
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M6 4v8l4-4-4-4z" fill="currentColor"/>
        </svg>
      </span>
      <span v-else class="tree-twistie-spacer"></span>
      
      <!-- Icon -->
      <img :src="getIconPath" class="tree-icon" alt="" />
      
      <!-- Name -->
      <span class="tree-name">{{ node.name }}</span>
    </div>
    
    <!-- Children -->
    <!-- Só renderiza filhos se estiver expandido E tiver filhos -->
    <template v-if="node.kind === 'dir' && isNodeExpanded && node.children?.length">
      <div class="tree-children">
        <FileTree
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :selectedPath="selectedPath"
          :expandedMap="expandedMap"
          :depth="depth + 1"
          @open="emit('open', $event)"
          @select="emit('select', $event)"
          @toggle="emit('toggle', $event)"
          @context="emit('context', $event)"
          @drop-files="emit('drop-files', $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree-node {
  user-select: none;
}

.tree-row {
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 8px;
  cursor: pointer;
  color: var(--text, #cccccc);
  border-radius: 3px;
  margin: 0 4px;
}

.tree-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tree-row--selected {
  background: rgba(79, 140, 255, 0.2) !important;
}

.tree-row--drop-target {
  background: rgba(79, 140, 255, 0.15);
  outline: 1px dashed rgba(79, 140, 255, 0.5);
}

.tree-twistie {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--muted, #858585);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.tree-twistie svg {
  width: 16px;
  height: 16px;
}

.tree-twistie--expanded {
  transform: rotate(90deg);
}

.tree-twistie-spacer {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.tree-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-left: 2px;
  margin-right: 6px;
  object-fit: contain;
}

.tree-name {
  flex: 1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 22px;
}
</style>
