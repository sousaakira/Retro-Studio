const DEFAULT_TILE_SIZE = 8
// The game streams the patterns around the screen (#90): a room is not limited to the 2048 a
// console cell addresses, only to the 65535 ids of the streamed data (0xFFFF = empty cell).
const MAX_ROOM_TILES = 65535
// Map size the editor and the exporter accept: the streaming runtime reads up to 1024 cells
// per side; the total keeps editing and export responsive.
export const MAX_MAP_SIDE = 1024
export const MAX_MAP_CELLS = 65536
export const mapSizeFits = (width, height) => width >= 1 && height >= 1 && width <= MAX_MAP_SIDE && height <= MAX_MAP_SIDE && width * height <= MAX_MAP_CELLS
const fail = (code, params) => {
  const error = new Error(code)
  error.code = code
  error.params = params
  throw error
}

/** Key of a tile seen mirrored: rows and/or columns reversed. */
function mirroredKey(pixels, tileSize, flipH, flipV) {
  let key = ''
  for (let y = 0; y < tileSize; y++) {
    const row = flipV ? tileSize - 1 - y : y
    for (let x = 0; x < tileSize; x++) {
      const source = (row * tileSize + (flipH ? tileSize - 1 - x : x)) * 4
      key += String.fromCharCode(pixels[source], pixels[source + 1], pixels[source + 2], pixels[source + 3])
    }
  }
  return key
}

/** Turns an already pixel-art aligned raster into a deduplicated 8x8 tile map. A tile that is a
 * mirror of another reuses it: the cell records the flips (flipH/flipV), as the console does. */
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
  const flipH = new Array(mapWidth * mapHeight).fill(false)
  const flipV = new Array(mapWidth * mapHeight).fill(false)

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

      const cell = tileY * mapWidth + tileX
      const key = mirroredKey(pixels, tileSize, false, false)
      let tileIndex = tileLookup.get(key)
      if (tileIndex === undefined) {
        // Mirrors of a stored tile: the cell shows the stored tile flipped back.
        for (const [h, v] of [[true, false], [false, true], [true, true]]) {
          const mirrored = tileLookup.get(mirroredKey(pixels, tileSize, h, v))
          if (mirrored !== undefined) { tileIndex = mirrored; flipH[cell] = h; flipV[cell] = v; break }
        }
      }
      if (tileIndex === undefined) {
        tileIndex = tiles.length
        if (tileIndex >= MAX_ROOM_TILES) {
          fail('tooManyTiles', { max: MAX_ROOM_TILES })
        }
        tileLookup.set(key, tileIndex)
        tiles.push(pixels)
      }
      map[cell] = tileIndex + 1
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

  return { mapWidth, mapHeight, map, flipH, flipV, atlas, atlasWidth, atlasHeight: rows * tileSize, tileCount: tiles.length }
}
