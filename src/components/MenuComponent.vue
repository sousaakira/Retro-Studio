<template>
  <template v-if="tvModelLoaded">
    <tree-view
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
    window.ipc.on('read-files', result => {
      console.log('Files: ', result.children)
      tvModelLoaded.value = true
      const project = [
        {
          id: 'project',
          label: 'Project folder',
          expanded: true,
          isNodeExpanded: true,
          children: result.children
        }
      ];
      tvModel.value = project
    })

  })

  const reloadFiles = () => {
    window.ipc.send('req-projec', {
      path: '../../../../../../../home/akira/sgdk-skeleton'
    })
  }

  // defineExpose({
  //   openFile
  // })

</script>