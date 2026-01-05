<template>
  <div class="scene-viewport" ref="viewportContainer">
    <ViewportToolbar
      :current-tool="currentTool"
      :zoom="zoom"
      :snap-to-grid="snapToGrid"
      :grid-size="gridSize"
      :show-grid="showGrid"
      @tool-change="setTool"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
      @toggle-snap-grid="snapToGrid = !snapToGrid"
      @grid-size-change="gridSize = $event"
      @toggle-show-grid="showGrid = !showGrid"
      @center-viewport="centerViewport"
      @fit-to-screen="fitToScreen"
      @zoom-to-fit="zoomToFit"
      @zoom-to-selection="zoomToSelection"
    />
    
    <div 
      class="viewport-canvas" 
      ref="canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @wheel="handleWheel"
      @contextmenu.prevent
    >
      <!-- Grid Background -->
      <svg 
        v-if="showGrid" 
        class="grid-overlay" 
        :width="canvasWidth" 
        :height="canvasHeight"
      >
        <defs>
          <!-- Minor Grid (e.g. 8x8 or 16x16) -->
          <pattern id="grid-minor" :width="gridSize * zoom" :height="gridSize * zoom" patternUnits="userSpaceOnUse">
            <path 
              :d="`M ${gridSize * zoom} 0 L 0 0 0 ${gridSize * zoom}`" 
              fill="none" 
              stroke="rgba(255, 255, 255, 0.05)" 
              stroke-width="0.5"
            />
          </pattern>
          <!-- Major Grid (every 4 minor tiles) -->
          <pattern id="grid-major" :width="gridSize * 4 * zoom" :height="gridSize * 4 * zoom" patternUnits="userSpaceOnUse">
            <path 
              :d="`M ${gridSize * 4 * zoom} 0 L 0 0 0 ${gridSize * 4 * zoom}`" 
              fill="none" 
              stroke="rgba(255, 255, 255, 0.15)" 
              stroke-width="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-minor)" />
        <rect width="100%" height="100%" fill="url(#grid-major)" />
      </svg>

      <!-- Game View Area (320x224 for Mega Drive) -->
      <div 
        class="game-view-area"
        :style="{
          width: `${320 * zoom}px`,
          height: `${224 * zoom}px`,
          transform: `translate(${offsetX}px, ${offsetY}px)`
        }"
      >
        <!-- Scene Nodes -->
        <div 
          v-for="node in sceneNodes" 
          :key="node.id"
          class="scene-node"
          :class="{ selected: selectedNodeId === node.id }"
          :style="getNodeStyle(node)"
          @mousedown.stop="handleNodeMouseDown(node, $event)"
        >
          <div class="node-handle" v-if="selectedNodeId === node.id">
            <div class="node-resize-handle" 
              v-for="handle in resizeHandles" 
              :key="handle"
              :class="handle"
              @mousedown.stop="startResize(node.id, handle, $event)"
            ></div>
          </div>
          <div class="node-label" v-if="node.name">{{ node.name }}</div>
        </div>
      </div>

      <!-- Selection Box -->
      <div 
        v-if="isSelecting"
        class="selection-box"
        :style="getSelectionBoxStyle()"
      ></div>
    </div>

    <!-- Viewport Info -->
    <div class="viewport-info">
      <span class="info-item">
        <i class="fas fa-mouse-pointer"></i>
        X: {{ Math.round((mouseX - offsetX) / zoom) }}, Y: {{ Math.round((mouseY - offsetY) / zoom) }}
      </span>
      <span v-if="selectedNode" class="info-item">
        <i class="fas fa-cube"></i>
        {{ selectedNode?.name || 'Node' }} ({{ selectedNode?.x }}, {{ selectedNode?.y }})
      </span>
      <span class="info-item">
        <i class="fas fa-layer-group"></i>
        {{ sceneNodes.length }} nodes
      </span>
      <button 
        class="minimap-toggle"
        @click="showMinimap = !showMinimap"
        :title="showMinimap ? 'Hide Minimap' : 'Show Minimap'"
      >
        <i class="fas fa-map"></i>
      </button>
    </div>
    
    <!-- Minimap -->
    <ViewportMinimap
      v-if="showMinimap"
      :show="showMinimap"
      :viewport-width="320"
      :viewport-height="224"
      :viewport-offset-x="offsetX"
      :viewport-offset-y="offsetY"
      :zoom="zoom"
      @pan="handleMinimapPan"
      @close="showMinimap = false"
    />
  </div>
</template>

<script setup>
/* eslint-disable no-undef */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useStore } from 'vuex'
import { useUndoRedo } from '../composables/useUndoRedo'
import ViewportMinimap from './ViewportMinimap.vue'
import ViewportToolbar from './ViewportToolbar.vue'

const store = useStore()
const { undo, redo, saveHistory } = useUndoRedo()

const emit = defineEmits([
  'scene-changed'
])

// Viewport state
const viewportContainer = ref(null)
const canvas = ref(null)
const zoom = ref(2)
const offsetX = ref(0)
const offsetY = ref(0)
const canvasWidth = ref(1920)
const canvasHeight = ref(1080)

// Zoom presets
const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4, 8, 16]
// const zoomLevel = computed(() => `${Math.round(zoom.value * 100)}%`)

// Pan state
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

// Tools
const currentTool = ref('select')
const snapToGrid = ref(true)
const gridSize = ref(8)
const showGrid = ref(true)
const showMinimap = ref(true)

// Mouse state
const mouseX = ref(0)
const mouseY = ref(0)
const isDragging = ref(false)
const isSelecting = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const selectionStart = ref({ x: 0, y: 0 })

// Scene nodes
const sceneNodes = ref([])
const selectedNodeId = ref(null)
const resizeHandles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']
const copiedNode = ref(null)

// Computed
const selectedNode = computed(() => {
  return sceneNodes.value.find(n => n.id === selectedNodeId.value)
})

// Methods
const setTool = (tool) => {
  currentTool.value = tool
}

const zoomIn = () => {
  const currentIndex = ZOOM_PRESETS.findIndex(z => Math.abs(z - zoom.value) < 0.01)
  if (currentIndex < ZOOM_PRESETS.length - 1) {
    zoom.value = ZOOM_PRESETS[currentIndex + 1]
  }
}

const zoomOut = () => {
  const currentIndex = ZOOM_PRESETS.findIndex(z => Math.abs(z - zoom.value) < 0.01)
  if (currentIndex > 0) {
    zoom.value = ZOOM_PRESETS[currentIndex - 1]
  }
}

/*
const zoomToPreset = (preset) => {
  zoom.value = Math.min(Math.max(preset, 0.25), 16)
}
*/

const zoomToFit = () => {
  const canvasRect = canvas.value?.getBoundingClientRect()
  if (canvasRect) {
    const scaleX = (canvasRect.width - 40) / 320
    const scaleY = (canvasRect.height - 40) / 224
    zoom.value = Math.min(scaleX, scaleY, 16)
    centerViewport()
  }
}

const zoomToSelection = () => {
  if (!selectedNode.value) return
  const node = selectedNode.value
  const canvasRect = canvas.value?.getBoundingClientRect()
  if (canvasRect) {
    const width = node.width || 16
    const height = node.height || 16
    const scaleX = (canvasRect.width - 40) / width
    const scaleY = (canvasRect.height - 40) / height
    zoom.value = Math.min(scaleX, scaleY, 16)
    centerViewport()
  }
}

const handleMinimapPan = ({ x, y }) => {
  offsetX.value = x
  offsetY.value = y
}

const resetZoom = () => {
  zoom.value = 2
  centerViewport()
}

const centerViewport = () => {
  if (canvas.value) {
    const rect = canvas.value.getBoundingClientRect()
    canvasWidth.value = rect.width
    canvasHeight.value = rect.height
    offsetX.value = (rect.width - 320 * zoom.value) / 2
    offsetY.value = (rect.height - 224 * zoom.value) / 2
  } else {
    offsetX.value = (canvasWidth.value - 320 * zoom.value) / 2
    offsetY.value = (canvasHeight.value - 224 * zoom.value) / 2
  }
}

const fitToScreen = () => {
  const canvasRect = canvas.value?.getBoundingClientRect()
  if (canvasRect) {
    const scaleX = (canvasRect.width - 40) / 320
    const scaleY = (canvasRect.height - 40) / 224
    zoom.value = Math.min(scaleX, scaleY, 16)
    centerViewport()
  }
}

const getNodeStyle = (node) => {
  const x = snapToGrid.value 
    ? Math.round(node.x / gridSize.value) * gridSize.value 
    : node.x
  const y = snapToGrid.value 
    ? Math.round(node.y / gridSize.value) * gridSize.value 
    : node.y
  
  const style = {
    left: `${x * zoom.value}px`,
    top: `${y * zoom.value}px`,
    width: `${(node.width || 16) * zoom.value}px`,
    height: `${(node.height || 16) * zoom.value}px`,
    zIndex: node.type === 'background' ? 1 : 10,
    backgroundColor: 'rgba(0, 255, 0, 0.1)' // Fallback visual
  }

  // Buscar assets de forma reativa do store
  const allSprites = store.state.resources.sprites || []
  const allBackgrounds = store.state.resources.backgrounds || []
  
  let asset = null
  const targetId = node.type === 'sprite' ? node.properties?.spriteId : node.properties?.backgroundId
  
  if (targetId) {
    const list = node.type === 'sprite' ? allSprites : allBackgrounds
    
    // 1. Tentar por ID exato
    asset = list.find(a => a.id === targetId)
    
    // 2. Tentar por nome (Plano B para IDs antigos/quebrados)
    if (!asset) {
      asset = list.find(a => a.name === targetId || a.name?.split('.')[0] === targetId)
      // Se encontrou pelo nome, atualizar o nó para o novo ID estável para "curar" a cena
      if (asset && node.properties) {
        if (node.type === 'sprite') node.properties.spriteId = asset.id
        else node.properties.backgroundId = asset.id
      }
    }

    // 3. Tentar pelo caminho do arquivo
    if (!asset && node.properties?.path) {
      asset = list.find(a => a.path === node.properties.path)
    }
  }

  if (asset) {
    // Se o asset foi encontrado mas NÃO tem preview, disparar o carregamento reativo
    if (!asset.preview) {
      store.dispatch('loadAssetPreview', asset)
      style.backgroundColor = 'rgba(255, 165, 0, 0.3)' // Laranja = carregando
    } else {
      style.backgroundImage = `url(${asset.preview})`
      style.backgroundRepeat = 'no-repeat'
      style.imageRendering = 'pixelated'
      style.backgroundColor = 'transparent'
      style.borderStyle = node.type === 'background' ? 'none' : 'solid'

      if (node.type === 'sprite' && node.properties?.frameWidth) {
        const fw = node.properties.frameWidth
        const fh = node.properties.frameHeight || fw
        const anim = node.properties.animIndex || 0
        const frame = node.properties.frameIndex || 0
        
        style.width = `${fw * zoom.value}px`
        style.height = `${fh * zoom.value}px`

        // Técnica de Porcentagem para Sprite Sheets (Independente de Zoom)
        if (asset.metadata && asset.metadata.width) {
          const sw = asset.metadata.width
          const sh = asset.metadata.height
          // background-size: (largura_total / largura_frame) * 100%
          style.backgroundSize = `${(sw / fw) * 100}% ${(sh / fh) * 100}%`
          // Posição proporcional baseada no zoom
          style.backgroundPosition = `-${frame * fw * zoom.value}px -${anim * fh * zoom.value}px`
        } else {
          style.backgroundSize = 'auto'
          style.backgroundPosition = `-${frame * fw * zoom.value}px -${anim * fh * zoom.value}px`
        }
      } else {
        style.backgroundSize = '100% 100%'
      }
    }
  }
  
  return style
}

const selectNode = (nodeId) => {
  selectedNodeId.value = nodeId
  store.dispatch('updateSelectedNode', sceneNodes.value.find(n => n.id === nodeId))
}

const handleNodeMouseDown = (node, e) => {
  // Handle mouse down on a node specifically
  if (currentTool.value === 'select') {
    selectNode(node.id)
    isDragging.value = true
    
    // Get canvas position
    const rect = canvas.value.getBoundingClientRect()
    mouseX.value = e.clientX - rect.left
    mouseY.value = e.clientY - rect.top
    
    // Store initial mouse position and node position for relative dragging
    dragStart.value = { 
      x: mouseX.value, 
      y: mouseY.value,
      nodeX: node.x,
      nodeY: node.y
    }
    
    // Add global mouse listeners for dragging
    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)
  }
}

const handleGlobalMouseMove = (e) => {
  if (canvas.value) {
    const rect = canvas.value.getBoundingClientRect()
    mouseX.value = e.clientX - rect.left
    mouseY.value = e.clientY - rect.top
    handleMouseMove(e)
  }
}

const handleGlobalMouseUp = (e) => {
  handleMouseUp(e)
  // Remove global listeners
  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
}

const handleMouseDown = (e) => {
  const rect = canvas.value.getBoundingClientRect()
  mouseX.value = e.clientX - rect.left
  mouseY.value = e.clientY - rect.top

  // Pan with middle mouse button or Shift+Left click
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    isPanning.value = true
    panStart.value = { x: mouseX.value, y: mouseY.value }
    canvas.value.style.cursor = 'grabbing'
    return
  }

  if (currentTool.value === 'select') {
    // Check if clicking on a node
    const clickedNode = getNodeAtPosition(mouseX.value, mouseY.value)
    if (clickedNode) {
      selectNode(clickedNode.id)
      isDragging.value = true
      // Store initial mouse position and node position for relative dragging
      dragStart.value = { 
        x: mouseX.value, 
        y: mouseY.value,
        nodeX: clickedNode.x,
        nodeY: clickedNode.y
      }
    } else {
      isSelecting.value = true
      selectionStart.value = { x: mouseX.value, y: mouseY.value }
      selectedNodeId.value = null
    }
  } else if (currentTool.value === 'move') {
    isDragging.value = true
    dragStart.value = { x: mouseX.value, y: mouseY.value }
  } else if (currentTool.value === 'sprite') {
    addSpriteNode(mouseX.value, mouseY.value)
  } else if (currentTool.value === 'tile') {
    addTileNode(mouseX.value, mouseY.value)
  } else if (currentTool.value === 'background') {
    addBackgroundNode()
  }
}

const getNodeAtPosition = (x, y) => {
  // Convert screen coordinates to game coordinates
  const gameX = (x - offsetX.value) / zoom.value
  const gameY = (y - offsetY.value) / zoom.value
  
  // Find node at this position (reverse order to get topmost)
  for (let i = sceneNodes.value.length - 1; i >= 0; i--) {
    const node = sceneNodes.value[i]
    if (gameX >= node.x && gameX <= node.x + (node.width || 16) &&
        gameY >= node.y && gameY <= node.y + (node.height || 16)) {
      return node
    }
  }
  return null
}

const handleMouseMove = (e) => {
  const rect = canvas.value.getBoundingClientRect()
  mouseX.value = e.clientX - rect.left
  mouseY.value = e.clientY - rect.top

  // Handle panning
  if (isPanning.value) {
    const deltaX = mouseX.value - panStart.value.x
    const deltaY = mouseY.value - panStart.value.y
    offsetX.value += deltaX
    offsetY.value += deltaY
    panStart.value = { x: mouseX.value, y: mouseY.value }
    return
  }

  if (isDragging.value && currentTool.value === 'move') {
    const deltaX = mouseX.value - dragStart.value.x
    const deltaY = mouseY.value - dragStart.value.y
    offsetX.value += deltaX
    offsetY.value += deltaY
    dragStart.value = { x: mouseX.value, y: mouseY.value }
  }

  if (isDragging.value && selectedNodeId.value && currentTool.value === 'select') {
    // Calculate relative movement from drag start
    const deltaX = (mouseX.value - dragStart.value.x) / zoom.value
    const deltaY = (mouseY.value - dragStart.value.y) / zoom.value
    
    // Apply relative movement to initial node position
    const nodeX = dragStart.value.nodeX + deltaX
    const nodeY = dragStart.value.nodeY + deltaY
    
    updateNodePosition(selectedNodeId.value, nodeX, nodeY)
  }
}

const handleMouseUp = () => {
  if (isPanning.value) {
    isPanning.value = false
    canvas.value.style.cursor = 'crosshair'
  }
  
  if (isDragging.value && selectedNodeId.value) {
    // Save history after moving a node
    saveHistory()
    emit('scene-changed')
  }
  
  isDragging.value = false
  isSelecting.value = false
}

const handleWheel = (e) => {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  zoom.value = Math.max(0.5, Math.min(8, zoom.value + delta))
}

const getSelectionBoxStyle = () => {
  const x = Math.min(selectionStart.value.x, mouseX.value)
  const y = Math.min(selectionStart.value.y, mouseY.value)
  const width = Math.abs(mouseX.value - selectionStart.value.x)
  const height = Math.abs(mouseY.value - selectionStart.value.y)
  
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`
  }
}

const addSpriteNode = (x, y) => {
  const nodeX = (x - offsetX.value) / zoom.value
  const nodeY = (y - offsetY.value) / zoom.value
  
  const newNode = {
    id: `node_${Date.now()}`,
    type: 'sprite',
    name: 'Sprite',
    x: snapToGrid.value ? Math.round(nodeX / gridSize.value) * gridSize.value : nodeX,
    y: snapToGrid.value ? Math.round(nodeY / gridSize.value) * gridSize.value : nodeY,
    width: 16,
    height: 16,
    properties: {
      spriteId: '',
      paletteId: 'PAL0',
      priority: 0,
      frameWidth: 16,
      frameHeight: 16,
      animIndex: 0,
      frameIndex: 0
    }
  }

  // Tentar carregar o último asset selecionado ou o primeiro da lista
  if (store.state.resources.sprites?.length > 0) {
    const defaultSprite = store.state.resources.sprites[0]
    newNode.properties.spriteId = defaultSprite.id
    newNode.name = defaultSprite.name
  }
  
  sceneNodes.value.push(newNode)
  store.dispatch('addSceneNode', newNode)
  selectNode(newNode.id)
  emit('scene-changed')
}

const addTileNode = (x, y) => {
  const nodeX = (x - offsetX.value) / zoom.value
  const nodeY = (y - offsetY.value) / zoom.value
  
  const newNode = {
    id: `node_${Date.now()}`,
    type: 'tile',
    name: 'Tile',
    x: snapToGrid.value ? Math.round(nodeX / gridSize.value) * gridSize.value : nodeX,
    y: snapToGrid.value ? Math.round(nodeY / gridSize.value) * gridSize.value : nodeY,
    width: 8,
    height: 8,
    properties: {}
  }
  
  sceneNodes.value.push(newNode)
  store.dispatch('addSceneNode', newNode)
  selectNode(newNode.id)
  emit('scene-changed')
  
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Node Added',
    message: `${newNode.type} node created`
  })
}

const addBackgroundNode = () => {
  const newNode = {
    id: `node_${Date.now()}`,
    type: 'background',
    name: 'Background',
    x: 0, 
    y: 0,
    width: 320, // Tamanho padrão Mega Drive
    height: 224,
    properties: {
      backgroundId: '',
      plane: 'BG_B',
      scrollType: 'NONE'
    }
  }
  
  // Tentar auto-selecionar o primeiro background disponível se existir
  if (store.state.resources.backgrounds?.length > 0) {
    newNode.properties.backgroundId = store.state.resources.backgrounds[0].id
    newNode.name = store.state.resources.backgrounds[0].name
  }
  
  sceneNodes.value.push(newNode)
  store.dispatch('addSceneNode', newNode)
  selectNode(newNode.id)
  emit('scene-changed')
  
  store.dispatch('showNotification', {
    type: 'success',
    title: 'Background Adicionado',
    message: 'Nó de background criado com tamanho 320x224'
  })
}

const updateNodePosition = (nodeId, x, y) => {
  const node = sceneNodes.value.find(n => n.id === nodeId)
  if (node) {
    const newX = snapToGrid.value ? Math.round(x / gridSize.value) * gridSize.value : x
    const newY = snapToGrid.value ? Math.round(y / gridSize.value) * gridSize.value : y
    
    // Clamp to game view area bounds
    const clampedX = Math.max(0, Math.min(320 - (node.width || 16), newX))
    const clampedY = Math.max(0, Math.min(224 - (node.height || 16), newY))
    
    // Update local node
    node.x = clampedX
    node.y = clampedY
    
    // Update in store (this will trigger watch, but we want immediate update)
    store.commit('updateSceneNode', { ...node, x: clampedX, y: clampedY })
  }
}

const startResize = (nodeId, handle, e) => {
  e.stopPropagation()
  // TODO: Implement resize logic
}

const copyNode = () => {
  if (selectedNode.value) {
    copiedNode.value = JSON.parse(JSON.stringify(selectedNode.value))
    store.dispatch('showNotification', {
      type: 'info',
      title: 'Copied',
      message: `"${selectedNode.value.name}" copied to clipboard`
    })
  }
}

const pasteNode = () => {
  if (copiedNode.value) {
    const newNode = {
      ...copiedNode.value,
      id: `node_${Date.now()}`,
      name: copiedNode.value.name + ' Copy',
      x: copiedNode.value.x + 16,
      y: copiedNode.value.y + 16
    }
    sceneNodes.value.push(newNode)
    store.dispatch('addSceneNode', newNode)
    selectNode(newNode.id)
    
    store.dispatch('showNotification', {
      type: 'success',
      title: 'Pasted',
      message: `"${newNode.name}" pasted`
    })
  }
}

const duplicateNode = () => {
  if (selectedNode.value) {
    const newNode = {
      ...JSON.parse(JSON.stringify(selectedNode.value)),
      id: `node_${Date.now()}`,
      name: selectedNode.value.name + ' Copy',
      x: selectedNode.value.x + 16,
      y: selectedNode.value.y + 16
    }
    sceneNodes.value.push(newNode)
    store.dispatch('addSceneNode', newNode)
    selectNode(newNode.id)
    
    store.dispatch('showNotification', {
      type: 'success',
      title: 'Duplicated',
      message: `"${newNode.name}" created`
    })
  }
}

// Keyboard shortcuts
const handleKeyDown = (e) => {
  if (e.target.tagName === 'INPUT') return
  
  switch(e.key.toLowerCase()) {
    case 'q':
      setTool('select')
      break
    case 'w':
      setTool('move')
      break
    case 's':
      if (!e.ctrlKey && !e.metaKey) {
        setTool('sprite')
      }
      break
    case 't':
      setTool('tile')
      break
    case 'b':
      setTool('background')
      break
    case 'g':
      snapToGrid.value = !snapToGrid.value
      break
    case 'c':
      if ((e.ctrlKey || e.metaKey) && selectedNodeId.value) {
        e.preventDefault()
        copyNode()
      } else if (!e.ctrlKey && !e.metaKey) {
        centerViewport()
      }
      break
    case 'f':
      if (!e.ctrlKey && !e.metaKey) {
        fitToScreen()
      }
      break
    case 'z':
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      break
    case 'y':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        redo()
      }
      break
    case 'delete':
    case 'backspace':
      if (selectedNodeId.value) {
        const nodeName = selectedNode.value?.name || 'Node'
        store.dispatch('removeSceneNode', selectedNodeId.value)
        sceneNodes.value = sceneNodes.value.filter(n => n.id !== selectedNodeId.value)
        selectedNodeId.value = null
        
        store.dispatch('showNotification', {
          type: 'info',
          title: 'Node Removed',
          message: `${nodeName} deleted`
        })
      }
      break
    case 'v':
      if ((e.ctrlKey || e.metaKey) && copiedNode.value) {
        e.preventDefault()
        pasteNode()
      }
      break
    case 'd':
      if ((e.ctrlKey || e.metaKey) && selectedNodeId.value) {
        e.preventDefault()
        duplicateNode()
      }
      break
  }
}

// Watch for scene updates from store
watch(() => store.state.sceneNodes, (newNodes) => {
  if (newNodes && newNodes.length >= 0) {
    // Always sync from store to ensure consistency
    const currentIds = sceneNodes.value.map(n => n.id).sort().join(',')
    const newIds = newNodes.map(n => n.id).sort().join(',')
    
    // If structure changed (nodes added/removed), replace all
    if (currentIds !== newIds || newNodes.length !== sceneNodes.value.length) {
      sceneNodes.value = JSON.parse(JSON.stringify(newNodes))
    } else {
      // Update existing nodes (positions, properties, etc.)
      newNodes.forEach(newNode => {
        const existing = sceneNodes.value.find(n => n.id === newNode.id)
        if (existing) {
          // Update all properties
          Object.assign(existing, newNode)
        } else {
          // Add new node if it doesn't exist locally
          sceneNodes.value.push(JSON.parse(JSON.stringify(newNode)))
        }
      })
      
      // Remove nodes that no longer exist in store
      sceneNodes.value = sceneNodes.value.filter(localNode => 
        newNodes.some(storeNode => storeNode.id === localNode.id)
      )
    }
  } else if (!newNodes || newNodes.length === 0) {
    // Clear if store is empty
    sceneNodes.value = []
  }
}, { deep: true, immediate: true })

// Watch for selected node from store (e.g., from hierarchy)
watch(() => store.state.selectedNode, (node) => {
  if (node && node.id !== selectedNodeId.value) {
    selectedNodeId.value = node.id
  }
}, { deep: true })

let resizeObserver = null

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  
  // Initialize nodes from store
  if (store.state.sceneNodes && store.state.sceneNodes.length > 0) {
    sceneNodes.value = JSON.parse(JSON.stringify(store.state.sceneNodes))
  }
  
  // Wait for DOM to be ready before centering
  nextTick(() => {
    resetZoom()
    
    // Watch for canvas resize
    if (canvas.value) {
      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (canvas.value) centerViewport()
        })
      })
      resizeObserver.observe(canvas.value)
    }
  })
  
  // Save initial state
  if (sceneNodes.value.length > 0) {
    saveHistory()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<style scoped>
.scene-viewport {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
  position: relative;
}

.viewport-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-right: 1px solid #333;
}

.toolbar-group:last-child {
  border-right: none;
}

.toolbar-btn {
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: #333;
  border-color: #444;
}

.toolbar-btn.active {
  background: #0066cc;
  border-color: #0088ff;
  color: white;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn:disabled:hover {
  background: #2a2a2a;
  border-color: #333;
}

.zoom-level {
  color: #ccc;
  font-size: 12px;
  padding: 0 8px;
}

.grid-size-input {
  width: 50px;
  background: #2a2a2a;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px;
  border-radius: 3px;
}

.viewport-canvas {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #0f0f0f;
  cursor: crosshair;
}

.grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  opacity: 0.3;
}

.game-view-area {
  position: absolute;
  border: 2px solid #0066cc;
  background: #000;
  box-shadow: 0 0 20px rgba(0, 102, 204, 0.3);
}

.scene-node {
  position: absolute;
  border: 1px solid rgba(0, 255, 0, 0.5);
  background: rgba(0, 255, 0, 0.1);
  cursor: grab;
  box-sizing: border-box;
  user-select: none;
}

.scene-node[style*="background-image"] {
  border-color: rgba(255, 255, 255, 0.2);
}

.scene-node:active {
  cursor: grabbing;
}

.scene-node.selected {
  border: 2px solid #0066cc;
  z-index: 100 !important;
  box-shadow: 0 0 10px rgba(0, 102, 204, 0.5);
}

.node-handle {
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  pointer-events: none;
}

.node-resize-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #0066cc;
  border: 1px solid #fff;
  pointer-events: all;
  cursor: nwse-resize;
}

.node-resize-handle.nw { top: -4px; left: -4px; cursor: nwse-resize; }
.node-resize-handle.ne { top: -4px; right: -4px; cursor: nesw-resize; }
.node-resize-handle.sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
.node-resize-handle.se { bottom: -4px; right: -4px; cursor: nwse-resize; }
.node-resize-handle.n { top: -4px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.node-resize-handle.s { bottom: -4px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.node-resize-handle.e { right: -4px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
.node-resize-handle.w { left: -4px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }

.node-label {
  position: absolute;
  top: -20px;
  left: 0;
  background: rgba(0, 102, 204, 0.8);
  color: white;
  padding: 2px 6px;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
}

.selection-box {
  position: absolute;
  border: 1px dashed #0066cc;
  background: rgba(0, 102, 204, 0.1);
  pointer-events: none;
}

.viewport-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: #252525;
  border-top: 1px solid #333;
  color: #ccc;
  font-size: 11px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.info-item i {
  color: #0066cc;
  font-size: 10px;
}

.minimap-toggle {
  background: transparent;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: auto;
}

.minimap-toggle:hover {
  background: #333;
  border-color: #444;
  color: #fff;
}
</style>
