// Portable catalogs reference image-local regions, never editor-specific GIDs.
export function parseAssetPack(text) {
  const p = JSON.parse(text)
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max
  const safeFile = (s) => typeof s === 'string' && /^[\p{L}\p{M}\p{N}_ .\/-]+\.png$/iu.test(s) && !s.startsWith('/') && !s.split('/').includes('..')
  if (p.version !== 1 || p.tileSize !== 8 || !Array.isArray(p.tilesets) || !Array.isArray(p.brushes) || !Array.isArray(p.objects)) throw new Error('Invalid map pack schema')
  if (p.tilesets.length > 16 || p.brushes.length > 512 || p.objects.length > 128) throw new Error('Map pack too large')
  const ids = new Set()
  for (const ts of p.tilesets) {
    if (!ts.id || ids.has(ts.id) || !safeFile(ts.file)) throw new Error('Invalid tileset path or ID')
    ids.add(ts.id)
  }
  const brushes = new Set()
  for (const b of p.brushes) {
    if (!b.id || brushes.has(b.id) || !ids.has(b.tileset) || !integer(b.x, 0, 255) || !integer(b.y, 0, 255) || !integer(b.w, 1, 32) || !integer(b.h, 1, 32)) throw new Error('Invalid brush region')
    if (!['bg', 'fg'].includes(b.layer) || !['none', 'solid', 'top', 'damage'].includes(b.collision)) throw new Error('Invalid brush attributes')
    brushes.add(b.id)
  }
  for (const o of p.objects) {
    if (!o.type || !integer(o.width, 1, 64) || !integer(o.height, 1, 64) || !o.properties || Array.isArray(o.properties)) throw new Error('Invalid object template')
    for (const v of Object.values(o.properties)) if (!['string', 'number', 'boolean'].includes(typeof v)) throw new Error('Object properties must be scalar')
  }
  return p
}
export function brushCells(brush, ts) {
  const rows = Math.ceil(ts.tilecount / ts.columns)
  if (brush.x + brush.w > ts.columns || brush.y + brush.h > rows) throw new Error('Brush outside tileset')
  return Array.from({ length: brush.w * brush.h }, (_, i) => ts.firstgid + (brush.y + Math.floor(i / brush.w)) * ts.columns + brush.x + i % brush.w)
}
export function relativeImagePath(mapPath, imagePath) {
  const clean = (p) => normalizeAssetPath(p).split('/').filter(Boolean)
  const from = clean(mapPath); from.pop()
  const to = clean(imagePath)
  if (/^[A-Za-z]:/.test(from[0] || '') && from[0]?.toLowerCase() !== to[0]?.toLowerCase()) throw new Error('Map and tileset must be on the same drive')
  let n = 0
  while (n < from.length && n < to.length && from[n] === to[n]) n++
  return [...from.slice(n).map(() => '..'), ...to.slice(n)].join('/')
}

export function normalizeAssetPath(path) {
  const p = String(path).replace(/\\/g, '/')
  const parts = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..' && !parts.at(-1).endsWith(':')) parts.pop()
    else if (part !== '..' || !p.startsWith('/')) parts.push(part)
  }
  return (p.startsWith('/') ? '/' : '') + parts.join('/')
}
