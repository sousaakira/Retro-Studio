import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { loadConfigFile } from './utils.js'
import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'
import { parseCompilationOutput } from './errorParser.js'
import { createBuildProgress } from '../../shared/retro/buildProgress.js'
import { classifyBuildFailure } from '../../shared/retro/toolchain.js'
import { beginBuildSnapshot, finishBuildSnapshot } from './buildSnapshot.js'
import { validateWorldForBuild } from './worldConfiguration.js'
import { validateCameraForBuild } from './cameraConfiguration.js'
import { validateProgressForBuild } from './progressConfiguration.js'
import { validateAudioForBuild } from './audioConfiguration.js'
import { validateCutsceneAdapterForBuild } from './cutsceneAdapter.js'
import { validateDebugForBuild } from './debugConfiguration.js'
import { validatePaletteForBuild } from './paletteConfiguration.js'
import { validateHudForBuild } from './hudConfiguration.js'
import { validateGameForBuild } from './gameHost.js'
import { planBuildFlavor, markBuildFlavor, acquireBuild, buildOwner } from './buildFlavor.js'

let mainWindowRef = null

// Quantos arquivos um build completo compila (para a barra de progresso). Limitado para não varrer pastas enormes.
function countBuildInputs(projectPath) {
  let sources = 0, resources = 0, visited = 0
  const walk = (directory, depth) => {
    if (depth > 6 || visited > 5000) return
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++visited > 5000) return
      if (entry.isDirectory()) { if (!entry.name.startsWith('.') && !(depth === 0 && entry.name === 'boot')) walk(path.join(directory, entry.name), depth + 1) }
      else if (/\.(c|s|asm|cpp)$/i.test(entry.name)) sources++
    }
  }
  walk(path.join(projectPath, 'src'), 0)
  try { resources = fs.readdirSync(path.join(projectPath, 'res')).filter(name => /\.res$/i.test(name)).length } catch { /* sem pasta de recursos */ }
  return { sources, resources }
}

export function setMainWindow(win) {
  mainWindowRef = win
}

function getMainWindow() {
  return mainWindowRef
}

const state = {
  releaseBuild: null,
  currentBuildProcess: null,
  emulatorProcess: null
}

/** O painel de depuração não constrói por cima de um build em andamento. */
export function isBuildRunning() { return !!state.currentBuildProcess }

function runBuild(projectPath, toolkitPath, event, runEmulator = true, isClean = false, wantedFlavor = 'release') {
  const mainWindow = getMainWindow()

  // Outro build do mesmo projeto (para depurar, ou pedido pela IA) usa o mesmo out/.
  if (projectPath && buildOwner(projectPath) && buildOwner(projectPath) !== 'ide') {
    event.reply('retro:run-game-error', { message: 'Já há um build deste projeto em andamento. Espere ele terminar.' })
    return
  }

  if (state.currentBuildProcess) {
    try {
      process.kill(-state.currentBuildProcess.pid, 'SIGTERM')
    } catch (e) {
      state.currentBuildProcess.kill()
    }
    state.currentBuildProcess = null
    state.releaseBuild?.()
  }
  if (runEmulator && state.emulatorProcess) {
    try {
      state.emulatorProcess.kill()
    } catch (e) { }
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
  let worldValidation
  try { worldValidation = validateWorldForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação do mundo: '+error.message,validation:{domain:'world',stage:'before-build'}})
    return
  }
  try { validateCameraForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação da câmera: '+error.message,validation:{domain:'camera',stage:'before-build'}})
    return
  }
  try { validateProgressForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação do progresso: '+error.message,validation:{domain:'progress',stage:'before-build'}})
    return
  }
  try { validateAudioForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação do áudio: '+error.message,validation:{domain:'audio',stage:'before-build'}})
    return
  }
  try { validateCutsceneAdapterForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação das cutscenes: '+error.message,validation:{domain:'cutscene',stage:'before-build'}})
    return
  }
  try { validateDebugForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação do diagnóstico: '+error.message,validation:{domain:'debug',stage:'before-build'}})
    return
  }
  try { validatePaletteForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação das paletas: '+error.message,validation:{domain:'palette',stage:'before-build'}})
    return
  }
  try { validateHudForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Validação do HUD: '+error.message,validation:{domain:'hud',stage:'before-build'}})
    return
  }
  try { validateGameForBuild(projectPath) }
  catch (error) {
    event.reply('retro:run-game-error', {message:'Jogador e início: '+error.message,validation:{domain:'game',stage:'before-build'}})
    return
  }

  // #64: trocar entre build comum e de depuração exige limpar os objetos antes.
  const flavor = planBuildFlavor(projectPath, wantedFlavor)
  isClean = isClean || flavor.clean
  const goal = flavor.goal

  const toolkitRunner = path.join(toolkitPath, 'dgen')
  const configData = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' })
  const selectedEmulatorName = configData.selectedEmulator || 'gen_sdl2'
  const selectedEmulatorPath = resolveEmulatorPath(selectedEmulatorName)
  const defaultEmulator = selectedEmulatorPath || resolveEmulatorPath('gen_sdl2')

  const isWin = process.platform === 'win32'
  const isSgdk = toolkitPath.toLowerCase().includes('sgdk') || fs.existsSync(path.join(toolkitPath, 'makefile.gen')) || fs.existsSync(path.join(toolkitPath, 'm68k-elf', 'makefile.gen'))

  let buildCommand = ''
  let spawnCmd = ''
  let spawnArgs = []
  let spawnEnv = { ...process.env, PATH: process.env.PATH }

  if (isSgdk) {
    // Honor project-specific preparation rules (e.g. TMX → SGDK resources).
    // The generated toolkit makefile remains the fallback for projects that
    // do not provide their own Makefile.
    const hasProjectMakefile = ['Makefile', 'makefile']
      .some((name) => fs.existsSync(path.join(projectPath, name)))
    if (isWin) {
      const makePath = fs.existsSync(path.join(toolkitPath, 'bin', 'make.exe'))
        ? path.join(toolkitPath, 'bin', 'make.exe')
        : path.join(toolkitPath, 'bin', 'make')
      const makefileGen = path.join(toolkitPath, 'makefile.gen')
      const makeCmd = hasProjectMakefile ? `"${makePath}"` : `"${makePath}" -f "${makefileGen}"`
      buildCommand = isClean ? `${makeCmd} clean && ${makeCmd}${goal}` : makeCmd + goal
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${projectPath}" && ${buildCommand}`]
      spawnEnv.GDK = toolkitPath
      spawnEnv.PATH = `${path.join(toolkitPath, 'bin')};${spawnEnv.PATH}`
    } else {
      const gdkPath = path.join(toolkitPath, 'm68k-elf')
      const makefileGen = path.join(gdkPath, 'makefile.gen')
      const makeCmd = hasProjectMakefile ? 'make' : `make -f "${makefileGen}"`
      buildCommand = isClean ? `${makeCmd} clean && ${makeCmd}${goal}` : makeCmd + goal
      buildCommand = `GDK="${gdkPath}" ${buildCommand}`
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${projectPath}" && ${buildCommand}`]
    }
  } else {
    const gdkPath = path.join(toolkitPath, 'm68k-elf')
    const makeCmd = `make`
    const buildCmd = isClean ? `${makeCmd} clean && ${makeCmd}${goal}` : makeCmd + goal

    if (isWin) {
      buildCommand = buildCmd
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${projectPath}" && set MARSDEV=${toolkitPath}&& set GDK=${gdkPath}&& ${buildCommand}`]
    } else {
      const envMake = `MARSDEV="${toolkitPath}" GDK="${gdkPath}"`
      buildCommand = `${envMake} ${buildCmd}`
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${projectPath}" && ${buildCommand}`]
    }
  }

  const sendToTerminal = (text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('retro:terminal-data', text)
    }
  }

  sendToTerminal(`\r\n> Iniciando build: ${buildCommand}\r\n`)
  // Barra de progresso: etapas e arquivos lidos da saída do make.
  const progress = createBuildProgress(countBuildInputs(projectPath))
  const sendProgress = (value) => { if (value && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('retro:build-progress', value) }
  sendProgress(progress.state())

  let buildOutput = ''
  const snapshotStart = beginBuildSnapshot(projectPath)
  // Até terminar bem, out/ pode misturar objetos dos dois tipos.
  if (isClean || flavor.flavor !== 'release') markBuildFlavor(projectPath, 'unknown', { create: flavor.flavor === 'debug' })
  state.releaseBuild?.()
  state.releaseBuild = acquireBuild(projectPath, 'ide')
  const releaseBuild = state.releaseBuild
  state.currentBuildProcess = spawn(spawnCmd, spawnArgs, {
    detached: !isWin,
    cwd: projectPath,
    env: spawnEnv
  })
  const buildProcess = state.currentBuildProcess

  state.currentBuildProcess.stdout.on('data', (data) => {
    const text = data.toString()
    buildOutput += text
    sendProgress(progress.feed(text))
    sendToTerminal(text.replace(/\n/g, '\r\n'))
  })

  state.currentBuildProcess.stderr.on('data', (data) => {
    const text = data.toString()
    buildOutput += text
    sendToTerminal(text.replace(/\n/g, '\r\n'))
  })

  state.currentBuildProcess.on('close', (code) => {
    // A superseded process must not clear or publish a newer build's state.
    releaseBuild?.()
    if (state.currentBuildProcess !== buildProcess) return
    state.currentBuildProcess = null

    const errors = parseCompilationOutput(buildOutput)
    if (errors.length > 0) {
      event.reply('retro:compilation-errors', { errors, output: buildOutput })
    }

    if (code !== 0) {
      // #61: say whose problem it is (tools on this machine or the game) when the output tells.
      const diagnosis = classifyBuildFailure(buildOutput)
      const scope = { environment: ' Problema do ambiente: ', game: ' Problema do jogo: ' }[diagnosis.scope]
      event.reply('retro:run-game-error', { message: `Build falhou com código ${code}.` + (scope ? scope + diagnosis.message : ''), diagnosis })
      return
    }

    markBuildFlavor(projectPath, flavor.flavor)
    sendProgress(progress.finish())
    const romPath = findRomOutput(projectPath)
    if (!romPath) {
      event.reply('retro:run-game-error', { message: 'ROM não encontrada após o build.' })
      return
    }
    try { worldValidation = validateWorldForBuild(projectPath, {expected:worldValidation}) }
    catch (error) {
      event.reply('retro:run-game-error', {message:'Validação do mundo: '+error.message,validation:{domain:'world',stage:'after-build'}})
      return
    }
    const buildSnapshot = finishBuildSnapshot(projectPath, snapshotStart, romPath)
    if (buildSnapshot.status === 'unavailable') sendToTerminal(`\r\n> Registro do build indisponível: ${buildSnapshot.error}\r\n`)

    if (!runEmulator) {
      event.reply('retro:build-complete', { romPath, buildSnapshot, worldValidation })
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

      event.reply('retro:run-game-build-complete', { romPath, emulator: emulatorToUse, buildSnapshot, worldValidation })
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
    runBuild(result.path, result.toolkitPath, event, false, result.clean)
  })

  ipcMain.on('retro:stop-build', () => {
    if (state.currentBuildProcess) {
      try {
        process.kill(-state.currentBuildProcess.pid, 'SIGTERM')
      } catch (e) {
        state.currentBuildProcess.kill()
      }
      state.currentBuildProcess = null
      state.releaseBuild?.()
    }
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.kill()
      } catch (e) { }
      state.emulatorProcess = null
    }
  })
}
