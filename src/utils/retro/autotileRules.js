export const AUTOTILE_FORMAT = 'retro-studio-autotile'
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max

export function validateAutotile(data, tilecount = 65536) {
  if (data?.format !== AUTOTILE_FORMAT || data.version !== 1 || data.tileSize !== 8 || typeof data.name !== 'string' || data.name.length > 80 ||
      !integer(data.width, 1, 64) || !integer(data.height, 1, 64) || !Array.isArray(data.mask) || data.mask.length !== data.width * data.height ||
      data.mask.some(value => value !== 0 && value !== 1) || !Array.isArray(data.rules) || data.rules.length > 256)
    throw new Error('invalidDocument')
  for (const rule of data.rules) {
    if (!rule || typeof rule.name !== 'string' || rule.name.length > 80 || (rule.enabled != null && typeof rule.enabled !== 'boolean') || !integer(rule.tile, 0, tilecount - 1) ||
        !Array.isArray(rule.pattern) || rule.pattern.length !== 9 || rule.pattern.some(value => ![-1, 0, 1].includes(value)) || rule.pattern[4] !== 1)
      throw new Error('invalidRule')
  }
  return data
}

/** First matching rule wins; cells beyond the authored shape count as empty. */
export function generateAutotiles({ width, height, mask, rules }) {
  const tiles = Array(mask.length).fill(-1), ruleIndices = Array(mask.length).fill(-1)
  let occupied = 0, unmatched = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x
    if (!mask[index]) continue
    occupied++
    const ruleIndex = rules.findIndex(rule => rule.enabled !== false && rule.pattern.every((value, cell) => {
      if (value === -1) return true
      const nx = x + cell % 3 - 1, ny = y + Math.floor(cell / 3) - 1
      const neighbor = nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : mask[ny * width + nx]
      return neighbor === value
    }))
    if (ruleIndex < 0) { unmatched++; continue }
    tiles[index] = rules[ruleIndex].tile; ruleIndices[index] = ruleIndex
  }
  return { tiles, ruleIndices, occupied, unmatched }
}

/** Conventional 3x3 tileset layout: corners, sides, center. Diagonals stay free. */
export function nineSliceRules(start, columns, tilecount) {
  const x = start % columns, y = Math.floor(start / columns)
  if (x + 3 > columns || (y + 2) * columns + x + 2 >= tilecount) throw new Error('presetBounds')
  return Array.from({ length: 9 }, (_, i) => {
    const rx = i % 3, ry = Math.floor(i / 3), pattern = Array(9).fill(-1)
    pattern[4] = 1
    pattern[1] = ry === 0 ? 0 : 1; pattern[7] = ry === 2 ? 0 : 1
    pattern[3] = rx === 0 ? 0 : 1; pattern[5] = rx === 2 ? 0 : 1
    return { name: `${rx + 1},${ry + 1}`, tile: (y + ry) * columns + x + rx, pattern, enabled: true }
  })
}

export function autotilePlacement(document, output, tileset, { width, height, x, y, current }) {
  if (!integer(x, 0, width - 1) || !integer(y, 0, height - 1)) throw new Error('placementBounds')
  if (output.unmatched) throw new Error('unmatched')
  const cells = []
  for (let i = 0; i < output.tiles.length; i++) {
    const local = output.tiles[i]
    if (local < 0) continue
    const dx = x + i % document.width, dy = y + Math.floor(i / document.width)
    if (dx >= width || dy >= height) throw new Error('placementBounds')
    if (!integer(local, 0, tileset.tilecount - 1)) throw new Error('invalidRule')
    const index = dy * width + dx, gid = tileset.firstgid + local
    cells.push({ index, x: dx, y: dy, gid, local, replaces: (current[index] || 0) > 0 && current[index] !== gid })
  }
  return { cells, replaced: cells.filter(cell => cell.replaces).length }
}
