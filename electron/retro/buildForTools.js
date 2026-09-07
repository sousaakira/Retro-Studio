/**
 * Build e emulador para tools da IA (retorna Promise)
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { loadConfigFile } from './utils.js'
import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'
import { parseCompilationOutput } from './errorParser.js'

function getToolkitPath() {
  const ui = loadConfigFile('ui-settings.json', {})
  const p = ui.toolkitPath || ''
  return p && fs.existsSync(p) ? p : null
}

/**
 * Executa build do projeto. Retorna Promise com resultado.
 * @param {string} projectPath - Caminho do projeto
 * @param {string} [toolkitPath] - Caminho do toolkit (opcional, usa ui-settings se omitido)
 * @param {{ clean?: boolean }} [options]
 * @returns {Promise<{ success: boolean, romPath?: string, stderr?: string, stdout?: string, exitCode?: number, errors?: Array }>}
 */
export function runBuildAsync(projectPath, toolkitPath = null, options = {}) {
  const { clean = false } = options
  const tkPath = toolkitPath || getToolkitPath()

  if (!tkPath || !fs.existsSync(tkPath)) {
    return Promise.resolve({ success: false, error: 'Toolkit path inválido ou não configurado.' })
  }
  if (!projectPath || !fs.existsSync(projectPath)) {
    return Promise.resolve({ success: false, error: 'Projeto inválido.' })
  }

  const isWin = process.platform === 'win32'
  const isSgdk = tkPath.toLowerCase().includes('sgdk') ||
    fs.existsSync(path.join(tkPath, 'makefile.gen')) ||
    fs.existsSync(path.join(tkPath, 'm68k-elf', 'makefile.gen'))

  let buildCommand = ''
  let spawnCmd = ''
  let spawnArgs = []
  let spawnEnv = { ...process.env, PATH: process.env.PATH }

  if (isSgdk) {
    if (isWin) {
      const makePath = fs.existsSync(path.join(tkPath, 'bin', 'make.exe'))
        ? path.join(tkPath, 'bin', 'make.exe')
        : path.join(tkPath, 'bin', 'make')
      const makefileGen = path.join(tkPath, 'makefile.gen')
      const makeCmd = `"${makePath}" -f "${makefileGen}"`
      buildCommand = clean ? `${makeCmd} clean && ${makeCmd}` : makeCmd
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${projectPath}" && ${buildCommand}`]
      spawnEnv.GDK = tkPath
      spawnEnv.PATH = `${path.join(tkPath, 'bin')};${spawnEnv.PATH}`
    } else {
      const gdkPath = path.join(tkPath, 'm68k-elf')
      const makefileGen = path.join(gdkPath, 'makefile.gen')
      const makeCmd = `make -f "${makefileGen}"`
      buildCommand = clean ? `${makeCmd} clean && ${makeCmd}` : makeCmd
      buildCommand = `GDK="${gdkPath}" ${buildCommand}`
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${projectPath}" && ${buildCommand}`]
    }
  } else {
    const gdkPath = path.join(tkPath, 'm68k-elf')
    const makeCmd = 'make'
    const buildCmd = clean ? `${makeCmd} clean && ${makeCmd}` : makeCmd
    if (isWin) {
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${projectPath}" && set MARSDEV=${tkPath}&& set GDK=${gdkPath}&& ${buildCmd}`]
    } else {
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${projectPath}" && MARSDEV="${tkPath}" GDK="${gdkPath}" ${buildCmd}`]
    }
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(spawnCmd, spawnArgs, {
      detached: !isWin,
      cwd: projectPath,
      env: spawnEnv
    })

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      const output = stdout + stderr
      const errors = parseCompilationOutput(output)

      if (code !== 0) {
        resolve({
          success: false,
          exitCode: code,
          stdout,
          stderr: output,
          errors
        })
        return
      }

      const romPath = findRomOutput(projectPath)
      resolve({
        success: true,
        romPath,
        exitCode: 0,
        stdout,
        stderr: output,
        errors
      })
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * Executa emulador com a ROM.
 * @param {string} [romPath] - Caminho da ROM (opcional, usa última build se omitido)
 * @param {string} [projectPath] - Caminho do projeto (para findRomOutput se romPath omitido)
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function runEmulatorAsync(romPath = null, projectPath = null) {
  const configData = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' })
  const emulatorName = configData.selectedEmulator || 'gen_sdl2'
  const emulatorPath = resolveEmulatorPath(emulatorName)

  let rom = romPath
  if (!rom && projectPath) {
    rom = findRomOutput(projectPath)
  }
  if (!rom || !fs.existsSync(rom)) {
    return { success: false, message: 'ROM não encontrada. Execute build_rom primeiro.' }
  }
  if (!emulatorPath || !fs.existsSync(emulatorPath)) {
    return { success: false, message: 'Emulador não encontrado ou não configurado.' }
  }

  return new Promise((resolve) => {
    try {
      const proc = spawn(emulatorPath, [rom], {
        cwd: projectPath ? path.dirname(rom) : undefined,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      proc.on('error', (err) => resolve({ success: false, message: err.message }))
      proc.unref()
      resolve({ success: true, message: `Emulador iniciado com ${path.basename(rom)}` })
    } catch (e) {
      resolve({ success: false, message: e.message })
    }
  })
}
