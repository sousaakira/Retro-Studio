<template>
  <v-layout class="rounded rounded-md">

    <v-navigation-drawer>
      <v-list>
        <v-list-item title="Navigation drawer"></v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-app-bar :elevation="0"  density="compact">

      <template v-slot:append>
        <v-icon icon="fas fa-play" @click="playApp()" />
      </template>

    </v-app-bar>

    <v-main class="container">
      <CodeEditor ref="codeEditorRef" msg="Ola mundo vei"/>
    </v-main>
  
    <!-- <v-main class="d-flex align-center justify-center" style="min-height: 300px;">
      <CodeEditor msg="Ola mundo vei"/>
    </v-main> -->

    <v-footer
      app
      name="footer"
    >
    teste
    </v-footer>
  </v-layout>
</template>

<script setup>
  import CodeEditor from './components/CodeEditor.vue'
  import { ref } from 'vue'

  const codeEditorRef = ref(null)

  const playApp = () => {
    codeEditorRef.value.playApp() // Chame a função playApp do componente filho
  }

</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
