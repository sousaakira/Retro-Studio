import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveEmulatorPath } from './emulatorUtils.js'
import { inspectEnvironment, environmentInstallPlan, installEnvironment } from './environment.js'
import { loadConfigFile, saveConfigFile } from './utils.js'
import {
  getPackageManifest,
  getPlatformKey,
  isPackageInstalled,
  downloadPackage,
  getInstallDir
} from './downloadManager.js'

let mainWindowRef = null

export function setMainWindow(win) {
  mainWindowRef = win
}

export function setupDownloadHandlers() {
  const toolkit = () => { const value=loadConfigFile('ui-settings.json', {}).toolkitPath;return typeof value==='string'?value:'' }
  const toolkitReady = root => !!root && ['makefile.gen','inc/genesis.h','bin/rescomp.jar',process.platform==='win32'?'bin/gcc.exe':'bin/m68k-elf-gcc'].every(file=>fs.existsSync(path.join(root,process.platform==='win32'?'':'m68k-elf',file)))
  const emulatorReady = () => !!resolveEmulatorPath(loadConfigFile('emulator-config.json', {}).selectedEmulator || 'gen_sdl2')
  const environmentStatus = async () => {
    const host = await inspectEnvironment({ toolkit:toolkit() })
    const items = [...host.items, {id:'toolkit',ok:toolkitReady(toolkit()),version:toolkit()}, {id:'emulator',ok:emulatorReady(),version:''}]
    const install = environmentInstallPlan(host)
    // Downloaded SDKs/emulators use the existing catalog, without root privileges.
    install.supported = (host.ready || install.supported) && ['linux','win32'].includes(process.platform)
    return { ...host, toolkitPath:toolkit(), hostReady:host.ready, ready:items.every(item=>item.ok), items, install }
  }
  ipcMain.handle('retro:environment-status', environmentStatus)
  let preparing = false, downloading = false
  ipcMain.handle('retro:prepare-environment', async event => {
    if (!mainWindowRef || mainWindowRef.isDestroyed() || event.sender !== mainWindowRef.webContents ||
        !event.senderFrame || event.senderFrame.routingId !== event.sender.mainFrame.routingId || event.senderFrame.processId !== event.sender.mainFrame.processId)
      return { success:false, error:'environmentSender' }
    if (preparing || downloading) return {success:false,error:'environmentBusy'}
    preparing = true
    try {
      const host = await installEnvironment({ toolkit:toolkit() })
      if (!host.ready) return { success:true, ...await environmentStatus() }
      const platform = getPlatformKey()
      let manifest
      const ensurePackage = async id => {
        manifest ||= await getPackageManifest()
        const pkg = manifest.packages.find(item=>item.id===id)
        if (!pkg?.platforms?.[platform]) throw new Error('environmentManual')
        const destination = getInstallDir(pkg.platforms[platform].extractTo)
        // Never extract over an existing partial/custom installation.
        if (!destination || (fs.existsSync(destination) && fs.readdirSync(destination).length)) throw new Error('environmentExistingFiles')
        return downloadPackage(pkg,platform,data=>{
          if (!event.sender.isDestroyed()) event.sender.send('retro:download-package-progress',{packageId:id,...data})
        })
      }
      if (!toolkitReady(toolkit())) {
        const before = loadConfigFile('ui-settings.json', {})
        const existing = getInstallDir(['toolkit','marsdev','mars'])
        const result = toolkitReady(existing) ? {installPath:existing} : await ensurePackage('marsdev')
        if (!toolkitReady(result.installPath)) throw new Error('environmentToolkitInvalid')
        const latest = loadConfigFile('ui-settings.json', {})
        if (latest.toolkitPath !== before.toolkitPath) throw new Error('environmentSettingsChanged')
        if (!saveConfigFile('ui-settings.json',{...latest,toolkitPath:result.installPath})) throw new Error('environmentInstallFailed')
      }
      if (!emulatorReady()) {
        const before = loadConfigFile('emulator-config.json', {})
        if (!resolveEmulatorPath('gen_sdl2')) await ensurePackage('gen_sdl2')
        if (!resolveEmulatorPath('gen_sdl2')) throw new Error('environmentToolkitInvalid')
        const latest = loadConfigFile('emulator-config.json', {})
        if (latest.selectedEmulator !== before.selectedEmulator) throw new Error('environmentSettingsChanged')
        if (!saveConfigFile('emulator-config.json',{...latest,selectedEmulator:'gen_sdl2'})) throw new Error('environmentInstallFailed')
      }
      return { success:true, ...await environmentStatus() }
    } catch (error) { return { success:false, error:/^environment[A-Za-z]+$/.test(error.message)?error.message:'environmentInstallFailed' } }
    finally { preparing = false }
  })
  ipcMain.handle('retro:get-downloadable-packages', async () => {
    const manifest = await getPackageManifest()
    const platformKey = getPlatformKey()
    const packages = manifest.packages.map((pkg) => {
      const platformConfig = pkg.platforms?.[platformKey]
      const extractTo = platformConfig?.extractTo
      const installed = extractTo ? isPackageInstalled(extractTo) : false
      const installPath = extractTo ? getInstallDir(extractTo) : null
      const available = !!platformConfig?.url
      return {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        category: pkg.category,
        available,
        installed,
        installPath: installed ? installPath : null
      }
    })
    return { success: true, packages, platform: platformKey }
  })

  ipcMain.handle('retro:download-package', async (_event, { packageId }) => {
    if (preparing || downloading) return {success:false,error:'Outra preparação ou download está em andamento. Aguarde terminar.'}
    downloading = true
    try {
      console.log('[Retro] retro:download-package: packageId=', packageId)
      const manifest = await getPackageManifest()
      const pkg = manifest.packages.find((p) => p.id === packageId)
      if (!pkg) {
        console.error('[Retro] retro:download-package: pacote não encontrado', packageId)
        return { success: false, error: 'Pacote não encontrado.' }
      }

      const platformKey = getPlatformKey()
      if (!pkg.platforms?.[platformKey]) {
        console.error('[Retro] retro:download-package: plataforma não disponível', { packageId, platformKey })
        return { success: false, error: `Pacote não disponível para ${platformKey}.` }
      }

      const sendProgress = (data) => {
        const win = mainWindowRef
        if (win && !win.isDestroyed()) {
          win.webContents.send('retro:download-package-progress', { packageId, ...data })
        }
      }

      try {
        const result = await downloadPackage(pkg, platformKey, sendProgress)
        console.log('[Retro] retro:download-package: sucesso', pkg.id, result.installPath)
        return result
      } catch (err) {
        console.error('[Retro] retro:download-package error:', err.message, 'packageId=', packageId, 'url=', pkg.platforms?.[platformKey]?.url)
        return { success: false, error: err.message }
      }
    } finally { downloading = false }
  })
}
