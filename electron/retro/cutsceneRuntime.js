import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIBRARY_DIR = path.join('assets', 'toolkit', 'lib', 'cutscene')

/** Finds the bundled cutscene runtime (dev tree, packaged app or resources). */
export function resolveCutsceneLibraryPath() {
  // electron/** and assets/** ship side by side (also inside app.asar).
  const candidates = [
    path.join(__dirname, '..', '..', LIBRARY_DIR),
    process.resourcesPath && path.join(process.resourcesPath, LIBRARY_DIR),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', LIBRARY_DIR),
    path.join(process.cwd(), LIBRARY_DIR)
  ].filter(Boolean)
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'manifest.json'))) || null
}

function readManifest(libraryPath) {
  const manifest = JSON.parse(fs.readFileSync(path.join(libraryPath, 'manifest.json'), 'utf8'))
  for (const file of manifest.files || []) {
    for (const value of [file.source, file.target]) {
      if (typeof value !== 'string' || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
        throw new Error(`Manifesto do runtime de cutscenes inválido: ${value}`)
      }
    }
  }
  return manifest
}

function insideProject(projectPath, target) {
  const absolute = path.resolve(projectPath, target)
  const relative = path.relative(projectPath, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Destino fora do projeto: ${target}`)
  return absolute
}

function sameContent(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)) } catch { return false }
}

/** Reports which runtime files exist in the project and whether they match the bundled version. */
export function cutsceneRuntimeStatus(projectPath) {
  const libraryPath = resolveCutsceneLibraryPath()
  if (!libraryPath) return { available: false, installed: false, files: [] }
  const manifest = readManifest(libraryPath)
  const root = path.resolve(projectPath)
  const files = (manifest.files || []).map(file => {
    const target = insideProject(root, file.target)
    const exists = fs.existsSync(target)
    return { target: file.target, mode: file.mode, exists, current: exists && (file.mode === 'keep' || sameContent(path.join(libraryPath, file.source), target)) }
  })
  return {
    available: true,
    version: manifest.version,
    installed: files.every(file => file.exists),
    upToDate: files.every(file => file.current),
    files
  }
}

/**
 * Copies the runtime into a project. Library files are replaced (a backup is kept
 * when the project copy was edited); project files such as the config are only
 * created when missing.
 */
export function installCutsceneRuntime(projectPath) {
  const libraryPath = resolveCutsceneLibraryPath()
  if (!libraryPath) throw new Error('Runtime de cutscenes não encontrado na instalação do Retro Studio.')
  const manifest = readManifest(libraryPath)
  const root = path.resolve(projectPath)
  const result = { version: manifest.version, created: [], updated: [], unchanged: [], kept: [], backups: [] }
  for (const file of manifest.files || []) {
    const source = path.join(libraryPath, file.source)
    const target = insideProject(root, file.target)
    if (fs.existsSync(target)) {
      if (file.mode === 'keep') { result.kept.push(file.target); continue }
      if (sameContent(source, target)) { result.unchanged.push(file.target); continue }
      const backup = `${target}.bak-${Date.now()}`
      fs.copyFileSync(target, backup)
      result.backups.push(path.relative(root, backup).split(path.sep).join('/'))
      fs.copyFileSync(source, target)
      result.updated.push(file.target)
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
      result.created.push(file.target)
    }
  }
  return result
}

/** Lists cutscenes/**\/*.cutscene.json relative to the project. */
export function listCutsceneFiles(projectPath) {
  const root = path.resolve(projectPath)
  const base = path.join(root, 'cutscenes')
  const found = []
  const walk = dir => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.cutscene.json')) found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(base)
  return found.sort()
}
