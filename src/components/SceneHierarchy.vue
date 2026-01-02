<template>
  <div class="scene-hierarchy">
    <div class="hierarchy-header">
      <h3>Scene Hierarchy</h3>
      <div class="header-actions">
        <button class="icon-btn" @click="addNode" title="Add Node">
          <i class="fas fa-plus"></i>
        </button>
        <button class="icon-btn" @click="removeNode" :disabled="!selectedNodeId" title="Remove Node">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
    
    <div class="hierarchy-tree">
      <div 
        v-for="node in sceneNodes" 
        :key="node.id"
        class="tree-node"
        :class="{ 
          selected: selectedNodeId === node.id,
          expanded: expandedNodes.includes(node.id)
        }"
        :style="{ paddingLeft: `${getNodeDepth(node) * 16}px` }"
        @click="selectNode(node.id)"
        @dblclick="toggleExpand(node.id)"
      >
        <i 
          class="fas"
          :class="node.children && node.children.length > 0 
            ? (expandedNodes.includes(node.id) ? 'fa-chevron-down' : 'fa-chevron-right')
            : 'fa-circle'"
          @click.stop="toggleExpand(node.id)"
        ></i>
        <i class="node-icon" :class="getNodeIcon(node.type)"></i>
        <span class="node-name">{{ node.name || node.type }}</span>
        <span class="node-type">{{ node.type }}</span>
      </div>
      
      <div v-if="sceneNodes.length === 0" class="empty-state">
        <p>No nodes in scene</p>
        <button class="btn-add" @click="addNode">Add First Node</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useStore } from 'vuex'

const store = useStore()

const expandedNodes = ref([])
const selectedNodeId = ref(null)

const sceneNodes = computed(() => {
  return store.state.sceneNodes || []
})

const getNodeDepth = (node, depth = 0) => {
  // Calculate depth for tree visualization
  return depth
}

const getNodeIcon = (type) => {
  const icons = {
    sprite: 'fa-image',
    tile: 'fa-th',
    entity: 'fa-cube',
    camera: 'fa-video',
    background: 'fa-layer-group',
    sound: 'fa-volume-up',
    script: 'fa-code',
    group: 'fa-folder'
  }
  return icons[type] || 'fa-circle'
}

const selectNode = (nodeId) => {
  selectedNodeId.value = nodeId
  store.dispatch('updateSelectedNode', sceneNodes.value.find(n => n.id === nodeId))
}

const toggleExpand = (nodeId) => {
  const index = expandedNodes.value.indexOf(nodeId)
  if (index > -1) {
    expandedNodes.value.splice(index, 1)
  } else {
    expandedNodes.value.push(nodeId)
  }
}

const addNode = () => {
  const newNode = {
    id: `node_${Date.now()}`,
    type: 'entity',
    name: 'New Node',
    x: 0,
    y: 0,
    width: 16,
    height: 16,
    properties: {},
    children: []
  }
  
  store.dispatch('addSceneNode', newNode)
  selectNode(newNode.id)
}

const removeNode = () => {
  if (selectedNodeId.value) {
    store.dispatch('removeSceneNode', selectedNodeId.value)
    selectedNodeId.value = null
  }
}

// Watch for selection changes from viewport
watch(() => store.state.selectedNode, (node) => {
  if (node) {
    selectedNodeId.value = node.id
  }
})
</script>

<style scoped>
.scene-hierarchy {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-right: 1px solid #333;
}

.hierarchy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.hierarchy-header h3 {
  margin: 0;
  font-size: 14px;
  color: #ccc;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 3px;
  transition: all 0.2s;
}

.icon-btn:hover:not(:disabled) {
  background: #333;
  color: #fff;
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hierarchy-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
  user-select: none;
}

.tree-node:hover {
  background: #2a2a2a;
}

.tree-node.selected {
  background: #0066cc;
  color: white;
}

.tree-node.expanded {
  /* Additional styles for expanded nodes */
}

.node-icon {
  font-size: 12px;
  color: #888;
}

.tree-node.selected .node-icon {
  color: white;
}

.node-name {
  flex: 1;
  font-size: 13px;
  color: #ccc;
}

.tree-node.selected .node-name {
  color: white;
}

.node-type {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
}

.tree-node.selected .node-type {
  color: rgba(255, 255, 255, 0.7);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #666;
  text-align: center;
}

.empty-state p {
  margin: 0 0 16px 0;
  font-size: 14px;
}

.btn-add {
  background: #0066cc;
  border: none;
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-add:hover {
  background: #0088ff;
}
</style>
