<template>
  <div class="tabs-wrapper" :class="{ 'has-scroll': showScrollButtons }">
    <button
      class="tab-scroll-btn"
      v-if="showScrollButtons"
      :disabled="!canScrollLeft"
      @click="scrollTabs('left')"
    >
      <i class="fas fa-chevron-left"></i>
    </button>

    <div class="tabs-viewport" ref="tabsViewportRef">
      <div class="tabs" ref="tabsContainerRef">
        <div
          v-for="(tab, index) in tabs"
          :key="tab.path"
          :class="{ tab: true, active: activeIndex === index }"
          @click="selectTab(tab, index)"
          ref="tabRefs"
          draggable="true"
          @dragstart="handleDragStart(index)"
          @dragover.prevent="handleDragOver(index, $event)"
          @dragleave="handleDragLeave($event)"
          @drop.prevent="handleDrop(index)"
          @dragend="resetDragState"
        >
          <i :class="getIcons(tab.name)"></i>
          <span class="tab-title">{{ tab.name }}</span>
          <button class="tab-close-btn" @click.stop="closeTab(tab, index)">
            <i class="fa fa-close"></i>
          </button>
        </div>
      </div>
    </div>

    <button
      class="tab-scroll-btn"
      v-if="showScrollButtons"
      :disabled="!canScrollRight"
      @click="scrollTabs('right')"
    >
      <i class="fas fa-chevron-right"></i>
    </button>
  </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isFile, obterIconePorExtensao } from '../plugins/icons'

const props = defineProps({
  tabRef: {
    type: Array,
    default: () => []
  },
  activePath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['tab-selected', 'tab-closed', 'tabs-reordered'])

const tabs = computed(() => props.tabRef || [])
const activeIndex = computed(() => {
  if (!tabs.value.length) return -1
  const idx = tabs.value.findIndex(tab => tab.path === props.activePath)
  return idx === -1 ? 0 : idx
})

const tabsViewportRef = ref(null)
const tabsContainerRef = ref(null)
const tabRefs = ref([])
const showScrollButtons = ref(false)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
let resizeObserver = null
const dragState = ref({
  sourceIndex: null,
  targetIndex: null
})

const handleDragStart = (index) => {
  dragState.value.sourceIndex = index
}

const handleDragOver = (index, event) => {
  if (dragState.value.sourceIndex === null || index === dragState.value.sourceIndex) return
  dragState.value.targetIndex = index
  const tabEl = event.currentTarget
  tabEl.classList.add('drag-over')
}

const handleDragLeave = (event) => {
  event.currentTarget?.classList?.remove('drag-over')
}

const handleDrop = (index) => {
  if (dragState.value.sourceIndex === null) return
  const targetIndex = index
  if (targetIndex === dragState.value.sourceIndex) {
    resetDragState()
    return
  }
  emit('tabs-reordered', {
    from: dragState.value.sourceIndex,
    to: targetIndex
  })
  nextTick(() => {
    ensureActiveTabVisible()
  })
  resetDragState()
}

const resetDragState = () => {
  dragState.value = { sourceIndex: null, targetIndex: null }
  tabRefs.value?.forEach((tabEl) => tabEl?.classList?.remove('drag-over'))
}

const updateScrollIndicators = () => {
  const viewport = tabsViewportRef.value
  const container = tabsContainerRef.value
  if (!viewport || !container) {
    showScrollButtons.value = false
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }

  showScrollButtons.value = container.scrollWidth > viewport.clientWidth + 2
  canScrollLeft.value = viewport.scrollLeft > 0
  canScrollRight.value = viewport.scrollLeft + viewport.clientWidth < container.scrollWidth - 1
}

const scrollTabs = (direction) => {
  const viewport = tabsViewportRef.value
  if (!viewport) return

  const delta = viewport.clientWidth * 0.6 || 120
  const amount = direction === 'left' ? -delta : delta
  viewport.scrollBy({ left: amount, behavior: 'smooth' })
}

const ensureActiveTabVisible = () => {
  nextTick(() => {
    const viewport = tabsViewportRef.value
    if (!viewport || activeIndex.value < 0) return

    const tabEl = tabRefs.value?.[activeIndex.value]
    if (tabEl && typeof tabEl.offsetLeft === 'number') {
      const tabLeft = tabEl.offsetLeft
      const tabRight = tabLeft + tabEl.offsetWidth
      const viewLeft = viewport.scrollLeft
      const viewRight = viewLeft + viewport.clientWidth

      if (tabLeft < viewLeft) {
        viewport.scrollTo({ left: tabLeft, behavior: 'smooth' })
      } else if (tabRight > viewRight) {
        viewport.scrollTo({ left: tabRight - viewport.clientWidth, behavior: 'smooth' })
      }
    }
  })
}

const selectTab = (tab, index) => {
  emit('tab-selected', { tab, index })
}

const closeTab = (tab, index) => {
  emit('tab-closed', { tab, index })
}

const getIcons = (fileName) => {
  if (isFile(fileName)) {
    const icone = obterIconePorExtensao(fileName)
    return icone
  }
  return 'fa-regular fa-file'
}

const bindResizeObserver = () => {
  if (resizeObserver || !tabsViewportRef.value) return
  resizeObserver = new ResizeObserver(() => {
    // Usar requestAnimationFrame para evitar erro de loop
    requestAnimationFrame(() => {
      if (!tabsViewportRef.value) return
      updateScrollIndicators()
      ensureActiveTabVisible()
    })
  })
  resizeObserver.observe(tabsViewportRef.value)
}

onMounted(() => {
  bindResizeObserver()
  tabsViewportRef.value?.addEventListener('scroll', updateScrollIndicators)
  updateScrollIndicators()
  ensureActiveTabVisible()
})

onBeforeUnmount(() => {
  tabsViewportRef.value?.removeEventListener('scroll', updateScrollIndicators)
  if (resizeObserver && tabsViewportRef.value) {
    resizeObserver.unobserve(tabsViewportRef.value)
  }
  resizeObserver = null
})

watch(() => tabs.value.length, () => {
  nextTick(() => {
    updateScrollIndicators()
    ensureActiveTabVisible()
  })
})

watch(() => props.activePath, () => ensureActiveTabVisible())
</script>

<style scoped>
.tabs-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.tabs-wrapper.has-scroll {
  padding: 0 4px;
}

.tab-scroll-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #333;
  background: #1f1f1f;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.tab-scroll-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.tab-scroll-btn:not(:disabled):hover {
  background: #2b2b2b;
  color: #fff;
}

.tabs-viewport {
  flex: 1;
  overflow: hidden;
}

.tabs {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  padding: 0 4px;
  height: 34px;
  background: transparent;
  white-space: nowrap;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: #9aa0a6;
  border-radius: 4px 4px 0 0;
  border: 1px solid transparent;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.03);
}

.tab:hover {
  color: #e8eaed;
  background: rgba(255, 255, 255, 0.08);
}

.tab.active {
  color: #fff;
  background: #2a2f38;
  border-color: #3c4048;
  border-bottom-color: #ffb703;
  box-shadow: inset 0 -2px 0 #ffb703;
}

.tab.drag-over {
  border-color: #ffb703;
  background: rgba(255, 183, 3, 0.15);
}

.tab i {
  font-size: 12px;
}

.tab-close-btn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  font-size: 10px;
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.tab-close-btn:hover {
  opacity: 1;
}
</style>