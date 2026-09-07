/**
 * Smoke: TMX MD attrs (flip GID + TILE_ATTR_FULL).
 * Uso: node scripts/smoke-tmx-attrs.mjs
 */
import { decodeTmxCell, encodeTmxCell, encodeTileAttrFull } from '../src/utils/retro/tmxTileAttrs.js'
import { toTMX } from '../src/utils/retro/tmxFormat.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const enc = encodeTmxCell(12, true, true)
const dec = decodeTmxCell(enc)
assert(dec.tile === 12 && dec.flipH && dec.flipV, `decode mismatch ${JSON.stringify(dec)}`)
assert(encodeTmxCell(0) === -1, 'empty should be -1')

const attr = encodeTileAttrFull(12, { palette: 3, priority: true, flipV: false, flipH: true })
assert((attr & 0x7ff) === 11, 'index')
assert(((attr >> 13) & 3) === 3, 'palette')
assert(!!(attr & (1 << 15)), 'priority')
assert(!!(attr & (1 << 11)), 'hflip')

const xml = toTMX({
  width: 2,
  height: 1,
  tiles: [1, 2],
  tiles2: [0, 0],
  flipH: [true, false],
  flipV: [false, true],
  palette: [1, 2],
  priority: [false, true],
  collision: [true, false],
  tilesets: [{ name: 't', path: 't.png', columns: 16 }]
})
assert(xml.includes('palette'), 'palette layer')
assert(xml.includes('2147483648') || xml.includes(String(encodeTmxCell(1, true, false) >>> 0)), 'flip H gid')
console.log('smoke-tmx-attrs: PASS')
