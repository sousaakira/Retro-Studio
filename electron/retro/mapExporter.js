import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

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

  let projectConfig
  try {
    projectConfig = JSON.parse(await fs.readFile(path.join(projectRoot, 'retro-studio.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { configured: false, exported: false }
    throw new Error(`Não foi possível ler retro-studio.json: ${error.message || error}`)
  }

  const config = projectConfig?.mapExport
  if (!config || typeof config !== 'object') return { configured: false, exported: false }

  const sourceMaps = Array.isArray(config.sourceMaps) ? config.sourceMaps : []
  const savedRelative = path.relative(projectRoot, savedMap).split(path.sep).join('/')
  const isListedMap = sourceMaps.some((item) => typeof item === 'string'
    && path.posix.normalize(item.replace(/\\/g, '/')) === savedRelative)
  if (!isListedMap) return { configured: true, exported: false, skipped: true }

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

  const command = process.platform === 'win32' ? 'python' : 'python3'
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, [scriptReal], {
      cwd: projectRoot,
      env: exporterEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
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
    child.on('close', (code, signal) => finish({
      success: code === 0,
      error: code === 0 ? null : `O exportador terminou com código ${code ?? signal}.`
    }))
  })
}
