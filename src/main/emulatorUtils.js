import path from 'path'
import fs from 'fs'
import { getAppPathSafe, EMULATORS_DIR } from './utils.js'
import { loadConfigFile } from './utils.js'

/**
 * Lista de emuladores suportados para auto-detect.
 * Adicionar novos aqui para aparecer em "Auto-Detected Emulators".
 * pathSegments: relativos a CONFIG_DIR (~/.retrostudio), ex: ['emulators','md','gen_sdl2'].
 * toolkitRelative: se definido, o executável fica em toolkitPath + este nome (ex: 'dgen').
 */
export const EMULATOR_DEFINITIONS = [
  { id: 'gen_sdl2', displayName: 'Genesis Plus GX (SDL2)', pathSegments: ['emulators', 'md', 'gen_sdl2'] },
  { id: 'blastem', displayName: 'BlastEm', pathSegments: ['emulators', 'blastem', 'blastem'] },
  { id: 'picodrive', displayName: 'PicoDrive', pathSegments: ['emulators', 'picodrive', 'picodrive'] },
  { id: 'md', displayName: 'MD (DGen)', toolkitRelative: 'dgen' },
]

/** @deprecated Use EMULATOR_DEFINITIONS; mantido para compatibilidade de path. */
export const DEFAULT_EMULATOR_RELATIVE_PATH = ['toolkit', 'emulators', 'md', 'gen_sdl2']

function getToolkitPath() {
  const ui = loadConfigFile('ui-settings.json', {})
  const p = ui.toolkitPath || ''
  return p && fs.existsSync(p) ? p : null
}

export function resolveEmulatorPath(emulatorName = null) {
  const def = EMULATOR_DEFINITIONS.find((e) => e.id === emulatorName) || EMULATOR_DEFINITIONS[0]
  const customPaths = loadConfigFile('custom-emulator-paths.json', {})
  const custom = customPaths[def.id]
  if (custom && typeof custom === 'string' && custom.trim() && fs.existsSync(custom.trim())) {
    return custom.trim()
  }

  if (def.toolkitRelative) {
    const toolkitPath = getToolkitPath()
    if (toolkitPath) {
      const candidate = path.join(toolkitPath, def.toolkitRelative)
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  const relativePath = def.pathSegments
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath
  const userEmulatorPath = path.join(EMULATORS_DIR, ...relativePath.slice(1))

  const candidateBuilders = [
    () => userEmulatorPath,
    () => appPath && path.join(appPath, 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => appPath && path.join(appPath, 'src', 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => resourcesPath && path.join(resourcesPath, 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => path.join(__dirname, 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => path.join(projectRoot, 'src', 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => path.join(projectRoot, 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => path.join(process.cwd(), 'toolkit', 'emulators', ...relativePath.slice(1)),
    () => path.join(process.cwd(), 'src', 'toolkit', 'emulators', ...relativePath.slice(1)),
  ]

  for (const buildCandidate of candidateBuilders) {
    const candidate = buildCandidate()
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return null
}

/** Retorna { [id]: path } apenas dos que têm path resolvido. */
export function getAvailableEmulators() {
  const available = {}
  for (const def of EMULATOR_DEFINITIONS) {
    const resolved = resolveEmulatorPath(def.id)
    if (resolved && fs.existsSync(resolved)) available[def.id] = resolved
  }
  return available
}

/** Lista para a UI: id, displayName, path, available. */
export function getAvailableEmulatorsList() {
  return EMULATOR_DEFINITIONS.map((def) => {
    const resolved = resolveEmulatorPath(def.id)
    const available = !!(resolved && fs.existsSync(resolved))
    return {
      id: def.id,
      displayName: def.displayName,
      path: resolved || '',
      available,
    }
  })
}

export function findRomOutput(projectPath) {
  const preferredCandidates = [
    path.join(projectPath, 'out', 'rom.bin'),
    path.join(projectPath, 'rom.bin'),
    path.join(projectPath, 'out', 'out.bin'),
    path.join(projectPath, 'out.bin'),
  ]

  for (const candidate of preferredCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  const scanDirs = [projectPath, path.join(projectPath, 'out')]
  let latestRom = null
  let latestTime = 0

  scanDirs.forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir)
    entries.forEach(entry => {
      if (!/\.(bin|32x)$/i.test(entry)) return
      const entryPath = path.join(dir, entry)
      try {
        const stats = fs.statSync(entryPath)
        if (stats.isFile() && stats.mtimeMs >= latestTime) {
          latestRom = entryPath
          latestTime = stats.mtimeMs
        }
      } catch (err) {
        console.warn('Falha ao inspecionar ROM candidate:', entryPath, err)
      }
    })
  })

  return latestRom
}
