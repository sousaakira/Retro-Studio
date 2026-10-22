import { ref, computed, watch, onScopeDispose } from 'vue'
import { mapNotesFile, parseMapNotes, serializeMapNotes, normalizeNote, nextNoteId, noteSummary, MAX_NOTES } from '../../shared/retro/mapNotes.js'

const VISIBLE_KEY = 'retrostudio.tilemap.notesVisible'

/**
 * Anotações para a IA do mapa aberto (#93). Salvas sozinhas (sem o botão Salvar do mapa) em
 * .retrostudio/map-notes/; um mapa ainda sem arquivo guarda as notas na memória até o primeiro save.
 */
export function useMapNotes({ projectPath, currentMapPath, relativeMapPath, mapWidth, mapHeight, tileSize, saving, viewport, setViewportPosition }) {
  const notes = ref([]), selectedId = ref(null), problem = ref(''), saveError = ref('')
  const draft = ref(null) // retângulo sendo arrastado no mapa, em pixels
  const visible = ref((() => { try { return localStorage.getItem(VISIBLE_KEY) !== '0' } catch { return true } })())
  watch(visible, value => { try { localStorage.setItem(VISIBLE_KEY, value ? '1' : '0') } catch { /* preferência opcional */ } })

  const selected = computed(() => notes.value.find(note => note.id === selectedId.value) || null)
  const openCount = computed(() => notes.value.filter(note => note.status === 'open').length)
  const mapSize = () => ({ width: (mapWidth.value || 0) * tileSize, height: (mapHeight.value || 0) * tileSize })

  const root = () => String(projectPath() || '').replace(/[/\\]+$/, '')
  const mapPath = () => currentMapPath.value && root() ? relativeMapPath() : null
  const fileFor = path => { const file = path && mapNotesFile(path); return file ? `${root()}/${file}` : null }

  let request = 0, saveTimer = null, loadedFor = null
  async function load(path) {
    const ticket = ++request
    clearTimeout(saveTimer); saveTimer = null
    selectedId.value = null; draft.value = null; problem.value = ''; saveError.value = ''
    const file = fileFor(path)
    if (!file) { notes.value = []; loadedFor = null; return }
    try {
      const raw = await window.retroStudio?.readTextFileOptional?.(file)
      if (ticket !== request) return
      const result = parseMapNotes(raw, mapSize())
      notes.value = result.notes; problem.value = result.problem; loadedFor = path
    } catch (error) {
      if (ticket !== request) return
      notes.value = []; loadedFor = path; problem.value = `Não foi possível ler as notas do mapa: ${error?.message || error}`
    }
  }

  async function writeNow() {
    clearTimeout(saveTimer); saveTimer = null
    const path = mapPath(), file = fileFor(path)
    // Arquivo ilegível não é sobrescrito: o usuário decide o que fazer com ele.
    if (!file || problem.value || loadedFor !== path) return
    try {
      await window.retroStudio.writeTextFile(file, serializeMapNotes(path, notes.value))
      saveError.value = ''
    } catch (error) { saveError.value = `As notas não foram salvas: ${error?.message || error}` }
  }
  function persist() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(writeNow, 400)
  }

  // Ao salvar um mapa novo ou "salvar como", as notas da memória acompanham o novo arquivo.
  // flush 'sync': saving ainda vale true neste instante (o save continua depois de trocar o caminho).
  watch(currentMapPath, async (now, before) => {
    if (now === before) return
    const path = mapPath(), duringSave = !!saving?.value
    if (duringSave && path && notes.value.length) {
      const existing = await window.retroStudio?.readTextFileOptional?.(fileFor(path)).catch(() => null)
      if (existing == null) { loadedFor = path; problem.value = ''; await writeNow(); return }
    }
    await load(path)
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { request++; if (saveTimer) writeNow() })

  const stamp = () => new Date().toISOString()
  function add(rect) {
    if (notes.value.length >= MAX_NOTES) { saveError.value = `Limite de ${MAX_NOTES} notas por mapa.`; return null }
    const now = stamp()
    const note = normalizeNote({ ...rect, id: nextNoteId(notes.value), kind: 'problem', layer: 'any', status: 'open', text: '', createdAt: now, updatedAt: now }, mapSize())
    notes.value = [...notes.value, note]
    selectedId.value = note.id
    visible.value = true
    persist()
    return note
  }
  function update(id, patch) {
    notes.value = notes.value.map(note => note.id === id ? normalizeNote({ ...note, ...patch, id, updatedAt: stamp() }, mapSize()) : note)
    persist()
  }
  function remove(id) {
    notes.value = notes.value.filter(note => note.id !== id)
    if (selectedId.value === id) selectedId.value = null
    persist()
  }
  function at(x, y) {
    return [...notes.value].reverse().find(note => x >= note.x && y >= note.y && x < note.x + note.width && y < note.y + note.height) || null
  }
  /** Centraliza a nota na área visível do editor e a seleciona. */
  function focus(id) {
    const note = notes.value.find(item => item.id === id)
    if (!note) return null
    selectedId.value = id; visible.value = true
    const view = viewport.value || { w: 0, h: 0 }
    setViewportPosition(note.x + note.width / 2 - view.w / 2, note.y + note.height / 2 - view.h / 2)
    return note
  }

  /** O agente mudou o arquivo (map_note_update): relê sem perder a seleção. */
  async function reload() {
    const keep = selectedId.value
    await load(mapPath())
    if (notes.value.some(note => note.id === keep)) selectedId.value = keep
  }

  /** Mapa aberto e notas em aberto, para o estado da IDE e o chip Tilemap do painel IA. */
  function context() {
    const path = mapPath()
    const name = currentMapPath.value ? String(currentMapPath.value).split(/[/\\]/).pop() : ''
    return { path, name, width: mapWidth.value, height: mapHeight.value, tileSize,
      notes: notes.value.filter(note => note.status === 'open').slice(0, 30).map(note => noteSummary(note, tileSize)),
      noteCount: notes.value.length, openNotes: openCount.value }
  }

  return { notes, selectedId, selected, openCount, visible, draft, problem, saveError, add, update, remove, at, focus, reload, context, flush: writeNow }
}
