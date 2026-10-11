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
  const isBuilding = ref(false)
  const isPlaying = ref(false)
  const isPackaging = ref(false)
  const buildProgressMessage = ref('')
  // Barra de progresso do build: etapa, porcentagem e arquivo atual (null = sem build).
  const buildProgress = ref(null)
  const startProgress = () => { buildProgress.value = { stage: 'start', percent: 0, detail: '' } }
  window.retroStudio?.retro?.onBuildProgress?.((value) => { if (buildProgress.value && value && Number.isFinite(value.percent)) buildProgress.value = { stage: String(value.stage || 'start'), percent: Math.max(buildProgress.value.percent, Math.min(100, value.percent)), detail: String(value.detail || '') } })
  const compilationErrors = ref([])
  let pendingPackageAfterBuild = false

  function handlePlayRetro() {
    if (!retroUiSettings.value?.toolkitPath) {
      window.retroStudioToast?.warning?.('Configure o MarsDev Toolkit em Settings > Retro Studio')
      openSettings()
      return
    }
    compilationErrors.value = []
    buildProgressMessage.value = ''
    startProgress()
    isPlaying.value = true
    runGame()
  }

  // #45: a build or run that failed is over. Without this the toolbar stayed on
  // "working" and Build stayed disabled until the user pressed Stop.
  function handleBuildFailed() {
    isBuilding.value = false
    isPlaying.value = false
    buildProgressMessage.value = ''
    pendingPackageAfterBuild = false
  }

  function handleStopRetro() {
    stopBuild()
    isBuilding.value = false
    isPlaying.value = false
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
    startProgress()
    isBuilding.value = true
    buildOnly(true)
  }

  async function runPackageSteamLinux() {
    const api = window.retroStudio?.retro
    const projectPath = projectConfig.value?.path || workspacePath?.value
    if (!api?.packageSteamLinux || !projectPath) return
    isPackaging.value = true
    buildProgressMessage.value = ''
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
        startProgress()
        isBuilding.value = true
        buildOnly(true)
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
    isBuilding,
    isPlaying,
    isPackaging,
    buildProgressMessage,
    buildProgress,
    compilationErrors,
    handlePlayRetro,
    handleStopRetro,
    handleBuildRetro,
    handlePackageRetro,
    runPackageSteamLinux,
    onBuildComplete,
    handleBuildFailed,
    clearCompilationErrors: () => { compilationErrors.value = [] }
  }
}
