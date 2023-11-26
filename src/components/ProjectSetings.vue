<template>
  <div>
    <v-container>
      <v-row>
        <v-col cols="3">
          <div>
            <a class="btn-back">..</a>
          </div>
          <div class="file-path">
            <i class="fa fa-folder"></i> Path
          </div>
        </v-col>

        <v-col cols="9">Projetos</v-col>

      </v-row>
    </v-container>
  </div>  
</template>

<script setup>
  import {onMounted} from 'vue'
  
  const getPathLocal = () => {
    window.ipc.send('current-path', {path: 'get'})
  }

  onMounted(() => {
    getPathLocal()
  })

</script>

<style>

</style>