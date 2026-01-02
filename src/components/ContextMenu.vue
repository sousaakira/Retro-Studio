<template>
  <div
    v-if="show"
    class="context-menu"
    :style="{ top: y + 'px', left: x + 'px' }"
    @click.stop
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="context-menu-item"
      :class="{ disabled: item.disabled, separator: item.separator }"
      @click="!item.disabled && !item.separator && handleClick(item)"
    >
      <i v-if="item.icon" :class="item.icon"></i>
      <span>{{ item.label }}</span>
      <span v-if="item.shortcut" class="shortcut">{{ item.shortcut }}</span>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  show: Boolean,
  x: Number,
  y: Number,
  items: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'action'])

const handleClick = (item) => {
  emit('action', item.action)
  emit('close')
}

const handleClickOutside = (e) => {
  if (typeof e.button === 'number' && e.button !== 0) {
    return
  }
  if (props.show && !e.target.closest('.context-menu')) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.context-menu {
  position: fixed;
  background: #252525;
  border: 1px solid #333;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 10001;
  min-width: 180px;
  padding: 4px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: #ccc;
  cursor: pointer;
  font-size: 13px;
  border-radius: 3px;
  transition: all 0.2s;
}

.context-menu-item:hover:not(.disabled):not(.separator) {
  background: #333;
  color: #fff;
}

.context-menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.context-menu-item.separator {
  height: 1px;
  padding: 0;
  margin: 4px 0;
  background: #333;
  cursor: default;
}

.context-menu-item i {
  width: 16px;
  text-align: center;
  color: #888;
}

.context-menu-item:hover:not(.disabled):not(.separator) i {
  color: #0066cc;
}

.shortcut {
  margin-left: auto;
  color: #666;
  font-size: 11px;
}
</style>
