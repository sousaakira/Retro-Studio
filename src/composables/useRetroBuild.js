/**
 * Build Retro: play, build, package
 */
import { ref } from 'vue'

export function useRetroBuild({
  workspacePath,
  projectConfig,
  retroUiSettings,
  runGame,
  buildOnly,
  stopBuild,
  isTerminalOpen,
  terminalRef,
  layoutMonaco,
  fitTerminal,
  openSettings,
  nextTick
}) {
  const isRetroCompiling = ref(false)
  const isPackaging = ref(false)
  const buildProgressMessage = ref('')
  const compilationErrors = ref([])
  let pendingPackageAfterBuild = false

  function handlePlayRetro() {
    if (!retroUiSettings.value?.toolkitPath) {
      window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
      openSettings()
      return
    }
    isRetroCompiling.value = true
    runGame()
  }

  function handleStopRetro() {
    stopBuild()
    isRetroCompiling.value = false
    buildProgressMessage.value = ''
  }

  async function handleBuildRetro() {
    if (!retroUiSettings.value?.toolkitPath) {
      window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
      openSettings()
      return
    }
    compilationErrors.value = []
    buildProgressMessage.value = ''
    isRetroCompiling.value = true
    if (!isTerminalOpen.value) {
      isTerminalOpen.value = true
      nextTick(() => { layoutMonaco(); fitTerminal() })
    }
    buildOnly()
  }

  async function runPackageSteamLinux() {
    const api = window.retroStudio?.retro
    const projectPath = projectConfig.value?.path || workspacePath?.value
    if (!api?.packageSteamLinux || !projectPath) return
    isPackaging.value = true
    buildProgressMessage.value = ''
    if (!isTerminalOpen.value) {
      isTerminalOpen.value = true
      nextTick(() => { layoutMonaco(); fitTerminal() })
    }
    const unsub = api.onPackageProgress?.((msg) => {
      buildProgressMessage.value = msg
      terminalRef.value?.writeRetroData?.(`\r\n> ${msg}\r\n`)
    })
    try {
      const res = await api.packageSteamLinux({
        projectPath,
        gameName: projectConfig.value?.name
      })
      if (res?.success) {
        const out = res.appImagePath || res.appDirPath
        window.retroStudioToast?.success?.(`Pacote gerado: ${out}`)
      } else if (!res?.canceled) {
        window.retroStudioToast?.error?.(res?.error || 'Falha ao empacotar')
      }
    } catch (e) {
      window.retroStudioToast?.error?.(e?.message || 'Erro ao empacotar')
    } finally {
      unsub?.()
      isPackaging.value = false
      buildProgressMessage.value = ''
    }
  }

  async function handlePackageRetro() {
    const api = window.retroStudio?.retro
    const projectPath = projectConfig.value?.path || workspacePath?.value
    if (!projectPath || !api?.canPackageSteamLinux) return
    const { canPackage, reason } = await api.canPackageSteamLinux(projectPath)
    if (!canPackage) {
      if (reason === 'Execute o build antes de empacotar') {
        if (!retroUiSettings.value?.toolkitPath) {
          window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
          openSettings()
          return
        }
        pendingPackageAfterBuild = true
        compilationErrors.value = []
        isRetroCompiling.value = true
        buildOnly()
      } else {
        window.retroStudioToast?.warning?.(reason || 'Não é possível empacotar')
      }
      return
    }
    await runPackageSteamLinux()
  }

  function onBuildComplete(callback) {
    if (pendingPackageAfterBuild) {
      pendingPackageAfterBuild = false
      runPackageSteamLinux()
    } else {
      callback?.()
    }
  }

  return {
    isRetroCompiling,
    isPackaging,
    buildProgressMessage,
    compilationErrors,
    handlePlayRetro,
    handleStopRetro,
    handleBuildRetro,
    handlePackageRetro,
    runPackageSteamLinux,
    onBuildComplete,
    clearCompilationErrors: () => { compilationErrors.value = [] }
  }
}
