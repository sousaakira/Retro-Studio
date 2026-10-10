import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function projectFile(root, relative, createParents = false) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') ||
      relative.startsWith('/') || /^[a-zA-Z]:/.test(relative) || /[\x00-\x1f]/.test(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid export path.')
  const target = path.resolve(root, relative)
  if (!inside(root, target)) throw new Error('Export path escapes project.')
  let parent = root
  for (const part of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, part)
    if (!fs.existsSync(parent)) {
      if (!createParents) return target
      fs.mkdirSync(parent)
    }
    const stat = fs.lstatSync(parent)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Export parent must be a regular directory.')
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Export target must be a regular file.')
  } else {
    // existsSync follows symlinks, including broken ones.
    try { fs.lstatSync(target); throw new Error('Export target is a broken link.') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return target
}
function readCurrent(target) {
  if (!fs.existsSync(target)) return null
  const stat = fs.lstatSync(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
    throw new Error('Export target is not a supported regular file.')
  return fs.readFileSync(target)
}
export function prepareProjectDirectory(projectPath, relativePath) {
  const root = fs.realpathSync(projectPath)
  return path.dirname(projectFile(root, relativePath + '/.directory-marker', true))
}
export function readProjectOutput(projectPath, relativePath) {
  return readCurrent(projectFile(fs.realpathSync(projectPath), relativePath))
}
function replace(target, bytes) {
  const temporary = path.join(path.dirname(target), '.export-' + randomUUID() + '.tmp')
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    fs.renameSync(temporary, target)
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}
/**
 * Serializes IDE writers and rolls back a failed publication. Every transaction
 * keeps its before/after snapshots and journal. Multiple renames are NOT a single
 * filesystem atomic operation: callers must await success before starting builds.
 * Crash recovery is deliberately separate; a leftover lock blocks new exports.
 */
export function publishProjectOutputs(projectPath, outputs, { producer = 'export', beforePublish } = {}) {
  const root = fs.realpathSync(projectPath)
  if (!Array.isArray(outputs) || !outputs.length || outputs.length > (producer === 'world-map-export' ? 1024 : 128) ||
      typeof producer !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(producer))
    throw new Error('Invalid export transaction.')
  let total = 0
  const names = new Set()
  const planned = outputs.map(output => {
    if (!output || typeof output.path !== 'string' || !(Buffer.isBuffer(output.bytes) && output.remove !== true || output.remove === true && output.bytes === undefined)) throw new Error('Export output must contain a Buffer or explicit removal.')
    if (output.path === '.retrostudio/export.lock' || output.path.startsWith('.retrostudio/export-recovery/') || output.path.startsWith('.retrostudio/export-transactions/'))
      throw new Error('Export cannot overwrite its transaction journal.')
    if (Object.hasOwn(output, 'expectedHash') && output.expectedHash !== null && !/^[a-f0-9]{64}$/.test(output.expectedHash))
      throw new Error('Invalid expected export revision.')
    if (names.has(output.path)) throw new Error('Duplicate export output path.')
    names.add(output.path)
    total += output.bytes?.length || 0
    if (total > 32 * 1024 * 1024) throw new Error('Export transaction exceeds 32 MiB.')
    return { path: output.path, bytes: output.bytes, removed: output.remove === true, target: projectFile(root, output.path, true),
      checkRevision: Object.hasOwn(output, 'expectedHash'), expectedHash: output.expectedHash }
  })
  const lock = projectFile(root, '.retrostudio/export.lock', true)
  const id = randomUUID()
  const transactionRelative = '.retrostudio/export-transactions/' + id
  if (fs.existsSync(lock)) throw new Error('An export is active or requires recovery. Existing outputs preserved.')
  const journalPath = projectFile(root, transactionRelative + '/journal.json', true)
  // Preparation metadata must be recoverable BEFORE publishing the lock.
  fs.writeFileSync(journalPath, JSON.stringify({ version: 1, id, producer, state: 'preparing', outputs: [] }), { flag: 'wx' })
  const lockRecord = projectFile(root, transactionRelative + '/lock.json', true)
  fs.writeFileSync(lockRecord, JSON.stringify({ version: 1, id, pid: process.pid, producer }), { flag: 'wx' })
  try { fs.linkSync(lockRecord, lock) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('An export is active or requires recovery. Existing outputs preserved.')
    throw error
  }
  const records = []
  let state = 'preparing', keepLock = false, preparedSnapshots = false, noOp = false
  const journal = () => journalPath && replace(journalPath, Buffer.from(JSON.stringify({
    version: 1, id, producer, state,
    outputs: (preparedSnapshots ? records : []).map(({ path, oldHash, newHash, changed, published, existed, removed }) =>
      ({ path, oldHash, newHash, changed, published, existed, removed }))
  }, null, 2) + '\n'))
  try {
    let beforeBytes = 0
    for (let index = 0; index < planned.length; index++) {
      const output = planned[index]
      const oldBytes = readCurrent(output.target)
      beforeBytes += oldBytes?.length || 0
      if (beforeBytes > 32 * 1024 * 1024) throw new Error('Export backups exceed 32 MiB.')
      const oldHash = oldBytes === null ? null : digest(oldBytes)
      if (output.checkRevision && output.expectedHash !== oldHash)
        throw new Error('Export source revision changed: ' + output.path)
      const newHash = output.removed ? null : digest(output.bytes)
      records.push({ ...output, oldBytes, oldHash, newHash, changed: oldHash !== newHash, published: false, existed: oldBytes !== null })

    }
    // Even identical batches validate under the writer lock. They retain no
    // snapshots; preparation metadata remains recoverable until the lock clears.
    if (records.every(record => !record.changed)) {
      noOp = true; state = 'committed'; journal()
      return { success: true, transactionId: null, journalPath: null,
        changed: [], reused: records.map(record => record.path) }
    }
    records.forEach((record, index) => {
      if (record.oldBytes !== null) fs.writeFileSync(projectFile(root, transactionRelative + '/' + index + '.before', true), record.oldBytes, { flag: 'wx' })
      if (!record.removed) fs.writeFileSync(projectFile(root, transactionRelative + '/' + index + '.after', true), record.bytes, { flag: 'wx' })
    })
    preparedSnapshots = true
    state = 'prepared'; journal()
    for (let index = 0; index < records.length; index++) {
      const record = records[index]
      if (!record.changed) continue
      beforePublish?.(index, record.path)
      const current = readCurrent(projectFile(root, record.path))
      if ((current === null ? null : digest(current)) !== record.oldHash)
        throw new Error('Export output changed while preparing: ' + record.path)
      state = 'publishing'; journal()
      if (record.removed) fs.unlinkSync(record.target)
      else replace(record.target, record.bytes)
      record.published = true; journal()
    }
    state = 'committed'; journal()
    return { success: true, transactionId: id, journalPath: path.relative(root, journalPath),
      changed: records.filter(record => record.changed).map(record => record.path),
      reused: records.filter(record => !record.changed).map(record => record.path) }
  } catch (error) {
    const conflicts = []
    for (const record of [...records].reverse()) {
      if (!record.published) continue
      try {
        const current = readCurrent(projectFile(root, record.path))
        if ((current === null ? null : digest(current)) !== record.newHash) {
          conflicts.push(record.path); continue
        }
        if (record.oldBytes === null) { if (current !== null) fs.unlinkSync(record.target) }
        else replace(record.target, record.oldBytes)
        record.published = false
      } catch { conflicts.push(record.path) }
    }
    state = conflicts.length ? 'recovery-required' : 'rolled-back'
    keepLock = conflicts.length > 0
    try { journal() } catch { keepLock = true }
    if (keepLock) throw new Error('Export requires recovery; snapshots preserved at ' + transactionRelative + '. ' + error.message)
    throw error
  } finally {
    if (!keepLock) {
      fs.unlinkSync(lock)
      if (noOp) {
        // Remove only metadata created by this read-only transaction.
        try { fs.unlinkSync(journalPath); fs.unlinkSync(lockRecord); fs.rmdirSync(path.dirname(journalPath)) }
        catch { /* A leftover diagnostic record does not affect project outputs. */ }
      }
    }
  }
}

function readJsonFile(target, limit = 1024 * 1024) {
  const bytes = readCurrent(target)
  if (!bytes || bytes.length > limit) throw new Error('Missing or oversized export recovery record.')
  return JSON.parse(bytes.toString('utf8'))
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code !== 'ESRCH' }
}
function activeRecoveryClaims(root, transactionId, ownClaim = '') {
  const directory = path.dirname(projectFile(root, '.retrostudio/export-recovery/placeholder'))
  if (!fs.existsSync(directory)) return []
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
  if (names.length > 512) throw new Error('Recovery claim limit reached; records preserved.')
  const active = []
  for (const name of names) {
    if (name === ownClaim) continue
    const claim = readJsonFile(projectFile(root, '.retrostudio/export-recovery/' + name), 4096)
    if (claim?.version !== 1 || !Number.isSafeInteger(claim.pid) || claim.pid < 1 ||
        typeof claim.transactionId !== 'string') throw new Error('Invalid recovery claim; records preserved.')
    if (claim.transactionId === transactionId && processAlive(claim.pid)) active.push(name)
  }
  return active
}
function pendingExport(root) {
  const lockPath = projectFile(root, '.retrostudio/export.lock')
  if (!fs.existsSync(lockPath)) return null
  const lock = readJsonFile(lockPath, 4096)
  if (lock?.version !== 1 || typeof lock.id !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(lock.id) ||
      !Number.isSafeInteger(lock.pid) || lock.pid < 1)
    throw new Error('Invalid export recovery lock; files preserved.')
  const journalPath = projectFile(root, '.retrostudio/export-transactions/' + lock.id + '/journal.json')
  const journal = readJsonFile(journalPath)
  if (journal?.version !== 1 || journal.id !== lock.id ||
      !['preparing', 'prepared', 'publishing', 'committed', 'rolled-back', 'recovery-required'].includes(journal.state) ||
      !Array.isArray(journal.outputs) || journal.outputs.length > (journal.producer === 'world-map-export' ? 1024 : 128))
    throw new Error('Invalid export recovery journal; files preserved.')
  const names = new Set()
  for (const output of journal.outputs) {
    projectFile(root, output.path)
    if (output.path === '.retrostudio/export.lock' || output.path.startsWith('.retrostudio/export-recovery/') || output.path.startsWith('.retrostudio/export-transactions/') ||
        names.has(output.path) || typeof output.existed !== 'boolean' || typeof output.changed !== 'boolean' ||
        (output.removed === true ? output.newHash !== null : !/^[a-f0-9]{64}$/.test(output.newHash)) ||
        (output.existed ? !/^[a-f0-9]{64}$/.test(output.oldHash) : output.oldHash !== null))
      throw new Error('Invalid export recovery output; files preserved.')
    names.add(output.path)
  }
  const alive = processAlive(lock.pid)
  const active = alive && !(lock.pid === process.pid && ['recovery-required', 'rolled-back', 'committed'].includes(journal.state))
  return { lock, lockPath, journal, journalPath, active: active || activeRecoveryClaims(root, lock.id).length > 0 }
}
export function inspectPendingProjectExport(projectPath) {
  const root = fs.realpathSync(projectPath)
  const pending = pendingExport(root)
  if (!pending) return { pending: false }
  return { pending: true, transactionId: pending.lock.id, state: pending.journal.state,
    active: pending.active, outputs: pending.journal.outputs.map(output => output.path) }
}
/** Explicit recovery never overwrites a file with unknown current contents. */
export function recoverProjectExport(projectPath, transactionId) {
  const root = fs.realpathSync(projectPath)
  const pending = pendingExport(root)
  if (!pending || pending.lock.id !== transactionId) throw new Error('Pending export changed; refresh recovery information.')
  if (pending.active) throw new Error('Export process is still active; recovery refused.')
  // Immutable per-attempt claims avoid deleting a shared stale lock. Claims from
  // dead processes remain as diagnostics; live contenders cause a safe retry.
  const claimName = randomUUID() + '.json'
  const recoveryLock = projectFile(root, '.retrostudio/export-recovery/' + claimName, true)
  const claimTemporary = projectFile(root, '.retrostudio/export-recovery/' + claimName + '.tmp', true)
  try {
    fs.writeFileSync(claimTemporary, JSON.stringify({ version: 1, pid: process.pid, transactionId }), { flag: 'wx' })
    fs.linkSync(claimTemporary, recoveryLock)
  } finally { if (fs.existsSync(claimTemporary)) fs.unlinkSync(claimTemporary) }
  try {
    if (activeRecoveryClaims(root, transactionId, claimName).length)
      throw new Error('Another recovery is active; retry after it finishes.')
    const currentLock = readJsonFile(pending.lockPath, 4096)
    if (currentLock.id !== transactionId) throw new Error('Pending export changed; refresh recovery information.')
    const plans = []
    let snapshotBytes = 0
    for (let index = 0; index < pending.journal.outputs.length; index++) {
      const output = pending.journal.outputs[index]
      const target = projectFile(root, output.path)
      const current = readCurrent(target)
      const currentHash = current === null ? null : digest(current)
      const committed = pending.journal.state === 'committed'
      if (committed) {
        if (currentHash !== output.newHash) throw new Error('Committed output changed; preserved: ' + output.path)
        continue
      }
      if (currentHash !== output.oldHash && currentHash !== output.newHash)
        throw new Error('Recovery conflict; current file preserved: ' + output.path)
      const base = '.retrostudio/export-transactions/' + pending.lock.id + '/' + index
      const after = output.removed === true ? null : readCurrent(projectFile(root, base + '.after'))
      const before = output.existed ? readCurrent(projectFile(root, base + '.before')) : null
      snapshotBytes += (after?.length || 0) + (before?.length || 0)
      if (snapshotBytes > 64 * 1024 * 1024 ||
          (output.removed !== true && (!after || digest(after) !== output.newHash)) ||
          (output.existed && (!before || digest(before) !== output.oldHash)))
        throw new Error('Invalid recovery snapshot; files preserved.')
      plans.push({ target, path: output.path, currentHash, oldHash: output.oldHash, before })
    }
    const restored = []
    for (const plan of plans) {
      const current = readCurrent(projectFile(root, plan.path))
      if ((current === null ? null : digest(current)) !== plan.currentHash)
        throw new Error('Recovery output changed; preserved: ' + plan.path)
      if (plan.currentHash === plan.oldHash) continue
      if (plan.before === null) fs.unlinkSync(plan.target)
      else replace(plan.target, plan.before)
      restored.push(plan.path)
    }
    pending.journal.state = pending.journal.state === 'committed' ? 'committed' : 'rolled-back'
    replace(pending.journalPath, Buffer.from(JSON.stringify(pending.journal, null, 2) + '\n'))
    fs.unlinkSync(pending.lockPath)
    return { success: true, transactionId, restored, state: pending.journal.state }
  } finally { fs.unlinkSync(recoveryLock) }
}
