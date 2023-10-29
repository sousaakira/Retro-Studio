<template>
  <v-list>
    <template v-for="item in files" :key="item.nome">
      <div @click="abrirArquivo(item.path)">
        <i :class="getItemIcon(item)" ></i> {{ item.nome }} <br>
      </div>
      <v-list-item v-if="item.tipo === 'diretorio' && item.conteudo">
        <RecursiveList :files="item.conteudo" :openFile="openFile" />
      </v-list-item>
    </template>
  </v-list>
</template>

<script>
  export default {
    props: {
      files: Array,
      openFile: Function,
    },
    methods: {
    abrirArquivo(caminho) {
      this.openFile(caminho);
    },
    getItemIcon(item){
      return item.tipo === 'diretorio' ? 'fa fa-folder' : 'fa fa-file';
    }
  },
  }
</script>