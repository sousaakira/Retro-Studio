import { nextTick, onBeforeUnmount, watch } from 'vue'

const KEY = 'retro-studio.workspace-layouts.v1'
const bounds = { sidebarWidth: [180,600,280], terminalHeight: [100,600,250], aiTerminalWidth: [300,800,450] }
export function normalizeWorkspaceLayout(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {}
  const result = { sidebarVisible: value.sidebarVisible !== false, isTerminalOpen: value.isTerminalOpen === true, isAITerminalOpen: value.isAITerminalOpen === true }
  for (const [key,[min,max,fallback]] of Object.entries(bounds)) result[key] = Number.isFinite(value[key]) ? Math.max(min, Math.min(max,value[key])) : fallback
  // #45: tab of the bottom dock chosen in each mode.
  result.dockTabs = {}
  if (value.dockTabs && typeof value.dockTabs === 'object' && !Array.isArray(value.dockTabs))
    for (const mode of ['code','maps','characters','scenes','run']) if (['terminal','problems','context'].includes(value.dockTabs[mode])) result.dockTabs[mode] = value.dockTabs[mode]
  return result
}

/** UI preferences only. Hidden docks stay mounted to preserve their work. */
export function useWorkspaceLayout({ projectPath, state, layout }) {
  let ready = false, applying = false, active = '', defaults = normalizeWorkspaceLayout(), records = new Map()
  const capture = () => normalizeWorkspaceLayout(Object.fromEntries(Object.entries(state).map(([key,value]) => [key,value.value])))
  const persist = () => {
    if (!ready || applying || !active) return
    records.delete(active); records.set(active,capture())
    while (records.size > 100) records.delete(records.keys().next().value)
    try {
      let encoded = JSON.stringify([...records])
      while (encoded.length > 128 * 1024 && records.size > 1) { records.delete(records.keys().next().value); encoded = JSON.stringify([...records]) }
      window.localStorage.setItem(KEY,encoded)
    } catch { /* Memory preferences still work when storage is unavailable. */ }
  }
  function apply(value) {
    applying = true
    const settings = normalizeWorkspaceLayout(value)
    for (const [key,value] of Object.entries(state)) value.value = settings[key]
    applying = false
    void nextTick(() => layout?.())
  }
  function activate() {
    defaults = capture()
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw && raw.length <= 128 * 1024) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) for (const item of parsed.slice(-100)) {
          if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length <= 4096 && item[1] && typeof item[1] === 'object') records.set(item[0],normalizeWorkspaceLayout(item[1]))
        }
      }
    } catch { /* Invalid preferences do not prevent opening a project. */ }
    active = projectPath.value || ''; ready = true
    apply(records.get(active) || defaults)
  }
  watch(projectPath, path => {
    if (!ready) return
    persist(); active = path || ''; apply(records.get(active) || defaults)
  }, { flush: 'sync' })
  watch(Object.values(state), () => { persist(); if (!applying) void nextTick(() => layout?.()) }, { flush: 'sync' })
  onBeforeUnmount(persist)
  return { activate, reset() { apply(defaults); persist() } }
}
