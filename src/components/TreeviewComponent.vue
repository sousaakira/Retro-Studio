<template>
  <ul class="treeview">
    <li
      v-for="node in treeData"
      :key="node.id"
      :class="[
        'tree-node',
        isSelected(node) ? 'selected' : '',
        isDragSource(node) ? 'drag-source' : '',
        isDragTarget(node) ? 'drag-target' : '',
        node.tipo === 'diretorio' ? 'is-directory' : 'is-file',
        node.tipo === 'diretorio' && node.expanded ? 'is-expanded' : ''
      ]"
      @dragover="handleDragOver(node, $event)"
      @drop="handleDrop(node, $event)"
    >
      <div
        class="node-row"
        draggable="true"
        @click="handleClick(node)"
        @contextmenu.prevent.stop="handleContextMenu(node, $event)"
        @dragover.prevent.stop="handleDragOver(node, $event)"
        @drop.prevent.stop="handleDrop(node, $event)"
        @dragstart="handleDragStart(node, $event)"
        @dragend="handleDragEnd"
      >
        <span
          class="twisty"
          :class="{ 'is-dir': node.tipo === 'diretorio' }"
          @click.stop="node.tipo === 'diretorio' && toggleNode(node)"
        >
          <i
            v-if="node.tipo === 'diretorio'"
            class="fas fa-chevron-right twisty-icon"
            :class="{ expanded: node.expanded }"
          ></i>
        </span>
        <span class="node-icon">
          <i
            v-if="node.tipo === 'diretorio'"
            :class="['fas', node.expanded ? 'fa-folder-open' : 'fa-folder', 'icon-folder']"
          ></i>
          <i v-else :class="getIcons(node.label)" class="icon-file"></i>
        </span>
        <span class="node-label" :title="node.label">{{ node.label }}</span>
      </div>
      <TreeView
        v-if="node.expanded && node.children && node.children.length > 0"
        class="treeview-children"
        :treeData="node.children"
        :openFile="openFile"
        :selectedPath="selectedPath"
        :dragSourcePath="dragSourcePath"
        :dragTargetPath="dragTargetPath"
        @contextmenu="$emit('contextmenu', $event)"
        @select="$emit('select', $event)"
        @dragstart="$emit('dragstart', $event)"
        @dragover="$emit('dragover', $event)"
        @drop="$emit('drop', $event)"
        @dragend="$emit('dragend', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </li>
  </ul>
</template>

<script>
import { isFile, obterIconePorExtensao } from '../plugins/icons'
const extensoesDeImagens = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tga', 'pal', 'pcx'];

function isImagem(fileName) {
  const extensao = fileName.split('.').pop().toLowerCase();
  return extensoesDeImagens.includes(extensao);
}

export default {
  name: 'TreeView',
  props: {
    openFile: { type: Function, required: true },
    treeData: { type: Array, required: true },
    selectedPath: { type: String, default: '' },
    dragSourcePath: { type: String, default: '' },
    dragTargetPath: { type: String, default: '' }
  },
  emits: ['contextmenu', 'select', 'dragstart', 'dragover', 'drop', 'dragend', 'toggle'],
  methods: {
    toggleNode(node) {
      node.expanded = !node.expanded;
      this.$emit('toggle', { node, expanded: node.expanded });
    },
    handleClick(node) {
      this.$emit('select', node);
      if (isImagem(node.label)) {
        this.$store.dispatch('updateFileImage', { node });
      } else if (node.tipo === 'arquivo') {
        this.$store.dispatch('updateFileRequest', { node });
      }
    },
    handleContextMenu(node, event) {
      event.stopPropagation();
      this.$emit('select', node);
      this.$emit('contextmenu', { node, event });
    },
    handleDragStart(node, event) {
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', node?.path || '');
      }
      this.$emit('dragstart', { node, event });
    },
    handleDragOver(node, event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.$emit('dragover', { node, event });
    },
    handleDrop(node, event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.$emit('drop', { node, event });
    },
    handleDragEnd() {
      this.$emit('dragend');
    },
    getIcons(fileName) {
      if (isFile(fileName)) {
        return obterIconePorExtensao(fileName);
      }
      return 'fa-regular fa-file';
    },
    isSelected(node) {
      return node?.path === this.selectedPath;
    },
    isDragSource(node) {
      return this.dragSourcePath && node?.path === this.dragSourcePath;
    },
    isDragTarget(node) {
      return this.dragTargetPath && node?.path === this.dragTargetPath;
    }
  }
};
</script>

<style scoped>
/* VS Code–style tree: indent by nesting, compact rows, twisty + icon + label */
.treeview {
  list-style: none;
  margin: 0;
  padding: 0;
}

.treeview .treeview-children {
  padding-left: 16px;
}

.tree-node {
  margin: 0;
  padding: 0;
}

.node-row {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 4px 0 0;
  margin: 0;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 0.1s ease;
  user-select: none;
  min-width: 0;
}

.node-row:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.tree-node.selected > .node-row {
  background-color: rgba(255, 255, 255, 0.1);
}

.tree-node.selected > .node-row .node-label,
.tree-node.selected > .node-row .icon-folder,
.tree-node.selected > .node-row .icon-file {
  color: inherit;
}

/* Twisty: fixed width, chevron rotates when expanded */
.twisty {
  flex-shrink: 0;
  width: 16px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
}

.twisty.is-dir {
  cursor: pointer;
  color: rgba(255, 255, 255, 0.7);
}

.twisty-icon {
  font-size: 10px;
  transition: transform 0.15s ease;
}

.twisty-icon.expanded {
  transform: rotate(90deg);
}

/* Icon slot: same width for alignment */
.node-icon {
  flex-shrink: 0;
  width: 16px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 6px;
}

.node-icon i {
  font-size: 14px;
}

.icon-folder {
  color: #e8b923;
}

.icon-file {
  color: rgba(255, 255, 255, 0.75);
}

/* Icon colors from plugins/icons (folder-blue, folder-yelo, etc.) */
.node-icon .folder-blue { color: #75beff; }
.node-icon .folder-yelo { color: #dcdcaa; }
.node-icon .folder-red { color: #f48771; }
.node-icon .folder-green { color: #4ec9b0; }

.node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
}

.tree-node.is-directory > .node-row .node-label {
  color: rgba(255, 255, 255, 0.9);
}

/* Drag states */
.tree-node.drag-target > .node-row {
  background-color: rgba(88, 166, 255, 0.15);
  outline: 1px dashed rgba(88, 166, 255, 0.5);
  outline-offset: -1px;
}

.tree-node.drag-source > .node-row {
  opacity: 0.5;
}
</style>
