import { tilesetColumns } from './mapComposition.js'

const HIGH = [true, 1, 'true', '1']

/**
 * Tile layers of the map editor drawn once at the map's own resolution (one canvas pixel per
 * pixel): BG, the high-priority BG tiles alone, and FG. The editor copies the visible part at its
 * zoom with one drawImage per layer, instead of drawing every visible tile on each redraw.
 * Between redraws only the cells whose tile, flips or priority changed are repainted.
 *
 * createCanvas: () => HTMLCanvasElement (or an OffscreenCanvas-like object).
 */
export function createTileLayerCache(createCanvas) {
  let cache = null

  function paintCell(ctx, imagesData, tid, flipH, flipV, x, y, size) {
    if (tid <= 0) return
    const data = imagesData.find(d => tid >= (d.ts.firstgid || 1)) || imagesData[imagesData.length - 1]
    if (!data?.img) {
      ctx.fillStyle = `hsl(${(tid * 47) % 360} 55% 42%)`
      ctx.fillRect(x, y, size, size)
      return
    }
    const columns = tilesetColumns(data.img, size, data.ts.columns)
    const local = tid - (data.ts.firstgid || 1)
    const sx = (local % columns) * size, sy = Math.floor(local / columns) * size
    try {
      if (flipH || flipV) {
        ctx.setTransform(flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, x + (flipH ? size : 0), y + (flipV ? size : 0))
        ctx.drawImage(data.img, sx, sy, size, size, 0, 0, size, size)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else {
        ctx.drawImage(data.img, sx, sy, size, size, x, y, size, size)
      }
    } catch {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = `hsl(${(tid * 47) % 360} 55% 42%)`
      ctx.fillRect(x, y, size, size)
    }
  }

  /** Bits of a cell: 1 flipH, 2 flipV, 4 high priority (BG only). */
  const bgBits = (input, i) => (input.flipH?.[i] ? 1 : 0) | (input.flipV?.[i] ? 2 : 0) | (HIGH.includes(input.priority?.[i]) ? 4 : 0)
  const fgBits = (input, i) => (input.flipH2?.[i] ? 1 : 0) | (input.flipV2?.[i] ? 2 : 0)

  function paintBg(i) {
    const { input, layers, size } = cache
    const x = (i % input.width) * size, y = Math.floor(i / input.width) * size
    const tid = input.tiles[i] || 0, bits = cache.bgBits[i]
    layers.bg.ctx.clearRect(x, y, size, size)
    layers.high.ctx.clearRect(x, y, size, size)
    paintCell(layers.bg.ctx, input.imagesData, tid, bits & 1, bits & 2, x, y, size)
    if (bits & 4) paintCell(layers.high.ctx, input.imagesData, tid, bits & 1, bits & 2, x, y, size)
  }

  function paintFg(i) {
    const { input, layers, size } = cache
    const x = (i % input.width) * size, y = Math.floor(i / input.width) * size
    const bits = cache.fgBits[i]
    layers.fg.ctx.clearRect(x, y, size, size)
    paintCell(layers.fg.ctx, input.imagesData, input.tiles2[i] || 0, bits & 1, bits & 2, x, y, size)
  }

  function layer(width, height) {
    const canvas = createCanvas()
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    return { canvas, ctx }
  }

  /**
   * input: { width, height, size, imagesData (sorted by firstgid, highest first), tiles, tiles2,
   * flipH, flipV, flipH2, flipV2, priority }. Returns { bg, high, fg } canvases.
   */
  function update(input) {
    const count = input.width * input.height, size = input.size
    const key = [input.width, input.height, size, ...input.imagesData.map(d => `${d.ts.firstgid}:${d.img?.src || ''}:${d.img?.naturalWidth || 0}`)].join('|')
    const rebuild = !cache || cache.key !== key
    if (rebuild) {
      cache = {
        key, input, size,
        tiles: new Int32Array(count), tiles2: new Int32Array(count), bgBits: new Uint8Array(count), fgBits: new Uint8Array(count),
        layers: { bg: layer(input.width * size, input.height * size), high: layer(input.width * size, input.height * size), fg: layer(input.width * size, input.height * size) }
      }
    }
    cache.input = input
    const changedBg = [], changedFg = []
    for (let i = 0; i < count; i++) {
      const tid = input.tiles[i] || 0, bits = bgBits(input, i)
      if (rebuild || cache.tiles[i] !== tid || cache.bgBits[i] !== bits) { cache.tiles[i] = tid; cache.bgBits[i] = bits; changedBg.push(i) }
      const tid2 = input.tiles2[i] || 0, bits2 = fgBits(input, i)
      if (rebuild || cache.tiles2[i] !== tid2 || cache.fgBits[i] !== bits2) { cache.tiles2[i] = tid2; cache.fgBits[i] = bits2; changedFg.push(i) }
    }
    for (const i of changedBg) paintBg(i)
    for (const i of changedFg) paintFg(i)
    return { bg: cache.layers.bg.canvas, high: cache.layers.high.canvas, fg: cache.layers.fg.canvas, changed: changedBg.length + changedFg.length }
  }

  return { update, reset: () => { cache = null } }
}
