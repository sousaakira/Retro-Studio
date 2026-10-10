import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { publishProjectOutputs } from './exportTransaction.js'

export const GENERATED_LEDGER_PATH = '.retrostudio/generated-assets.json'
/** Ownership is declared only at creation; matching names never imply ownership. */
export function readGeneratedAssetLedger(projectPath) {
  const root = fs.realpathSync(projectPath)
  const directory = path.join(root, '.retrostudio')
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid asset ledger directory.')
  }
  const target = path.join(root, GENERATED_LEDGER_PATH)
  let stat
  try { stat = fs.lstatSync(target) }
  catch (error) { if (error.code === 'ENOENT') return Object.defineProperty({ version: 1, assets: [] }, 'sourceHash', { value: null }); throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error('Invalid generated asset ledger.')
  const sourceBytes = fs.readFileSync(target)
  const ledger = JSON.parse(sourceBytes.toString('utf8'))
  validateGeneratedAssetLedger(ledger)
  return Object.defineProperty(ledger, 'sourceHash', { value: createHash('sha256').update(sourceBytes).digest('hex') })
}
export function createOwnedRasterAsset(projectPath, relativePath, bytes, hash) {
  const root = fs.realpathSync(projectPath)
  const target = path.join(root, relativePath)
  if (fs.existsSync(target)) throw new Error('Existing assets cannot acquire generated ownership.')
  const ledger = readGeneratedAssetLedger(root)
  if (ledger.assets.some(entry => entry.path === relativePath))
    throw new Error('Missing owned asset requires recovery before recreation.')
  ledger.assets.push({ path: relativePath, hash, size: bytes.length,
    producer: 'raster-import', createdAt: new Date().toISOString() })
  const ledgerBytes = Buffer.from(JSON.stringify(ledger, null, 2) + '\n')
  if (ledger.assets.length > 4096 || ledgerBytes.length > 1024 * 1024)
    throw new Error('Generated asset ledger exceeds supported size.')
  const receipt = publishProjectOutputs(root, [
    { path: relativePath, bytes, expectedHash: null },
    { path: GENERATED_LEDGER_PATH, bytes: ledgerBytes, expectedHash: ledger.sourceHash }
  ], { producer: 'raster-import' })
  return receipt
}

export function validateGeneratedAssetLedger(ledger) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.assets) || ledger.assets.length > 4096)
    throw new Error('Unsupported generated asset ledger.')
  const seen = new Set()
  for (const entry of ledger.assets) {
    if (!entry || typeof entry.path !== 'string' ||
        !/(?:^|\/)generated\/raster-[a-f0-9]{64}\.png$/.test(entry.path) ||
        entry.path.startsWith('/') || /^[a-zA-Z]:/.test(entry.path) || entry.path.includes('\\') || /[\x00-\x1f]/.test(entry.path) ||
        entry.path.split('/').some(part => !part || part === '..' || part === '.') ||
        !/^[a-f0-9]{64}$/.test(entry.hash) || !entry.path.endsWith('raster-' + entry.hash + '.png') ||
        entry.producer !== 'raster-import' || !Number.isSafeInteger(entry.size) ||
        entry.size < 0 || entry.size > 32 * 1024 * 1024 || typeof entry.createdAt !== 'string' ||
        seen.has(entry.path)) throw new Error('Invalid generated asset ownership record.')
    seen.add(entry.path)
  }
  return ledger
}
