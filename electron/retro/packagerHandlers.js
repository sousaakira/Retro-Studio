import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { packageForSteamLinux } from './packager.js'
import { findRomOutput } from './emulatorUtils.js'

export function setupPackagerHandlers() {
  ipcMain.handle('retro:can-package-steam-linux', async (_event, projectPath) => {
    if (process.platform !== 'linux') return { canPackage: false, reason: 'Apenas Linux' }
    if (!projectPath || !fs.existsSync(projectPath)) return { canPackage: false, reason: 'Projeto inválido' }
    const romPath = findRomOutput(projectPath)
    return { canPackage: !!romPath, reason: romPath ? null : 'Execute o build antes de empacotar' }
  })

  ipcMain.handle('retro:package-steam-linux', async (event, options = {}) => {
    const { projectPath, outputPath: givenOutputPath, gameName, emulatorId } = options

    if (process.platform !== 'linux') {
      return { success: false, error: 'Empacotamento Steam Linux só é suportado em Linux.' }
    }

    let outputPath = givenOutputPath
    if (!outputPath) {
      const result = await dialog.showOpenDialog({
        title: 'Pasta de saída do pacote',
        defaultPath: projectPath ? path.join(projectPath, 'dist') : undefined,
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths?.length) {
        return { success: false, canceled: true }
      }
      outputPath = result.filePaths[0]
    }

    try {
      const result = await packageForSteamLinux({
        projectPath,
        outputPath,
        gameName,
        emulatorId,
        onProgress: (msg) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('retro:package-progress', msg)
          }
        }
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}
