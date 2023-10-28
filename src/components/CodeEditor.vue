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
  mounted() {
    // handle reply from the backend
    window.ipc.on('READ_FILE', (payload) => {
      console.log(payload.content);
    });
  },
  methods: {
    readFile(path) {
      // ask backend to read file
      const payload = { path };
      window.ipc.send('READ_FILE', payload);
    },
  },
  setup(props) {
    const code = ref(props.msg)
    // const { ipcRenderer } = require('electron');

    const extensions = [html(), javascript(), oneDark]

    // Codemirror EditorView instance ref
    const view = shallowRef()
    const handleReady = (payload) => {
      view.value = payload.view
    }

    const playApp = () => {
      console.log(code.value)
      window.ipc.send('run-game', code.value);
      // ipcRenderer.send('play', code.value)
    }

    const eventCode = (event) => {
      console.log(event)
    }

    return {
      code,
      extensions,
      handleReady,
      playApp,
      eventCode
    }
  }
})
</script>