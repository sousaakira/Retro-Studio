/**
 * Utilitários para formato TMX (Tiled Map Exchange) - compatível com SGDK rescomp
 * rescomp exige: TMX com dados em CSV
 *
 * Extensões MD-aware (Retro Studio):
 * - Flips H/V nos bits altos do GID (padrão Tiled)
 * - Layers `palette` / `palette2` com 0–3 (por célula, BG/FG)
 * - Layers `collision` (u8 bitfield: dirs + tipo) e `priority` (0/1)
 */

import {
  decodeTmxCell,
  encodeTmxCell,
  encodeTileAttrFull,
  clampPalette
} from './tmxTileAttrs.js'
import { normalizeCollisionCell } from './tmxCollision.js'

const TILE_SIZE = 8
const xml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c])).replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;')

function csvLines(values, width, height, mapFn) {
  const lines = []
  for (let y = 0; y < height; y++) {
    const row = []
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      row.push(String(mapFn(values[i], i)))
    }
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

/**
 * Gera XML TMX a partir dos dados do mapa
 */
export function toTMX(data) {
  const {
    width,
    height,
    tiles = [],
    tiles2 = [],
    tilesets = [],
    collision = [],
    priority = [],
    flipH = [],
    flipV = [],
    palette = [],
    flipH2 = [],
    flipV2 = [],
    palette2 = [],
    objects = [],
    background = null
  } = data
  const w = Math.max(1, width || 40)
  const h = Math.max(1, height || 30)
  const tileCount = w * h

  const encodeLayer = (arr, fhArr, fvArr) => csvLines(arr, w, h, (tile, i) => {
    const v = encodeTmxCell(tile ?? 0, !!fhArr[i], !!fvArr[i])
    return v < 0 ? '-1' : String(v >>> 0)
  })

  let layers = ` <layer id="1" name="Tile Layer 1" width="${w}" height="${h}">
  <data encoding="csv">
${encodeLayer(tiles, flipH, flipV)}
  </data>
 </layer>`

  const t2 = tiles2.length >= tileCount ? tiles2 : Array(tileCount).fill(0)
  layers += `
 <layer id="4" name="Tile Layer 2" width="${w}" height="${h}">
  <data encoding="csv">
${encodeLayer(t2, flipH2, flipV2)}
  </data>
 </layer>`

  if (collision.length >= tileCount) {
    layers += `
 <layer id="2" name="collision" width="${w}" height="${h}">
  <data encoding="csv">
${csvLines(collision, w, h, (v) => normalizeCollisionCell(v))}
  </data>
 </layer>`
  }

  if (priority.length >= tileCount) {
    layers += `
 <layer id="3" name="priority" width="${w}" height="${h}">
  <data encoding="csv">
${csvLines(priority, w, h, (v) => (v ? 1 : 0))}
  </data>
 </layer>`
  }

  const pal = palette.length >= tileCount ? palette : Array(tileCount).fill(0)
  layers += `
 <layer id="6" name="palette" width="${w}" height="${h}">
  <data encoding="csv">
${csvLines(pal, w, h, (v) => clampPalette(v))}
  </data>
 </layer>`

  const pal2 = palette2.length >= tileCount ? palette2 : Array(tileCount).fill(0)
  layers += `
 <layer id="7" name="palette2" width="${w}" height="${h}">
  <data encoding="csv">
${csvLines(pal2, w, h, (v) => clampPalette(v))}
  </data>
 </layer>`

  let tilesetBlocks = ''
  let currentGid = 1
  const backgroundProperties = background?.path ? ` <properties>
  <property name="retroStudio.backgroundImage" value="${xml(background.path)}"/>
  <property name="retroStudio.backgroundFit" value="${xml(background.fit || 'cover')}"/>
  <property name="retroStudio.backgroundOpacity" type="float" value="${Math.max(0, Math.min(1, Number(background.opacity ?? 1)))}"/>
 </properties>\n` : ''

  if (!tilesets || tilesets.length === 0) {
    tilesetBlocks = ` <tileset firstgid="1" name="tileset" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" tilecount="256" columns="16">
  <image source="tileset.png" width="128" height="128"/>
 </tileset>\n`
  } else {
    for (const ts of tilesets) {
      const cols = Math.max(1, ts.columns || 16)
      const count = Math.max(1, ts.tilecount || cols * Math.ceil(256 / cols))
      const firstgid = ts.firstgid || currentGid
      tilesetBlocks += ` <tileset firstgid="${firstgid}" name="${xml(ts.name || 'tileset')}" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" tilecount="${count}" columns="${cols}">
  <image source="${xml(ts.path || 'tileset.png')}" width="${cols * TILE_SIZE}" height="${Math.ceil(count / cols) * TILE_SIZE}"/>
 </tileset>\n`
      currentGid = Math.max(currentGid, firstgid + count)
    }
  }

  let objectBlocks = ''
  if (objects && objects.length > 0) {
    objectBlocks = `\n <objectgroup id="5" name="objects">\n`
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      const oid = obj.id || (i + 1)
      const oname = obj.name || obj.type || `Object${oid}`
      const ox = (obj.x || 0) * TILE_SIZE
      const oy = (obj.y || 0) * TILE_SIZE
      objectBlocks += `  <object id="${oid}" name="${xml(oname)}" type="${xml(obj.type || '')}" x="${ox}" y="${oy}" width="${(obj.width || 1) * TILE_SIZE}" height="${(obj.height || 1) * TILE_SIZE}">
   <properties>
${Object.entries(obj.properties || {}).map(([k, v]) => `    <property name="${xml(k)}" type="${typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'float' : 'string'}" value="${xml(v)}"/>`).join('\n')}
   </properties>
  </object>\n`
    }
    objectBlocks += ` </objectgroup>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.8" tiledversion="1.8.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" infinite="0" nextlayerid="8" nextobjectid="${Math.max(0, ...objects.map(o => Number(o.id) || 0)) + 1}">
${backgroundProperties}${tilesetBlocks}${layers}${objectBlocks}
</map>
`
}

export function fromJSON(jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    return {
      width: data.width || 40,
      height: data.height || 30,
      tiles: data.tiles || [],
      tilesets: data.tilesets || [],
      tiles2: data.tiles2 || [], collision: data.collision || [], priority: data.priority || [],
      flipH: data.flipH || [], flipV: data.flipV || [], palette: data.palette || [],
      flipH2: data.flipH2 || [], flipV2: data.flipV2 || [], palette2: data.palette2 || [],
      objects: data.objects || [],
      background: data.background || null
    }
  } catch {
    return null
  }
}

function parseRawCsv(dataEl, width, height) {
  if (!dataEl) return null
  const csv = dataEl.textContent.trim()
  const raw = []
  csv.split(/[\r\n]+/).forEach((line) => {
    line.split(',').forEach((v) => {
      const n = parseInt(v.trim(), 10)
      raw.push(Number.isNaN(n) ? -1 : n)
    })
  })
  if (raw.length < width * height) return null
  return raw.slice(0, width * height)
}

function parseTileLayer(dataEl, width, height) {
  const raw = parseRawCsv(dataEl, width, height)
  if (!raw) return null
  const tiles = []
  const flipH = []
  const flipV = []
  for (const n of raw) {
    const cell = decodeTmxCell(n)
    tiles.push(cell.tile)
    flipH.push(cell.flipH)
    flipV.push(cell.flipV)
  }
  return { tiles, flipH, flipV }
}

function parseBoolLayer(dataEl, width, height) {
  const raw = parseRawCsv(dataEl, width, height)
  if (!raw) return null
  return raw.map((n) => n > 0)
}

function parseCollisionLayer(dataEl, width, height) {
  const raw = parseRawCsv(dataEl, width, height)
  if (!raw) return null
  return raw.map((n) => normalizeCollisionCell(n < 0 ? 0 : n))
}

function parsePaletteLayer(dataEl, width, height) {
  const raw = parseRawCsv(dataEl, width, height)
  if (!raw) return null
  return raw.map((n) => clampPalette(n < 0 ? 0 : n))
}

/**
 * Parseia TMX e extrai dados do mapa (incl. flips / paletas).
 */
export function fromTMX(xml) {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const map = doc.querySelector('map')
    if (!map) return null

    const width = parseInt(map.getAttribute('width') || '40', 10)
    const height = parseInt(map.getAttribute('height') || '30', 10)
    const layers = doc.querySelectorAll('layer')
    const empty = () => Array(width * height).fill(0)
    const emptyBool = () => Array(width * height).fill(false)

    let tiles = empty()
    let tiles2 = empty()
    let flipH = emptyBool()
    let flipV = emptyBool()
    let flipH2 = emptyBool()
    let flipV2 = emptyBool()
    let palette = empty()
    let palette2 = empty()
    let collision = []
    let priority = []
    const backgroundProperties = new Map()
    for (const property of doc.querySelectorAll('map > properties > property')) {
      backgroundProperties.set(property.getAttribute('name'), property.getAttribute('value') ?? property.textContent)
    }
    const backgroundPath = backgroundProperties.get('retroStudio.backgroundImage')
    const parsedBackgroundOpacity = Number(backgroundProperties.get('retroStudio.backgroundOpacity') ?? 1)
    const background = backgroundPath ? {
      path: backgroundPath,
      fit: backgroundProperties.get('retroStudio.backgroundFit') || 'cover',
      opacity: Number.isFinite(parsedBackgroundOpacity) ? Math.max(0, Math.min(1, parsedBackgroundOpacity)) : 1
    } : null

    let tileLayerIdx = 0
    for (const layer of layers) {
      const dataEl = layer.querySelector('data')
      const name = (layer.getAttribute('name') || '').toLowerCase().trim()
      if (name === 'collision') {
        collision = parseCollisionLayer(dataEl, width, height) || []
      } else if (name === 'priority' || name.endsWith(' priority') || name.endsWith(' prio')) {
        priority = parseBoolLayer(dataEl, width, height) || []
      } else if (name === 'palette' || name === 'palette1') {
        palette = parsePaletteLayer(dataEl, width, height) || empty()
      } else if (name === 'palette2') {
        palette2 = parsePaletteLayer(dataEl, width, height) || empty()
      } else {
        const parsed = parseTileLayer(dataEl, width, height)
        if (parsed) {
          if (tileLayerIdx === 0) {
            tiles = parsed.tiles
            flipH = parsed.flipH
            flipV = parsed.flipV
            tileLayerIdx++
          } else if (tileLayerIdx === 1) {
            tiles2 = parsed.tiles
            flipH2 = parsed.flipH
            flipV2 = parsed.flipV
            tileLayerIdx++
          }
        }
      }
    }

    const tsElements = doc.querySelectorAll('tileset')
    const tmxTilesets = []

    if (tsElements.length > 0) {
      for (const ts of tsElements) {
        const img = ts.querySelector('image')
        const src = img?.getAttribute('source') || ''
        const name = ts.getAttribute('name') || src.split(/[/\\]/).pop() || 'tileset'
        const firstgid = parseInt(ts.getAttribute('firstgid') || '1', 10)
        tmxTilesets.push({ name, path: src, firstgid,
          columns: parseInt(ts.getAttribute('columns') || '16', 10),
          tilecount: parseInt(ts.getAttribute('tilecount') || '256', 10)
        })
      }
    } else {
      const img = doc.querySelector('tileset image')
      const src = img?.getAttribute('source') || ''
      if (src) {
        tmxTilesets.push({ name: src.split(/[/\\]/).pop(), path: src, firstgid: 1 })
      }
    }

    const objectgroup = doc.querySelector('objectgroup')
    const tmxObjects = []
    if (objectgroup) {
      const objs = objectgroup.querySelectorAll('object')
      for (const obj of objs) {
        const id = parseInt(obj.getAttribute('id') || '0', 10)
        const name = obj.getAttribute('name') || ''
        const type = obj.getAttribute('type') || ''
        const ox = parseFloat(obj.getAttribute('x') || '0')
        const oy = parseFloat(obj.getAttribute('y') || '0')
        const properties = {}
        for (const prop of obj.querySelectorAll('property')) {
          const k = prop.getAttribute('name')
          const v = prop.hasAttribute('value') ? prop.getAttribute('value') : prop.textContent
          if (k) properties[k] = prop.getAttribute('type') === 'bool' ? v === 'true' :
            ['int', 'float'].includes(prop.getAttribute('type')) ? Number(v) : v
        }
        tmxObjects.push({
          id,
          name,
          type,
          x: Math.round(ox / TILE_SIZE),
          y: Math.round(oy / TILE_SIZE),
          width: Math.max(1, Math.round(parseFloat(obj.getAttribute('width') || '8') / TILE_SIZE)),
          height: Math.max(1, Math.round(parseFloat(obj.getAttribute('height') || '8') / TILE_SIZE)),
          properties
        })
      }
    }

    return {
      width,
      height,
      tiles,
      tiles2,
      tilesets: tmxTilesets,
      collision,
      priority,
      flipH,
      flipV,
      palette,
      flipH2,
      flipV2,
      palette2,
      objects: tmxObjects,
      background
    }
  } catch (e) {
    console.error('fromTMX error:', e)
    return null
  }
}

function layerToCRows(width, height, mapFn) {
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = []
    for (let x = 0; x < width; x++) {
      row.push(String(mapFn(y * width + x)))
    }
    rows.push('    ' + row.join(', '))
  }
  return rows.join(',\n')
}

/**
 * Gera array C com TILE_ATTR_FULL por célula (BG).
 */
export function toCArray(data, varName = 'map_tiles') {
  const {
    width,
    height,
    tiles = [],
    flipH = [],
    flipV = [],
    palette = [],
    priority = []
  } = data
  const w = Math.max(1, width || 40)
  const h = Math.max(1, height || 30)
  const body = layerToCRows(w, h, (i) => {
    const tile = tiles[i] ?? 0
    if (!tile) return 0
    return encodeTileAttrFull(tile, {
      palette: palette[i] ?? 0,
      priority: !!priority[i],
      flipV: !!flipV[i],
      flipH: !!flipH[i]
    })
  })
  return `/* TILE_ATTR_FULL(pal, prio, vflip, hflip, index) */\nconst u16 ${varName}[] = {\n${body}\n};`
}

/**
 * Export C completo: BG + FG (TILE_ATTR_FULL) + collision u8 + dims.
 * Collision bitfield: bits0-3 dirs, bits4-7 type (ver tmxCollision.js).
 */
export function toCFullExport(data, baseName = 'map') {
  const name = String(baseName || 'map').replace(/[^a-zA-Z0-9_]/g, '_') || 'map'
  const w = Math.max(1, data.width || 40)
  const h = Math.max(1, data.height || 30)
  const {
    tiles = [],
    tiles2 = [],
    flipH = [],
    flipV = [],
    palette = [],
    flipH2 = [],
    flipV2 = [],
    palette2 = [],
    priority = [],
    collision = []
  } = data

  const bg = layerToCRows(w, h, (i) => {
    const tile = tiles[i] ?? 0
    if (!tile) return 0
    return encodeTileAttrFull(tile, {
      palette: palette[i] ?? 0,
      priority: !!priority[i],
      flipV: !!flipV[i],
      flipH: !!flipH[i]
    })
  })
  const fg = layerToCRows(w, h, (i) => {
    const tile = tiles2[i] ?? 0
    if (!tile) return 0
    return encodeTileAttrFull(tile, {
      palette: palette2[i] ?? 0,
      priority: false,
      flipV: !!flipV2[i],
      flipH: !!flipH2[i]
    })
  })
  const col = layerToCRows(w, h, (i) => normalizeCollisionCell(collision[i] ?? 0))

  return `/* Retro Studio map export — ${name}
 * BG/FG: TILE_ATTR_FULL(pal, prio, vflip, hflip, index)
 * collision: u8 bitfield — bits0-3 dirs (T/B/L/R), bits4-7 type (0 none,1 solid,2 ladder,3 water,4 damage,5 custom)
 */
#define ${name.toUpperCase()}_WIDTH ${w}
#define ${name.toUpperCase()}_HEIGHT ${h}

const u16 ${name}_bg[] = {
${bg}
};

const u16 ${name}_fg[] = {
${fg}
};

const u8 ${name}_collision[] = {
${col}
};
`
}

export { TILE_SIZE }
