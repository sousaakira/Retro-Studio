import { ensureConfigDir } from './utils.js'
import { setupGameHandlers, setMainWindow as setGameMainWindow } from './game.js'
import { setupProjectHandlers } from './project.js'
import { setupEmulatorHandlers } from './emulator.js'
import { setupDownloadHandlers, setMainWindow as setDownloadsMainWindow } from './downloads.js'
import { setupSceneHandlers } from './scene.js'
import { setupTutorialHandlers } from './tutorials.js'
import { setupCartridgeHandlers } from './cartridge.js'

export function setupRetroHandlers(mainWindow) {
  ensureConfigDir()
  setGameMainWindow(mainWindow)
  setDownloadsMainWindow(mainWindow)
  setupGameHandlers()
  setupProjectHandlers()
  setupEmulatorHandlers(mainWindow)
  setupDownloadHandlers()
  setupSceneHandlers()
  setupTutorialHandlers()
  setupCartridgeHandlers()
}
