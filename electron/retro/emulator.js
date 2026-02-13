import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getAvailableEmulators, getAvailableEmulatorsList } from './emulatorUtils.js'
import { loadConfigFile, saveConfigFile } from './utils.js'

export function setupEmulatorHandlers(mainWindow) {
  ipcMain.handle('retro:get-available-emulators', async () => {
    try {
      const available = getAvailableEmulators()
      const list = getAvailableEmulatorsList()
      return {
        success: true,
        emulators: Object.keys(available),
        paths: available,
        list
      }
    } catch (error) {
      console.error('[Retro] get-available-emulators error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:get-emulator-config', async () => {
    const config = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' })
    return { success: true, config }
  })

  ipcMain.handle('retro:set-emulator-config', async (_event, configData) => {
    const success = saveConfigFile('emulator-config.json', configData)
    return { success }
  })

  ipcMain.handle('retro:get-custom-emulator-paths', async () => {
    const defaults = { gen_sdl2: '', blastem: '', picodrive: '', md: '' }
    const paths = { ...defaults, ...loadConfigFile('custom-emulator-paths.json', {}) }
    return { success: true, paths }
  })

  ipcMain.handle('retro:set-custom-emulator-paths', async (_event, paths) => {
    const success = saveConfigFile('custom-emulator-paths.json', paths)
    return { success, paths }
  })

  ipcMain.handle('retro:browse-emulator-path', async (_event, { emulator }) => {
    try {
      const displayNames = { gen_sdl2: 'Genesis SDL2', blastem: 'BlastEm', picodrive: 'PicoDrive', md: 'MD (DGen)' }
      const title = `Select ${displayNames[emulator] || emulator} Executable`
      const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, {
        title,
        defaultPath: process.env.HOME,
        properties: ['openFile'],
        filters: [
          { name: 'Executable Files', extensions: ['', 'exe', 'bin'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (!result.canceled && result.filePaths.length > 0) {
        return { emulator, path: result.filePaths[0], success: true }
      }
      return { emulator, success: false }
    } catch (error) {
      console.error('[Retro] browse-emulator-path error:', error)
      return { emulator, success: false, error: error.message }
    }
  })
}
