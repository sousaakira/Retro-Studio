<template>
  <codemirror 
    v-model="code"
    style="height: 91.6vh; border: none;" 
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
import { defineComponent, ref, shallowRef } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
// import { cpp } from '@codemirror/lang-cpp'
import { oneDark } from '@codemirror/theme-one-dark'

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
    const extensions = [javascript(), html(), oneDark]

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

    return {
      code,
      extensions,
      handleReady,
      playApp,
      getCodFile,
      eventCode
    }
  }
})
</script>