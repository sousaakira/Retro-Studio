import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listMapFilesInKit } from '../electron/retro/mapKitMaps.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-map-kit-files-'))
try {
  const nested = path.join(root, 'examples', 'forest')
  await fs.mkdir(nested, { recursive: true })
  const packPath = path.join(root, 'alice-map-pack.json')
  const tmxPath = path.join(nested, 'first-room.tmx')
  const jsonPath = path.join(nested, 'first-room.json')
  const otherPath = path.join(root, 'root-map.json')
  const palettePath = path.join(root, 'palette.json')
  const ignoredPath = path.join(root, '.hidden.tmx')
  await Promise.all([
    fs.writeFile(packPath, '{}'),
    fs.writeFile(tmxPath, '<map />'),
    fs.writeFile(jsonPath, JSON.stringify({ width: 1, height: 1, tiles: [0] })),
    fs.writeFile(otherPath, JSON.stringify({ width: 1, height: 1, tiles: [0] })),
    fs.writeFile(palettePath, JSON.stringify({ colors: [[0, 0, 0]] })),
    fs.writeFile(ignoredPath, '<map />')
  ])

  const maps = await listMapFilesInKit(root, packPath)
  assert.deepEqual(maps.map((map) => map.path), [tmxPath, otherPath])
  assert.equal(maps.find((map) => map.path === tmxPath).name, 'first-room')
  assert.deepEqual(await listMapFilesInKit(root, packPath, { maxDepth: 0 }), [{ path: otherPath, name: 'root-map' }])
  console.log('smoke-map-kit-files: PASS (recursive maps only, metadata filtered, TMX preferred over JSON)')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
