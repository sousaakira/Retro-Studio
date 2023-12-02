<template>
  <v-layout class="rounded rounded-md">

    <v-navigation-drawer>
      <div class="painel painel-bar">
        <ul class="tools">
          <li @click="openModalProject"><i class="fa fa-folder"></i></li>
          <li @click="openModalSetings"><i class="fa fa-gears"></i></li>
          <li class="right-align"><i class="fa fa-user"></i></li>
          <li class="right-align"><i class="fa fa-search"></i></li>
        </ul>
      </div>

      <MenuComponent :openFile="openFile" />
      
    </v-navigation-drawer>

    <v-app-bar :elevation="0" density="compact" class="panel-top">
      <v-card>
        <TabsComponet :tabRef="tabRef" ref="openTabRef" />
      </v-card>

      <template v-slot:append>
        <!-- <v-icon icon="fas fa-play fa-spin" class="play-icon" @click="playApp()" /> -->
        <v-icon icon="fas fa-play" class="play-icon" @click="playApp()" />
      </template>
    </v-app-bar>

    <v-main class="container">
      <CodeEditor ref="codeEditorRef" :msg="contentFile" :sendSave="sendSave" />
    </v-main>

    <v-footer app name="footer">
      teste
    </v-footer>
  </v-layout>
  
  <!-- Componente do Modal -->
  <Modal ref="project" title="Project Manage" w="1024px" h="600px">
    <!-- Conteúdo do modal aqui -->
    <p>Project Manage</p>
    <Project />
  </Modal>

  <Modal ref="modalSet" title="Setings" w="800px" h="600px">
    <!-- Conteúdo do modal aqui -->
    <p>Modal de configurações</p>

  </Modal>

  <Modal ref="modaImage" title="Image file" w="800px" h="600px" >
    <p>Image file</p>
    <img :src="'custom://'+ dataImage.node.path" alt="">
  </Modal>

</template>

<script setup>
import path from 'path'
import CodeEditor from './components/CodeEditor.vue'
import Modal from './components/ModalPage.vue';
import Project from './components/ProjectSetings.vue'
import TabsComponet from './components/TabsComponet.vue';

// eslint-disable-next-line no-unused-vars
import { setDataTab } from './data/localstorage.js'
import MenuComponent from './components/MenuComponent.vue'
import { ref, defineExpose, onMounted } from 'vue'
import { useStore } from 'vuex';
const store = useStore();

const contentFile = ref('')
const project = ref(null)
const modalSet = ref(null)
const modaImage = ref(null)
const dataImage = ref(null)


const openModalProject = () =>{
  try {
    project.value.openModal()
  } catch (error) {
    console.log('Erro on openModalProject: ', error)
  }
}

const openModalSetings = () =>{
  try {
    modalSet.value.openModal()
    
  } catch (error) {
    console.log('Erro on openModalSetings: ', error)
  }
}

const openModalImage = () => {
  try {
    modaImage.value.openModal()
  } catch (error) {
    console.log('Error on openModalImage', error)
  }
}

const codeEditorRef = ref(null)
const openTabRef = ref(null)

// eslint-disable-next-line no-unused-vars
const playApp = () => {
  try {
    codeEditorRef.value.playApp() // Chame a função playApp do componente filho
  } catch (error) {
    console.log('Erro on playApp: ', error)
  }
}


const tabRef = ref([])

// 


const openFile = (filePath) => {
  // console.log('> ',filePath)
  try {
    tabRef.value = []
    const fileName = path.basename(filePath)
    contentFile.value = filePath
    setDataTab(fileName, filePath)
    // getTabs(fileName)
    openTabRef.value.openTab(fileName)
  
    window.ipc.send('open-file', filePath)
    window.ipc.on('receive-file', result => {
      codeEditorRef.value.getCodFile(result)
    })
  } catch (error) {
    console.log('Error on openFile: ', error)
  }
}


const reguisterImage = () => {
  const unregister = store.watch(
    (state) => state.imageRequest,
    (newData) => {
      dataImage.value = newData
      openModalImage()
    }
  )
  return unregister;
}

const reguisterTab = () => {
  const unregister = store.watch(
    (state) => state.tabRequest,
    (newData) => {
      console.log('hfajs', newData.tabFile)
      preSave()
      openFile(newData.tabFile)
    }
  )
  return unregister;
}

onMounted(() => {
  try {
    // openModalProject()
    reguisterImage()
    reguisterTab()
  } catch (error) {
    console.log('Erro on onMounted: ', error)
  }
})

const preSave = () => {
  try {
    codeEditorRef.value.sendSave()
  } catch (error) {
    console.log('Erro on preSave: ', error)
  }
}

defineExpose({
  openFile
})

</script>

<style>
  #app {
    font-family: Avenir, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
</style>
