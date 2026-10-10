import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createOwnedRasterAsset } from './generatedAssetLedger.js'

const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
export function assetContentHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
/** Regular file of `directory` with exactly these bytes and this extension, if any. */
export function sameContent(directory, extension, bytes) {
  let entries
  try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return null }
  if (entries.length > 4096) return null
  for (const entry of entries.filter(item => item.isFile() && path.extname(item.name).toLowerCase() === extension.toLowerCase()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name)
    try { if (fs.lstatSync(file).size === bytes.length && fs.readFileSync(file).equals(bytes)) return file } catch { /* unreadable: not a match */ }
  }
  return null
}
/** Project-only asset write. Generated raster atlases are immutable by content. */
export function writeProjectAsset(projectPath, resourcePath, filename, buffer) {
  const root = fs.realpathSync(projectPath)
  const relativeName = String(filename || '').replaceAll('\\', '/')
  if (!relativeName || path.isAbsolute(relativeName) || /^[a-zA-Z]:/.test(relativeName) ||
      relativeName.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f"<>:|?*]/.test(relativeName))
    throw new Error('Invalid project asset filename.')
  if (!Array.isArray(buffer) && !Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array))
    throw new Error('Invalid asset data.')
  if (buffer.length > 32 * 1024 * 1024 || (Array.isArray(buffer) && buffer.some(value => !Number.isInteger(value) || value < 0 || value > 255)))
    throw new Error('Asset data exceeds the supported size or contains invalid bytes.')
  const bytes = Buffer.from(buffer)
  const hash = assetContentHash(bytes)
  const generated = /^generated\/raster-([a-f0-9]{64})\.png$/.exec(relativeName)
  if (relativeName.includes('/') && !generated) throw new Error('Only generated raster assets may use a subdirectory.')
  if (generated && generated[1] !== hash) throw new Error('Generated raster name does not match its contents.')
  const resourceDir = path.resolve(root, resourcePath || 'res')
  // Inside the project, never the root itself nor a hidden/tool folder (.git, .retrostudio...).
  if (!inside(root, resourceDir) || resourceDir === root || path.relative(root, resourceDir).split(path.sep).some(part => part.startsWith('.')))
    throw new Error('Resources must be inside the project.')
  // Check every existing ancestor before creating descendants; no symlink escape.
  function ensureDirectory(directory) {
    if (!inside(root, directory)) throw new Error('Asset directory is outside the project.')
    if (fs.existsSync(directory)) {
      if (!inside(root, fs.realpathSync(directory))) throw new Error('Asset directory resolves outside the project.')
      if (!fs.statSync(directory).isDirectory()) throw new Error('Asset parent is not a directory.')
      return
    }
    ensureDirectory(path.dirname(directory))
    fs.mkdirSync(directory)
  }
  ensureDirectory(resourceDir)
  let target = path.resolve(resourceDir, relativeName), renamed = false
  ensureDirectory(path.dirname(target))
  // true = identical file already there; a different file is never replaced.
  const occupied = file => {
    if (!fs.existsSync(file)) { try { fs.lstatSync(file) } catch { return null } throw new Error('Cannot write over a broken link.') }
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || !inside(root, fs.realpathSync(file)))
      throw new Error('Cannot write a non-regular or symlinked asset.')
    return stat.size === bytes.length && fs.readFileSync(file).equals(bytes)
  }
  let existing = occupied(target)
  // #42: the same bytes already in this folder under another name (same extension) are
  // reused instead of stored twice. Generated names are their own content address.
  if (existing === null && !generated) {
    const same = sameContent(path.dirname(target), path.extname(target), bytes)
    if (same) return { assetPath: path.relative(root, same), hash, generated: false, reused: true, renamed: path.basename(same) !== path.basename(target) }
  }
  if (existing === false) {
    if (generated) throw new Error('Generated raster asset has conflicting contents; original preserved.')
    // #42: an import never overwrites other content. The new file gets a name derived from
    // its own bytes, so importing it again lands on the same file instead of piling up.
    const extension = path.extname(relativeName)
    target = path.resolve(resourceDir, relativeName.slice(0, relativeName.length - extension.length) + '-' + hash.slice(0, 8) + extension)
    renamed = true
    existing = occupied(target)
    if (existing === false) throw new Error('Asset name is taken by other content; existing files preserved.')
  }
  if (existing) return { assetPath: path.relative(root, target), hash, generated: !!generated, reused: true, renamed }
  if (generated) {
    createOwnedRasterAsset(root, path.relative(root, target).split(path.sep).join('/'), bytes, hash)
    return { assetPath: path.relative(root, target), hash, generated: true, reused: false }
  }
  const temporary = path.join(path.dirname(target), '.asset-' + randomUUID() + '.tmp')
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return { assetPath: path.relative(root, target), hash, generated: !!generated, reused: false, renamed }
}
