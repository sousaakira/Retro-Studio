<template>
  <div class="resources-panel">
    <AssetsManager ref="assetsManagerRef" />
  </div>
</template>

<script setup>
import { ref, defineExpose, defineAsyncComponent } from 'vue'
const AssetsManager = defineAsyncComponent(() => import('./AssetsManager.vue'))

const assetsManagerRef = ref(null)

defineExpose({
  assetsManagerRef
})
</script>

<style scoped>
.resources-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  border-right: 1px solid #333;
}
</style>
