/**
 * Utilitários para formato TMX (Tiled Map Exchange) - compatível com SGDK rescomp
 * rescomp exige: TMX com dados em CSV
 */

const TILE_SIZE = 8

/**
 * Gera XML TMX a partir dos dados do mapa
 * @param {Object} data - { width, height, tiles, tiles2?, tilesets[], collision?, priority? }
 * tilesets: [{ id, name, path, preview, columns }]
 */
export function toTMX(data) {
  const { width, height, tiles = [], tiles2 = [], tilesets = [], collision = [], priority = [], objects = [] } = data
  const w = Math.max(1, width || 40)
  const h = Math.max(1, height || 30)
  const tileCount = w * h

  const toCsv = (arr) => {
    const data = Array.from({ length: tileCount }, (_, i) => {
      const v = (arr[i] ?? 0)
      return v <= 0 ? -1 : v - 1
    })
    const lines = []
    for (let y = 0; y < h; y++) {
      lines.push(data.slice(y * w, (y + 1) * w).map((v) => String(v)).join(','))
    }
    return lines.join('\n')
  }

  let layers = ` <layer id="1" name="Tile Layer 1" width="${w}" height="${h}">
  <data encoding="csv">
${toCsv(tiles)}
  </data>
 </layer>`

  const t2 = tiles2.length >= tileCount ? tiles2 : Array(tileCount).fill(0)
  layers += `
 <layer id="4" name="Tile Layer 2" width="${w}" height="${h}">
  <data encoding="csv">
${toCsv(t2)}
  </data>
 </layer>`

  if (collision.length >= tileCount) {
    const colLines = []
    for (let y = 0; y < h; y++) {
      const row = Array.from({ length: w }, (_, i) => collision[y * w + i] ? 1 : 0).join(',')
      colLines.push(row)
    }
    layers += `
 <layer id="2" name="collision" width="${w}" height="${h}">
  <data encoding="csv">
${colLines.join('\n')}
  </data>
 </layer>`
  }

  if (priority.length >= tileCount) {
    const prioLines = []
    for (let y = 0; y < h; y++) {
      const row = Array.from({ length: w }, (_, i) => priority[y * w + i] ? 1 : 0).join(',')
      prioLines.push(row)
    }
    layers += `
 <layer id="3" name="priority" width="${w}" height="${h}">
  <data encoding="csv">
${prioLines.join('\n')}
  </data>
 </layer>`
  }

  let tilesetBlocks = ''
  let currentGid = 1

  if (!tilesets || tilesets.length === 0) {
    // Fallback default
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
      // Tiled objects coordinates are typically aligned to bottom-left relative to grid, or top-left.
      // We will just export standard pixel coordinates (x, y) assuming TILE_SIZE scale.
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
<map version="1.8" tiledversion="1.8.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" infinite="0" nextlayerid="6" nextobjectid="${objects.length + 1}">
${tilesetBlocks}${layers}${objectBlocks}
</map>
`
}

/**
 * Parseia JSON customizado { width, height, tiles, tilesetPath }
 */
export function fromJSON(jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    return {
      width: data.width || 40,
      height: data.height || 30,
      tiles: data.tiles || [],
      tilesets: data.tilesets || []
    }
  } catch (e) {
    return null
  }
}

function parseLayerCsv(dataEl, width, height, asBool = false) {
  if (!dataEl) return null
  const csv = dataEl.textContent.trim()
  const raw = []
  csv.split(/[\r\n]+/).forEach((line) => {
    line.split(',').forEach((v) => {
      const n = parseInt(v.trim(), 10)
      raw.push(Number.isNaN(n) ? 0 : n)
    })
  })
  if (raw.length < width * height) return null
  if (asBool) return raw.map((n) => n > 0)

  return raw.map((n) => {
    if (n < 0) return 0
    return n + 1
  })
}

/**
 * Parseia TMX (simplificado) e extrai dados do mapa
 * @returns {Object|null} { width, height, tiles, tilesets, collision?, priority? }
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
    let tiles = Array(width * height).fill(0)
    let tiles2 = Array(width * height).fill(0)
    let collision = []
    let priority = []

    let tileLayerIdx = 0
    for (const layer of layers) {
      const dataEl = layer.querySelector('data')
      const name = (layer.getAttribute('name') || '').toLowerCase()
      if (name === 'collision') {
        collision = parseLayerCsv(dataEl, width, height, true) || []
      } else if (name === 'priority') {
        priority = parseLayerCsv(dataEl, width, height, true) || []
      } else {
        const t = parseLayerCsv(dataEl, width, height, false)
        if (t) {
          if (tileLayerIdx === 0) { tiles = t; tileLayerIdx++ }
          else if (tileLayerIdx === 1) { tiles2 = t; tileLayerIdx++ }
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
        tmxTilesets.push({
          name,
          path: src,
          firstgid
        })
      }
    } else {
      // Fallback pra single tileset como antes
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

    return { width, height, tiles, tiles2, tilesets: tmxTilesets, collision, priority, objects: tmxObjects }
  } catch (e) {
    console.error('fromTMX error:', e)
    return null
  }
}

/**
 * Gera array C de tiles para uso direto no SGDK
 * @param {Object} data - { width, height, tiles }
 * @param {string} varName - nome da variável
 */
export function toCArray(data, varName = 'map_tiles') {
  const { width, height, tiles = [] } = data
  const w = Math.max(1, width || 40)
  const h = Math.max(1, height || 30)
  const tileCount = w * h
  const arr = Array.from({ length: tileCount }, (_, i) => tiles[i] ?? 0)
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = arr.slice(y * w, (y + 1) * w).map((v) => String(v)).join(', ')
    rows.push('    ' + row)
  }
  return `const u16 ${varName}[] = {\n${rows.join(',\n')}\n};`
}

export { TILE_SIZE }
