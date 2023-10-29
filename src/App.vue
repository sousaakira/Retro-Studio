<template>
  <v-layout class="rounded rounded-md">

    <v-navigation-drawer>
      <v-list>
        <v-list-item>
          <v-list-title>Project <i class="fa fa-rotate" style="cursor: pointer;" @click="reloadFiles()"></i></v-list-title>
          <template v-if="files.length">
            <RecursiveList :files="files" :openFile="openFile"/>
          </template>
          <template v-else>
            Nenhum arquivo ou diretório encontrado.
          </template>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-app-bar :elevation="0" density="compact">

      <template v-slot:append>
        <v-icon icon="fas fa-play" @click="playApp()" />
      </template>

    </v-app-bar>

    <v-main class="container">
      <CodeEditor ref="codeEditorRef" :msg="contentFile" />
    </v-main>

    <!-- <v-main class="d-flex align-center justify-center" style="min-height: 300px;">
      <CodeEditor msg="Ola mundo vei"/>
    </v-main> -->

    <v-footer app name="footer">
      teste
    </v-footer>
  </v-layout>
</template>

<script setup>
import CodeEditor from './components/CodeEditor.vue'
import RecursiveList from './components/RecursiveList.vue'

import { ref, onMounted } from 'vue'

const codeEditorRef = ref(null)
const contentFile = ref('Ola mundo vei')
const files = ref([])

const playApp = () => {
  codeEditorRef.value.playApp() // Chame a função playApp do componente filho
}

const openFile = (path) => {
  contentFile.value = path+ 'sklfjaklsfalsdfkads'
  window.ipc.send('open-file', path)
  window.ipc.on('receive-file', result => {
    console.log(result)
    codeEditorRef.value.getCodFile(result)
  })
}

onMounted(() => {
  console.log('Montando')

  reloadFiles()

  window.ipc.on('read-files', result => {
    console.log('Files: ', result.conteudo)
    files.value = result.conteudo
  })
})


const reloadFiles = () => {
  window.ipc.send('req-projec', {
    path: '../../../../../../../home/akira/sgdk-skeleton'
  })
}

</script>

<style>
  #app {
    font-family: Avenir, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
</style>
