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
  const fileModify = ref(false)
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
      const project = JSON.parse(localStorage.getItem('project'))
      window.ipc.send('run-game', project);
    })

    initCode.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      save()
    })

    initCode.getModel().onDidChangeContent(() => {
      // A lógica que você deseja executar quando o conteúdo do modelo é alterado
      console.log('Conteúdo do modelo foi alterado:');
      fileModify.value = true
    });

  })
  
  // eslint-disable-next-line no-unused-vars
  const getCodFile = async (codeFile) => {
    await initCode.setValue(codeFile)
    // console.log('klsdnfjasdhfjakds', codeFile, props.msg)
  }
    
  const playApp = () => {
    // console.log(code.value)
    const project = JSON.parse(localStorage.getItem('project'))
    window.ipc.send('run-game', project);
  }

  const save = () => {
    const cod = initCode.getValue()
    console.log('Salvando', cod)
    // console.log('Salvando length', cod.length)
    // console.log('Salvando', props.msg)
    if(cod.length > 0){
      if(props.msg != undefined && props.msg != ''){
        return window.ipc.send('save-file',{cod, path: props.msg})
      }
      fileModify.value = false
      // alert('Empty file')
    }
    console.log('Não savar conteudo vazio')
  }

  const sendSave = () => {
    console.log('Send Save: ')
    save()
  }
  
  defineExpose({
    getCodFile,
    playApp,
    sendSave
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