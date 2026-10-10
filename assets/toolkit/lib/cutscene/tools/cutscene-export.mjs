import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { compileProject, defaultCutsceneConfig } from './cutscene-compiler.mjs'
import { readProjectOutput, publishProjectOutputs } from './export-transaction.mjs'

const CONFIG = 'cutscenes/cutscene-config.json'
const RECORD = '.retrostudio/cutscene-export.json'
const GENERATOR = 'retro-studio.cutscene-compiler.v1'
const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
function headerPath(value) {
  if (typeof value !== 'string' || !/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.h$/.test(value)) throw Error('Cutscene output must be a header under src/.')
  return value
}
function bounded(root, name) {
  const bytes = readProjectOutput(root, name)
  if (bytes && bytes.length > 2 * 1024 * 1024) throw Error('Cutscene input exceeds 2 MiB: ' + name)
  return bytes
}
function scenePaths(root) {
  const found = []
  let entries = 0
  function walk(relative, depth) {
    if (depth > 16) throw Error('Cutscene folders exceed depth limit.')
    const directory = path.join(root, relative)
    if (!fs.existsSync(directory)) return
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Cutscene folder must be a regular directory.')
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 512) throw Error('Cutscene catalog exceeds 512 entries.')
      if (item.name.startsWith('.')) continue
      const name = relative + '/' + item.name
      if (item.isSymbolicLink()) throw Error('Cutscene source links are not supported.')
      if (item.isDirectory()) walk(name, depth + 1)
      else if (item.isFile() && item.name.endsWith('.cutscene.json')) found.push(name)
    }
  }
  walk('cutscenes', 0)
  if (found.length > 64) throw Error('Cutscene catalog exceeds 64 scenes.')
  return found.sort()
}
function ownership(root) {
  const bytes = bounded(root, RECORD)
  if (bytes === null) return { bytes, files: [] }
  const record = JSON.parse(bytes.toString('utf8'))
  if (record.version !== 1 || record.generator !== GENERATOR || !Array.isArray(record.files) || record.files.length > 2) throw Error('Invalid cutscene ownership record.')
  const names = new Set()
  for (const file of record.files) {
    headerPath(file.path)
    if (!/^[a-f0-9]{64}$/.test(file.hash) || names.has(file.path)) throw Error('Invalid cutscene ownership record.')
    names.add(file.path)
    const current = bounded(root, file.path)
    if (hash(current) !== file.hash) throw Error('Cutscene header changed outside the generator; preserved: ' + file.path)
  }
  return { bytes, files: record.files }
}
function compileSaved(root) {
  const configBytes = bounded(root, CONFIG)
  if (configBytes === null) return { success: false, errors: ['Missing ' + CONFIG] }
  const config = { ...defaultCutsceneConfig(), ...JSON.parse(configBytes.toString('utf8')) }
  const names = [headerPath(config.output?.ids || 'src/cutscene_ids.h'), headerPath(config.output?.data || 'src/cutscene_data.h')]
  if (names[0] === names[1]) throw Error('Cutscene headers must have different paths.')
  const sources = [{ path: CONFIG, bytes: configBytes }]
  let total = configBytes.length
  const paths = scenePaths(root)
  const inputs = paths.map(name => {
    const bytes = bounded(root, name)
    if (bytes === null) throw Error('Cutscene source disappeared: ' + name)
    total += bytes.length
    if (total > 8 * 1024 * 1024) throw Error('Cutscene sources exceed 8 MiB.')
    sources.push({ path: name, bytes })
    return { path: name, scene: JSON.parse(bytes.toString('utf8')) }
  })
  const result = compileProject(inputs, config)
  if (!result.ok) return { success: false, errors: result.errors, outputPaths: names }
  return { success: true, paths, sources, scripts: result.scripts.length, outputs: names.map((name, index) => ({ path: name, bytes: Buffer.from(index ? result.dataHeader : result.idsHeader) })) }
}
function recordBytes(files, sources) {
  return Buffer.from(JSON.stringify({ version: 1, generator: GENERATOR, files, sources }, null, 2) + '\n')
}
/** Before changing authored sources, adopt only exact legacy generated headers. */
export function prepareCutsceneExport(projectPath) {
  const root = fs.realpathSync(projectPath), owned = ownership(root)
  if (owned.bytes !== null) return { success: true, prepared: true }
  const configBytes = bounded(root, CONFIG)
  if (configBytes === null) return { success: true, prepared: true }
  let config
  try { config = JSON.parse(configBytes.toString('utf8')) }
  catch { return { success: true, prepared: true, adopted: false } } // No adoption; later publication still protects every unmanaged header.
  const names = [headerPath(config.output?.ids || 'src/cutscene_ids.h'), headerPath(config.output?.data || 'src/cutscene_data.h')]
  if (names.every(name => bounded(root, name) === null)) return { success: true, prepared: true }
  const compiled = compileSaved(root)
  if (!compiled.success) {
    if (compiled.outputPaths?.every(name => bounded(root, name) === null)) return { success: true, prepared: true }
    return compiled
  }
  const existing = []
  const checks = []
  for (const output of compiled.outputs) {
    const current = bounded(root, output.path)
    if (current === null) continue
    if (!current.equals(output.bytes)) throw Error('Unmanaged cutscene header differs from saved sources; preserved: ' + output.path)
    existing.push({ path: output.path, hash: hash(current) })
    checks.push({ path: output.path, bytes: current, expectedHash: hash(current) })
  }
  if (!existing.length) return { success: true, prepared: true }
  const sources = compiled.sources.map(source => ({ path: source.path, hash: hash(source.bytes) }))
  const outputs = [...checks, ...compiled.sources.map(source => ({ ...source, expectedHash: hash(source.bytes) })), { path: RECORD, bytes: recordBytes(existing, sources), expectedHash: null }]
  const receipt = publishProjectOutputs(root, outputs, { producer: 'cutscene-adoption' })
  return { ...receipt, prepared: true }
}
/** Main process compiles saved inputs; renderer cannot supply header contents. */
export function publishCutsceneExport(projectPath, { beforePublish } = {}) {
  const root = fs.realpathSync(projectPath), owned = ownership(root)
  const compiled = compileSaved(root)
  if (!compiled.success) return compiled
  const outputs = compiled.outputs.map(output => {
    const current = bounded(root, output.path)
    const previous = owned.files.find(file => file.path === output.path)
    if (previous && hash(current) !== previous.hash) throw Error('Cutscene header changed outside the generator; preserved: ' + output.path)
    if (current !== null && !previous && !current.equals(output.bytes)) throw Error('Unmanaged cutscene header preserved: ' + output.path)
    return { ...output, expectedHash: previous ? previous.hash : hash(current) }
  })
  for (const previous of owned.files) if (!outputs.some(output => output.path === previous.path)) outputs.push({ path: previous.path, remove: true, expectedHash: previous.hash })
  const files = compiled.outputs.map(output => ({ path: output.path, hash: hash(output.bytes) }))
  const sources = compiled.sources.map(source => ({ path: source.path, hash: hash(source.bytes) }))
  outputs.push({ path: RECORD, bytes: recordBytes(files, sources), expectedHash: hash(owned.bytes) })
  const verifySources = () => {
    if (JSON.stringify(scenePaths(root)) !== JSON.stringify(compiled.paths)) throw Error('Cutscene catalog changed during export.')
    for (const source of sources) if (hash(bounded(root, source.path)) !== source.hash) throw Error('Cutscene source changed during export: ' + source.path)
  }
  verifySources()
  const receipt = publishProjectOutputs(root, outputs, { producer: 'cutscene-export', beforePublish(index, name) { beforePublish?.(index, name); verifySources() } })
  return { ...receipt, errors: [], files, generator: GENERATOR }
}

/** Validation only: no directories, journals, ledgers or headers are written. */
export function checkCutsceneExport(projectPath) {
  const result = compileSaved(fs.realpathSync(projectPath))
  return { success: result.success, errors: result.errors || [], scripts: result.scripts || 0 }
}
