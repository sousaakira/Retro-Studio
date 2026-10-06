import { normalizeAssetPath } from './tilemapAssetPack.js'

export const RECENT_TILEMAPS_KEY = 'retrostudio.tilemap.recentFiles.v1'
export const RECENT_TILEMAPS_LIMIT = 8

function getBrowserStorage() {
  try { return globalThis.localStorage } catch { return null }
}

function cleanEntry(entry) {
  if (!entry || typeof entry.path !== 'string') return null
  const path = normalizeAssetPath(entry.path).trim()
  if (!path || !/\.(tmx|json)$/i.test(path)) return null
  const name = path.split('/').pop()?.replace(/\.(tmx|json)$/i, '') || path
  return { path, name, lastOpened: Number(entry.lastOpened) || 0 }
}

export function readRecentTilemaps(storage = getBrowserStorage()) {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(RECENT_TILEMAPS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    return parsed.map(cleanEntry).filter((entry) => {
      if (!entry || seen.has(entry.path)) return false
      seen.add(entry.path)
      return true
    }).slice(0, RECENT_TILEMAPS_LIMIT)
  } catch {
    return []
  }
}

function writeRecentTilemaps(entries, storage = getBrowserStorage()) {
  if (!storage) return
  try { storage.setItem(RECENT_TILEMAPS_KEY, JSON.stringify(entries.slice(0, RECENT_TILEMAPS_LIMIT))) } catch {}
}

export function rememberRecentTilemap(filePath, storage = getBrowserStorage(), now = Date.now()) {
  const entry = cleanEntry({ path: filePath, lastOpened: now })
  if (!entry || !storage) return readRecentTilemaps(storage)
  const entries = [entry, ...readRecentTilemaps(storage).filter((item) => item.path !== entry.path)]
  writeRecentTilemaps(entries, storage)
  return entries.slice(0, RECENT_TILEMAPS_LIMIT)
}

export function forgetRecentTilemap(filePath, storage = getBrowserStorage()) {
  const path = normalizeAssetPath(String(filePath || ''))
  const entries = readRecentTilemaps(storage).filter((entry) => entry.path !== path)
  writeRecentTilemaps(entries, storage)
  return entries
}

export function clearRecentTilemaps(storage = getBrowserStorage()) {
  if (storage) {
    try { storage.removeItem(RECENT_TILEMAPS_KEY) } catch {}
  }
  return []
}
