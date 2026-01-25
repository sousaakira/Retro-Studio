<template>
  <ul class="treeview">
    <li 
      v-for="node in treeData" 
      :key="node.id" 
      :class="[
        'tree-node',
        node.tipo === 'arquivo' ? 'margen' : '',
        isSelected(node) ? 'selected' : '',
        isDragSource(node) ? 'drag-source' : '',
        isDragTarget(node) ? 'drag-target' : '',
        node.tipo === 'diretorio' ? 'is-directory' : '',
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
        <button @click.stop="toggleNode(node)" v-if="node.tipo == 'diretorio'">
          <i :class="[
            'fas',
            node.expanded ? 'fa-chevron-down' : 'fa-chevron-right',
            'space'
          ]"></i>&nbsp;
          <i :class="[
            'fas',
            node.expanded ? 'fa-folder-open folder-color' : 'fa-folder folder-color'
          ]"></i>
        </button>
        <i v-if="node.tipo == 'arquivo'" :class="getIcons(node.label)"></i>
        {{ node.label }}
      </div>
      <TreeView
        class="click"
        v-if="node.expanded && node.children && node.children.length > 0"
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

function isImagem(fileName){
  const extensao = fileName.split('.').pop().toLowerCase();
  return extensoesDeImagens.includes(extensao);
}

export default {
  name: 'TreeView',
  props: {
    openFile: {
      type: Function,
      required: true
    },
    treeData: {
      type: Array,
      required: true
    },
    selectedPath: {
      type: String,
      default: ''
    },
    dragSourcePath: {
      type: String,
      default: ''
    },
    dragTargetPath: {
      type: String,
      default: ''
    }
  },
  emits: ['contextmenu', 'select', 'dragstart', 'dragover', 'drop', 'dragend', 'toggle'],
  methods: {
    toggleNode(node) {
      node.expanded = !node.expanded;
      this.$emit('toggle', { node, expanded: node.expanded })
    },
    handleClick(node) {
      this.$emit('select', node)
      if (isImagem(node.label)) {
        this.$store.dispatch('updateFileImage', { node })
      } else if (node.tipo === 'arquivo') {
        this.$store.dispatch('updateFileRequest', { node })
      }
    },
    handleContextMenu(node, event) {
      event.stopPropagation();
      this.$emit('select', node)
      this.$emit('contextmenu', { node, event })
    },
    handleDragStart(node, event) {
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', node?.path || '')
      }
      this.$emit('dragstart', { node, event })
    },
    handleDragOver(node, event) {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      this.$emit('dragover', { node, event })
    },
    handleDrop(node, event) {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      this.$emit('drop', { node, event })
    },
    handleDragEnd() {
      this.$emit('dragend')
    },
    getIcons(fileName){
      if (isFile(fileName)) {
        const icone = obterIconePorExtensao(fileName);
        return icone
      } else {
        return "fa-regular fa-file"
      }
    },
    isSelected(node) {
      return node?.path === this.selectedPath
    },
    isDragSource(node) {
      return this.dragSourcePath && node?.path === this.dragSourcePath
    },
    isDragTarget(node) {
      return this.dragTargetPath && node?.path === this.dragTargetPath
    }
  }
};
</script>

<style scoped>
.treeview {
  list-style: none;
  padding-left: 6px;
}

.treeview button {
  margin-right: 2px;
  cursor: pointer;
}

.click {
  cursor: pointer;
}
.margen {
  padding-left: 22px;
  /* border: solid 1px; */
}
.folder-color {
  color: bisque;
}
.folder-blue {
  color: rgb(40, 40, 173);
  font-weight: bold;
}
.folder-yelo {
  color: rgb(173, 153, 40);
  font-weight: bold;
}
.folder-green {
  color: rgb(17, 104, 29);
  font-weight: bold;
}
.tree-node .node-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 4px;
  transition: background 0.2s ease;
}
.tree-node .node-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.tree-node .node-row i {
  font-size: 11px;
  min-width: 14px;
  text-align: center;
}
.tree-node .node-row button {
  padding: 0;
}
.tree-node.selected > .node-row {
  background: rgba(0, 102, 204, 0.2);
}
.tree-node.selected > .node-row span,
.tree-node.selected > .node-row i {
  color: #fff;
}
.tree-node.is-directory > .node-row {
  color: #c8d3f5;
}
.tree-node.is-directory button {
  color: inherit;
}
.tree-node.is-directory.is-expanded > .node-row {
  background: rgba(100, 149, 237, 0.15);
  border-left: 2px solid rgba(100, 149, 237, 0.6);
  padding-left: 14px;
}

.tree-node.drag-target > .node-row {
  background: rgba(46, 170, 250, 0.25);
  border: 1px dashed rgba(46, 170, 250, 0.6);
}

.tree-node.drag-source > .node-row {
  opacity: 0.6;
}
</style>
