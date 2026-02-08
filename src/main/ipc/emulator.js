import { ipcMain, dialog } from 'electron'
import { getAvailableEmulators, getAvailableEmulatorsList } from '../emulatorUtils.js'
import { loadConfigFile, saveConfigFile } from '../utils.js'
import { state } from '../state.js'

export function setupEmulatorHandlers() {
  ipcMain.on('get-available-emulators', (event) => {
    try {
      const available = getAvailableEmulators()
      const list = getAvailableEmulatorsList()
      event.reply('available-emulators', {
        success: true,
        emulators: Object.keys(available),
        paths: available,
        list,
      })
    } catch (error) {
      console.error('Error getting available emulators:', error)
      event.reply('available-emulators', { success: false, error: error.message })
    }
  })

  ipcMain.on('get-emulator-config', (event) => {
    const config = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' });
    event.reply('emulator-config', { success: true, config });
  })

  ipcMain.on('set-emulator-config', (event, configData) => {
    const success = saveConfigFile('emulator-config.json', configData);
    event.reply('emulator-config-updated', { success });
  })

  ipcMain.on('get-custom-emulator-paths', (event) => {
    const defaults = { gen_sdl2: '', blastem: '', picodrive: '', md: '' }
    const paths = { ...defaults, ...loadConfigFile('custom-emulator-paths.json', {}) }
    event.reply('custom-emulator-paths', { success: true, paths })
  })

  ipcMain.on('set-custom-emulator-paths', (event, paths) => {
    const success = saveConfigFile('custom-emulator-paths.json', paths);
    event.reply('custom-emulator-paths', { success, paths });
  })

  ipcMain.on('browse-emulator-path', async (event, { emulator }) => {
    try {
      const displayNames = { gen_sdl2: 'Genesis SDL2', blastem: 'BlastEm', picodrive: 'PicoDrive', md: 'MD (DGen)' }
      const title = `Select ${displayNames[emulator] || emulator} Executable`
      const result = await dialog.showOpenDialog(state.mainWindow, {
        title,
        defaultPath: process.env.HOME,
        properties: ['openFile'],
        filters: [
          { name: 'Executable Files', extensions: ['', 'exe', 'bin'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        event.reply('emulator-path-selected', { 
          emulator, 
          path: selectedPath,
          success: true 
        })
      }
    } catch (error) {
      console.error('Error browsing for emulator path:', error)
      event.reply('emulator-path-selected', { 
        emulator, 
        success: false, 
        error: error.message 
      })
    }
  })
}
