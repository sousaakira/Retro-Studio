import { ref, computed, watch } from 'vue'

const projectConfig = ref(null)
const isRetroProject = ref(false)
const uiSettings = ref({ toolkitPath: '' })

export function useRetroProject(workspacePath) {
  let projectRequest = 0
  const checkRetroProject = async () => {
    const request = ++projectRequest
    const path = workspacePath?.value
    const current = () => request === projectRequest && workspacePath?.value === path
    isRetroProject.value = false
    projectConfig.value = null
    if (!path) {
      try { await window.retroStudio?.retro?.lspStop?.(null) } catch { /* ignore */ }
      return
    }
    try {
      const isRetro = await window.retroStudio?.retro?.isRetroProject(path)
      if (!current() || !isRetro) return
      const config = await window.retroStudio?.retro?.getProjectConfig(path)
      if (!current()) return
      projectConfig.value = { ...config, path }
      isRetroProject.value = true
      try { await window.retroStudio?.retro?.lspEnsureFlags?.(path) } catch { /* ignore */ }
    } catch {
      if (current()) {
        isRetroProject.value = false
        projectConfig.value = null
      }
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

  const buildOnly = (isClean = false) => {
    const path = projectConfig.value?.path || workspacePath?.value
    const toolkit = uiSettings.value?.toolkitPath
    if (path && toolkit) {
      window.retroStudio?.retro?.buildOnly?.(path, toolkit, isClean)
    }
  }

  const stopBuild = () => {
    window.retroStudio?.retro?.stopBuild?.()
  }

  if (workspacePath) {
    watch(workspacePath, checkRetroProject, { immediate: true, flush: 'sync' })
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
