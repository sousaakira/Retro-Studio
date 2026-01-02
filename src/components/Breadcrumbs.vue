<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="breadcrumbs" v-if="items.length > 0">
    <div
      v-for="(item, index) in items"
      :key="index"
      class="breadcrumb-item"
      :class="{ active: index === items.length - 1 }"
      @click="navigateTo(item, index)"
    >
      <i v-if="index === 0" class="fas fa-home"></i>
      <span>{{ item.label }}</span>
      <i v-if="index < items.length - 1" class="fas fa-chevron-right separator"></i>
    </div>
  </div>
</template>

<script setup>
/* eslint-disable no-undef, vue/multi-word-component-names */

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['navigate'])

const navigateTo = (item, index) => {
  if (index < props.items.length - 1) {
    emit('navigate', { item, index })
  }
}
</script>

<style scoped>
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: #252525;
  border-bottom: 1px solid #333;
  font-size: 12px;
  overflow-x: auto;
  white-space: nowrap;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 3px;
  transition: all 0.2s;
}

.breadcrumb-item:hover:not(.active) {
  background: #2a2a2a;
  color: #ccc;
}

.breadcrumb-item.active {
  color: #0066cc;
  cursor: default;
}

.breadcrumb-item i:not(.separator) {
  color: #0066cc;
}

.separator {
  color: #555;
  font-size: 10px;
  margin-left: 4px;
}
</style>
