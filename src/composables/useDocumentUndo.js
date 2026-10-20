// #52: desfazer/refazer de um editor cujo documento é um único objeto reativo (config).
import { ref, watch } from 'vue'
import { createDocumentHistory } from '../../shared/retro/documentHistory.js'

/**
 * config: ref com o documento (null enquanto carrega). Carregar (null → objeto) começa um
 * histórico novo: o que veio do disco, de outro projeto ou de um rascunho nunca vira um passo
 * que se possa "desfazer" por cima do documento novo.
 */
// paused: enquanto true (ex.: um arraste no piano roll), as mudanças não viram passos; ao soltar, o
// estado final vira um passo só.
export function useDocumentUndo(config, { blocked = () => false, limit = 100, key, paused } = {}) {
  // key: what counts as content. Fields the service rewrites on save are left out by the caller.
  const history = createDocumentHistory(key ? { limit, key } : { limit })
  const canUndo = ref(false), canRedo = ref(false)
  let expected = null
  const sync = () => { canUndo.value = history.canUndo(); canRedo.value = history.canRedo() }
  watch(() => config.value ? JSON.stringify(config.value) : null, (now, before) => {
    if (now === null) return
    if (before === null || before === undefined) history.reset(JSON.parse(now))
    else if (now === expected) expected = null // the state this composable has just applied
    else if (paused?.()) return
    else history.record(JSON.parse(now))
    sync()
  }, { immediate: true })
  if (paused) watch(paused, (now, before) => { if (before && !now && config.value) { history.record(JSON.parse(JSON.stringify(config.value))); sync() } })
  function apply(next) {
    if (!next || !config.value) return false
    expected = JSON.stringify(next)
    config.value = next
    sync()
    return true
  }
  const isBlocked = () => (typeof blocked === 'function' ? blocked() : blocked?.value) || !config.value
  const undo = () => !isBlocked() && apply(history.undo())
  const redo = () => !isBlocked() && apply(history.redo())
  /** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. Text fields keep their own undo. Returns true when handled. */
  function onKeydown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
    const key = String(event.key || '').toLowerCase()
    if (key !== 'z' && key !== 'y') return false
    const target = event.target, tag = String(target?.tagName || '').toLowerCase()
    if (tag === 'textarea' || target?.isContentEditable || (tag === 'input' && !['checkbox', 'radio', 'range', 'color', 'button', 'number'].includes(String(target.type || 'text').toLowerCase()))) return false
    const done = key === 'y' || event.shiftKey ? redo() : undo()
    event.preventDefault?.()
    return done || true
  }
  return { undo, redo, onKeydown, canUndo, canRedo }
}
