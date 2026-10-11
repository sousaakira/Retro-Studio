import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { prepareMapExportStage, MAP_STAGE_PROTOCOL } from './mapExportStage.js'
import {hasManagedWorldMapExport} from './worldMapExport.js'
import {worldConfigurationStatus,saveWorldConfigurationWithMaps} from './worldConfiguration.js'

const MAX_OUTPUT_CHARS = 16000
const EXPORT_TIMEOUT_MS = 30000

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function trimOutput(value) {
  const text = String(value || '')
  return text.length > MAX_OUTPUT_CHARS ? text.slice(-MAX_OUTPUT_CHARS) : text
}

function failureMessage(code, signal, stderr, stdout) {
  const output = (stderr.trim() || stdout.trim()).replace(/\x1b\[[0-9;]*m/g, '')
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const cause = lines.at(-1)
  const status = `O exportador terminou com código ${code ?? signal}.`
  return cause ? `${status} ${cause.slice(0, 1200)}` : status
}

function exporterEnvironment() {
  const allowed = [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP',
    'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'VIRTUAL_ENV', 'CONDA_PREFIX'
  ]
  return Object.fromEntries(allowed
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]))
}

/** Run an explicitly configured, workspace-confined Python exporter after a map save. */
export async function runConfiguredMapExporter({ projectPath, mapPath }) {
  const projectRoot = path.resolve(String(projectPath || ''))
  const savedMap = path.resolve(String(mapPath || ''))
  if (!projectPath || !mapPath || !isInside(projectRoot, savedMap)) {
    throw new Error('O mapa salvo precisa estar dentro do projeto aberto.')
  }
  const projectReal = await fs.realpath(projectRoot)
  const savedMapReal = await fs.realpath(savedMap)
  if (!isInside(projectReal, savedMapReal)) {
    throw new Error('O mapa salvo resolve para fora do projeto aberto.')
  }

  // A managed world owns its room generation. Refresh it before looking at
  // legacy sourceMaps, which may list only the original single-map entry.
  const savedRelative = path.relative(projectRoot, savedMap).split(path.sep).join('/')
  if(hasManagedWorldMapExport(projectReal)){
    try{
      const world=worldConfigurationStatus(projectReal)
      if(world.config.rooms.some(room=>room.map===savedRelative)){
        const transaction=await saveWorldConfigurationWithMaps(projectReal,{config:world.config,revision:world.revision})
        return {configured:true,exported:true,success:true,world:true,transaction,stdout:'Recursos de '+transaction.mapsExported+' salas atualizados.',stderr:''}
      }
    }catch(error){return {configured:true,exported:false,success:false,error:error.message,stdout:'',stderr:''}}
  }

  let projectConfig, projectConfigBytes
  try {
    projectConfigBytes = await fs.readFile(path.join(projectRoot, 'retro-studio.json'))
    projectConfig = JSON.parse(projectConfigBytes.toString('utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { configured: false, exported: false }
    throw new Error(`Não foi possível ler retro-studio.json: ${error.message || error}`)
  }

  const config = projectConfig?.mapExport
  if (!config || typeof config !== 'object') return { configured: false, exported: false }

  const sourceMaps = Array.isArray(config.sourceMaps) ? config.sourceMaps : []
  const isListedMap = sourceMaps.some((item) => typeof item === 'string'
    && path.posix.normalize(item.replace(/\\/g, '/')) === savedRelative)
  // O mapa salvo não é um dos que o jogo compila: o editor avisa quais são.
  if (!isListedMap) return { configured: true, exported: false, skipped: true, sourceMaps: sourceMaps.filter(item => typeof item === 'string').slice(0, 8) }

  if (typeof config.script !== 'string' || !config.script.trim()) {
    throw new Error('mapExport.script não está configurado em retro-studio.json.')
  }

  const scriptPath = path.resolve(projectRoot, config.script)
  const scriptReal = await fs.realpath(scriptPath)
  if (!isInside(projectReal, scriptReal) || path.extname(scriptReal).toLowerCase() !== '.py') {
    throw new Error('O exportador precisa ser um script Python dentro do projeto aberto.')
  }
  const scriptStat = await fs.stat(scriptReal)
  if (!scriptStat.isFile()) throw new Error('O exportador configurado não é um arquivo.')

  if (config.outputProtocol !== undefined && config.outputProtocol !== MAP_STAGE_PROTOCOL)
    throw new Error('Protocolo de saída do exportador não suportado; arquivos preservados.')
  let stage = null
  if (config.outputProtocol === MAP_STAGE_PROTOCOL) {
    if (config.inputPaths !== undefined && !Array.isArray(config.inputPaths))
      throw new Error('mapExport.inputPaths precisa ser uma lista de caminhos.')
    const inputPaths = [...new Set(['retro-studio.json', config.script, ...sourceMaps, ...(config.inputPaths || [])])]
    stage = prepareMapExportStage(projectReal, savedRelative, { inputPaths, expectedConfigHash: createHash('sha256').update(projectConfigBytes).digest('hex') })
  }
  const command = process.platform === 'win32' ? 'python' : 'python3'
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, [scriptReal], {
      cwd: projectRoot,
      env: { ...exporterEnvironment(), ...(stage ? { RETROSTUDIO_EXPORT_STAGE: stage.directory } : {}) },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { stage?.dispose() } catch { /* Keep temporary outputs if cleanup fails. */ }
      resolve({ configured: true, exported: !!result.success, ...result, stdout: trimOutput(stdout), stderr: trimOutput(stderr) })
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish({ success: false, error: `O exportador excedeu ${EXPORT_TIMEOUT_MS / 1000} segundos.` })
    }, EXPORT_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout = trimOutput(stdout + chunk) })
    child.stderr.on('data', (chunk) => { stderr = trimOutput(stderr + chunk) })
    child.on('error', (error) => finish({ success: false, error: `Não foi possível iniciar ${command}: ${error.message}` }))
    child.on('close', (code, signal) => {
      if (settled) return
      if (code !== 0) { finish({ success: false, error: failureMessage(code, signal, stderr, stdout) }); return }
      try {
        const transaction = stage?.publish()
        finish({ success: true, error: null, ...(transaction ? { transaction } : {}) })
      } catch (error) { finish({ success: false, error: error.message }) }
    })
  })
}
