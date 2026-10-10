// Issues #48/#57: binary-alpha pixel oracle for normal VDP priority.
// This software Canvas2D fixture tests production composition/masking, not a browser.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { composeMapArtwork, drawPrioritySprites, priorityRuns, spritePriority, tilesetColumns } from '../src/utils/retro/mapComposition.js'

class Surface {
  constructor(width = 1, height = 1, pixels) {
    this._width = width; this._height = height; this.pixels = pixels || Array(width * height).fill(0)
    this.context = new Context(this)
  }
  get width() { return this._width }
  set width(value) { this._width = value; this.reset() }
  get height() { return this._height }
  set height(value) { this._height = value; this.reset() }
  reset() { this.pixels = Array(this.width * this.height).fill(0); this.context = new Context(this) }
  getContext() { return this.context }
}

class Context {
  constructor(canvas) {
    this.canvas = canvas
    this.state = { x: 0, y: 0, sx: 1, sy: 1, globalAlpha: 1, globalCompositeOperation: 'source-over' }
    this.stack = []
  }
  get globalAlpha() { return this.state.globalAlpha }
  set globalAlpha(v) { this.state.globalAlpha = v }
  get globalCompositeOperation() { return this.state.globalCompositeOperation }
  set globalCompositeOperation(v) { this.state.globalCompositeOperation = v }
  save() { this.stack.push({ ...this.state }) }
  restore() { assert.ok(this.stack.length, 'balanced restore'); this.state = this.stack.pop() }
  translate(x, y) { this.state.x += x * this.state.sx; this.state.y += y * this.state.sy }
  scale(x, y) { this.state.sx *= x; this.state.sy *= y }
  drawImage(image, ...args) {
    if (image.broken) throw new Error('broken image')
    let sourceX = 0, sourceY = 0, sourceW = image.width, sourceH = image.height
    let x, y, w = image.width, h = image.height
    if (args.length === 2) [x, y] = args
    else if (args.length === 4) [x, y, w, h] = args
    else [sourceX, sourceY, sourceW, sourceH, x, y, w, h] = args
    const state = this.state
    for (let py = 0; py < this.canvas.height; py++) for (let px = 0; px < this.canvas.width; px++) {
      const localX = (px + 0.5 - state.x) / state.sx - x
      const localY = (py + 0.5 - state.y) / state.sy - y
      if (localX < 0 || localY < 0 || localX >= w || localY >= h) continue
      const ix = sourceX + Math.floor(localX * sourceW / w)
      const iy = sourceY + Math.floor(localY * sourceH / h)
      const color = ix < 0 || iy < 0 || ix >= image.width || iy >= image.height ? 0 : image.pixels[iy * image.width + ix]
      if (!color || !state.globalAlpha) continue
      const index = py * this.canvas.width + px
      this.canvas.pixels[index] = state.globalCompositeOperation === 'destination-out' ? 0 : color
    }
  }
}

const image = (pixels, width = pixels.length) => new Surface(width, pixels.length / width, pixels)
const sprite = (id, pixels, highPriority, extra = {}) => ({
  id, image: image(pixels), sourceX: 0, sourceY: 0, sourceWidth: pixels.length, sourceHeight: 1,
  x: 0, y: 0, width: pixels.length, height: 1, highPriority, ...extra
})
assert.equal(tilesetColumns({ naturalWidth: 64 }, 8, 99), 8, 'image width overrides stale TMX columns')
assert.equal(tilesetColumns({ naturalWidth: 0 }, 8, 7), 7)
assert.equal(tilesetColumns({ naturalWidth: 0 }, 8, 0), 16)
assert.equal(spritePriority(undefined), true)
for (const value of [true, 1, 'true', '1']) assert.equal(spritePriority(value), true)
for (const value of [false, 0, 'false', '0']) assert.equal(spritePriority(value), false)
assert.deepEqual(priorityRuns([1, true, 0, '1', 0, '0', 1, 1], 4, 2),
  [{ x: 0, y: 0, width: 2 }, { x: 3, y: 0, width: 1 }, { x: 2, y: 1, width: 2 }])

// Exhaust all opaque/transparent sprite pixels, sprite priorities and plane
// priorities. The oracle selects the first SAT pixel BEFORE comparing planes.
let cases = 0
for (let mask = 0; mask < 128; mask++) {
  const [frontColor, backColor, frontHigh, backHigh, bgColor, bgHigh, fgColor] =
    Array.from({ length: 7 }, (_, bit) => !!(mask & (1 << bit)))
  const sprites = [sprite(20, [backColor ? 22 : 0], backHigh), sprite(10, [frontColor ? 11 : 0], frontHigh)]
  const surface = new Surface()
  const ctx = surface.getContext('2d')
  const order = []
  composeMapArtwork(ctx, sprites, {
    drawBG() { order.push('bg'); ctx.drawImage(image([bgColor ? 33 : 0]), 0, 0) },
    drawHighBG() { order.push('highBG'); ctx.drawImage(image([bgHigh && bgColor ? 33 : 0]), 0, 0) },
    drawFG() { order.push('fg'); ctx.drawImage(image([fgColor ? 44 : 0]), 0, 0) },
    createCanvas: () => new Surface()
  })
  const winner = frontColor ? { color: 11, high: frontHigh } : backColor ? { color: 22, high: backHigh } : null
  const expected = winner?.high ? winner.color : fgColor ? 44 : bgHigh && bgColor ? 33 : winner?.color || (bgColor ? 33 : 0)
  assert.equal(surface.pixels[0], expected, 'VDP normal composition mask ' + mask)
  assert.equal(ctx.stack.length, 0)
  assert.equal(order[0], 'bg')
  assert.equal(order.at(-1), 'fg')
  cases++
}

// A lower-priority front sprite hides a high-priority sprite behind it, even
// when the front sprite itself loses to FG. Transparent holes reveal the back.
{
  const canvas = new Surface(4, 1)
  const ctx = canvas.getContext('2d')
  composeMapArtwork(ctx, [sprite(2, [5, 5, 5, 5], true), sprite(1, [9, 0, 9, 0], false)], {
    drawBG() {}, drawHighBG() {},
    drawFG() { ctx.drawImage(image([7, 7, 7, 7]), 0, 0) },
    createCanvas: () => new Surface()
  })
  assert.deepEqual(canvas.pixels, [7, 5, 7, 5])
}

// Crop, nonzero translation, nearest scale and both flips must also affect the
// alpha mask, so a front sprite's transparent cells reveal the right back cell.
{
  const canvas = new Surface(6, 3), ctx = canvas.getContext('2d')
  const front = sprite(1, [0], false, { image: image([8, 0, 3, 0, 4, 0], 3),
    sourceX: 1, sourceY: 0, sourceWidth: 2, sourceHeight: 2,
    x: 1, y: 1, width: 4, height: 2, flipH: true, flipV: true })
  const back = sprite(2, [6, 6, 6, 6], true, { x: 1, y: 1, height: 2 })
  composeMapArtwork(ctx, [back, front], {
    drawBG() {}, drawHighBG() {}, drawFG() { ctx.drawImage(image(Array(18).fill(7), 6), 0, 0) },
    createCanvas: () => new Surface()
  })
  assert.deepEqual(canvas.pixels, [7,7,7,7,7,7, 7,6,6,7,7,7, 7,7,7,6,6,7])
}

// Scratch allocation is per sprite bounds, independent of map dimensions, and
// reused for several overlapping sprites within a pass.
{
  let created = 0
  const scratch = []
  const canvas = new Surface(100, 2)
  drawPrioritySprites(canvas.getContext(), [
    sprite(1, [1,0], false, { x: 50 }),
    sprite(2, [2,2], false, { x: 50 }),
    sprite(3, [3,3], false, { x: 50 })
  ], false, () => { created++; const value = new Surface(); scratch.push(value); return value })
  assert.equal(created, 1)
  assert.equal(scratch[0].width, 2)
  assert.equal(scratch[0].height, 1)
  assert.deepEqual(canvas.pixels.slice(50, 52), [1, 2])
}
{
  const canvas = new Surface(), ctx = canvas.getContext()
  const broken = sprite(1, [1], false); broken.image.broken = true
  assert.deepEqual([...drawPrioritySprites(ctx, [broken], false, () => new Surface())], [])
  assert.equal(ctx.stack.length, 0)
  assert.deepEqual(ctx.state, { x: 0, y: 0, sx: 1, sy: 1, globalAlpha: 1, globalCompositeOperation: 'source-over' })
}

// UI is wired to the tested compositor; scenery-only cutscene preview remains.
const vue = fs.readFileSync(new URL('../src/components/retro/tilemap/TilemapCanvas.vue', import.meta.url), 'utf8')
assert.match(vue, /const renderedVisuals = composeMapArtwork\(ctx, visuals/)
assert.match(vue, /if \(!clean\) for \(const obj/)
assert.match(vue, /const cols = tilesetColumns\(tsData\.img, tilePx, tsData\.ts\.columns\)/)
assert.match(vue, /const hasVisual = renderedVisuals\.has\(obj\.id\)/)
assert.ok(vue.indexOf('composeMapArtwork(ctx') < vue.indexOf("if (!clean && st('showGrid'))"))
console.log('Map priority preview: ' + cases + ' pixel cases, SAT masking, transparency, scale/flips, bounded scratch and state restoration passed.')
