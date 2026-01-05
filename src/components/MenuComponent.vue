<template>
  <div>
    <TreeviewComponent :treeData="tvModel" :openFile="openFile" />
  </div>
</template>

<script setup>
  import TreeviewComponent from './TreeviewComponent.vue'
  import { useStore } from 'vuex';
  const store = useStore();  
  // eslint-disable-next-line no-unused-vars
  import { ref, onMounted, onUnmounted, defineProps, defineExpose, computed } from 'vue'
  const tvModel = ref([]);
  const props = defineProps({
    openFile: {
      type: Function,
      required: true
    }
  });

  const project = computed({
    get: () => store.state.projectConfig,
    set: (val) => store.commit('setProjectConfig', val)
  })
  const openFile = (event) => {
    event.tipo == 'arquivo' ? props.openFile(event.path) : ''
  }

  let unregisterWatcher = null

  const registerOpenFile = () => {
    if (unregisterWatcher) {
      unregisterWatcher()
    }
    unregisterWatcher = store.watch(
      (state) => state.fileRequest,
      (newData) => {
        if (newData?.node) {
          openFile(newData.node)
        }
      }
    )
  }

  onMounted(() => {
    const projectData = localStorage.getItem('project')
    if(projectData){
      console.log('Tem')
      const parsed = JSON.parse(projectData)
      store.commit('setProjectConfig', parsed)
      reloadFiles()
    }

    loadFiles()
    registerOpenFile()
  })

  onUnmounted(() => {
    if (unregisterWatcher) {
      unregisterWatcher()
      unregisterWatcher = null
    }
    if (ipcReadHandler) {
      window.ipc?.off?.('read-files', ipcReadHandler)
      ipcReadHandler = null
    }
  })

  let ipcReadHandler = null

  const loadFiles = () => {
    if (!ipcReadHandler) {
      ipcReadHandler = (data) => {
        // Agora o retorno é { estrutura, config }
        const result = data?.estrutura || data
        const config = data?.config

        if (config && project.value.path) {
          const updatedProject = { ...project.value, ...config }
          store.commit('setProjectConfig', updatedProject)
          localStorage.setItem('project', JSON.stringify(updatedProject))
        }

        console.log('Files >>>: ', result.children);
        tvModel.value.splice(0, tvModel.value.length);
        tvModel.value.push({
          id: 'project',
          label: project?.value?.name || 'Project',
          expanded: true,
          isNodeExpanded: true,
          children: result.children
        });
      }
      window.ipc?.on?.('read-files', ipcReadHandler)
    }
  };

  /** load current project */
  const reloadFiles = () => {
    window.ipc.send('req-projec', {
      path: project.value.path
    })
  }

  defineExpose({
    openFile
  })
</script>