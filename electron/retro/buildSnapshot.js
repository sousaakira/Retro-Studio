import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { publishProjectOutputs } from './exportTransaction.js'

const RECEIPT = '.retro-studio/builds/latest.json'
const MAX_FILE = 64 * 1024 * 1024
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function fingerprint(root, relative, limit = MAX_FILE, content = false) {
  const file = path.resolve(root, relative)
  const real = fs.realpathSync(file)
  if (!inside(root, file) || !inside(root, real) || fs.lstatSync(file).isSymbolicLink()) throw new Error('snapshot-path-outside-project')
  const expected = fs.statSync(real)
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
  try {
    const before = fs.fstatSync(fd)
    if (before.ino !== expected.ino || before.dev !== expected.dev) throw new Error('snapshot-file-changed')
    if (!before.isFile() || before.size > limit) throw new Error('snapshot-file-limit')
    const hash = crypto.createHash('sha256'), chunk = Buffer.alloc(Math.min(65536, Math.max(1, before.size)))
    const parts = content ? [] : null
    let offset = 0
    while (offset < before.size) {
      const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, before.size - offset), offset)
      if (!count) throw new Error('snapshot-file-changed')
      hash.update(chunk.subarray(0, count)); if (parts) parts.push(Buffer.from(chunk.subarray(0, count)))
      offset += count
    }
    const after = fs.fstatSync(fd), named = fs.statSync(file)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== named.ino || after.dev !== named.dev || !inside(root, fs.realpathSync(file))) throw new Error('snapshot-file-changed')
    return { path: relative.replaceAll(path.sep, '/'), size: before.size, hash: hash.digest('hex'), ...(parts ? { bytes: Buffer.concat(parts) } : {}) }
  } finally { fs.closeSync(fd) }
}

/** Observational inventory. This does not execute or interpret project scripts. */
export function captureBuildInputs(projectPath) {
  const root = fs.realpathSync(projectPath), files = [], diagnostics = []
  let bytes = 0, visited = 0
  function visit(relative, depth = 0) {
    if (++visited > 8192 || depth > 16) throw new Error('snapshot-tree-limit')
    const file = path.join(root, relative), stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !inside(root, fs.realpathSync(file))) throw new Error('snapshot-path-outside-project')
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file).sort()) {
        if (!entry.startsWith('.')) visit(path.join(relative, entry), depth + 1)
      }
    } else {
      if (files.length >= 4096 || !stat.isFile() || bytes + stat.size > 256 * 1024 * 1024) throw new Error('snapshot-input-limit')
      const record = fingerprint(root, relative, Math.min(MAX_FILE, 256 * 1024 * 1024 - bytes)); bytes += record.size; files.push(record)
    }
  }
  for (const relative of ['Makefile', 'makefile', 'retro-studio.json', 'src', 'inc', 'res', 'tools', 'maps', 'charset', 'charsets', 'scenes', 'cutscenes', 'world', 'physics', 'controls', 'camera', 'progress', 'audio', 'debug']) {
    try { visit(relative) } catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ path: relative, code: error.message }) }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files, diagnostics, coverage: 'standard-project-paths-only' }
}

export function beginBuildSnapshot(projectPath) {
  try { return { root: fs.realpathSync(projectPath), inputs: captureBuildInputs(projectPath), startedAt: new Date().toISOString() } }
  catch (error) { return { error: error.message } }
}

/** Called only after successful make. Failure of this diagnostic must not fail a ROM build. */
export function finishBuildSnapshot(projectPath, started, romPath) {
  try {
    const root = fs.realpathSync(projectPath)
    if (!started || started.error || started.root !== root) throw new Error(started?.error || 'snapshot-project-changed')
    const inputs = captureBuildInputs(root)
    // O projeto pode ter sido aberto por um link simbólico: a ROM é comparada pelo caminho real, como a raiz.
    const rom = fingerprint(root, path.relative(root, fs.realpathSync(romPath))), outputs = [rom]
    for (const relative of ['out/rom.out', 'out/rom.elf', 'build/rom.elf']) {
      try { outputs.push(fingerprint(root, relative)); break } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const changedDuringBuild = JSON.stringify(started.inputs.files) !== JSON.stringify(inputs.files)
    const receipt = { version: 1, producer: 'retro-studio-build', startedAt: started.startedAt, finishedAt: new Date().toISOString(),
      coverage: inputs.coverage, inputStability: changedDuringBuild ? 'changed-during-build' : 'unchanged-between-observations',
      inputs: inputs.files, outputs, diagnostics: [...started.inputs.diagnostics, ...inputs.diagnostics],
      compilerDependencyProof: false }
    let current = null
    try {
      current = fingerprint(root, RECEIPT, 1024 * 1024, true)
      const existing = JSON.parse(current.bytes)
      if (existing.version !== 1 || existing.producer !== receipt.producer) throw new Error('snapshot-unmanaged-receipt')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const data = Buffer.from(JSON.stringify(receipt, null, 2) + '\n')
    if (data.length > 1024 * 1024) throw new Error('snapshot-receipt-limit')
    publishProjectOutputs(root, [{ path: RECEIPT, bytes: data, expectedHash: current?.hash ?? null }], { producer: 'build-snapshot' })
    return { status: 'recorded', path: RECEIPT, inputStability: receipt.inputStability }
  } catch (error) { return { status: 'unavailable', error: error.message } }
}

/** Hash comparison is audit evidence, not proof of make dependency correctness. */
export function inspectBuildSnapshot(projectPath, { rom = null, elf = null } = {}) {
  try {
    const root = fs.realpathSync(projectPath), file = fingerprint(root, RECEIPT, 1024 * 1024, true)
    const receipt = JSON.parse(file.bytes)
    if (receipt.version !== 1 || receipt.producer !== 'retro-studio-build' || !Array.isArray(receipt.inputs) || !Array.isArray(receipt.outputs) ||
        receipt.inputs.length > 4096 || receipt.outputs.length > 4 || receipt.outputs.length < 1 ||
        !['changed-during-build', 'unchanged-between-observations'].includes(receipt.inputStability) ||
        typeof receipt.finishedAt !== 'string' || receipt.finishedAt.length > 64) throw new Error('invalid-build-receipt')
    const changed = [], missing = []
    let bytes = 0, actualBytes = 0
    for (const item of [...receipt.inputs, ...receipt.outputs]) {
      if (!item || typeof item.path !== 'string' || item.path.length > 2048 || !/^[a-f0-9]{64}$/.test(item.hash) ||
          !Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_FILE || (bytes += item.size) > 384 * 1024 * 1024) throw new Error('invalid-build-receipt')
      try {
        const current = fingerprint(root, item.path, Math.min(MAX_FILE, 384 * 1024 * 1024 - actualBytes))
        actualBytes += current.size
        if (current.hash !== item.hash) changed.push(item.path)
      }
      catch (error) { if (error.code === 'ENOENT') missing.push(item.path); else throw error }
    }
    const current = captureBuildInputs(root)
    const known = new Set(receipt.inputs.map(item => item.path))
    const added = current.files.filter(item => !known.has(item.path)).map(item => item.path)
    const recorded = artifact => artifact && receipt.outputs.some(item => item.path === artifact.path && item.hash === artifact.hash)
    return { status: changed.length || missing.length || added.length ? 'changed-since-build' : 'matches-recorded-files',
      path: RECEIPT, finishedAt: receipt.finishedAt, inputStability: receipt.inputStability,
      changed, missing, added, coverage: 'standard-project-paths-only', compilerDependencyProof: false,
      artifactAssociation: recorded(rom) && recorded(elf) ? 'matches-displayed-artifacts' : 'unproven',
      incomplete: !Array.isArray(receipt.diagnostics) || receipt.diagnostics.length > 0 || current.diagnostics.length > 0 }
  } catch (error) { return { status: error.code === 'ENOENT' ? 'not-recorded' : 'unavailable', error: error.code === 'ENOENT' ? null : error.message } }
}
