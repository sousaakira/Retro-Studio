<template>
  <ul class="treeview">
    <li v-for="node in treeData" :key="node.id" :class=" node.tipo == 'arquivo'?  'margen' : ''">
      <div @click="handleClick(node)">
        <button @click="toggleNode(node)" v-if="node.tipo == 'diretorio'">
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
      <TreeView class="click" :treeData="node.children"
        v-if="node.expanded && node.children && node.children.length > 0" />
    </li>
  </ul>
</template>

<script>
import { isFile, obterIconePorExtensao } from '../plugins/icons'
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
    },
    getIcons(fileName){

      if (isFile(fileName)) {
        const icone = obterIconePorExtensao(fileName);
        console.log(`Ícone correspondente à extensão ${icone}`);
        return icone
      } else {
        console.log('O arquivo não tem uma extensão suportada.');
        console.log('Icon >>>> ', fileName)
        return "fa-regular fa-file"
      }
      // 'fa fa-file' :
      // "fa-solid fa-h"
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
</style>
