<template>
  <div>
    <div ref="editor" style="height: 91.6vh; border: none; font-size: 16px"></div>
  </div>
</template>

<script setup>
  import * as monaco from 'monaco-editor'
 
  import { ref, onMounted, defineProps, defineExpose } from 'vue'
  const editor = ref()
  const code = ref('')
  // const codEditor = ref()

  const props = defineProps({
    msg: String
  });

  let initCode = ''
  onMounted(() => {
    initCode = monaco.editor.create(editor.value, {
      value: code.value,
      language: 'c',
      theme: 'vs-dark',
      fontSize: 19,
      fontFamily: ['Courier New', 'Courier', 'monospace'],
      automaticLayout: true,
      verticalHasArrows: true,
    })

    initCode.addCommand(monaco.KeyCode.F5, () => {
      alert('Compile options')
    })

    initCode.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      save()
    })

  })
  
  const getCodFile = (codeFile) => {
    initCode.setValue(codeFile)
    console.log('klsdnfjasdhfjakds', codeFile, props.msg)
  }
    
  const playApp = () => {
    console.log(code.value)
    window.ipc.send('run-game', code.value);
  }

  const save = () => {
    const cod = initCode.getValue()
    // console.log('Salvando', cod)
    console.log('Salvando', props.msg)
    if(props.msg != undefined && props.msg != ''){
      return window.ipc.send('save-file',{cod, path: props.msg})
    }
    
    alert('Empty file')
    
  }
  
  defineExpose({
    getCodFile,
    playApp
  })
</script>

<style scoped>
/* Defina as fontes e tamanhos de fontes aqui */
.editor {
  font-family: 'Courier New', Courier, monospace;
  font-family: 'Sua Fonte', sans-serif;
  /* Substitua 'Sua Fonte' pela fonte desejada */
  font-size: 16px;
  /* Tamanho da fonte em pixels */
}
</style>