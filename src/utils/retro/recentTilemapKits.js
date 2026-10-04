import { normalizeAssetPath } from './tilemapAssetPack.js'

export const RECENT_TILEMAP_KITS_KEY = 'retrostudio.tilemap.recentKits.v1'
const LIMIT = 8

function storage() { try { return globalThis.localStorage } catch { return null } }
function clean(item) {
  if (!item || typeof item.path !== 'string') return null
  const path = normalizeAssetPath(item.path).trim()
  if (!path || !/\.json$/i.test(path)) return null
  return { path, name: String(item.name || path.split('/').pop().replace(/\.json$/i, '')), lastOpened: Number(item.lastOpened) || 0 }
}

export function readRecentTilemapKits(store = storage()) {
  if (!store) return []
  try {
    const entries = JSON.parse(store.getItem(RECENT_TILEMAP_KITS_KEY) || '[]')
    if (!Array.isArray(entries)) return []
    const seen = new Set()
    return entries.map(clean).filter(item => {
      if (!item || seen.has(item.path)) return false
      seen.add(item.path)
      return true
    }).slice(0, LIMIT)
  } catch { return [] }
}

export function rememberRecentTilemapKit(filePath, name, store = storage(), now = Date.now()) {
  const item = clean({ path: filePath, name, lastOpened: now })
  if (!item || !store) return readRecentTilemapKits(store)
  const entries = [item, ...readRecentTilemapKits(store).filter(entry => entry.path !== item.path)].slice(0, LIMIT)
  try { store.setItem(RECENT_TILEMAP_KITS_KEY, JSON.stringify(entries)) } catch {}
  return entries
}

export function forgetRecentTilemapKit(filePath, store = storage()) {
  const normalized = normalizeAssetPath(String(filePath || ''))
  const entries = readRecentTilemapKits(store).filter(item => item.path !== normalized)
  try { store?.setItem(RECENT_TILEMAP_KITS_KEY, JSON.stringify(entries)) } catch {}
  return entries
}

export function clearRecentTilemapKits(store = storage()) {
  try { store?.removeItem(RECENT_TILEMAP_KITS_KEY) } catch {}
  return []
}
