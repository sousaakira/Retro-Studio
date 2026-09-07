/**
 * Utilitários para formato TMX (Tiled Map Exchange) - compatível com SGDK rescomp
 * rescomp exige: TMX com dados em CSV
 *
 * Extensões MD-aware (Retro Studio):
 * - Flips H/V nos bits altos do GID (padrão Tiled)
 * - Layers `palette` / `palette2` com 0–3 (por célula, BG/FG)
 * - Layers `collision` (0/1) e `priority` (0/1) — já usadas pelo SGDK para priority
 */

import {
  decodeTmxCell,
  encodeTmxCell,
  encodeTileAttrFull,
  clampPalette
} from './tmxTileAttrs.js'

const TILE_SIZE = 8

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
    objects = []
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
${csvLines(collision, w, h, (v) => (v ? 1 : 0))}
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

  if (!tilesets || tilesets.length === 0) {
    tilesetBlocks = ` <tileset firstgid="1" name="tileset" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" tilecount="256" columns="16">
  <image source="tileset.png" width="128" height="128"/>
 </tileset>\n`
  } else {
    for (const ts of tilesets) {
      const imageName = ts.path.split(/[/\\]/).pop() || ts.name || 'tileset.png'
      const cols = ts.columns || 16
      const count = cols * Math.ceil(256 / cols)
      tilesetBlocks += ` <tileset firstgid="${currentGid}" name="${ts.name || 'tileset'}" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" tilecount="${count}" columns="${cols}">
  <image source="${imageName}" width="${cols * TILE_SIZE}" height="${Math.ceil(256 / cols) * TILE_SIZE}"/>
 </tileset>\n`
      currentGid += count
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
      objectBlocks += `  <object id="${oid}" name="${oname}" type="${obj.type || ''}" x="${ox}" y="${oy}" width="${TILE_SIZE}" height="${TILE_SIZE}">
   <properties>
${Object.entries(obj.properties || {}).map(([k, v]) => `    <property name="${k}" value="${v}"/>`).join('\n')}
   </properties>
  </object>\n`
    }
    objectBlocks += ` </objectgroup>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.8" tiledversion="1.8.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" infinite="0" nextlayerid="8" nextobjectid="${objects.length + 1}">
${tilesetBlocks}${layers}${objectBlocks}
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
      tilesets: data.tilesets || []
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

    let tileLayerIdx = 0
    for (const layer of layers) {
      const dataEl = layer.querySelector('data')
      const name = (layer.getAttribute('name') || '').toLowerCase().trim()
      if (name === 'collision') {
        collision = parseBoolLayer(dataEl, width, height) || []
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
        tmxTilesets.push({ name, path: src, firstgid })
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
          const v = prop.getAttribute('value')
          if (k) properties[k] = v
        }
        tmxObjects.push({
          id,
          name,
          type,
          x: Math.round(ox / TILE_SIZE),
          y: Math.round(oy / TILE_SIZE),
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
      objects: tmxObjects
    }
  } catch (e) {
    console.error('fromTMX error:', e)
    return null
  }
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
  const tileCount = w * h
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = []
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const tile = tiles[i] ?? 0
      if (!tile) {
        row.push('0')
      } else {
        row.push(String(encodeTileAttrFull(tile, {
          palette: palette[i] ?? 0,
          priority: !!priority[i],
          flipV: !!flipV[i],
          flipH: !!flipH[i]
        })))
      }
    }
    rows.push('    ' + row.join(', '))
  }
  return `/* TILE_ATTR_FULL(pal, prio, vflip, hflip, index) */\nconst u16 ${varName}[] = {\n${rows.join(',\n')}\n};`
}

export { TILE_SIZE }
