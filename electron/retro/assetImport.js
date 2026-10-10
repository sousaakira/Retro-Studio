// #42: importing a file into the project never replaces different content, never piles up
// copies of the same content and records where each imported original came from.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { publishProjectOutputs, readProjectOutput } from './exportTransaction.js'
import { soundResourceEntry } from '../../shared/retro/audioConfiguration.js'

export const ASSET_ORIGINS_PATH = '.retrostudio/asset-origins.json'
const MAX_BYTES = 30 * 1024 * 1024
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const RESOURCE_TYPES = { sprite: 'IMAGE', tile: 'IMAGE', tilemap: 'TILEMAP', palette: 'PALETTE', background: 'IMAGE', scene: 'TILEMAP' }
const validPath = file => typeof file === 'string' && file.length <= 512 && !file.startsWith('/') && !/^[a-zA-Z]:/.test(file) &&
  !file.includes('\\') && !/[\x00-\x1f]/.test(file) && file.split('/').every(part => part && part !== '.' && part !== '..')

/** Origins of imported originals. Only the source file name is kept: an absolute path of
 * the machine that imported it would mean nothing (and leak a user name) anywhere else. */
export function validateAssetOrigins(record) {
  if (record?.version !== 1 || !Array.isArray(record.assets) || record.assets.length > 4096) throw new Error('Unsupported asset origins record.')
  const seen = new Set()
  for (const entry of record.assets) {
    if (!entry || !validPath(entry.path) || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.hash) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_BYTES ||
        typeof entry.sourceName !== 'string' || !entry.sourceName || entry.sourceName.length > 255 || /[\\/\x00-\x1f]/.test(entry.sourceName) ||
        typeof entry.importedAt !== 'string' || entry.importedAt.length > 64) throw new Error('Invalid asset origin record.')
    seen.add(entry.path)
  }
  return record
}
export function readAssetOrigins(projectPath) {
  const root = fs.realpathSync(projectPath), bytes = readProjectOutput(root, ASSET_ORIGINS_PATH)
  if (bytes === null) return Object.defineProperty({ version: 1, assets: [] }, 'sourceHash', { value: null })
  if (bytes.length > 1024 * 1024) throw new Error('Asset origins record exceeds 1 MiB.')
  return Object.defineProperty(validateAssetOrigins(JSON.parse(bytes.toString('utf8'))), 'sourceHash', { value: hash(bytes) })
}
function resourceDirectory(root) {
  let configured = 'res'
  const bytes = readProjectOutput(root, 'retro-studio.json')
  if (bytes && bytes.length <= 1024 * 1024) try { const value = JSON.parse(bytes.toString('utf8')).resourcePath; if (typeof value === 'string' && value) configured = value.replaceAll('\\', '/').replace(/\/+$/, '') } catch {}
  if (!validPath(configured) || configured.split('/').some(part => part.startsWith('.'))) throw new Error('Resources must be inside the project.')
  return configured
}
/**
 * Plan + publish in one transaction: asset, resources.res line and origin record.
 * - same content already in the resource folder: reused, nothing is copied;
 * - free name: copied under the source name;
 * - name taken by other content: copied as <name>-<8 hash digits>.<ext>, so the same
 *   source always lands on the same file and the existing one is preserved.
 */
export function importProjectAsset(projectPath, sourcePath, { type = '' } = {}) {
  const root = fs.realpathSync(projectPath)
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error('Arquivo de origem inválido.')
  const stat = fs.statSync(sourcePath)
  if (!stat.isFile()) throw new Error('A origem não é um arquivo comum.')
  if (stat.size > MAX_BYTES) throw new Error('O arquivo passa do limite de 30 MiB para importação.')
  const sourceName = path.basename(sourcePath)
  // Quotes would break the line in resources.res; the others are invalid on Windows.
  if (!sourceName || /[\\/\x00-\x1f"<>:|?*]/.test(sourceName) || sourceName.length > 255 || sourceName.startsWith('.')) throw new Error('Nome de arquivo não suportado: evite aspas e os caracteres < > : | ? *.')
  const bytes = fs.readFileSync(sourcePath), digest = hash(bytes)
  const directory = resourceDirectory(root), extension = path.extname(sourceName), stem = sourceName.slice(0, sourceName.length - extension.length)
  // Same bytes already there (any name, same extension)? Reuse it: reimporting never accumulates files.
  let target = null, reused = false
  const absoluteDirectory = path.join(root, directory)
  if (fs.existsSync(absoluteDirectory) && !fs.lstatSync(absoluteDirectory).isSymbolicLink()) {
    const candidates = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === extension.toLowerCase()).map(entry => entry.name).sort()
    if (candidates.length > 4096) throw new Error('Pasta de recursos grande demais para conferir duplicatas.')
    // The file with the source name wins, so a plain reimport reports its own name.
    for (const name of [sourceName, ...candidates.filter(name => name !== sourceName)]) {
      if (!candidates.includes(name)) continue
      const file = path.join(absoluteDirectory, name), info = fs.lstatSync(file)
      if (info.isFile() && info.size === bytes.length && hash(fs.readFileSync(file)) === digest) { target = directory + '/' + name; reused = true; break }
    }
  }
  if (!target) {
    target = directory + '/' + sourceName
    if (readProjectOutput(root, target) !== null) {
      target = directory + '/' + stem + '-' + digest.slice(0, 8) + extension
      if (readProjectOutput(root, target) !== null) throw new Error('Já existe ' + target + ' com outro conteúdo; nada foi alterado.')
    }
  }
  const fileName = path.posix.basename(target), resourcesPath = directory + '/resources.res'
  const outputs = []
  if (!reused) outputs.push({ path: target, bytes, expectedHash: null })
  // resources.res: one line per file. rescomp has no SOUND type: WAV/XGM for the driver, nothing for preview-only formats.
  const resourcesBytes = readProjectOutput(root, resourcesPath), resources = resourcesBytes === null ? '' : resourcesBytes.toString('utf8')
  // Declared paths are relative to the resource folder: "./hero.png" is the same file as "hero.png".
  const declared = [...resources.matchAll(/^\s*(\w+)\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"\n]+)"/gm)].map(match => ({ symbol: match[2], file: path.posix.normalize(match[3].replaceAll('\\', '/')) }))
  const eol = /\r\n/.test(resources) ? '\r\n' : '\n'
  let symbol = fileName.slice(0, fileName.length - extension.length).toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (/^[0-9]/.test(symbol)) symbol = '_' + symbol
  const already = declared.find(entry => entry.file === fileName)
  let registered = !!already
  if (already) symbol = already.symbol
  if (!registered) {
    if (declared.some(entry => entry.symbol === symbol)) symbol += '_' + digest.slice(0, 8).toUpperCase()
    if (declared.some(entry => entry.symbol === symbol)) throw new Error('O símbolo ' + symbol + ' já pertence a outro recurso em ' + resourcesPath + '.')
    const line = type === 'sound' ? soundResourceEntry(symbol, fileName) : (RESOURCE_TYPES[type] || 'IMAGE') + ' ' + symbol + ' "' + fileName + '" 0'
    if (line) {
      outputs.push({ path: resourcesPath, bytes: Buffer.from(resources.trim() ? resources.replace(/(?:\r?\n)*$/, eol) + line + eol : line + eol), expectedHash: resourcesBytes === null ? null : hash(resourcesBytes) })
      registered = true
    }
  }
  // Origin: recorded for files this import created; a reused file keeps whatever origin it had.
  const origins = readAssetOrigins(root)
  if (!reused) {
    // Entries of files that no longer exist are dropped, so the record cannot fill up with history.
    const next = { version: 1, assets: [...origins.assets.filter(entry => entry.path !== target && fs.existsSync(path.join(root, entry.path))),
      { path: target, hash: digest, size: bytes.length, sourceName, importedAt: new Date().toISOString() }] }
    validateAssetOrigins(next)
    outputs.push({ path: ASSET_ORIGINS_PATH, bytes: Buffer.from(JSON.stringify(next, null, 2) + '\n'), expectedHash: origins.sourceHash })
  }
  if (outputs.length) publishProjectOutputs(root, outputs, { producer: 'asset-import' })
  return { success: true, assetPath: target, hash: digest, reused, renamed: !reused && fileName !== sourceName, registered, symbol: registered ? symbol : null }
}

/**
 * Adds or updates one line of resources.res ("TYPE SYMBOL "file" ..."), atomically.
 * Same symbol and same file: the line is updated. Same symbol, another file: refused,
 * because replacing it would silently repoint code that uses the symbol.
 */
export function registerResourceEntry(projectPath, resourceEntry) {
  const root = fs.realpathSync(projectPath)
  if (typeof resourceEntry !== 'string' || resourceEntry.length > 1024 || /[\r\n\x00]/.test(resourceEntry)) throw new Error('Linha de recurso inválida.')
  const parsed = resourceEntry.trim().match(/^(\w+)\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]+)"(.*)$/)
  if (!parsed) throw new Error('Linha de recurso inválida: esperado TIPO NOME "arquivo".')
  const symbol = parsed[2], file = path.posix.normalize(parsed[3].replaceAll('\\', '/'))
  const resourcesPath = resourceDirectory(root) + '/resources.res'
  const bytes = readProjectOutput(root, resourcesPath), text = bytes === null ? '' : bytes.toString('utf8'), eol = /\r\n/.test(text) ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let updated = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim().match(/^(\w+)\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]+)"/)
    if (!line || line[2] !== symbol) continue
    if (path.posix.normalize(line[3].replaceAll('\\', '/')) !== file)
      throw new Error('O nome ' + symbol + ' já pertence a "' + line[3] + '" em ' + resourcesPath + '. Renomeie o arquivo ou a entrada existente; nada foi alterado.')
    lines[index] = resourceEntry.trim(); updated = true
  }
  let next
  if (updated) next = lines.join(eol)
  else next = (text.trim() ? text.replace(/(?:\r?\n)*$/, eol) : '') + resourceEntry.trim() + eol
  if (next !== text) publishProjectOutputs(root, [{ path: resourcesPath, bytes: Buffer.from(next), expectedHash: bytes === null ? null : hash(bytes) }], { producer: 'asset-register' })
  return { symbol, file, updated }
}
