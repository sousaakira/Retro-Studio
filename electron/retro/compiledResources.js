import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { publishProjectOutputs } from './exportTransaction.js'
import { inspectBuildSnapshot } from './buildSnapshot.js'

const MAX_FILE = 64 * 1024 * 1024
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

/** Read linked ELF32/68000 data without executing project commands or tools. */
export function parseM68kElf(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 52 || bytes.length > MAX_FILE ||
      bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes[4] !== 1 || bytes[5] !== 2 || bytes[6] !== 1)
    throw new Error('unsupported-elf')
  const range = (offset, size) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length)
      throw new Error('invalid-elf-range')
    return bytes.subarray(offset, offset + size)
  }
  if (bytes.readUInt16BE(16) !== 2 || bytes.readUInt16BE(18) !== 4 || bytes.readUInt32BE(20) !== 1) throw new Error('unsupported-elf-target')
  const table = bytes.readUInt32BE(32), stride = bytes.readUInt16BE(46), count = bytes.readUInt16BE(48)
  const stringsIndex = bytes.readUInt16BE(50)
  if (stride !== 40 || count < 1 || count > 2048 || stringsIndex >= count) throw new Error('invalid-elf-sections')
  range(table, count * stride)
  const sections = Array.from({ length: count }, (_, index) => {
    const offset = table + index * stride
    const section = { index, nameOffset: bytes.readUInt32BE(offset), type: bytes.readUInt32BE(offset + 4),
      flags: bytes.readUInt32BE(offset + 8), address: bytes.readUInt32BE(offset + 12), offset: bytes.readUInt32BE(offset + 16),
      size: bytes.readUInt32BE(offset + 20), link: bytes.readUInt32BE(offset + 24), entrySize: bytes.readUInt32BE(offset + 36) }
    section.cpuAddress = section.address & 0xffffff // 68000 has a 24-bit address bus; SGDK may sign-extend RAM symbols.
    if (section.address + section.size > 0x100000000) throw new Error('invalid-elf-address')
    if (section.type !== 8) range(section.offset, section.size)
    return section
  })
  const names = sections[stringsIndex]
  if (names.type !== 3 || names.size > 1024 * 1024) throw new Error('invalid-elf-strings')
  const stringAt = (section, offset) => {
    if (section?.type !== 3 || offset >= section.size) throw new Error('invalid-elf-string')
    const start = section.offset + offset
    const end = bytes.indexOf(0, start)
    if (end < start || end >= section.offset + section.size || end - start > 256) throw new Error('invalid-elf-string')
    return bytes.toString('utf8', start, end)
  }
  for (const section of sections) section.name = stringAt(names, section.nameOffset)
  const allocated = sections.filter(section => (section.flags & 2) && section.size)
  const sorted = [...allocated].sort((a, b) => a.cpuAddress - b.cpuAddress)
  if (allocated.some(section => section.cpuAddress + section.size > 0x1000000)) throw new Error('invalid-elf-address')
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].cpuAddress < sorted[i - 1].cpuAddress + sorted[i - 1].size) throw new Error('overlapping-elf-sections')
  const symbols = new Map()
  let symbolCount = 0, reads = 0, readBytes = 0
  for (const section of sections.filter(section => section.type === 2)) {
    if (section.entrySize !== 16 || section.size % 16 || !sections[section.link]) throw new Error('invalid-elf-symbols')
    symbolCount += section.size / 16
    if (symbolCount > 100000) throw new Error('elf-symbol-limit')
    for (let offset = section.offset; offset < section.offset + section.size; offset += 16) {
      const name = stringAt(sections[section.link], bytes.readUInt32BE(offset))
      const symbol = { name, address: bytes.readUInt32BE(offset + 4), size: bytes.readUInt32BE(offset + 8),
        type: bytes[offset + 12] & 15, sectionIndex: bytes.readUInt16BE(offset + 14) }
      if (!(bytes[offset + 12] >> 4)) continue // Local labels can repeat across object files.
      if (!name || !symbol.sectionIndex || symbol.sectionIndex >= sections.length) continue
      if (symbols.has(name) && (symbols.get(name).address !== symbol.address || symbols.get(name).size !== symbol.size))
        throw new Error('ambiguous-elf-symbol')
      symbols.set(name, symbol)
    }
  }
  function data(address, length) {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) || address < 0 || length < 0 || length > 32 * 1024 * 1024)
      throw new Error('invalid-elf-read')
    if (++reads > 100000 || (readBytes += length) > 32 * 1024 * 1024) throw new Error('elf-read-limit')
    address &= 0xffffff
    const section = allocated.find(section => section.type !== 8 && address >= section.cpuAddress && address + length <= section.cpuAddress + section.size)
    if (!section || address < 0 || length < 0) throw new Error('unmapped-elf-pointer')
    return range(section.offset + address - section.cpuAddress, length)
  }
  return { sections, symbols, data }
}

function sgdkResource(elf, declaration) {
  const symbol = elf.symbols.get(declaration.symbol)
  if (!symbol) return { status: 'not-linked', facts: null }
  if (![0, 1].includes(symbol.type)) throw new Error('not-data-resource')
  const at = (address, length) => elf.data(address, length)
  const palette = address => {
    const header = at(address, 6), length = header.readUInt16BE(0)
    if (!length || length > 256) throw new Error('invalid-palette')
    const bytes = at(header.readUInt32BE(2), length * 2)
    return { paletteEntries: length, paletteWords: Array.from({ length }, (_, i) => bytes.readUInt16BE(i * 2)) }
  }
  const tiles = address => {
    const header = at(address, 8), compression = header.readUInt16BE(0), tileCount = header.readUInt16BE(2)
    if (compression > 2) throw new Error('unsupported-compression')
    if (tileCount && compression === 0) at(header.readUInt32BE(4), tileCount * 32)
    return { tileCount, compression, uncompressedTileBytes: tileCount * 32,
      tilePayloadRomBytes: compression === 0 ? tileCount * 32 : null }
  }
  let facts
  switch (declaration.kind) {
    case 'TILESET': facts = tiles(symbol.address); break
    case 'PALETTE': facts = palette(symbol.address); break
    case 'IMAGE': {
      const header = at(symbol.address, 12), map = at(header.readUInt32BE(8), 10)
      facts = { ...palette(header.readUInt32BE(0)), ...tiles(header.readUInt32BE(4)),
        mapWidth: map.readUInt16BE(2), mapHeight: map.readUInt16BE(4), mapUnits: 'tiles-8px' }
      break
    }
    case 'SPRITE': {
      const header = at(symbol.address, 18)
      const width = header.readUInt16BE(0), height = header.readUInt16BE(2), animationCount = header.readUInt16BE(8)
      if (!width || !height || width > 4096 || height > 4096 || !animationCount || animationCount > 256) throw new Error('invalid-sprite')
      const animations = at(header.readUInt32BE(10), animationCount * 4)
      let frameCount = 0, peakFrameTiles = 0, peakFrameSprites = 0
      for (let i = 0; i < animationCount; i++) {
        const animation = at(animations.readUInt32BE(i * 4), 6), count = animation[0]
        if (!count || animation[1] >= count || (frameCount += count) > 8192) throw new Error('invalid-animation')
        const frames = at(animation.readUInt32BE(2), count * 4)
        for (let j = 0; j < count; j++) {
          const frame = at(frames.readUInt32BE(j * 4), 10)
          const tileCount = tiles(frame.readUInt32BE(2)).tileCount
          peakFrameTiles = Math.max(peakFrameTiles, tileCount)
          peakFrameSprites = Math.max(peakFrameSprites, frame[0])
        }
      }
      facts = { width, height, animationCount, frameCount, peakFrameTiles, peakFrameSprites,
        maxNumTile: header.readUInt16BE(14), maxNumSprite: header.readUInt16BE(16), ...palette(header.readUInt32BE(4)) }
      if (facts.maxNumTile < peakFrameTiles || facts.maxNumSprite < peakFrameSprites) throw new Error('inconsistent-sprite-budget')
      break
    }
    case 'MAP': {
      const header = at(symbol.address, 28)
      const compression = header.readUInt16BE(6)
      facts = { mapWidth: header.readUInt16BE(0), mapHeight: header.readUInt16BE(2), mapUnits: 'blocks-128px',
        compressionFields: { metaTiles: compression & 15, blocks: (compression >> 4) & 15, indexes: (compression >> 8) & 15 },
        metaTileCount: header.readUInt16BE(8), blockCount: header.readUInt16BE(10) }
      break
    }
    // Sound resources have no structure to read: their ROM cost is the span of the symbol.
    // rescomp emits no size for them, so the span runs to the next global symbol of the
    // section. That is an UPPER BOUND (padding and unnamed data may follow) and is labelled so.
    case 'XGM': case 'WAV': {
      let bytes = symbol.size, evidence = 'symbol-size'
      if (!bytes) {
        const section = elf.sections[symbol.sectionIndex]
        let next = section ? (section.address + section.size) >>> 0 : 0
        for (const other of elf.symbols.values()) if (other.sectionIndex === symbol.sectionIndex && other.address > symbol.address && other.address < next) next = other.address
        bytes = next > symbol.address ? next - symbol.address : 0; evidence = 'next-symbol'
      }
      if (!bytes || bytes > 16 * 1024 * 1024) throw new Error('invalid-sound-resource')
      facts = { romBytes: bytes, romBytesEvidence: evidence }
      break
    }
    default: return { status: 'unsupported-resource', facts: null }
  }
  return { status: 'compiled', facts }
}

function boundedFile(root, relative, max = MAX_FILE, prefix = null) {
  const file = path.resolve(root, relative)
  if (!inside(root, file)) throw new Error('outside-project')
  const real = fs.realpathSync(file)
  if (!inside(root, real)) throw new Error('outside-project')
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > max) throw new Error('report-file-limit')
    const bytes = Buffer.alloc(prefix === null ? stat.size : Math.min(prefix, stat.size))
    let read = 0
    while (read < bytes.length) {
      const length = fs.readSync(fd, bytes, read, bytes.length - read, read)
      if (!length) throw new Error('report-file-changed')
      read += length
    }
    const after = fs.fstatSync(fd)
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('report-file-changed')
    return { bytes, size: stat.size, modifiedAt: stat.mtime.toISOString(), path: relative, hash: prefix === null ? hash(bytes) : null }
  } finally { fs.closeSync(fd) }
}

/** #51: specific actions for costs that were actually read from the compiled ROM.
 * Each one names the resource and its source file; authoring estimates never produce one. */
export function resourceSuggestions({ resources = [], staticRAM = null, rom = null } = {}) {
  const list = []
  const add = (code, resource, values) => list.push({ code, symbol: resource?.symbol ?? null, origin: resource?.origin ?? null, values })
  for (const resource of resources) {
    const facts = resource.status === 'compiled' ? resource.facts : null
    if (!facts) continue
    if ((resource.kind === 'TILESET' || resource.kind === 'IMAGE') && facts.compression === 0 && facts.tileCount >= 128)
      add('uncompressed-tiles', resource, { tiles: facts.tileCount, bytes: facts.uncompressedTileBytes })
    if (resource.kind === 'IMAGE' && facts.tileCount >= 1200) add('many-unique-tiles', resource, { tiles: facts.tileCount })
    if (resource.kind === 'SPRITE' && facts.peakFrameSprites >= 8) add('sprite-hardware-pieces', resource, { sprites: facts.peakFrameSprites })
    if (resource.kind === 'SPRITE' && facts.peakFrameTiles >= 96) add('sprite-frame-tiles', resource, { tiles: facts.peakFrameTiles })
    if ((resource.kind === 'XGM' || resource.kind === 'WAV') && facts.romBytes >= 256 * 1024) add('sound-rom', resource, { bytes: facts.romBytes })
  }
  if (Number.isInteger(staticRAM) && staticRAM > 48 * 1024) add('static-ram-high', null, { bytes: staticRAM })
  if (rom && Number.isInteger(rom.size) && rom.size > 4 * 1024 * 1024) add('rom-large', null, { bytes: rom.size })
  return list
}

/** No sums of all sprite frames: VRAM depends on simultaneous consumers. */
export function resourceBudget(resources, config = {}) {
  const byId = new Map(resources.map(resource => [resource.symbol, resource]))
  const mode = config.videoMode || 'H40'
  if (!['H32', 'H40'].includes(mode)) throw new Error('invalid-budget-mode')
  const planes = config.planes ?? null, arena = config.tileArena ?? null
  if (planes && (![32, 64, 128].includes(planes.width) || ![32, 64, 128].includes(planes.height) || planes.width * planes.height > 4096))
    throw new Error('invalid-plane-budget')
  if (arena && (!Number.isInteger(arena.start) || !Number.isInteger(arena.bytes) || arena.start < 0 || arena.bytes < 0 ||
      arena.start % 32 || arena.bytes % 32 || arena.start + arena.bytes > 65536)) throw new Error('invalid-tile-arena')
  const reservations = config.reservations || [], consumers = config.consumers || []
  if (!Array.isArray(reservations) || reservations.length > 128 || !Array.isArray(consumers) || consumers.length > 128)
    throw new Error('invalid-budget-config')
  const warnings = [], ids = new Set()
  const reserved = reservations.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(item.id) || ids.has(item.id) ||
        !Number.isInteger(item.start) || item.start < 0 || !Number.isInteger(item.bytes) || item.bytes < 0 || item.start + item.bytes > 65536)
      throw new Error('invalid-vram-reservation')
    ids.add(item.id)
    return { id: item.id, start: item.start, bytes: item.bytes, source: 'configuration' }
  }).sort((a, b) => a.start - b.start)
  for (let i = 1; i < reserved.length; i++)
    if (reserved[i].start < reserved[i - 1].start + reserved[i - 1].bytes) warnings.push('overlapping-reservations')
  if (arena && reserved.some(row => arena.start < row.start + row.bytes && row.start < arena.start + arena.bytes)) warnings.push('tile-arena-overlap')
  const rows = consumers.map(item => {
    if (!item || typeof item.resourceId !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(item.resourceId) || !Number.isInteger(item.instances) || item.instances < 0 || item.instances > 4096 ||
        !['sprite-stream', 'tiles-resident'].includes(item.mode)) throw new Error('invalid-resource-consumer')
    const resource = byId.get(item.resourceId), facts = resource?.facts
    const perInstance = item.mode === 'sprite-stream' ? facts?.maxNumTile : facts?.tileCount
    const hardwareSprites = item.mode === 'sprite-stream' && facts?.maxNumSprite !== undefined ? facts.maxNumSprite * item.instances : null
    return { resourceId: item.resourceId, origin: resource?.origin || null, instances: item.instances, mode: item.mode,
      tiles: perInstance === undefined ? null : perInstance * item.instances, hardwareSprites }
  })
  const unknown = rows.some(row => row.tiles === null)
  const tileBytes = unknown ? null : rows.reduce((sum, row) => sum + row.tiles * 32, 0)
  if (arena && tileBytes !== null && tileBytes > arena.bytes) warnings.push('tile-arena-capacity')
  const hardwareSprites = rows.some(row => row.mode === 'sprite-stream' && row.hardwareSprites === null) ? null :
    rows.reduce((sum, row) => sum + (row.hardwareSprites || 0), 0)
  if (hardwareSprites !== null && hardwareSprites > (mode === 'H40' ? 80 : 64)) warnings.push('sprite-table-limit')
  if (tileBytes !== null && reserved.reduce((sum, row) => sum + row.bytes, 0) + tileBytes > 65536) warnings.push('vram-capacity-limit')
  return { videoMode: mode, planes: planes ? { width: planes.width, height: planes.height, nameTableBytesEach: planes.width * planes.height * 2 } : null,
    tileArena: arena, reservations: reserved, consumers: rows, plannedTileBytes: tileBytes, plannedHardwareSprites: hardwareSprites,
    warnings, limits: { vramBytes: 65536, ramBytes: 65536, paletteSlots: 4, paletteEntriesPerSlot: 16,
      hardwareSprites: mode === 'H40' ? 80 : 64, spritesPerLine: mode === 'H40' ? 20 : 16, spritePixelsPerLine: mode === 'H40' ? 320 : 256 },
    occupancy: 'planning-only', runtimeDMA: 'unknown', runtimeRAM: 'unknown', runtimePaletteAssignments: 'unknown' }
}

export function inspectCompiledResources(projectPath, options = {}) {
  if (options.abi !== undefined && options.abi !== null && options.abi !== 'sgdk-1.81') throw new Error('unsupported-resource-abi')
  const root = fs.realpathSync(projectPath), diagnostics = [], resources = []
  let config = {}, configFile = null, configEditable = true, elf = null, elfFile = null, rom = null
  try {
    configFile = boundedFile(root, 'retro-studio.json', 1024 * 1024)
    config = JSON.parse(configFile.bytes)
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid-report-config')
  } catch (error) { config = {}; if (error.code !== 'ENOENT') { configEditable = false; diagnostics.push({ code: 'invalid-report-config' }) } }
  let abi = options.abi ?? config.hardwareBudget?.resourceAbi ?? null
  if (abi !== null && abi !== 'sgdk-1.81') {
    diagnostics.push({ code: 'unsupported-resource-abi', source: 'retro-studio.json:hardwareBudget.resourceAbi' })
    abi = null
  }
  for (const candidate of ['out/rom.out', 'out/rom.elf', 'build/rom.elf']) {
    try { elfFile = boundedFile(root, candidate); elf = parseM68kElf(elfFile.bytes); break }
    catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ code: error.message, source: candidate }); elfFile = null }
  }
  try { const file = boundedFile(root, 'out/rom.bin'); rom = { ...file, bytes: undefined } }
  catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ code: error.message, source: 'out/rom.bin' }) }
  let sourceBytes = 0, declarations = 0
  const resDirectory = path.join(root, 'res')
  if (fs.existsSync(resDirectory)) {
    if (!inside(root, fs.realpathSync(resDirectory))) throw new Error('outside-project')
    const files = fs.readdirSync(resDirectory).filter(file => file.endsWith('.res')).sort()
    if (files.length > 128) throw new Error('resource-file-limit')
    const symbols = new Set()
    for (const file of files) {
      const relative = 'res/' + file, source = boundedFile(root, relative, 1024 * 1024)
      if ((sourceBytes += source.size) > 4 * 1024 * 1024) throw new Error('resource-file-limit')
      for (const match of source.bytes.toString('utf8').matchAll(/^\s*(\w+)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+"([^"\n]+)"/gm)) {
        if (++declarations > 512) throw new Error('resource-declaration-limit')
        if (symbols.has(match[2])) { diagnostics.push({ code: 'duplicate-resource-symbol', source: relative, symbol: match[2] }); continue }
        symbols.add(match[2])
        const token = match[3].replaceAll('\\', '/')
        const origin = /^(?:\/|[a-zA-Z]:\/)/.test(token) ? token : path.posix.normalize('res/' + token)
        const declaration = { kind: match[1].toUpperCase(), symbol: match[2], origin,
          declaration: relative, sourceHash: source.hash, authoring: null }
        // Source dimensions are an unoptimized grid estimate, never compiled VRAM.
        if (declaration.origin.endsWith('.png')) try {
          const input = boundedFile(root, declaration.origin, 32 * 1024 * 1024, 24)
          if (input.bytes.length >= 24 && input.bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
            const width = input.bytes.readUInt32BE(16), height = input.bytes.readUInt32BE(20)
            if (width && height && width <= 65536 && height <= 65536) declaration.authoring = { width, height, gridTiles: Math.ceil(width / 8) * Math.ceil(height / 8) }
          }
        } catch (error) { diagnostics.push({ code: error.message, source: declaration.origin }) }
        let result = { status: !elf ? 'not-built' : !abi ? 'unknown-abi' : 'unknown', facts: null }
        if (elf && abi) try { result = sgdkResource(elf, declaration) }
        catch (error) { result = { status: 'unreadable-resource', facts: null }; diagnostics.push({ code: error.message, symbol: declaration.symbol }) }
        resources.push({ ...declaration, ...result })
      }
    }
  }
  const sections = elf?.sections.filter(section => (section.flags & 2) && section.size).map(section => ({
    name: section.name, address: section.cpuAddress, elfAddress: section.address, bytes: section.size, storedInElf: section.type !== 8,
    memory: section.cpuAddress >= 0xff0000 && section.cpuAddress + section.size <= 0x1000000 ? 'ram' : section.cpuAddress + section.size <= 0x400000 ? 'rom' : 'other'
  })) || []
  const staticRAM = elf ? sections.filter(section => section.memory === 'ram').reduce((sum, section) => sum + section.bytes, 0) : null
  let budget
  try {
    if (config.hardwareBudget !== undefined && (!config.hardwareBudget || typeof config.hardwareBudget !== 'object' || Array.isArray(config.hardwareBudget)))
      throw new Error('invalid-budget-config')
    budget = resourceBudget(resources, { ...config.hardwareBudget, videoMode: config.hardwareBudget?.videoMode || config.retroStudio?.target?.videoMode || 'H40' })
    budget.configured = config.hardwareBudget !== undefined
  } catch (error) {
    diagnostics.push({ code: error.message, source: 'retro-studio.json:hardwareBudget' })
    budget = { ...resourceBudget([]), configured: false, invalid: true }
  }
  return { version: 1, abi, abiEvidence: abi ? 'explicit-reader-assumption' : 'unknown', rom,
    configuration: { editable: configEditable && !budget.invalid, revision: configFile?.hash ?? null,
      budget: config.hardwareBudget ?? { videoMode: config.retroStudio?.target?.videoMode || 'H40', reservations: [], consumers: [] } },
    elf: elfFile ? { path: elfFile.path, size: elfFile.size, hash: elfFile.hash, modifiedAt: elfFile.modifiedAt } : null,
    sections, staticRAM, resources, budget, diagnostics, suggestions: resourceSuggestions({ resources, staticRAM, rom }),
    buildSnapshot: inspectBuildSnapshot(root, { rom, elf: elfFile }), freshness: 'unknown', runtimeHeap: 'unknown', runtimeStack: 'unknown',
    sourceAttribution: 'current-resource-declarations', resourceRomOwnership: 'unknown',
    unknowns: ['build-source-snapshot', 'heap-stack', 'runtime-vram-layout', 'dma-per-frame', 'sprite-scanline-load', 'palette-conflicts', 'shared-rom-payload-ownership'] }
}

/** Explicit UI save: preserve project settings, revision guard and transaction backup. */
export function saveHardwareBudget(projectPath, { revision, budget } = {}) {
  if (!budget || typeof budget !== 'object' || Array.isArray(budget) || Buffer.byteLength(JSON.stringify(budget)) > 64 * 1024)
    throw new Error('invalid-budget-config')
  if (budget.resourceAbi !== undefined && budget.resourceAbi !== null && budget.resourceAbi !== 'sgdk-1.81') throw new Error('unsupported-resource-abi')
  resourceBudget([], budget)
  const root = fs.realpathSync(projectPath)
  let current = null, config = {}
  try {
    current = boundedFile(root, 'retro-studio.json', 1024 * 1024)
    config = JSON.parse(current.bytes)
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid-report-config')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (revision !== (current?.hash ?? null)) throw new Error('budget-config-changed')
  config.hardwareBudget = structuredClone(budget)
  const bytes = Buffer.from(JSON.stringify(config, null, 2) + '\n')
  if (bytes.length > 1024 * 1024) throw new Error('report-file-limit')
  const receipt = publishProjectOutputs(root, [{ path: 'retro-studio.json', bytes, expectedHash: revision }], { producer: 'hardware-budget' })
  return { ...receipt, revision: hash(bytes), budget: config.hardwareBudget }
}
