<template>
   <div class="tabs">
      <div v-for="(tab, index) in tabRef" :key="tab.name" @click="selectTab(index, tab)" :class="{ 'tab': true, 'active': activeTab === index }">
        
        <i :class="getIcons(tab.name)"></i> <span>{{ tab.name }}</span>
        
        <a class="tab-close-btn" @click="removTab(index)"><i class="fa fa-close"></i></a>
      </div>
    </div>
</template>


<script setup>
  import { isFile, obterIconePorExtensao } from '../plugins/icons'
  import { ref, defineProps, onMounted, defineExpose } from 'vue'
  import { updateTabs } from '../data/localstorage.js'
  import { useStore } from 'vuex';
  const store = useStore();

  const props = defineProps({
    tabRef: Array,
    openTab: Function
  });
  
  const activeTab = ref(0);
  const tabRef = ref(props.tabRef)

  const currentTab = ref('')


  const openTab = () => {
    getTabs()
  }

  onMounted(() => {
    try {
      getTabs()
      activeTab.value = 0
      tabIndex(0)
      openStartFile()
    } catch (error) {
      console.log('Erro on onMounted: ', error)
    }
  })

  const openStartFile = () => {
    try {
      console.log(tabRef.value[0])
      store.dispatch('updateTab', { tabFile: tabRef?.value[0]?.path })
    } catch (error) {
      console.log('Erro on open start file: ', error)
    }
  }

  const selectTab = (index, id) => {
    try {
      activeTab.value = index;
      const result = tabRef.value.find(tab => tab.name === id.name)
      console.log('currentTab.value: ', currentTab.value, '  id ', id.name)
      currentTab.value === id.name ? '' : store.dispatch('updateTab', { tabFile: result?.path })

      currentTab.value = id.name

    } catch (error) {
      console.log('Erro on selectTab: ', error);
    }
  };

  const removTab = (index) => {
    try {
      const novoArray = tabRef.value.filter((item, i) => i !== index);
      console.log('Current Tab remove ', novoArray);
      updateTabs(novoArray);
      getTabs()
    } catch (error) {
      console.log('Erro on removeTab: ', error);
    }
  };

  const tabIndex = (id) => {
    try {
      console.log('tabindex: ',id)
    } catch (error) {
      console.log('Erro on current Tab: ', error)
    }
  }


  const getTabs = (name = '') => {
    try {
      const resTab = localStorage.getItem('tabs')
      tabRef.value = JSON.parse(resTab)
      const existsIndex = tabRef.value.findIndex(tab => tab?.name === name);
      activeTab.value = existsIndex
    } catch (error) {
      console.log('Erro on getTabs: ', error)
    }
  }

  const getIcons = (fileName) => {

    if (isFile(fileName)) {
      const icone = obterIconePorExtensao(fileName);
      console.log(`Ícone correspondente à extensão ${icone}`);
      return icone
    } else {
      console.log('O arquivo não tem uma extensão suportada.');
      console.log('Icon >>>> ', fileName)
      return "fa-regular fa-file"
    }
    // 'fa fa-file' :
    // "fa-solid fa-h"
  }


  defineExpose({
    openTab
  })
</script>