export const MEGA_DRIVE_VRAM_BYTES = 64 * 1024
export const MEGA_DRIVE_TILE_BYTES = 32
export const MEGA_DRIVE_MAP_RESERVE_BYTES = 8 * 1024

const assetPath = value => String(value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
const toTiles = (width, height) => Math.max(0, Math.ceil(Number(width || 0) / 8) * Math.ceil(Number(height || 0) / 8))

/** Conservative map estimate: full source sheets plus one 64x32 plane allocation. */
export function estimateMapVram({ tilesets = [], background = null, parallaxLayers = [] } = {}) {
  const graphics = new Map()
  for (const tileset of tilesets) {
    const key = assetPath(tileset.path) || `tileset:${tileset.id || tileset.name || graphics.size}`
    const count = Math.max(0, Number(tileset.tilecount) || Math.ceil(Number(tileset.columns || 0) * Number(tileset.rows || 0)))
    if (count) graphics.set(key, Math.max(graphics.get(key) || 0, count))
  }
  for (const image of [background, ...parallaxLayers]) {
    if (!image?.path || !image.width || !image.height) continue
    const key = assetPath(image.path)
    const count = toTiles(image.width, image.height)
    graphics.set(key, Math.max(graphics.get(key) || 0, count))
  }
  const graphicsTiles = [...graphics.values()].reduce((sum, count) => sum + count, 0)
  const graphicsBytes = graphicsTiles * MEGA_DRIVE_TILE_BYTES
  const estimatedBytes = graphicsBytes + MEGA_DRIVE_MAP_RESERVE_BYTES
  return {
    totalBytes: MEGA_DRIVE_VRAM_BYTES,
    reservedBytes: MEGA_DRIVE_MAP_RESERVE_BYTES,
    graphicsTiles,
    graphicsBytes,
    estimatedBytes,
    percent: Math.round(estimatedBytes / MEGA_DRIVE_VRAM_BYTES * 100),
    remainingBytes: MEGA_DRIVE_VRAM_BYTES - estimatedBytes,
    status: estimatedBytes >= MEGA_DRIVE_VRAM_BYTES ? 'over' : estimatedBytes >= MEGA_DRIVE_VRAM_BYTES * 0.9 ? 'critical' : estimatedBytes >= MEGA_DRIVE_VRAM_BYTES * 0.75 ? 'warning' : 'ok'
  }
}

export function formatVramBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  return value >= 1024 ? `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB` : `${value} B`
}
