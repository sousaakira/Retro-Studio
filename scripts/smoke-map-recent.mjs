import assert from 'node:assert/strict'
import {
  RECENT_TILEMAPS_KEY,
  RECENT_TILEMAPS_LIMIT,
  readRecentTilemaps,
  rememberRecentTilemap,
  forgetRecentTilemap,
  clearRecentTilemaps
} from '../src/utils/retro/recentTilemaps.js'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

const storage = new MemoryStorage()
assert.deepEqual(readRecentTilemaps(storage), [])
let recent = rememberRecentTilemap('/projects/alice/maps/forest.tmx', storage, 10)
assert.equal(recent[0].name, 'forest')
assert.equal(recent[0].lastOpened, 10)
rememberRecentTilemap('C:\\games\\alice\\map.json', storage, 20)
rememberRecentTilemap('/projects/alice/maps/forest.tmx', storage, 30)
recent = readRecentTilemaps(storage)
assert.deepEqual(recent.map((entry) => entry.path), [
  '/projects/alice/maps/forest.tmx',
  'C:/games/alice/map.json'
])
assert.equal(recent[0].lastOpened, 30)
assert.deepEqual(rememberRecentTilemap('/projects/alice/res/terrain.png', storage), recent)
for (let i = 0; i < RECENT_TILEMAPS_LIMIT + 2; i++) {
  rememberRecentTilemap(`/maps/${i}.tmx`, storage, 100 + i)
}
assert.equal(readRecentTilemaps(storage).length, RECENT_TILEMAPS_LIMIT)
assert.equal(forgetRecentTilemap('/maps/9.tmx', storage).some((entry) => entry.path === '/maps/9.tmx'), false)
assert.deepEqual(clearRecentTilemaps(storage), [])
assert.equal(storage.getItem(RECENT_TILEMAPS_KEY), null)
storage.setItem(RECENT_TILEMAPS_KEY, '{broken')
assert.deepEqual(readRecentTilemaps(storage), [])
console.log('smoke-map-recent: PASS (persist, deduplicate, reorder, limit, remove and clear)')
