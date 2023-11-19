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

      <template v-if="tvModelLoaded">
          <tree-view
            class="painel-bar"
            :initial-model="tvModel"
            :model-defaults="modelDefaults"
            :skin-class="skinClass"
            :getSelected="selectedNode"
            @treeNodeClick="handleClick"
          ></tree-view>
      </template>
      
    </v-navigation-drawer>

    <v-app-bar :elevation="0" density="compact">
      <v-card>
        <v-tabs
          v-model="tab"

        >
          <v-tab
            v-for="n in 3"
            :key="n"
            :value="n"
          >
            Item {{ n }} <a @click="removTab(n)">x</a>
          </v-tab>
        </v-tabs>
        <!-- <v-card-text class="text-center">
          <v-btn
            :disabled="!length"
            variant="text"
            @click="length--"
          >
            Remove Tab
          </v-btn>
          <v-divider
            class="mx-4"
            vertical
          ></v-divider>
          <v-btn
            variant="text"
            @click="length++"
          >
            Add Tab
          </v-btn>
        </v-card-text> -->
      </v-card>

      <template v-slot:append>

      
        <v-icon icon="fas fa-play" class="play-icon" @click="playApp()" />
      </template>

    </v-app-bar>

    <v-main class="container">
      <CodeEditor ref="codeEditorRef" :msg="contentFile" />
    </v-main>

    <v-footer app name="footer">
      teste

      <!-- Seu conteúdo principal aqui -->
      <button @click="openModalProject">Abrir Modal</button>
      <button @click="openModalSetings">Abrir Modal2</button>
    </v-footer>
  </v-layout>
  
  <!-- Componente do Modal -->
  <Modal ref="project" title="Project Manage" w="1024px" h="600px">
    <!-- Conteúdo do modal aqui -->
    <p>Project Manage</p>

  </Modal>

  <Modal ref="modalSet" title="Setings" w="800px" h="600px">
    <!-- Conteúdo do modal aqui -->
    <p>Modal de configurações</p>

  </Modal>


</template>

<script setup>
import CodeEditor from './components/CodeEditor.vue'
// import RecursiveList from './components/RecursiveList.vue'
import Modal from './components/ModalPage.vue';


import { ref, onMounted, watch } from 'vue'

const codeEditorRef = ref(null)
const contentFile = ref('')
// const files = ref([])
const tab = ref()
const project = ref(null)
const modalSet = ref(null)

const openModalProject = () =>{
  project.value.openModal()
}

const openModalSetings = () =>{
  modalSet.value.openModal()
}



const playApp = () => {
  codeEditorRef.value.playApp() // Chame a função playApp do componente filho
}

import { TreeView } from "@grapoza/vue-tree"


const removTab = () => {
  console.log('dflskffjals')
}


const modelDefaults = ref({

  customizations: {
    classes: {
      // treeViewNodeSelfExpander: 'action-button',
      treeViewNodeSelfExpandedIndicator: 'fas fa-chevron-right',
      // treeViewNodeSelfAction: 'action-button',
      treeViewNodeSelfAddChildIcon: 'fas fa-plus-circle',
      treeViewNodeSelfDeleteIcon: 'fas fa-file',
      treeViewNodeSelfSpacer: 'fas fa-file'
   
    }
  },
  draggable: true,
  allowDrop: true,
  state: {
    expanded: true
  }
});

const skinClass = ref("grayscale");

const tvModel = ref([]);



const handleClick = (event) => {
  console.log(event.path)
  event.tipo == 'arquivo' ? openFile(event.path) : ''
}

const openFile = (path) => {
  contentFile.value = path
  window.ipc.send('open-file', path)
  window.ipc.on('receive-file', result => {
    console.log(result)
    codeEditorRef.value.getCodFile(result)
  })
}

watch(tvModel, (newVal, oldVal) => {
  console.log('tvModel mudou:', newVal);
  console.log('tvModel oldVal:', oldVal);
});
const tvModelLoaded = ref(false);
onMounted(() => {
  reloadFiles()

  window.ipc.on('read-files', result => {
    console.log('Files: ', result.children)
    tvModelLoaded.value = true
    const project = [{ id: 'project', label: 'Project folder' }];
    project[0].children = result.children;
    tvModel.value = project
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
