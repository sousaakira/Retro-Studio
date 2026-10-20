import fs from 'node:fs'
import path from 'node:path'
import { assetContentHash } from './projectAssets.js'
import { readGeneratedAssetLedger } from './generatedAssetLedger.js'
import { inspectPendingProjectExport, readProjectOutput } from './exportTransaction.js'
import { readAssetOrigins } from './assetImport.js'
import { fromPortablePath, isAbsolutePath } from '../../shared/retro/portablePath.js'

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.pal', '.act', '.wav', '.ogg', '.mp3', '.vgm', '.vgz', '.xgm', '.bin'])
// Files whose references this report understands (literals and resource symbols).
const STATIC_EXTENSIONS = new Set(['.json', '.tmx', '.tsx', '.res', '.c', '.h', '.s', '.asm'])
// Documentation never loads a resource.
const INERT_EXTENSIONS = new Set(['.md', '.markdown'])
const INERT_NAMES = new Set(['.gitignore', '.gitattributes', '.editorconfig', 'license', 'license.txt', 'compile_flags.txt', '.clangd'])
// Skipped only at the project root, where they are tool or build output. A folder with one
// of these names deeper in the tree is game content and is read like any other.
const EXCLUDED = new Set(['.git', '.retrostudio', '.retro-studio', 'out', 'build', 'dist-electron', 'node_modules'])
const unix = file => file.split(path.sep).join('/')
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
/**
 * Conservative, read-only dependency report. Literal references and resource
 * symbols are useful evidence, never proof that arbitrary scripts are understood.
 */
export function inspectProjectAssets(projectPath) {
  const root = fs.realpathSync(projectPath)
  let ledger, ledgerError = '', exportRecovery, exportRecoveryError = ''
  try { ledger = readGeneratedAssetLedger(root) } catch (error) { ledgerError = error.message }
  try { exportRecovery = inspectPendingProjectExport(root) } catch (error) { exportRecoveryError = error.message }
  const ownership = new Map((ledger?.assets || []).map(entry => [entry.path, entry]))
  // #42: origin of imported originals, owners of map exports and the files charsets depend on.
  let origins = new Map(), originsError = ''
  try { origins = new Map(readAssetOrigins(root).assets.map(entry => [entry.path, entry])) } catch (error) { originsError = error.message }
  const exported = new Map()
  // A record names an owner only for files its producer can write (by name) and, further down, only while the bytes still match.
  const record = (file, list, producer, pattern) => {
    try {
      const bytes = readProjectOutput(root, file)
      if (bytes === null || bytes.length > 4 * 1024 * 1024) return
      for (const entry of list(JSON.parse(bytes.toString('utf8'))) || [])
        if (typeof entry?.path === 'string' && pattern.test(entry.path) && /^[a-f0-9]{64}$/.test(entry.hash) && exported.size < 4096) exported.set(entry.path, { producer, hash: entry.hash })
    } catch { /* an unreadable record grants no ownership */ }
  }
  record('.retrostudio/world-map-export.json', data => data.files, 'world-map-export', /^res\/generated\/(?:world-\d+-(?:bg|fg|collision|hitbox)\.png|map-object-[a-f0-9]{64}\.png)$/)
  record('res/generated/map-manifest.json', data => data.objectResources, 'map-export', /^res\/generated\/map-object-[a-f0-9]{64}\.png$/)
  const charsetSources = new Map(), charsetOutputs = new Map(), portability = []
  const nonPortable = (file, value, reason) => { if (portability.length < 200) portability.push({ file, value: String(value).slice(0, 200), reason }) }
  const assets = [], sources = [], skipped = [], dynamicSources = []
  let count = 0, sourceBytes = 0, hashBytes = 0
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++count > 20000) { if (!skipped.includes('file-limit')) skipped.push('file-limit'); return }
      const file = path.join(directory, entry.name)
      const relative = unix(path.relative(root, file))
      if (entry.isSymbolicLink()) { skipped.push(relative); continue }
      if (entry.isDirectory()) {
        if (relative.split('/').length > 64) skipped.push(relative)
        else if (!(directory === root && EXCLUDED.has(entry.name))) walk(file)
        continue
      }
      if (!entry.isFile()) { skipped.push(relative); continue }
      const extension = path.extname(entry.name).toLowerCase()
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || !inside(root, fs.realpathSync(file))) { skipped.push(relative); continue }
      const canHash = ASSET_EXTENSIONS.has(extension) && stat.size <= 32 * 1024 * 1024 && hashBytes + stat.size <= 128 * 1024 * 1024
      if (canHash) hashBytes += stat.size
      else if (ASSET_EXTENSIONS.has(extension)) skipped.push(relative + ' (hash limit)')
      if (ASSET_EXTENSIONS.has(extension)) assets.push({
        path: relative, size: stat.size, hash: canHash ? assetContentHash(fs.readFileSync(file)) : null,
        references: [], duplicates: [], kind: /(?:^|\/)generated\//.test(relative) ? 'derived-location' : 'source'
      })
      if (ASSET_EXTENSIONS.has(extension) || INERT_EXTENSIONS.has(extension) || INERT_NAMES.has(entry.name.toLowerCase())) continue
      // #42: anything else that is not understood (scripts, makefiles under any name, includes,
      // other languages, lists read by tools) may load a resource in a way this report cannot
      // see. Its literals still count as references, and its presence forbids any automatic
      // "disposable" verdict.
      const understood = STATIC_EXTENSIONS.has(extension)
      if (!understood) dynamicSources.push(relative)
      if (stat.size > 1024 * 1024 || sourceBytes + stat.size > 32 * 1024 * 1024) { skipped.push(relative); continue }
      const raw = fs.readFileSync(file)
      if (!understood && raw.subarray(0, 4096).includes(0)) continue // binary: nothing to read, already counted as unknown
      sourceBytes += stat.size
      let text = raw.toString('utf8')
      // Inventory and output manifests do not constitute usage by a game.
      if (/\/generated\/[^/]*manifest\.json$/i.test('/' + relative)) continue
      if (relative === 'retro-studio.json') {
        try {
          const config = JSON.parse(text)
          // The inventory is not usage, but an absolute path in it breaks on another machine.
          for (const item of Array.isArray(config.assets) ? config.assets.slice(0, 4096) : [])
            if (typeof item?.path === 'string' && /^(?:[\\/]|[a-zA-Z]:[\\/])/.test(item.path)) nonPortable(relative, item.path, 'absolute-path')
          delete config.assets; text = JSON.stringify(config)
        }
        catch { skipped.push(relative); continue }
      }
      if (entry.name.endsWith('.charset.json')) try {
        const charset = JSON.parse(text)
        const sources = Array.isArray(charset.sources) ? charset.sources : [charset.source]
        for (const source of sources) {
          const stored = source?.path
          if (typeof stored === 'string' && stored) {
            const absolute = fromPortablePath(root, stored), local = absolute && inside(root, absolute) ? unix(path.relative(root, absolute)) : null
            if (local) charsetSources.set(local, relative)
            if (isAbsolutePath(stored)) nonPortable(relative, stored, local ? 'absolute-inside-project' : 'outside-project')
          }
        }
        if (typeof charset.exportedFileName === 'string' && /^[^/\\]+\.png$/i.test(charset.exportedFileName)) charsetOutputs.set('res/' + charset.exportedFileName, relative)
      } catch { /* an invalid charset project protects nothing and claims nothing */ }
      // Absolute paths written in authoring files stop working on another machine.
      else if (['.json', '.tmx', '.tsx', '.res'].includes(extension) && !/(?:^|\/)generated\/[^/]*manifest\.json$/i.test(relative)) {
        // File references: absolute anywhere, or relative ones that leave the project.
        const seen = new Set()
        for (const match of text.matchAll(/"([^"\n]{1,400})"|'([^'\n]{1,400})'/g)) {
          const value = (match[1] ?? match[2]).replaceAll('\\\\', '/').replaceAll('\\', '/').replaceAll('&amp;', '&')
          if (seen.has(value) || !/\.[A-Za-z0-9]{1,5}$/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /\s{2}|[<>{}]/.test(value)) continue
          seen.add(value)
          if (/^(?:\/|[a-zA-Z]:\/)/.test(value)) nonPortable(relative, value, inside(root, path.resolve(value)) && !/^[a-zA-Z]:/.test(value) ? 'absolute-inside-project' : 'absolute-path')
          else if (value.includes('../') && !inside(root, path.resolve(root, relative === 'retro-studio.json' ? '.' : path.dirname(relative), value))) nonPortable(relative, value, 'outside-project')
        }
      }
      sources.push({ path: relative, text, extension })
    }
  }
  walk(root)
  const byBasename = new Map(), byPath = new Map(assets.map(asset => [asset.path, asset]))
  for (const asset of assets) {
    const basename = path.basename(asset.path)
    if (!byBasename.has(basename)) byBasename.set(basename, [])
    byBasename.get(basename).push(asset)
  }
  const symbols = new Map()
  let referenceChecks = 0
  function addReference(asset, sourcePath) {
    if (++referenceChecks > 100000) {
      if (!skipped.includes('reference-limit')) skipped.push('reference-limit')
      return false
    }
    if (!asset.references.includes(sourcePath)) asset.references.push(sourcePath)
    return true
  }

  function reference(source, token) {
    if (referenceChecks >= 100000) return []
    const decoded = token.replaceAll('\\\\', '/').replaceAll('\\', '/')
      .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    const local = unix(path.relative(root, path.resolve(root, path.dirname(source.path), decoded)))
    const direct = byPath.get(local) || byPath.get(decoded)
    const targets = direct ? [direct] : (byBasename.get(path.posix.basename(decoded)) || [])
    for (const asset of targets) if (!addReference(asset, source.path)) break
    return targets
  }
  for (const source of sources) {
    for (const match of source.text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) reference(source, match[1] ?? match[2])
    if (source.extension === '.res') {
      for (const match of source.text.matchAll(/^\s*\w+\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]+)"/gm))
        symbols.set(match[1], reference(source, match[2]))
    }
  }
  for (const source of sources.filter(item => ['.c', '.h', '.s', '.asm', '.inc', '.cpp', '.cc', '.hpp', '.i'].includes(item.extension))) {
    for (const token of source.text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
      if (referenceChecks >= 100000) break
      for (const asset of symbols.get(token) || []) if (!addReference(asset, source.path)) break
    }
  }
  const hashes = new Map()
  for (const asset of assets) if (asset.hash) {
    if (!hashes.has(asset.hash)) hashes.set(asset.hash, [])
    hashes.get(asset.hash).push(asset.path)
  }
  for (const asset of assets) {
    asset.references.sort()
    const owned = ownership.get(asset.path)
    asset.ownership = !owned ? 'untracked' : owned.hash === asset.hash && owned.size === asset.size ? 'verified' : 'modified-or-unverified'
    if (owned) asset.producer = owned.producer
    const group = asset.hash ? (hashes.get(asset.hash) || []) : []
    asset.duplicateCount = Math.max(0, group.length - 1)
    asset.duplicates = group.slice(0, 9).filter(file => file !== asset.path).slice(0, 8)
    asset.status = asset.references.length ? 'referenced' : 'unverified'
    // Role, owner and origin. Nothing here is inferred from a file name alone.
    const origin = origins.get(asset.path), listed = exported.get(asset.path), output = listed && listed.hash === asset.hash ? listed : null
    if (charsetSources.has(asset.path)) { asset.role = 'charset-source'; asset.origin = { kind: 'charset-sheet', project: charsetSources.get(asset.path) } }
    else if (charsetOutputs.has(asset.path)) { asset.role = 'charset-output'; asset.owner = 'character-export'; asset.origin = { kind: 'charset', project: charsetOutputs.get(asset.path) } }
    else if (owned) { asset.role = 'derived'; asset.owner = owned.producer; asset.origin = { kind: 'generated', producer: owned.producer, createdAt: owned.createdAt } }
    // Export records name an owner; "ownership" stays the ledger's word, the only one cleanup trusts.
    else if (output) { asset.role = 'derived'; asset.owner = output.producer; asset.origin = { kind: 'generated', producer: output.producer, verified: true } }
    else if (asset.kind === 'derived-location') asset.role = 'generated-unknown'
    else asset.role = 'original'
    // An imported sheet keeps its import origin and also says which character project uses it.
    if (origin && ['original', 'charset-source'].includes(asset.role)) asset.origin = { kind: 'import', sourceName: origin.sourceName, importedAt: origin.importedAt, verified: origin.hash === asset.hash,
      ...(asset.role === 'charset-source' ? { project: charsetSources.get(asset.path) } : {}) }
    asset.owner ??= null; asset.origin ??= null
    // Originals and everything a charset needs are never offered to a derivative cleanup.
    asset.protected = ['original', 'charset-source', 'charset-output'].includes(asset.role)
    // This report deliberately grants no deletion authority. Ownership is a
    // separate manifest, and scripts or skipped files can hide dependencies.
    asset.cleanupEligible = false
    asset.quarantineCandidate = !!owned && asset.ownership === 'verified' && !asset.references.length && !asset.protected
    // Unknown dependencies (scripts, skipped files, limits) never allow an automatic "disposable" verdict.
    asset.disposal = asset.protected ? 'never' : asset.references.length ? 'in-use'
      : !asset.quarantineCandidate ? 'unknown-owner' : dynamicSources.length || skipped.length ? 'manual-review' : 'candidate'
  }
  return {
    success: true, projectPath: path.resolve(projectPath), assets: assets.sort((a,b) => a.path.localeCompare(b.path)),
    inspectedFiles: count, skipped, dynamicSources, ledgerError, originsError, portability, exportRecovery, exportRecoveryError,
    missingOwnedAssets: (ledger?.assets || []).filter(entry => !byPath.has(entry.path)).map(entry => entry.path),
    coverage: 'literal-and-resource-symbols', destructiveActionsAvailable: false
  }
}
