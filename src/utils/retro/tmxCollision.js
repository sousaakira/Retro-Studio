/**
 * Colisão MD-aware por célula (bitfield u8).
 * Bits 0–3: direções (TOP/BOTTOM/LEFT/RIGHT)
 * Bits 4–7: tipo (none/solid/ladder/water/damage/custom)
 * Compat: valor 1 / true legado → SOLID + ALL dirs
 */

export const COL_TOP = 0x01
export const COL_BOTTOM = 0x02
export const COL_LEFT = 0x04
export const COL_RIGHT = 0x08
export const COL_DIRS = 0x0F

export const COL_TYPE = {
  NONE: 0,
  SOLID: 1,
  LADDER: 2,
  WATER: 3,
  DAMAGE: 4,
  CUSTOM: 5
}

export const COL_TYPE_LABELS = ['none', 'solid', 'ladder', 'water', 'damage', 'custom']

export function packCollision(dirs = COL_DIRS, type = COL_TYPE.SOLID) {
  const d = (dirs | 0) & COL_DIRS
  const t = (type | 0) & 0x0f
  if (!d && !t) return 0
  return d | (t << 4)
}

export function collisionDirs(v) {
  return (normalizeCollisionCell(v) & COL_DIRS)
}

export function collisionType(v) {
  return (normalizeCollisionCell(v) >> 4) & 0x0f
}

export function hasCollision(v) {
  const n = normalizeCollisionCell(v)
  return (n & COL_DIRS) !== 0 || ((n >> 4) & 0x0f) !== 0
}

export function normalizeCollisionCell(v) {
  if (v === true || v === 1) return packCollision(COL_DIRS, COL_TYPE.SOLID)
  if (!v || v === false) return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return n & 0xff
}

export function toggleCollisionCell(current, paintValue) {
  const cur = normalizeCollisionCell(current)
  const paint = normalizeCollisionCell(paintValue) || packCollision(COL_DIRS, COL_TYPE.SOLID)
  return cur === paint ? 0 : paint
}

/** Cor de overlay por tipo (CSS rgba hints). */
export function collisionTypeColor(type) {
  switch (type) {
    case COL_TYPE.LADDER: return 'rgba(0, 200, 80, 0.4)'
    case COL_TYPE.WATER: return 'rgba(30, 120, 255, 0.4)'
    case COL_TYPE.DAMAGE: return 'rgba(255, 80, 0, 0.45)'
    case COL_TYPE.CUSTOM: return 'rgba(180, 0, 255, 0.4)'
    case COL_TYPE.SOLID:
    default: return 'rgba(255, 0, 0, 0.35)'
  }
}
