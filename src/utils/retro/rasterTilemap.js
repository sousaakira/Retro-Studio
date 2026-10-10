const DEFAULT_TILE_SIZE = 8
const MAX_MEGA_DRIVE_TILES = 2048
const fail = (code, params) => {
  const error = new Error(code)
  error.code = code
  error.params = params
  throw error
}

/** Turns an already pixel-art aligned raster into a deduplicated 8x8 tile map. */
export function rasterToTilemap(imageData, width, height, tileSize = DEFAULT_TILE_SIZE) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail('invalidDimensions')
  }
  if (width % tileSize || height % tileSize) {
    fail('unalignedDimensions', { tileSize })
  }
  if (!imageData || imageData.length !== width * height * 4) {
    fail('unreadableImage')
  }

  const colors = new Set()
  let hasTransparency = false
  for (let i = 0; i < imageData.length; i += 4) {
    const alpha = imageData[i + 3]
    if (alpha !== 0 && alpha !== 255) {
      fail('semiTransparent')
    }
    if (alpha) colors.add(`${imageData[i]},${imageData[i + 1]},${imageData[i + 2]}`)
    else hasTransparency = true
  }
  const maxColors = hasTransparency ? 15 : 16
  if (colors.size > maxColors) {
    fail('tooManyColors', { count: colors.size, max: maxColors })
  }

  const mapWidth = width / tileSize
  const mapHeight = height / tileSize
  const tiles = []
  const tileLookup = new Map()
  const map = new Array(mapWidth * mapHeight).fill(0)

  for (let tileY = 0; tileY < mapHeight; tileY++) {
    for (let tileX = 0; tileX < mapWidth; tileX++) {
      const pixels = new Uint8ClampedArray(tileSize * tileSize * 4)
      let visible = false
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const source = ((tileY * tileSize + y) * width + tileX * tileSize + x) * 4
          const target = (y * tileSize + x) * 4
          pixels[target] = imageData[source]
          pixels[target + 1] = imageData[source + 1]
          pixels[target + 2] = imageData[source + 2]
          pixels[target + 3] = imageData[source + 3]
          if (imageData[source + 3]) visible = true
        }
      }
      if (!visible) continue

      let key = ''
      for (let i = 0; i < pixels.length; i++) key += String.fromCharCode(pixels[i])
      let tileIndex = tileLookup.get(key)
      if (tileIndex === undefined) {
        tileIndex = tiles.length
        if (tileIndex >= MAX_MEGA_DRIVE_TILES) {
          fail('tooManyTiles', { max: MAX_MEGA_DRIVE_TILES })
        }
        tileLookup.set(key, tileIndex)
        tiles.push(pixels)
      }
      map[tileY * mapWidth + tileX] = tileIndex + 1
    }
  }

  if (!tiles.length) fail('fullyTransparent')

  const columns = 16
  const rows = Math.ceil(tiles.length / columns)
  const atlas = new Uint8ClampedArray(columns * rows * tileSize * tileSize * 4)
  const atlasWidth = columns * tileSize
  for (let i = 0; i < tiles.length; i++) {
    const tileX = i % columns
    const tileY = Math.floor(i / columns)
    const tile = tiles[i]
    for (let y = 0; y < tileSize; y++) {
      const source = y * tileSize * 4
      const target = ((tileY * tileSize + y) * atlasWidth + tileX * tileSize) * 4
      atlas.set(tile.subarray(source, source + tileSize * 4), target)
    }
  }

  return { mapWidth, mapHeight, map, atlas, atlasWidth, atlasHeight: rows * tileSize, tileCount: tiles.length }
}
