// Anotações para a IA no editor de mapas (#93): áreas do mapa com uma instrução (problema, tarefa
// ou informação). Ficam fora do TMX, em .retrostudio/map-notes/<caminho do mapa>.json, para não
// entrarem no jogo nem no manifesto exportado. Coordenadas em pixels do mapa (tile = 8 px).

export const MAP_NOTES_FORMAT = 'retro-studio.map-notes'
export const MAP_NOTES_VERSION = 1
export const MAP_NOTES_DIRECTORY = '.retrostudio/map-notes'
export const NOTE_KINDS = ['problem', 'task', 'info']
export const NOTE_LAYERS = ['any', 'fg', 'bg', 'background', 'objects', 'collision']
export const NOTE_STATUS = ['open', 'done']
export const MAX_NOTES = 200
export const MAX_NOTE_TEXT = 2000
const TILE = 8

/** Caminho relativo do mapa no projeto, com "/" e sem subir de pasta; null se inválido. */
export function normalizeMapPath(mapPath) {
  const path = String(mapPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '..' || part === '')) return null
  return /\.tmx$/i.test(path) ? path : null
}

/** Arquivo das notas de um mapa, relativo à raiz do projeto. */
export function mapNotesFile(mapPath) {
  const path = normalizeMapPath(mapPath)
  return path ? `${MAP_NOTES_DIRECTORY}/${path}.json` : null
}

const int = (value, min, max, fallback) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
const text = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').slice(0, max)
const pick = (value, list) => list.includes(value) ? value : list[0]

/** Nota válida a partir de qualquer entrada; size = { width, height } do mapa em pixels (opcional). */
export function normalizeNote(raw, size = null) {
  const maxW = size?.width > 0 ? size.width : 1 << 16, maxH = size?.height > 0 ? size.height : 1 << 16
  const x = int(raw?.x, 0, maxW - 1, 0), y = int(raw?.y, 0, maxH - 1, 0)
  return {
    id: int(raw?.id, 1, 1 << 30, 1),
    kind: pick(raw?.kind, NOTE_KINDS),
    layer: pick(raw?.layer, NOTE_LAYERS),
    status: pick(raw?.status, NOTE_STATUS),
    x, y,
    width: int(raw?.width, 1, maxW - x, TILE),
    height: int(raw?.height, 1, maxH - y, TILE),
    text: text(raw?.text, MAX_NOTE_TEXT),
    reply: text(raw?.reply, MAX_NOTE_TEXT),
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : ''
  }
}

/** Lê o arquivo de notas. Devolve { notes, problem }; texto vazio ou ausente = sem notas. */
export function parseMapNotes(raw, size = null) {
  if (raw == null || String(raw).trim() === '') return { notes: [], problem: '' }
  let data
  try { data = JSON.parse(raw) } catch { return { notes: [], problem: 'O arquivo de notas do mapa não é um JSON válido.' } }
  if (data?.format !== MAP_NOTES_FORMAT || !Array.isArray(data.notes)) return { notes: [], problem: 'O arquivo de notas do mapa não está no formato do Retro Studio.' }
  if (Number(data.version) > MAP_NOTES_VERSION) return { notes: [], problem: 'As notas do mapa foram salvas por uma versão mais nova do Retro Studio.' }
  const seen = new Set(), notes = []
  for (const item of data.notes.slice(0, MAX_NOTES)) {
    const note = normalizeNote(item, size)
    if (seen.has(note.id)) note.id = Math.max(0, ...seen) + 1
    seen.add(note.id); notes.push(note)
  }
  return { notes, problem: '' }
}

export function serializeMapNotes(mapPath, notes) {
  return JSON.stringify({ format: MAP_NOTES_FORMAT, version: MAP_NOTES_VERSION, map: normalizeMapPath(mapPath) || '',
    notes: (notes || []).slice(0, MAX_NOTES).map(note => normalizeNote(note)) }, null, 2) + '\n'
}

export const nextNoteId = notes => (notes || []).reduce((max, note) => Math.max(max, note.id || 0), 0) + 1

/** Faixa de tiles coberta pela nota (inclusiva). */
export function noteTiles(note, tileSize = TILE) {
  return { x1: Math.floor(note.x / tileSize), y1: Math.floor(note.y / tileSize),
    x2: Math.floor((note.x + note.width - 1) / tileSize), y2: Math.floor((note.y + note.height - 1) / tileSize) }
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Notas como a IA as recebe: posição em pixels e tiles e os objetos do TMX que tocam a área
 * (colisões, rampas, spawn, inimigos...). objects em pixels, como parseTmxObjects devolve.
 */
export function describeNotes(notes, { objects = [], tileSize = TILE } = {}) {
  return (notes || []).map(note => {
    const near = objects.filter(obj => overlaps(note, { x: obj.x, y: obj.y, width: Math.max(1, obj.width || 0), height: Math.max(1, obj.height || 0) }))
    return {
      id: note.id, kind: note.kind, status: note.status, layer: note.layer, text: note.text,
      ...(note.reply ? { reply: note.reply } : {}),
      pixels: { x: note.x, y: note.y, width: note.width, height: note.height },
      tiles: noteTiles(note, tileSize),
      objects: near.slice(0, 30).map(obj => ({ id: obj.id, type: obj.type, ...(obj.name ? { name: obj.name } : {}),
        x: obj.x, y: obj.y, width: obj.width, height: obj.height,
        ...(Object.keys(obj.properties || {}).length ? { properties: obj.properties } : {}) }))
    }
  })
}

const KIND_LABEL = { problem: 'problema', task: 'tarefa', info: 'informação' }
const LAYER_LABEL = { any: 'qualquer camada', fg: 'frente (FG)', bg: 'cenário (BG)', background: 'fundo visual', objects: 'objetos', collision: 'colisão' }
export const noteKindLabel = kind => KIND_LABEL[kind] || kind
export const noteLayerLabel = layer => LAYER_LABEL[layer] || layer

/** Linha curta de uma nota para o contexto do chat. */
export function noteSummary(note, tileSize = TILE) {
  const t = noteTiles(note, tileSize)
  return `#${note.id} ${noteKindLabel(note.kind)} [${noteLayerLabel(note.layer)}] px ${note.x},${note.y} ${note.width}x${note.height} (tiles ${t.x1},${t.y1}-${t.x2},${t.y2}): ${note.text.replace(/\s+/g, ' ').trim() || '(sem texto)'}`
}
