/**
 * Utilitários para formato TMX (Tiled Map Exchange) - compatível com SGDK rescomp
 * rescomp exige: TMX com dados em CSV
 */

const TILE_SIZE = 8

/**
 * Gera XML TMX a partir dos dados do mapa
 * @param {Object} data - { width, height, tiles, tiles2?, tilesetImagePath, tilesetColumns, collision?, priority? }
 */
export function toTMX(data) {
  const { width, height, tiles = [], tiles2 = [], tilesetImagePath = 'tileset.png', tilesetColumns = 16, collision = [], priority = [] } = data
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

  const imageName = tilesetImagePath.split(/[/\\]/).pop() || 'tileset.png'

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

  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.8" tiledversion="1.8.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" infinite="0" nextlayerid="5" nextobjectid="1">
 <tileset firstgid="1" name="tileset" tilewidth="${TILE_SIZE}" tileheight="${TILE_SIZE}" tilecount="${tilesetColumns * Math.ceil(256 / tilesetColumns)}" columns="${tilesetColumns}">
  <image source="${imageName}" width="${tilesetColumns * TILE_SIZE}" height="${Math.ceil(256 / tilesetColumns) * TILE_SIZE}"/>
 </tileset>${layers}
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
      tilesetImagePath: data.tilesetPath || ''
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
  const hasNegative = raw.some((n) => n < 0)
  return raw.map((n) => {
    if (n < 0) return 0
    return hasNegative ? n + 1 : n
  })
}

/**
 * Parseia TMX (simplificado) e extrai dados do mapa
 * @returns {Object|null} { width, height, tiles, tilesetImagePath, collision?, priority? }
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

    const img = doc.querySelector('tileset image')
    const tilesetImagePath = img?.getAttribute('source') || ''

    return { width, height, tiles, tiles2, tilesetImagePath, collision, priority }
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
