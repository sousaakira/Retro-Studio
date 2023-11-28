<template>
  <ul class="treeview">
    <li v-for="node in treeData" :key="node.id">
      <div>
        <button @click="toggleNode(node)" v-if="node.tipo == 'diretorio'">
          <i :class="{ 'fas fa-folder-open': node.expanded, 'fas fa-folder': !node.expanded }"></i>
        </button>
        <i v-if="node.tipo == 'arquivo'" class="fa fa-file"></i>
        {{ node.label }}
      </div>
      <TreeView :treeData="node.children" v-if="node.expanded && node.children && node.children.length > 0" />
    </li>
  </ul>
</template>

<script>
export default {
  name: 'TreeView',
  props: {
    treeData: {
      type: Array,
      required: true
    }
  },
  methods: {
    toggleNode(node) {
      node.expanded = !node.expanded;
    }
  }
};
</script>

<style scoped>
.treeview {
  list-style: none;
  padding-left: 12px;
}

.treeview button {
  margin-right: 5px;
  cursor: pointer;
}
</style>
