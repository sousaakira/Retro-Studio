export const MAX_COLOR_PIXELS = 16 * 1024 * 1024
const MAX_COLORS = 65536

export function colorHex(key) { return `#${key.toString(16).padStart(6, '0').toUpperCase()}` }
export function colorKey(hex) { return /^#[0-9a-f]{6}$/i.test(hex || '') ? parseInt(hex.slice(1), 16) : null }

/** Exact RGB colors from artwork only; fully transparent pixels never count. */
export function analyzeMapColors({ data, width, height }) {
  if (width * height > MAX_COLOR_PIXELS) throw new Error('tooLarge')
  const counts = new Map()
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    counts.set(key, (counts.get(key) || 0) + 1)
    total++
    if (counts.size > MAX_COLORS) throw new Error('tooManyColors')
  }
  const colors = [...counts].map(([key, count]) => {
    const r = key >>> 16, g = (key >>> 8) & 255, b = key & 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
    const hue = !delta ? -1 : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360
    return { key, hex: colorHex(key), r, g, b, count, hue, lightness: (max + min) / 510 }
  }).sort((a, b) => b.count - a.count || a.key - b.key)
  return { colors, total }
}

/** Preserve matching artwork pixels, dim the rest, and collect tile locations. */
export function locateMapColor({ data, width, height }, key, tileSize = 8, dimEmpty = false) {
  const mask = new Uint8ClampedArray(data.length), tiles = new Set()
  const columns = Math.ceil(width / tileSize)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) { if (dimEmpty) mask[i + 3] = 205; continue }
    const match = ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) === key
    if (match) {
      mask[i] = data[i]; mask[i + 1] = data[i + 1]; mask[i + 2] = data[i + 2]; mask[i + 3] = data[i + 3]
      const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width)
      tiles.add(Math.floor(y / tileSize) * columns + Math.floor(x / tileSize))
      count++
    } else mask[i + 3] = 205
  }
  return { mask, count, locations: [...tiles].map(index => ({ x: (index % columns) * tileSize, y: Math.floor(index / columns) * tileSize })) }
}

export function objectPaletteBank(object) {
  const raw = object?.properties?.palette
  return raw !== '' && raw != null && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 3 ? String(Number(raw)) : 'unknown'
}

/** Authoring attributes, not a claim about the game's compiled CRAM contents. */
export function mapPaletteUsage({ scope, spriteId = 'all', tiles = [], tiles2 = [], palette = [], palette2 = [], objects = [], background, parallax = [] }) {
  const rows = []
  if (scope !== 'sprites') {
    for (const [source, values, banks] of [['BG', tiles, palette], ['FG', tiles2, palette2]]) {
      const counts = [0, 0, 0, 0]
      values.forEach((tile, i) => { if (tile > 0) counts[Number(banks[i]) & 3]++ })
      counts.forEach((count, bank) => { if (count) rows.push({ source, bank: String(bank), count, unit: 'tiles' }) })
    }
    if (background?.preview) rows.push({ source: 'background', bank: 'unknown', count: 1, unit: 'images' })
    if (parallax.length) rows.push({ source: 'parallax', bank: 'unknown', count: parallax.length, unit: 'images' })
  }
  if (scope !== 'scenery') for (const obj of objects) {
    if (!obj.visual?.gid || (spriteId !== 'all' && String(obj.id) !== spriteId)) continue
    rows.push({ source: obj.name || obj.type || String(obj.id), bank: objectPaletteBank(obj), count: 1, unit: 'sprites' })
  }
  return rows
}
