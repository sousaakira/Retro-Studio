import { ref, computed } from 'vue'

const sceneNodes = ref([])
const selectedNodeId = ref(null)
const currentScene = ref(null)
const currentScenePath = ref(null)

export function useSceneState() {
  const selectedNode = computed(() =>
    sceneNodes.value.find((n) => n.id === selectedNodeId.value)
  )

  function addNode(node) {
    const id = `node_${Date.now()}_${Math.random().toString(36).slice(2)}`
    sceneNodes.value.push({ ...node, id })
    selectedNodeId.value = id
    return id
  }

  function removeNode(id) {
    sceneNodes.value = sceneNodes.value.filter((n) => n.id !== id)
    if (selectedNodeId.value === id) selectedNodeId.value = null
  }

  function updateNode(id, updates) {
    const idx = sceneNodes.value.findIndex((n) => n.id === id)
    if (idx >= 0) sceneNodes.value[idx] = { ...sceneNodes.value[idx], ...updates }
  }

  function setNodes(nodes) {
    sceneNodes.value = nodes || []
    selectedNodeId.value = null
  }

  function loadScene(sceneData, path) {
    currentScene.value = sceneData
    currentScenePath.value = path
    setNodes(sceneData?.nodes || [])
  }

  function clearScene() {
    currentScene.value = null
    currentScenePath.value = null
    setNodes([])
  }

  return {
    sceneNodes,
    selectedNodeId,
    selectedNode,
    currentScene,
    currentScenePath,
    addNode,
    removeNode,
    updateNode,
    setNodes,
    loadScene,
    clearScene
  }
}
