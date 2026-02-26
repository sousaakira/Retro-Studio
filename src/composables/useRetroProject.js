import { ref, computed, watch } from 'vue'

const projectConfig = ref(null)
const isRetroProject = ref(false)
const uiSettings = ref({ toolkitPath: '' })

export function useRetroProject(workspacePath) {
  const checkRetroProject = async () => {
    if (!workspacePath?.value) {
      isRetroProject.value = false
      projectConfig.value = null
      return
    }
    try {
      const isRetro = await window.retroStudio?.retro?.isRetroProject(workspacePath.value)
      isRetroProject.value = !!isRetro
      if (isRetro) {
        const config = await window.retroStudio?.retro?.getProjectConfig(workspacePath.value)
        projectConfig.value = { ...config, path: workspacePath.value }
      } else {
        projectConfig.value = null
      }
    } catch (e) {
      isRetroProject.value = false
      projectConfig.value = null
    }
  }

  const loadUiSettings = async () => {
    try {
      const settings = await window.retroStudio?.retro?.getUiSettings?.()
      uiSettings.value = settings || {}
    } catch (e) {
      uiSettings.value = {}
    }
  }

  const toolkitPath = computed(() => uiSettings.value?.toolkitPath || '')

  const runGame = () => {
    const path = projectConfig.value?.path || workspacePath?.value
    const toolkit = uiSettings.value?.toolkitPath
    if (path && toolkit) {
      window.retroStudio?.retro?.runGame?.(path, toolkit)
    }
  }

  const buildOnly = () => {
    const path = projectConfig.value?.path || workspacePath?.value
    const toolkit = uiSettings.value?.toolkitPath
    if (path && toolkit) {
      window.retroStudio?.retro?.buildOnly?.(path, toolkit)
    }
  }

  const stopBuild = () => {
    window.retroStudio?.retro?.stopBuild?.()
  }

  if (workspacePath) {
    watch(workspacePath, checkRetroProject, { immediate: true })
  }

  return {
    projectConfig,
    isRetroProject,
    uiSettings,
    toolkitPath,
    checkRetroProject,
    loadUiSettings,
    runGame,
    buildOnly,
    stopBuild
  }
}
