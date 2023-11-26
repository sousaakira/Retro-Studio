<template>
  <div>
    <v-container>
      <v-row>
        <v-col cols="3" style="max-height: 500px; overflow-y: auto;">
          <div class="row">
            <div class="btn-back" @click="backDirectory(foldeName,foldeHoot)">
              <i class="fa-solid fa-arrow-up"></i>
            </div>
            <div class="btn-back" @click="setHomeFolde()">
              <i class="fa-solid fa-home"></i>
            </div>
          </div>
          <div>
            <i class="fa fa-folder-open"></i> {{ foldeName }}
          </div>   
          <div class="file-path" v-for="data in foldes" :key="data.name" @click="openFolder(data.label, data.path)">
            <i class="fa fa-folder"></i> {{data.label}}
          </div>
        </v-col>

        <v-col cols="9">Projetos</v-col>

      </v-row>
    </v-container>
  </div>  
</template>

<script setup>
  import {ref, onMounted} from 'vue'
  const foldeHoot = ref()
  const foldeName = ref()
  const foldes = ref([])
  const getPathLocal = () => {
    window.ipc.send('current-path', {path: 'get'})
  }
  const setHomeFolde = () => {
  window.ipc.send('get-home', { home:true })
  }

  const openFolder = (label, path) => {
    window.ipc.send('directory-navigate', {label, path})
  }

  const backDirectory = (folde, path) => {
    console.log(folde, path)
    window.ipc.send('back-directory-navigate', { folde, path })
  }

  onMounted(() => {
    getPathLocal()

    window.ipc.on('send-directory', res => {
      console.log(res)
      foldeHoot.value = res.path
      foldeName.value = res.label
      foldes.value = res.children
    })
  })

</script>

<style>

</style>