export const RECENT_CHARSETS_KEY = 'retrostudio.charsetMaker.recentFiles.v1'
const LIMIT = 8

function storage() { try { return globalThis.localStorage } catch { return null } }

function clean(entry) {
  if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) return null
  const path = entry.path.trim()
  if (!/\.(png|gif|jpe?g|bmp)$/i.test(path)) return null
  const name = String(entry.name || path.split(/[\\/]/).pop() || path)
  return { path, name, lastOpened: Number(entry.lastOpened) || 0 }
}

export function readRecentCharsets(store = storage()) {
  if (!store) return []
  try {
    const entries = JSON.parse(store.getItem(RECENT_CHARSETS_KEY) || '[]')
    if (!Array.isArray(entries)) return []
    const seen = new Set()
    return entries.map(clean).filter(entry => {
      if (!entry || seen.has(entry.path)) return false
      seen.add(entry.path)
      return true
    }).slice(0, LIMIT)
  } catch { return [] }
}

export function rememberRecentCharset(filePath, name, store = storage(), now = Date.now()) {
  const entry = clean({ path: filePath, name, lastOpened: now })
  if (!entry || !store) return readRecentCharsets(store)
  const entries = [entry, ...readRecentCharsets(store).filter(item => item.path !== entry.path)].slice(0, LIMIT)
  try { store.setItem(RECENT_CHARSETS_KEY, JSON.stringify(entries)) } catch {}
  return entries
}

export function forgetRecentCharset(filePath, store = storage()) {
  const entries = readRecentCharsets(store).filter(item => item.path !== filePath)
  try { store?.setItem(RECENT_CHARSETS_KEY, JSON.stringify(entries)) } catch {}
  return entries
}
