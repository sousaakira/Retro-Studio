import { ipcMain } from 'electron'
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
    const manifest = await getPackageManifest()
    const pkg = manifest.packages.find((p) => p.id === packageId)
    if (!pkg) return { success: false, error: 'Pacote não encontrado.' }

    const platformKey = getPlatformKey()
    if (!pkg.platforms?.[platformKey]) {
      return { success: false, error: `Pacote não disponível para ${platformKey}.` }
    }

    const sendProgress = (data) => {
      const win = mainWindowRef
      if (win && !win.isDestroyed()) {
        win.webContents.send('retro:download-package-progress', { packageId, ...data })
      }
    }

    try {
      return await downloadPackage(pkg, platformKey, sendProgress)
    } catch (err) {
      console.error('[Retro] download-package error:', err)
      return { success: false, error: err.message }
    }
  })
}
