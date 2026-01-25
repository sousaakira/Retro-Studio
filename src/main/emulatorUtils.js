import path from 'path'
import fs from 'fs'
import { getAppPathSafe, EMULATORS_DIR } from './utils.js'

export const DEFAULT_EMULATOR_RELATIVE_PATH = ['toolkit', 'emulators', 'md', 'gen_sdl2']
export const AVAILABLE_EMULATORS = {
  'gen_sdl2': ['toolkit', 'emulators', 'md', 'gen_sdl2'],
  'blastem': ['toolkit', 'emulators', 'blastem', 'blastem'],
  'picodrive': ['toolkit', 'emulators', 'PicoDrive', 'picodrive']
}

export function resolveEmulatorPath(emulatorName = null) {
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath
  const emulatorKey = emulatorName || 'gen_sdl2'
  const relativePath = AVAILABLE_EMULATORS[emulatorKey] || AVAILABLE_EMULATORS['gen_sdl2']

  const userEmulatorPath = path.join(EMULATORS_DIR, ...relativePath.slice(2))

  const candidateBuilders = [
    () => userEmulatorPath,
    () => appPath && path.join(appPath, ...relativePath),
    () => appPath && path.join(appPath, 'src', ...relativePath),
    () => resourcesPath && path.join(resourcesPath, ...relativePath),
    () => resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', ...relativePath),
    () => path.join(__dirname, ...relativePath),
    () => path.join(projectRoot, 'src', ...relativePath),
    () => path.join(projectRoot, ...relativePath),
    () => path.join(process.cwd(), ...relativePath),
    () => path.join(process.cwd(), 'src', ...relativePath)
  ]

  for (const buildCandidate of candidateBuilders) {
    const candidate = buildCandidate()
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function getAvailableEmulators() {
  const available = {}
  for (const [name] of Object.entries(AVAILABLE_EMULATORS)) {
    const resolvedPath = resolveEmulatorPath(name)
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      available[name] = resolvedPath
    }
  }
  return available
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
