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

      <MenuComponent
        :openFile="openFile"
      />
      
    </v-navigation-drawer>

    <v-app-bar :elevation="0" density="compact" class="panel-top">
      <v-card>

        <div class="tabs">
          <div v-for="(tab, index) in tabRef" :key="tab.name" @click="selectTab(index, tab)" :class="{ 'tab': true, 'active': activeTab === index }">
            {{ tab.name }} 
            <a class="tab-close-btn" @click="removTab(index)"><i class="fa fa-close"></i></a>
          </div>
        </div>
      
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

</template>

<script setup>
import path from 'path'
import CodeEditor from './components/CodeEditor.vue'
import Modal from './components/ModalPage.vue';
import Project from './components/ProjectSetings.vue'

// eslint-disable-next-line no-unused-vars
import { setDataTab, updateTabs } from './data/localstorage.js'
import MenuComponent from './components/MenuComponent.vue'
import { ref, defineExpose, onMounted } from 'vue'

const tabRef = ref([])
const contentFile = ref('')
// const files = ref([])
// const tab = ref()
const project = ref(null)
const modalSet = ref(null)
const activeTab = ref(0);

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

const codeEditorRef = ref(null)

// eslint-disable-next-line no-unused-vars
const playApp = () => {
  try {
    codeEditorRef.value.playApp() // Chame a função playApp do componente filho
  } catch (error) {
    console.log('Erro on playApp: ', error)
  }
}

const currentTab = ref('')
const selectTab = (index, id) => {
  try {
    activeTab.value = index;
    preSave()
    const result = tabRef.value.find(tab => tab.name === id.name)
    console.log('currentTab.value: ', currentTab.value, '  id ', id.name)
    currentTab.value === id.name ? '' : openFile(result?.path)
    currentTab.value = id.name

  } catch (error) {
    console.log('Erro on selectTab: ', error);
  }
};

const removTab = (index) => {
  try {
    const novoArray = tabRef.value.filter((item, i) => i !== index);
    console.log('Current Tab remove ', novoArray);
    updateTabs(novoArray);
    getTabs()
  } catch (error) {
    console.log('Erro on removeTab: ', error);
  }
};

const tabIndex = (id) => {
  try{
    preSave()
    openFile(tabRef.value[id]?.path)
  }catch(error){
    console.log('Erro on current Tab: ', error)
  }
}

const getTabs = (name = '') => {
  try {
    const resTab = localStorage.getItem('tabs')
    tabRef.value = JSON.parse(resTab)
    const existsIndex = tabRef.value.findIndex(tab => tab?.name === name);
    activeTab.value = existsIndex
  } catch (error) {
    console.log('Erro on getTabs: ', error)
  }
}


const openFile = (filePath) => {
  try {
    tabRef.value = []
    const fileName = path.basename(filePath)
    contentFile.value = filePath
    setDataTab(fileName, filePath)
    getTabs(fileName)
  
    window.ipc.send('open-file', filePath)
    window.ipc.on('receive-file', result => {
      codeEditorRef.value.getCodFile(result)
    })
  } catch (error) {
    console.log('Error on openFile: ', error)
  }
}

onMounted(() => {
  try {
    getTabs()
    activeTab.value = 0
    tabIndex(0)
    openModalProject()
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
