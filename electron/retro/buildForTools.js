import { checkBuildEnvironment } from './environment.js'
/**
 * Build e emulador para tools da IA (retorna Promise)
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { loadConfigFile } from './utils.js'
import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'
import { parseCompilationOutput } from './errorParser.js'
import { classifyBuildFailure } from '../../shared/retro/toolchain.js'
import { beginBuildSnapshot, finishBuildSnapshot } from './buildSnapshot.js'
import { validateWorldForBuild } from './worldConfiguration.js'
import { validateCameraForBuild } from './cameraConfiguration.js'
import { validateEnemiesForBuild } from './enemyConfiguration.js'
import { validateProgressForBuild } from './progressConfiguration.js'
import { validateAudioForBuild } from './audioConfiguration.js'
import { validateCutsceneAdapterForBuild } from './cutsceneAdapter.js'
import { validateDebugForBuild } from './debugConfiguration.js'
import { validatePaletteForBuild } from './paletteConfiguration.js'
import { validateHudForBuild } from './hudConfiguration.js'
import { validateGameForBuild } from './gameHost.js'
import { planBuildFlavor, markBuildFlavor, acquireBuild } from './buildFlavor.js'

function getToolkitPath() {
  const ui = loadConfigFile('ui-settings.json', {})
  const p = ui.toolkitPath || ''
  return p && fs.existsSync(p) ? p : null
}

/**
 * Executa build do projeto. Retorna Promise com resultado.
 * @param {string} projectPath - Caminho do projeto
 * @param {string} [toolkitPath] - Caminho do toolkit (opcional, usa ui-settings se omitido)
 * @param {{ clean?: boolean, flavor?: 'release'|'debug', onProcess?: (stop: () => void) => void }} [options]
 *   onProcess recebe a função que cancela este build.
 * @returns {Promise<{ success: boolean, romPath?: string, stderr?: string, stdout?: string, exitCode?: number, errors?: Array }>}
 */
export async function runBuildAsync(projectPath, toolkitPath = null, options = {}) {
  const tkPath = toolkitPath || getToolkitPath()

  if (!tkPath || !fs.existsSync(tkPath)) {
    return Promise.resolve({ success: false, error: 'Toolkit path inválido ou não configurado.' })
  }
  if (!projectPath || !fs.existsSync(projectPath)) {
    return Promise.resolve({ success: false, error: 'Projeto inválido.' })
  }
  let cancelled = false, stopCurrent = null
  options.onProcess?.(() => { cancelled = true; stopCurrent?.() })
  const environment = await checkBuildEnvironment(tkPath, { projectPath })
  if (environment) return { success:false, error:environment.message, diagnosis:environment, errors:[] }
  if (cancelled) return { success:false, cancelled:true, error:'Build cancelado.', errors:[] }
  const plan = planBuildFlavor(projectPath || '', options.flavor)
  const clean = !!options.clean || plan.clean
  const goal = plan.goal
  let worldValidation
  try { worldValidation = validateWorldForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação do mundo: '+error.message,validation:{domain:'world',stage:'before-build'}}) }
  try { validateCameraForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação da câmera: '+error.message,validation:{domain:'camera',stage:'before-build'}}) }
  try { validateProgressForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação do progresso: '+error.message,validation:{domain:'progress',stage:'before-build'}}) }
  try { validateEnemiesForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação dos inimigos: '+error.message,validation:{domain:'enemies',stage:'before-build'}}) }
  try { validateAudioForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação do áudio: '+error.message,validation:{domain:'audio',stage:'before-build'}}) }
  try { validateCutsceneAdapterForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação das cutscenes: '+error.message,validation:{domain:'cutscene',stage:'before-build'}}) }
  try { validateDebugForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação do diagnóstico: '+error.message,validation:{domain:'debug',stage:'before-build'}}) }
  try { validatePaletteForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação das paletas: '+error.message,validation:{domain:'palette',stage:'before-build'}}) }
  try { validateHudForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Validação do HUD: '+error.message,validation:{domain:'hud',stage:'before-build'}}) }
  try { validateGameForBuild(projectPath) }
  catch (error) { return Promise.resolve({success:false,error:'Jogador e início: '+error.message,validation:{domain:'game',stage:'before-build'}}) }

  const isWin = process.platform === 'win32'
  const isSgdk = tkPath.toLowerCase().includes('sgdk') ||
    fs.existsSync(path.join(tkPath, 'makefile.gen')) ||
    fs.existsSync(path.join(tkPath, 'm68k-elf', 'makefile.gen'))

  let buildCommand = ''
  let spawnCmd = ''
  let spawnArgs = []
  let probeArgs = null // make -n do alvo pedido (só onde o shell é sh)
  let spawnEnv = { ...process.env, PATH: process.env.PATH }

  if (isSgdk) {
    const hasProjectMakefile = ['Makefile', 'makefile']
      .some((name) => fs.existsSync(path.join(projectPath, name)))
    if (isWin) {
      const makePath = fs.existsSync(path.join(tkPath, 'bin', 'make.exe'))
        ? path.join(tkPath, 'bin', 'make.exe')
        : path.join(tkPath, 'bin', 'make')
      const makefileGen = path.join(tkPath, 'makefile.gen')
      const makeCmd = hasProjectMakefile ? `"${makePath}"` : `"${makePath}" -f "${makefileGen}"`
      buildCommand = clean ? `${makeCmd} clean && ${makeCmd}${goal}` : makeCmd + goal
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${projectPath}" && ${buildCommand}`]
      spawnEnv.GDK = tkPath
      spawnEnv.PATH = `${path.join(tkPath, 'bin')};${spawnEnv.PATH}`
    } else {
      const gdkPath = path.join(tkPath, 'm68k-elf')
      const makefileGen = path.join(gdkPath, 'makefile.gen')
      const makeCmd = hasProjectMakefile ? 'make' : `make -f "${makefileGen}"`
      buildCommand = clean ? `${makeCmd} clean && ${makeCmd}${goal}` : makeCmd + goal
      // export: com limpeza o comando são dois make (clean && build) e os dois precisam do GDK.
      buildCommand = `export GDK="${gdkPath}" && ${buildCommand}`
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${projectPath}" && ${buildCommand}`]
      probeArgs = ['-c', `cd "${projectPath}" && GDK="${gdkPath}" ${makeCmd} -n${goal}`]
    }
  } else {
    const gdkPath = path.join(tkPath, 'm68k-elf')
    const makeCmd = 'make'
    const buildCmd = clean ? `${makeCmd} clean && ${makeCmd}${goal}` : makeCmd + goal
    if (isWin) {
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${projectPath}" && set MARSDEV=${tkPath}&& set GDK=${gdkPath}&& ${buildCmd}`]
    } else {
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${projectPath}" && export MARSDEV="${tkPath}" GDK="${gdkPath}" && ${buildCmd}`]
      probeArgs = ['-c', `cd "${projectPath}" && MARSDEV="${tkPath}" GDK="${gdkPath}" ${makeCmd} -n${goal}`]
    }
  }

  const releaseBuild = acquireBuild(projectPath, 'tools')
  if (!releaseBuild) return Promise.resolve({ success: false, error: 'Já há um build deste projeto em andamento. Espere ele terminar.' })
  // Antes de limpar qualquer coisa: o Makefile do projeto tem esse alvo? "make -n" não constrói
  // nada. Só a resposta "não há regra para o alvo" conta; qualquer outra falha do ensaio (um
  // arquivo que a geração ainda vai criar, por exemplo) fica para o build de verdade relatar.
  const kill = child => () => { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() } }
  const goalMissing = !(goal && probeArgs) ? Promise.resolve('') : new Promise((resolve) => {
    let text = ''
    const probe = spawn(spawnCmd, probeArgs, { detached: true, cwd: projectPath, env: { ...spawnEnv, LC_ALL: 'C', LANG: 'C' } })
    const timer = setTimeout(kill(probe), 60000)
    stopCurrent = kill(probe)
    const collect = (d) => { if (text.length < 1024 * 1024) text += d.toString() }
    probe.stdout?.on('data', collect); probe.stderr?.on('data', collect)
    probe.on('error', () => { clearTimeout(timer); resolve('') })
    probe.on('close', () => {
      clearTimeout(timer)
      const line = text.split(/\r?\n/).find(item => new RegExp("No rule to make target [`'\"]" + goal.trim() + "['\"]\\.\\s+Stop").test(item))
      resolve(line ? line.trim() : '')
    })
  })

  return goalMissing.then((missing) => new Promise((resolve) => {
    if (cancelled) { releaseBuild(); resolve({ success: false, cancelled: true, error: 'Build cancelado.', errors: [] }); return }
    if (missing) {
      releaseBuild()
      resolve({ success: false, missingGoal: true, error: `O Makefile deste projeto não constrói o alvo “${goal.trim()}”. Nada foi limpo nem alterado. Saída do make: ${missing}` })
      return
    }
    const snapshotStart = beginBuildSnapshot(projectPath)
    if (clean || plan.flavor !== 'release') markBuildFlavor(projectPath, 'unknown', { create: plan.flavor === 'debug' })
    let stdout = ''
    let stderr = ''

    const proc = spawn(spawnCmd, spawnArgs, {
      detached: !isWin,
      cwd: projectPath,
      env: spawnEnv
    })

    stopCurrent = kill(proc)
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      releaseBuild()
      const output = stdout + stderr
      const errors = parseCompilationOutput(output)
      if (cancelled) { resolve({ success: false, cancelled: true, error: 'Build cancelado.', errors: [] }); return }

      if (code !== 0) {
        resolve({
          success: false,
          exitCode: code,
          stdout,
          stderr: output,
          errors,
          diagnosis: classifyBuildFailure(output)
        })
        return
      }

      markBuildFlavor(projectPath, plan.flavor)
      const romPath = findRomOutput(projectPath)
      try { worldValidation = validateWorldForBuild(projectPath, {expected:worldValidation}) }
      catch (error) {
        resolve({success:false,error:'Validação do mundo: '+error.message,stdout,stderr:output,exitCode:code,errors,validation:{domain:'world',stage:'after-build'}})
        return
      }
      const buildSnapshot = romPath ? finishBuildSnapshot(projectPath, snapshotStart, romPath) : { status: 'unavailable', error: 'build-rom-missing' }
      resolve({
        success: true,
        romPath,
        flavor: plan.flavor,
        buildSnapshot,
        worldValidation,
        exitCode: 0,
        stdout,
        stderr: output,
        errors
      })
    })

    proc.on('error', (err) => {
      releaseBuild()
      resolve({ success: false, error: err.message })
    })
  }))
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
