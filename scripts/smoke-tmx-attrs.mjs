/**
 * Smoke: TMX MD attrs + collision bitfield + C full export.
 */
import { decodeTmxCell, encodeTmxCell, encodeTileAttrFull } from '../src/utils/retro/tmxTileAttrs.js'
import { packCollision, normalizeCollisionCell, COL_DIRS, COL_TYPE, COL_TOP, hasCollision } from '../src/utils/retro/tmxCollision.js'
import { toTMX, toCFullExport } from '../src/utils/retro/tmxFormat.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const enc = encodeTmxCell(12, true, true)
const dec = decodeTmxCell(enc)
assert(dec.tile === 12 && dec.flipH && dec.flipV, `decode mismatch ${JSON.stringify(dec)}`)

const solid = packCollision(COL_DIRS, COL_TYPE.SOLID)
assert(normalizeCollisionCell(1) === solid, 'legacy 1')
assert(normalizeCollisionCell(true) === solid, 'legacy true')
assert(hasCollision(solid), 'hasCollision')
const topOnly = packCollision(COL_TOP, COL_TYPE.LADDER)
assert((topOnly & 0x0f) === COL_TOP, 'dirs')
assert(((topOnly >> 4) & 0x0f) === COL_TYPE.LADDER, 'type')

const xml = toTMX({
  width: 2,
  height: 1,
  tiles: [1, 2],
  tiles2: [0, 3],
  flipH: [true, false],
  flipV: [false, true],
  palette: [1, 2],
  palette2: [0, 1],
  priority: [false, true],
  collision: [solid, topOnly],
  tilesets: [{ name: 't', path: 't.png', columns: 16 }]
})
assert(xml.includes(`>${solid}<`) || xml.includes(`,${solid}`) || xml.includes(`${solid},`) || xml.includes(String(solid)), 'collision value in tmx')

const c = toCFullExport({
  width: 2,
  height: 1,
  tiles: [1, 2],
  tiles2: [0, 3],
  flipH: [true, false],
  flipV: [false, false],
  palette: [0, 1],
  palette2: [0, 0],
  priority: [false, true],
  collision: [solid, topOnly]
}, 'level1')
assert(c.includes('level1_bg'), 'bg')
assert(c.includes('level1_fg'), 'fg')
assert(c.includes('level1_collision'), 'collision')
assert(c.includes('LEVEL1_WIDTH 2'), 'width define')

console.log('smoke-tmx-attrs: PASS')
