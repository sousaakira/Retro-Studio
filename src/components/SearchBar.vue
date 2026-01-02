<template>
  <div class="search-bar" v-if="show">
    <div class="search-input-wrapper">
      <i class="fas fa-search search-icon"></i>
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        placeholder="Search files, resources..."
        class="search-input"
        @keyup.esc="closeSearch"
        @keyup.enter="performSearch"
        @input="onSearchInput"
      />
      <button v-if="searchQuery" class="clear-btn" @click="clearSearch">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div v-if="searchResults.length > 0" class="search-results">
      <div
        v-for="result in searchResults"
        :key="result.id"
        class="search-result-item"
        @click="selectResult(result)"
      >
        <i :class="getResultIcon(result.type)"></i>
        <div class="result-info">
          <div class="result-name">{{ result.name }}</div>
          <div class="result-path">{{ result.path }}</div>
        </div>
      </div>
    </div>
    <div v-else-if="searchQuery && !isSearching" class="no-results">
      No results found
    </div>
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, watch, nextTick } from 'vue'
import { useStore } from 'vuex'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'select', 'open'])

const store = useStore()
const searchInput = ref(null)
const searchQuery = ref('')
const searchResults = ref([])
const isSearching = ref(false)

const getResultIcon = (type) => {
  const icons = {
    file: 'fas fa-file',
    folder: 'fas fa-folder',
    sprite: 'fas fa-image',
    tile: 'fas fa-th',
    palette: 'fas fa-palette',
    scene: 'fas fa-cube'
  }
  return icons[type] || 'fas fa-file'
}

const onSearchInput = () => {
  if (searchQuery.value.length > 2) {
    performSearch()
  } else {
    searchResults.value = []
  }
}

const performSearch = () => {
  if (!searchQuery.value || searchQuery.value.length < 2) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  const query = searchQuery.value.toLowerCase()
  const results = []

  // Search in resources
  const resources = store.state.resources
  if (resources) {
    Object.keys(resources).forEach(key => {
      const items = resources[key] || []
      items.forEach(item => {
        if (item.name?.toLowerCase().includes(query)) {
          results.push({
            id: item.id,
            name: item.name,
            path: item.path || '',
            type: key.slice(0, -1) // Remove 's' from 'sprites', 'tiles', etc.
          })
        }
      })
    })
  }

  // Search in scene nodes
  const nodes = store.state.sceneNodes || []
  nodes.forEach(node => {
    if (node.name?.toLowerCase().includes(query)) {
      results.push({
        id: node.id,
        name: node.name,
        path: '',
        type: 'scene'
      })
    }
  })

  searchResults.value = results.slice(0, 10) // Limit to 10 results
  isSearching.value = false
}

const selectResult = (result) => {
  emit('select', result)
  closeSearch()
}

const clearSearch = () => {
  searchQuery.value = ''
  searchResults.value = []
}

const closeSearch = () => {
  clearSearch()
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    nextTick(() => {
      searchInput.value?.focus()
    })
  }
})

// Watch for show prop changes to focus input
watch(() => props.show, (newVal) => {
  if (newVal) {
    nextTick(() => {
      searchInput.value?.focus()
    })
  } else {
    clearSearch()
  }
})
</script>

<style scoped>
.search-bar {
  position: absolute;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  max-width: 90vw;
  background: #252525;
  border: 1px solid #333;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  overflow: hidden;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: 12px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
}

.search-icon {
  color: #888;
  margin-right: 8px;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #ccc;
  font-size: 14px;
  outline: none;
}

.search-input::placeholder {
  color: #666;
}

.clear-btn {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 3px;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: #333;
  color: #fff;
}

.search-results {
  max-height: 300px;
  overflow-y: auto;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 1px solid #1e1e1e;
}

.search-result-item:hover {
  background: #2a2a2a;
}

.search-result-item i {
  color: #0066cc;
  font-size: 16px;
  width: 20px;
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-name {
  color: #ccc;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
}

.result-path {
  color: #888;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.no-results {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 13px;
}
</style>
