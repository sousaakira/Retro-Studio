/**
 * Atributos MD / Tiled por célula de mapa.
 * Flips: bits altos do GID no CSV TMX (padrão Tiled — SGDK preserva).
 * Paleta: layer CSV `palette` / `palette2` com valores 0–3 (round-trip editor + export C).
 */

export const TMX_FLIP_H = 0x80000000
export const TMX_FLIP_V = 0x40000000
export const TMX_FLIP_D = 0x20000000
export const TMX_FLIP_MASK = TMX_FLIP_H | TMX_FLIP_V | TMX_FLIP_D

/** Decodifica célula CSV TMX → índice 1-based do editor + flips. */
export function decodeTmxCell(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return { tile: 0, flipH: false, flipV: false }
  }
  const u = n >>> 0
  const flipH = !!(u & TMX_FLIP_H)
  const flipV = !!(u & TMX_FLIP_V)
  const local0 = u & ~TMX_FLIP_MASK
  return {
    tile: local0 + 1,
    flipH,
    flipV
  }
}

/** Codifica índice 1-based do editor + flips → valor CSV TMX (unsigned). */
export function encodeTmxCell(tile, flipH = false, flipV = false) {
  if (!tile || tile <= 0) return -1
  let v = (tile - 1) >>> 0
  if (flipH) v |= TMX_FLIP_H
  if (flipV) v |= TMX_FLIP_V
  return v >>> 0
}

/** SGDK TILE_ATTR_FULL(pal, prio, flipV, flipH, index) — index = tile 0-based local. */
export function encodeTileAttrFull(tile, { palette = 0, priority = false, flipV = false, flipH = false } = {}) {
  const index = Math.max(0, (tile || 0) - 1)
  const pal = Math.max(0, Math.min(3, palette | 0))
  const prio = priority ? 1 : 0
  const fv = flipV ? 1 : 0
  const fh = flipH ? 1 : 0
  // Bits: pal<<13 | prio<<15 | vflip<<12 | hflip<<11 | index
  return (fh << 11) | (fv << 12) | (pal << 13) | (prio << 15) | (index & 0x7ff)
}

export function clampPalette(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return 0
  return Math.min(3, Math.max(0, v | 0))
}
