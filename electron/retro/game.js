import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { loadConfigFile } from './utils.js'
import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'
import { parseCompilationOutput } from './errorParser.js'

let mainWindowRef = null

export function setMainWindow(win) {
  mainWindowRef = win
}

function getMainWindow() {
  return mainWindowRef
}

const state = {
  currentBuildProcess: null,
  emulatorProcess: null
}

function runBuild(projectPath, toolkitPath, event, runEmulator = true) {
  const mainWindow = getMainWindow()

  if (state.currentBuildProcess) {
    try {
      process.kill(-state.currentBuildProcess.pid, 'SIGTERM')
    } catch (e) {
      state.currentBuildProcess.kill()
    }
    state.currentBuildProcess = null
  }
  if (runEmulator && state.emulatorProcess) {
    try {
      state.emulatorProcess.kill()
    } catch (e) {}
    state.emulatorProcess = null
  }

  if (!toolkitPath || !fs.existsSync(toolkitPath)) {
    event.reply('retro:run-game-error', { message: 'Toolkit path inválido.' })
    return
  }

  if (!projectPath || !fs.existsSync(projectPath)) {
    event.reply('retro:run-game-error', { message: 'Projeto inválido.' })
    return
  }

  const toolkitRunner = path.join(toolkitPath, 'dgen')
  const configData = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' })
  const selectedEmulatorName = configData.selectedEmulator || 'gen_sdl2'
  const selectedEmulatorPath = resolveEmulatorPath(selectedEmulatorName)
  const defaultEmulator = selectedEmulatorPath || resolveEmulatorPath('gen_sdl2')

  const gdkPath = path.join(toolkitPath, 'm68k-elf')
  const envMake = `MARSDEV="${toolkitPath}" GDK="${gdkPath}"`
  const buildCommand = `${envMake} make`

  const sendToTerminal = (text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('retro:terminal-data', text)
    }
  }

  sendToTerminal(`\r\n> Iniciando build: ${buildCommand}\r\n`)

  let buildOutput = ''
  state.currentBuildProcess = spawn('sh', ['-c', `cd "${projectPath}" && ${buildCommand}`], {
    detached: true,
    cwd: projectPath
  })

  state.currentBuildProcess.stdout.on('data', (data) => {
    const text = data.toString()
    buildOutput += text
    sendToTerminal(text.replace(/\n/g, '\r\n'))
  })

  state.currentBuildProcess.stderr.on('data', (data) => {
    const text = data.toString()
    buildOutput += text
    sendToTerminal(text.replace(/\n/g, '\r\n'))
  })

  state.currentBuildProcess.on('close', (code) => {
    const wasKilled = state.currentBuildProcess === null
    state.currentBuildProcess = null

    if (wasKilled && code !== 0) return

    const errors = parseCompilationOutput(buildOutput)
    if (errors.length > 0) {
      event.reply('retro:compilation-errors', { errors, output: buildOutput })
    }

    if (code !== 0) {
      event.reply('retro:run-game-error', { message: `Build falhou com código ${code}.` })
      return
    }

    const romPath = findRomOutput(projectPath)
    if (!romPath) {
      event.reply('retro:run-game-error', { message: 'ROM não encontrada após o build.' })
      return
    }

    if (!runEmulator) {
      event.reply('retro:build-complete', { romPath })
      return
    }

    const emulatorToUse = defaultEmulator && fs.existsSync(defaultEmulator) ? defaultEmulator : toolkitRunner

    sendToTerminal(`\r\n> Executando: "${emulatorToUse}" "${romPath}"\r\n`)

    try {
      state.emulatorProcess = spawn(emulatorToUse, [romPath], {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      state.emulatorProcess.stdout.on('data', (data) => {
        sendToTerminal(data.toString().replace(/\n/g, '\r\n'))
      })

      state.emulatorProcess.stderr.on('data', (data) => {
        sendToTerminal(data.toString().replace(/\n/g, '\r\n'))
      })

      state.emulatorProcess.on('close', (code) => {
        state.emulatorProcess = null
        event.reply('retro:emulator-closed', { code })
      })

      state.emulatorProcess.on('error', (err) => {
        state.emulatorProcess = null
        event.reply('retro:run-game-error', { message: `Erro ao iniciar emulador: ${err.message}` })
      })

      event.reply('retro:run-game-build-complete', { romPath, emulator: emulatorToUse })
    } catch (e) {
      event.reply('retro:run-game-error', { message: `Falha ao disparar emulador: ${e.message}` })
    }
  })
}

export function setupGameHandlers() {
  ipcMain.on('retro:run-game', (event, result) => {
    runBuild(result.path, result.toolkitPath, event, true)
  })

  ipcMain.on('retro:build-only', (event, result) => {
    runBuild(result.path, result.toolkitPath, event, false)
  })

  ipcMain.on('retro:stop-build', () => {
    if (state.currentBuildProcess) {
      try {
        process.kill(-state.currentBuildProcess.pid, 'SIGTERM')
      } catch (e) {
        state.currentBuildProcess.kill()
      }
      state.currentBuildProcess = null
    }
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.kill()
      } catch (e) {}
      state.emulatorProcess = null
    }
  })
}
