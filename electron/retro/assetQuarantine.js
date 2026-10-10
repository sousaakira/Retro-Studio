import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { inspectProjectAssets } from './assetReport.js'
import { readGeneratedAssetLedger, validateGeneratedAssetLedger, GENERATED_LEDGER_PATH } from './generatedAssetLedger.js'
import { publishProjectOutputs, readProjectOutput } from './exportTransaction.js'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const uuid = id => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)
const key = (root, value) => typeof value === 'string' ? path.relative(root, path.resolve(root, value)).split(path.sep).join('/') : ''
const encode = data => {
  const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n')
  if (bytes.length > 1024 * 1024) throw new Error('Asset lifecycle metadata exceeds 1 MiB; files preserved.')
  return bytes
}
function configuration(root) {
  const bytes = readProjectOutput(root, 'retro-studio.json')
  if (!bytes || bytes.length > 1024 * 1024) throw new Error('Invalid project configuration for asset cleanup.')
  const config = JSON.parse(bytes.toString('utf8'))
  if (config.assets !== undefined && !Array.isArray(config.assets)) throw new Error('Invalid asset inventory.')
  return { bytes, config }
}
export function planAssetQuarantine(projectPath, paths) {
  const root = fs.realpathSync(projectPath)
  if (!Array.isArray(paths) || !paths.length || paths.length > 20 ||
      paths.some(file => typeof file !== 'string') || new Set(paths).size !== paths.length)
    throw new Error('Select between one and twenty generated assets.')
  const report = inspectProjectAssets(root)
  if (report.ledgerError || report.exportRecoveryError || report.exportRecovery?.pending)
    throw new Error('Resolve asset ledger/export recovery errors before cleanup.')
  const assets = paths.map(file => {
    const asset = report.assets.find(item => item.path === file)
    // quarantineCandidate: owned by the generated-asset ledger, verified, unreferenced and not an original/charset file.
    if (!asset || asset.ownership !== 'verified' || asset.references.length || !asset.quarantineCandidate)
      throw new Error('Asset is not an owned, verified, apparently unreferenced derivative: ' + file)
    return { path: asset.path, hash: asset.hash, size: asset.size }
  })
  if (assets.reduce((total, asset) => total + asset.size, 0) > 24 * 1024 * 1024)
    throw new Error('Quarantine selection exceeds 24 MiB; select fewer files.')
  const warnings = { dynamicSources: report.dynamicSources, skipped: report.skipped }
  const planId = hash(encode({ assets, warnings }))
  return { projectPath: path.resolve(projectPath), planId, assets, warnings,
    totalBytes: assets.reduce((total, asset) => total + asset.size, 0) }
}
export function quarantineProjectAssets(projectPath, paths, expectedPlanId, options = {}) {
  const root = fs.realpathSync(projectPath)
  const plan = planAssetQuarantine(root, paths)
  if (plan.planId !== expectedPlanId) throw new Error('Cleanup plan changed; inspect resources again.')
  const ledger = readGeneratedAssetLedger(root)
  const { bytes: configBytes, config } = configuration(root)
  const id = randomUUID(), base = '.retrostudio/asset-trash/' + id
  const outputs = [], entries = []
  for (let index = 0; index < plan.assets.length; index++) {
    const asset = plan.assets[index]
    const bytes = readProjectOutput(root, asset.path)
    if (!bytes || hash(bytes) !== asset.hash) throw new Error('Asset changed before quarantine.')
    const inventory = (config.assets || []).filter(item => key(root, item.path) === asset.path)
    const record = ledger.assets.find(item => item.path === asset.path)
    const trashPath = base + '/files/' + index + '.png'
    entries.push({ ...asset, record, inventory, trashPath })
    outputs.push({ path: trashPath, bytes, expectedHash: null }, { path: asset.path, remove: true, expectedHash: asset.hash })
  }
  const selected = new Set(paths)
  ledger.assets = ledger.assets.filter(entry => !selected.has(entry.path))
  if (config.assets) config.assets = config.assets.filter(item => !selected.has(key(root, item.path)))
  validateGeneratedAssetLedger(ledger)
  const manifest = { version: 1, id, status: 'quarantined', createdAt: new Date().toISOString(), entries, warnings: plan.warnings }
  outputs.push(
    { path: GENERATED_LEDGER_PATH, bytes: encode(ledger), expectedHash: ledger.sourceHash },
    { path: 'retro-studio.json', bytes: encode(config), expectedHash: hash(configBytes) },
    { path: base + '/manifest.json', bytes: encode(manifest), expectedHash: null }
  )
  const receipt = publishProjectOutputs(root, outputs, { producer: 'asset-quarantine', ...options })
  return { ...receipt, quarantineId: id, paths }
}
function readManifest(root, id) {
  if (!uuid(id)) throw new Error('Invalid asset quarantine ID.')
  const manifestPath = '.retrostudio/asset-trash/' + id + '/manifest.json'
  const bytes = readProjectOutput(root, manifestPath)
  if (!bytes || bytes.length > 1024 * 1024) throw new Error('Missing or oversized quarantine record.')
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest.version !== 1 || manifest.id !== id || !['quarantined','restored'].includes(manifest.status) ||
      typeof manifest.createdAt !== 'string' || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 20)
    throw new Error('Invalid asset quarantine record.')
  return { bytes, manifest, manifestPath }
}
export function listAssetQuarantines(projectPath) {
  const root = fs.realpathSync(projectPath)
  const base = path.join(root, '.retrostudio/asset-trash')
  if (!fs.existsSync(base)) return []
  const stat = fs.lstatSync(base)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid asset quarantine directory.')
  const ids = fs.readdirSync(base)
  if (ids.length > 512) throw new Error('Asset quarantine listing limit reached.')
  return ids.filter(uuid).filter(id => readProjectOutput(root, '.retrostudio/asset-trash/' + id + '/manifest.json') !== null).map(id => {
    const { manifest } = readManifest(root, id)
    return { id, status: manifest.status, createdAt: manifest.createdAt, paths: manifest.entries.map(entry => entry.path) }
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
}
export function restoreAssetQuarantine(projectPath, id, options = {}) {
  const root = fs.realpathSync(projectPath)
  const { bytes: manifestBytes, manifest, manifestPath } = readManifest(root, id)
  if (manifest.status !== 'quarantined') throw new Error('This asset quarantine was already restored.')
  const ledger = readGeneratedAssetLedger(root)
  const { bytes: configBytes, config } = configuration(root)
  const outputs = [], seen = new Set()
  let total = 0
  for (let index = 0; index < manifest.entries.length; index++) {
    const entry = manifest.entries[index]
    if (!entry || typeof entry.path !== 'string' || !/(?:^|\/)generated\/raster-[a-f0-9]{64}\.png$/.test(entry.path) ||
        !/^[a-f0-9]{64}$/.test(entry.hash) || !entry.path.endsWith('raster-' + entry.hash + '.png') ||
        entry.trashPath !== '.retrostudio/asset-trash/' + id + '/files/' + index + '.png' ||
        entry.record?.path !== entry.path || entry.record?.hash !== entry.hash || entry.record?.producer !== 'raster-import' || typeof entry.record.createdAt !== 'string' ||
        !Array.isArray(entry.inventory) || seen.has(entry.path))
      throw new Error('Invalid quarantine entry; files preserved.')
    seen.add(entry.path)
    if (readProjectOutput(root, entry.path) !== null || ledger.assets.some(record => record.path === entry.path))
      throw new Error('Restore destination already exists; current asset preserved: ' + entry.path)
    const bytes = readProjectOutput(root, entry.trashPath)
    total += bytes?.length || 0
    if (!bytes || total > 24 * 1024 * 1024 || hash(bytes) !== entry.hash || bytes.length !== entry.size || entry.record.size !== entry.size)
      throw new Error('Quarantine contents changed; files preserved.')
    for (const item of entry.inventory) {
      if (key(root,item.path) !== entry.path || (config.assets || []).some(existing => existing.id === item.id || key(root,existing.path) === entry.path))
        throw new Error('Restore inventory conflict; current project preserved.')
    }
    ledger.assets.push(entry.record)
    if (entry.inventory.length) { config.assets ||= []; config.assets.push(...entry.inventory) }
    outputs.push({ path: entry.path, bytes, expectedHash: null })
  }
  validateGeneratedAssetLedger(ledger)
  if (ledger.assets.length > 4096 || encode(ledger).length > 1024 * 1024)
    throw new Error('Restored ownership ledger exceeds supported size.')
  manifest.status = 'restored'; manifest.restoredAt = new Date().toISOString()
  outputs.push(
    { path: GENERATED_LEDGER_PATH, bytes: encode(ledger), expectedHash: ledger.sourceHash },
    { path: 'retro-studio.json', bytes: encode(config), expectedHash: hash(configBytes) },
    { path: manifestPath, bytes: encode(manifest), expectedHash: hash(manifestBytes) }
  )
  return { ...publishProjectOutputs(root,outputs,{producer:'asset-restore',...options}), quarantineId:id }
}
