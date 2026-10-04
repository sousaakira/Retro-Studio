import path from 'node:path'
import fs from 'node:fs/promises'

const MAP_EXTENSION = /\.(tmx|json)$/i

export async function listMapFilesInKit(directory, excludedFile = '', options = {}) {
  const root = path.resolve(directory)
  const excluded = excludedFile ? path.resolve(excludedFile) : ''
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 4
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 100
  const maps = []

  async function walk(current, depth) {
    if (depth > maxDepth || maps.length >= maxFiles) return
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (maps.length >= maxFiles) break
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (entry.isFile() && MAP_EXTENSION.test(entry.name) &&
                 path.resolve(fullPath) !== excluded) {
        if (/\.json$/i.test(entry.name)) {
          try {
            const stat = await fs.stat(fullPath)
            if (stat.size > 16 * 1024 * 1024) continue
            const map = JSON.parse(await fs.readFile(fullPath, 'utf8'))
            if (!Number.isInteger(map.width) || map.width < 1 || map.width > 256 ||
                !Number.isInteger(map.height) || map.height < 1 || map.height > 256 ||
                !Array.isArray(map.tiles) || map.tiles.length < map.width * map.height) continue
          } catch {
            continue
          }
        }
        maps.push({ path: fullPath, name: path.basename(entry.name).replace(MAP_EXTENSION, '') })
      }
    }
  }

  await walk(root, 0)
  const uniqueMaps = new Map()
  for (const map of maps.sort((a, b) => a.path.localeCompare(b.path))) {
    const key = path.relative(root, map.path).replace(/\.(tmx|json)$/i, '').toLowerCase()
    const previous = uniqueMaps.get(key)
    if (!previous || (/\.tmx$/i.test(map.path) && !/\.tmx$/i.test(previous.path))) {
      uniqueMaps.set(key, map)
    }
  }
  return [...uniqueMaps.values()].sort((a, b) => a.path.localeCompare(b.path))
}
