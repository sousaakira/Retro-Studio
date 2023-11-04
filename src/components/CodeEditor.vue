<template>
  <codemirror 
    v-model="code"
    style="height: 91.6vh; border: none; font-size: 16px" 
    :autofocus="true"
    :indent-with-tab="true" 
    :tab-size="2" 
    :extensions="extensions" 
    @ready="handleReady" 
    @change="eventCode('change', $event)"
    @focus="eventCode('focus', $event)" 
    @blur="eventCode('blur', $event)" 
  />
</template>

<script>
import { defineComponent, ref, shallowRef, onMounted } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { cpp } from '@codemirror/lang-cpp'
import { oneDark } from '@codemirror/theme-one-dark'

const laguage = {
  html:  html(),
  js: javascript(),
  cpp: cpp()
}
export default defineComponent({
  name: 'HelloWorld',
  props: {
    msg: String
  },
  components: {
    Codemirror
  },
  setup(props) {

    const code = ref(props.msg)
    const extensions = ref([])

    // Codemirror EditorView instance ref
    const view = shallowRef()
    const handleReady = (payload) => {
      view.value = payload.view
    }

    const playApp = () => {
      console.log(code.value)
      window.ipc.send('run-game', code.value);
    }

    const getCodFile = (codeFile) => {
      code.value = codeFile
      console.log(code)
    }
    

    const eventCode = (event) => {
      console.log(event)
    }
    onMounted(() => {
      extensions.value = [laguage.js, oneDark]
    })

    return {
      code,
      extensions,
      handleReady,
      playApp,
      getCodFile,
      eventCode
    }
  },

})
</script>

<style scoped>
/* Defina as fontes e tamanhos de fontes aqui */
.codemirror {
  font-family: 'Sua Fonte', sans-serif;
  /* Substitua 'Sua Fonte' pela fonte desejada */
  font-size: 16px;
  /* Tamanho da fonte em pixels */
}
</style>