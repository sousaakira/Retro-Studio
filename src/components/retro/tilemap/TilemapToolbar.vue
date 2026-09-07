<template>
  <div class="te-toolbar-map">
    <div class="te-layer-select">
      <button
        class="te-tool-btn"
        :class="{ active: state.activeLayer.value === 'bg' }"
        :title="t('tilemap.layerBg')"
        @click="state.activeLayer.value = 'bg'"
      >
        BG
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.activeLayer.value === 'fg' }"
        :title="t('tilemap.layerFg')"
        @click="state.activeLayer.value = 'fg'"
      >
        FG
      </button>
      <div v-if="state.activeLayer.value === 'fg'" class="te-fg-opacity" :title="t('tilemap.fgOpacity')">
        <input type="range" min="0" max="1" step="0.1" v-model.number="state.fgOpacity.value" />
      </div>
    </div>
    <div class="te-tools">
      <button
        v-for="tool in drawToolsList"
        :key="tool.id"
        class="te-tool-btn"
        :class="{ active: state.drawTool.value === tool.id }"
        :title="tool.title"
        @click="state.drawTool.value = tool.id"
      >
        {{ tool.icon }}
      </button>
      <button class="te-tool-btn" :class="{ active: state.selectedTileRegion.value?.w === 1 }" :title="t('tilemap.brush8')" @click="state.setBrushSize(1, 1)">8</button>
      <button class="te-tool-btn" :class="{ active: state.selectedTileRegion.value?.w === 2 && state.selectedTileRegion.value?.h === 2 }" :title="t('tilemap.brush16')" @click="state.setBrushSize(2, 2)">16</button>
      <button class="te-tool-btn" :title="t('tilemap.viewportGuide')" @click="state.cycleViewportGuide()">{{ state.viewportGuide.value === 'off' ? '⌀' : state.viewportGuide.value }}</button>
    </div>
    <div class="te-debug-tools">
      <button
        class="te-tool-btn"
        :class="{ active: state.showGrid.value }"
        :title="t('tilemap.toggleGrid')"
        @click="state.showGrid.value = !state.showGrid.value"
      >
        ⊞
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showTileIndices.value }"
        :title="t('tilemap.showIndices')"
        @click="state.showTileIndices.value = !state.showTileIndices.value"
      >
        #
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showCollision.value }"
        :title="t('tilemap.showCollisions')"
        @click="state.showCollision.value = !state.showCollision.value"
      >
        ⬛
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editCollision.value }"
        :title="t('tilemap.editCollision')"
        @click="toggleExclusiveEdit('collision')"
      >
        ◼
      </button>
      <button
        v-if="state.editCollision.value"
        class="te-tool-btn"
        :class="{ active: !!(state.paintCollisionDirs.value & state.COL_TOP) }"
        title="TOP"
        @click="state.togglePaintCollisionDir(state.COL_TOP)"
      >T</button>
      <button
        v-if="state.editCollision.value"
        class="te-tool-btn"
        :class="{ active: !!(state.paintCollisionDirs.value & state.COL_BOTTOM) }"
        title="BOTTOM"
        @click="state.togglePaintCollisionDir(state.COL_BOTTOM)"
      >B</button>
      <button
        v-if="state.editCollision.value"
        class="te-tool-btn"
        :class="{ active: !!(state.paintCollisionDirs.value & state.COL_LEFT) }"
        title="LEFT"
        @click="state.togglePaintCollisionDir(state.COL_LEFT)"
      >L</button>
      <button
        v-if="state.editCollision.value"
        class="te-tool-btn"
        :class="{ active: !!(state.paintCollisionDirs.value & state.COL_RIGHT) }"
        title="RIGHT"
        @click="state.togglePaintCollisionDir(state.COL_RIGHT)"
      >R</button>
      <button
        v-if="state.editCollision.value"
        class="te-tool-btn"
        :title="t('tilemap.cycleCollisionType')"
        @click="state.cyclePaintCollisionType()"
      >T{{ state.paintCollisionType.value }}</button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showPriority.value }"
        :title="t('tilemap.showPriority')"
        @click="state.showPriority.value = !state.showPriority.value"
      >
        △
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showMinimap?.value }"
        :title="t('tilemap.minimapToggle')"
        @click="state.showMinimap.value = !state.showMinimap.value"
      >
        🗺️
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editPriority.value }"
        :title="t('tilemap.editPriority')"
        @click="state.editPriority.value = !state.editPriority.value"
      >
        ▲
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.paintFlipH.value }"
        :title="t('tilemap.paintFlipH')"
        @click="state.paintFlipH.value = !state.paintFlipH.value"
      >
        ↔
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.paintFlipV.value }"
        :title="t('tilemap.paintFlipV')"
        @click="state.paintFlipV.value = !state.paintFlipV.value"
      >
        ↕
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editFlipH.value }"
        :title="t('tilemap.editFlipH')"
        @click="toggleExclusiveEdit('flipH')"
      >
        H
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editFlipV.value }"
        :title="t('tilemap.editFlipV')"
        @click="toggleExclusiveEdit('flipV')"
      >
        V
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.editPalette.value }"
        :title="t('tilemap.editPalette')"
        @click="toggleExclusiveEdit('palette')"
      >
        P{{ state.paintPalette.value }}
      </button>
      <button
        class="te-tool-btn"
        :title="t('tilemap.cyclePaintPalette')"
        @click="state.paintPalette.value = (state.paintPalette.value + 1) % 4"
      >
        ◈
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showFlips.value }"
        :title="t('tilemap.showFlips')"
        @click="state.showFlips.value = !state.showFlips.value"
      >
        ⇄
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showPaletteOverlay.value }"
        :title="t('tilemap.showPaletteOverlay')"
        @click="state.showPaletteOverlay.value = !state.showPaletteOverlay.value"
      >
        ▣
      </button>
      <button
        class="te-tool-btn"
        :class="{ active: state.showCoords.value }"
        :title="t('tilemap.showCoords')"
        @click="state.showCoords.value = !state.showCoords.value"
      >
        ⌖
      </button>
    </div>
    <div class="te-selection-actions">
      <button
        class="te-tool-btn"
        :disabled="!state.selection.value?.w"
        :title="t('tilemap.duplicate')"
        @click="state.duplicateSelection"
      >
        ⊕
      </button>
    </div>
    <div class="te-undo-redo">
      <button class="te-tool-btn" :disabled="!state.canUndo.value" :title="t('tilemap.undo')" @click="state.undo">↶</button>
      <button class="te-tool-btn" :disabled="!state.canRedo.value" :title="t('tilemap.redo')" @click="state.redo">↷</button>
    </div>
    <div class="te-zoom">
      <button @click="state.zoom.value = Math.max(1, state.zoom.value - 1)">−</button>
      <span>{{ state.zoom.value }}×</span>
      <button @click="state.zoom.value = Math.min(8, state.zoom.value + 1)">+</button>
    </div>
  </div>
</template>

<script setup>
import { computed, unref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  state: {
    type: Object,
    required: true
  }
})

/** drawTools no state é ComputedRef — template precisa da lista, não do ref */
const drawToolsList = computed(() => {
  const raw = props.state?.drawTools
  const list = unref(raw)
  return Array.isArray(list) ? list : []
})

function clearAttrEdits() {
  props.state.editCollision.value = false
  props.state.editPriority.value = false
  props.state.editFlipH.value = false
  props.state.editFlipV.value = false
  props.state.editPalette.value = false
}

function toggleExclusiveEdit(kind) {
  const map = {
    collision: props.state.editCollision,
    flipH: props.state.editFlipH,
    flipV: props.state.editFlipV,
    palette: props.state.editPalette
  }
  const target = map[kind]
  if (!target) return
  const next = !target.value
  clearAttrEdits()
  target.value = next
}
</script>

<style scoped>
.te-toolbar-map {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.te-layer-select,
.te-tools,
.te-debug-tools,
.te-selection-actions,
.te-undo-redo {
  display: flex;
  align-items: center;
  gap: 2px;
}
.te-layer-select { margin-right: 8px; }

.te-tool-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.te-tool-btn:hover { background: rgba(255,255,255,0.08); color: var(--text); }
.te-tool-btn.active { background: var(--accent); color: #fff; }

.te-zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 0px;
  font-size: 12px;
}
.te-zoom button {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  cursor: pointer;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}
.te-zoom button:hover { background: var(--accent); color: #fff; }
</style>
