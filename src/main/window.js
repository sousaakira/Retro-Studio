import { BrowserWindow, screen, Tray, Menu, globalShortcut, app } from 'electron'
import path from 'path'
import { state } from './state.js'
import { ensureConfigDir } from './utils.js'
import { setupHelpWatcher } from './helpWatcher.js'

const isDevelopment = !app.isPackaged

export async function createWindow() {
  const iconPath = isDevelopment 
    ? path.join(process.cwd(), 'public', 'icon.png')
    : path.join(__dirname, '../dist', 'icon.png')
    
  try {
    new Tray(iconPath)
  } catch (e) {
    console.warn('Falha ao carregar ícone da bandeja:', e.message)
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = targetDisplay.workArea
  
  const windowWidth = 1500
  const windowHeight = 867
  const windowX = Math.floor(displayX + (displayWidth - windowWidth) / 2)
  const windowY = Math.floor(displayY + (displayHeight - windowHeight) / 2)

  const preloadPath = path.join(__dirname, 'preload.js')

  state.mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: preloadPath,
      devTools: true,
      sandbox: false
    },
    icon: iconPath,
    show: false
  })

  state.mainWindow.once('ready-to-show', () => {
    console.log('[Main] Event: ready-to-show')
    state.mainWindow.setPosition(windowX, windowY)
    state.mainWindow.show()
    if (isDevelopment) {
      console.log('[Main] Janela pronta - Abrindo DevTools')
      state.mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  setTimeout(() => {
    if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isVisible()) {
      console.warn('[Main] Timeout: ready-to-show demorou demais, mostrando janela forçadamente')
      state.mainWindow.show()
      if (isDevelopment) {
        state.mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
    }
  }, 5000)

  setupHelpWatcher(state.mainWindow);

  state.mainWindow.on('maximize', () => {
    state.mainWindow.webContents.send('window-control-state', { isMaximized: true })
  })

  state.mainWindow.on('unmaximize', () => {
    state.mainWindow.webContents.send('window-control-state', { isMaximized: false })
  })

  state.mainWindow.webContents.on('devtools-opened', () => {
    state.mainWindow.webContents.send('status-message', { message: 'DevTools Aberto', type: 'info' })
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('[Main] VITE_DEV_SERVER_URL detectada:', process.env.VITE_DEV_SERVER_URL)
    try {
      await state.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
      console.log('[Main] URL carregada com sucesso')
    } catch (error) {
      console.error('[Main] Erro ao carregar URL do Vite, usando fallback local:', error)
      state.mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }
  } else {
    console.log('[Main] Carregando index.html local (Produção ou Sem Server)')
    state.mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

export function setupAppMenu() {
  const menuTemplate = [
    { label: 'RetroStudio', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [ { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' } ] },
    { label: 'View', submenu: [ { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' } ] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (state.mainWindow) {
      state.mainWindow.webContents.isDevToolsOpened() ? state.mainWindow.webContents.closeDevTools() : state.mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  globalShortcut.register('F5', () => {
    if (state.mainWindow) state.mainWindow.webContents.reload()
  })
}
