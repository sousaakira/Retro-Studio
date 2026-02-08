/* eslint-disable no-unused-vars */
'use strict'

import { app, protocol, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'

// Importar estado e janelas
import { state } from './main/state.js'
import { createWindow, setupAppMenu } from './main/window.js'

// Importar Utilitários
import { ensureConfigDir } from './main/utils.js'

// Importar Handlers IPC
import { setupFsHandlers } from './main/ipc/fs.js'
import { setupProjectHandlers } from './main/ipc/project.js'
import { setupTerminalHandlers } from './main/ipc/terminal.js'
import { setupEmulatorHandlers } from './main/ipc/emulator.js'
import { setupSceneHandlers } from './main/ipc/scene.js'
import { setupUiHandlers } from './main/ipc/ui.js'
import { setupGameHandlers } from './main/ipc/game.js'
import { setupTutorialHandlers } from './main/ipc/tutorials.js'
import { setupCartridgeHandlers } from './main/ipc/cartridge.js'
import { setupDownloadHandlers } from './main/ipc/downloads.js'

const isDevelopment = !app.isPackaged

// Habilitar conexão remota para DevTools (Socket)
console.log('DEVELOPMENT --------> ', isDevelopment)
if (isDevelopment) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
  console.log('[Main] Remote debugging enabled on port 9222');
}

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (state.ptyProcess) {
    try {
      state.ptyProcess.kill();
    } catch (e) {
      console.error('Erro ao encerrar PTY:', e);
    }
  }
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (state.mainWindow === null) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', async () => {
  console.log('[Main] App is ready. Initializing...');
  
  // Garantir diretórios de configuração
  ensureConfigDir()

  // Registrar protocolo customizado 'app' para carregar assets do sistema de arquivos
  protocol.registerFileProtocol('app', (request, callback) => {
    let url = request.url.replace('app://./', '')
    url = url.replace('app://', '') // Remover protocolo se vier de outra forma
    const decodedUrl = decodeURIComponent(url)
    
    try {
      // Tentar resolver no diretório do bundle (dist_electron/bundled)
      let filePath = path.join(__dirname, decodedUrl)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      // Tentar resolver na raiz do ASAR (para assets do frontend como fontes)
      filePath = path.join(__dirname, '..', decodedUrl)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      // Tentar resolver caminhos absolutos (para o CSS/JS que referenciam fontes)
      const baseName = path.basename(decodedUrl)
      filePath = path.join(__dirname, baseName)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      // Resolver fonts que ficam em css/fonts no build do Vue
      if (decodedUrl.includes('fonts/')) {
        const fontPath = path.join(__dirname, 'fonts', baseName)
        if (fs.existsSync(fontPath)) {
          return callback({ path: fontPath })
        }
      }

      // Fallback para diretório de recursos (onde o extraResources joga os arquivos)
      const resourcesPath = process.resourcesPath
      if (resourcesPath) {
        filePath = path.join(resourcesPath, decodedUrl)
        if (fs.existsSync(filePath)) {
          return callback({ path: filePath })
        }
      }

      console.warn('[Protocol] File not found:', decodedUrl)
      callback({ error: -6 }) // net::ERR_FILE_NOT_FOUND
    } catch (error) {
      console.error('Protocol error:', error)
      callback({ error: -2 })
    }
  })

  // Registrar protocolo 'custom' (fallback legado se necessário)
  protocol.registerFileProtocol('custom', (request, callback) => {
    const url = request.url.replace('custom://', '');
    callback({ path: decodeURIComponent(url) });
  });

  // Inicializar todos os Handlers IPC
  console.log('[Main] Initializing IPC handlers...')
  setupFsHandlers()
  setupProjectHandlers()
  setupTerminalHandlers()
  setupEmulatorHandlers()
  setupSceneHandlers()
  setupUiHandlers()
  setupGameHandlers()
  setupTutorialHandlers()
  setupCartridgeHandlers()
  setupDownloadHandlers()
  console.log('[Main] All IPC handlers initialized')

  // Configurar Menu da Aplicação
  setupAppMenu()

  // Criar Janela Principal
  createWindow()
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}
