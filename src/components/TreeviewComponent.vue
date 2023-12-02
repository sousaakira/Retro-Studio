<template>
  <ul class="treeview">
    <li v-for="node in treeData" :key="node.id">
      <div @click="handleClick(node)">
        <button @click="toggleNode(node)" v-if="node.tipo == 'diretorio'">
          <i :class="[
            'fas',
            node.expanded ? 'fa-chevron-down' : 'fa-chevron-right',
            'space'
          ]"></i>&nbsp;
          <i :class="[
            'fas',
            node.expanded ? 'fa-folder-open' : 'fa-folder'
          ]"></i>
        </button>
        <i v-if="node.tipo == 'arquivo'" class="fa fa-file"></i>
        {{ node.label }}
      </div>
      <TreeView class="click" :treeData="node.children"
        v-if="node.expanded && node.children && node.children.length > 0" />
    </li>
  </ul>
</template>

<script>
const extensoesDeImagens = ['jpg', 'jpeg', 'png', 'gif', 'bmp'];

function isImagem(fileName){
  const extensao = fileName.split('.').pop().toLowerCase();
  return extensoesDeImagens.includes(extensao);
}

export default {
  name: 'TreeView',
  props: {
    openFile: {
      type: Array,
      required: true
    },
    treeData: {
      type: Array,
      required: true
    },
  },
  methods: {
    toggleNode(node) {
      node.expanded = !node.expanded;
    },
    handleClick(node) {

      if (isImagem(node.label)) {
        this.$store.dispatch('updateFileImage', { node })
      } else {
        if (node.tipo === 'arquivo') {
          // this.openFile(node.path);
          this.$store.dispatch('updateFileRequest', { node })
        }
      }
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
</style>
