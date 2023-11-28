<template>
  <div>
    <Treeview :treeData="tvModel" />
  </div>
</template>

<script setup>
  import Treeview from './Treeview.vue';
  import { ref, onMounted, defineProps } from 'vue'
  const tvModel = ref([]);
  const props = defineProps({
    openFile: String
  });

  // eslint-disable-next-line no-unused-vars
  const handleClick = (event) => {
  console.log(event)
  event.tipo == 'arquivo' ? props.openFile(event.path) : ''
}

  onMounted(() => {
    reloadFiles()
    loadFiles()
  })

  const loadFiles = () => {
    window.ipc.on('read-files', result => {
      console.log('Files: ', result.children);
      // Limpa o array atual
      tvModel.value.splice(0, tvModel.value.length);

      // Adiciona novos elementos
      tvModel.value.push({
        id: 'project',
        label: 'Project folder',
        expanded: true,
        isNodeExpanded: true,
        children: result.children
      });

    });
  };

  const reloadFiles = () => {
    const project = JSON.parse(localStorage.getItem('project'))
    window.ipc.send('req-projec', {
      path: project.path
    })
  }


</script>


<!-- <template>
  <template v-if="tvModelLoaded">
    <tree-view
    key="unique-key"
    class="painel-bar"
    :options="treeOptions"
    :initial-model="tvModel"
    :model-defaults="modelDefaults"
    :skin-class="skinClass"
    :aria-expanded="tvModel"
    :getSelected="selectedNode"
    @treeNodeClick="handleClick"
    @treeNodeExpandedChange="expandedChange"
  ></tree-view>

  </template>
</template>

<script setup>
  import { TreeView } from "@grapoza/vue-tree"
  import { ref, onMounted, defineProps } from 'vue'

  // const { props } = defineProps(['funcaoDoPai']);

  const props = defineProps({
    openFile: String
  });
  
  const expandedChange = (event) => {
    console.log('vendoto', event)
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
    allowDrop: ['before', 'after', 'child', 'all'],
    state: {
      expanded: true
    },
    treeNodeSpec: {
      focusable: true,
      expanded: true
    }
  });


  const selectedNode = () => {
    console.log('node selected: ')
  }

  const skinClass = ref("grayscale");
  const tvModel = ref([]);

  const handleClick = (event) => {
    console.log(event)
    event.tipo == 'arquivo' ? props.openFile(event.path) : ''
  }

  const tvModelLoaded = ref(false);

  onMounted(() => {
    reloadFiles()
    loadFiles()

  })

  const loadFiles = () => {
    window.ipc.on('read-files', result => {
      console.log('Files: ', result.children);
      // Limpa o array atual
      tvModel.value.splice(0, tvModel.value.length);

      // Adiciona novos elementos
      tvModel.value.push({
        id: 'project',
        label: 'Project folder',
        expanded: true,
        isNodeExpanded: true,
        children: result.children
      });

      // Atualiza o estado carregado
      tvModelLoaded.value = true;
    });
  };
 

  const reloadFiles = () => {
    const project = JSON.parse(localStorage.getItem('project'))
    window.ipc.send('req-projec', {
      path: project.path
    })
  }

  // defineExpose({
  //   openFile
  // })

</script> -->