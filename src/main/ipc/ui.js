import { ipcMain, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'
import { loadConfigFile, saveConfigFile, TOOLKIT_DIR } from '../utils.js'

export function setupUiHandlers() {
  ipcMain.on('save-ui-settings', (event, settings) => {
    saveConfigFile('ui-settings.json', settings);
  });

  ipcMain.handle('get-ui-settings', async () => {
    const settings = loadConfigFile('ui-settings.json', {});
    if (!settings.toolkitPath) {
      const defaultToolkitPath = path.join(TOOLKIT_DIR, 'marsdev', 'mars');
      if (fs.existsSync(defaultToolkitPath)) {
        settings.toolkitPath = defaultToolkitPath;
      }
    }
    return settings;
  });

  ipcMain.on('window-control', (_event, action) => {
    if (!state.mainWindow) return
    switch (action) {
      case 'minimize': state.mainWindow.minimize(); break
      case 'maximize': state.mainWindow.isMaximized() ? state.mainWindow.unmaximize() : state.mainWindow.maximize(); break
      case 'close': state.mainWindow.close(); break
    }
  })

  ipcMain.on('select-folder', (event) => {
    dialog.showOpenDialog(state.mainWindow, {
      properties: ['openDirectory']
    }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        event.reply('folder-selected', { path: result.filePaths[0] })
      }
    })
  })

  ipcMain.on('select-file', (event, options = {}) => {
    dialog.showOpenDialog(state.mainWindow, {
      title: options.title || 'Selecionar Arquivo',
      properties: ['openFile'],
      filters: options.filters || []
    }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        event.reply('file-selected', { path: result.filePaths[0] })
      }
    })
  })

  ipcMain.on('open-external-editor', (event, { editorPath, filePath }) => {
    if (!editorPath || !filePath) return
    const { spawn } = require('child_process')
    spawn(editorPath, [filePath], { detached: true, stdio: 'ignore' }).unref()
  })

  ipcMain.on('open-external-url', (event, url) => {
    if (url) shell.openExternal(url)
  })
}
