// Progresso do build a partir da saída do make (SGDK/MarsDev): etapas conhecidas e contagem de
// arquivos. É uma estimativa que só anda para a frente; um build incremental pula etapas.
export const BUILD_STAGES = ['start', 'export', 'resources', 'compile', 'link', 'rom', 'done']
const RANGE = { start: [0, 2], export: [2, 10], resources: [10, 35], compile: [35, 90], link: [90, 96], rom: [96, 99], done: [100, 100] }
const EXPORT = /^\s*(?:python3?|node)\s+(tools\/\S+)/
const RESOURCE = /rescomp(?:\.jar)?\s+(\S+\.res)\s/
const COMPILE = /\s-c\s+(\S+\.(?:c|s|S|asm|cpp))\s+-o\s/
const LINK = /\s-o\s+\S*rom\.out\b/
const ROM = /objcopy\b.*\brom\.bin\b|\bsizebnd\b/

/** totals: { sources, resources } = arquivos que um build completo compila (0 = desconhecido). */
export function createBuildProgress(totals = {}) {
  const total = { compile: Math.max(0, totals.sources | 0), resources: Math.max(0, totals.resources | 0) }
  const seen = { compile: new Set(), resources: new Set(), export: new Set() }
  let stage = 'start', percent = 0, detail = '', pending = ''
  const order = name => BUILD_STAGES.indexOf(name)
  function advance(next, file) {
    if (order(next) < order(stage)) return false
    stage = next; detail = file || ''
    const [from, to] = RANGE[next]
    let value = from
    if (seen[next]) {
      seen[next].add(file)
      const count = seen[next].size, all = total[next] || 0
      // Sem total conhecido, cada arquivo anda metade do que falta: avança sempre, nunca chega ao fim da etapa.
      value = all ? from + (to - from) * Math.min(1, count / all) : to - (to - from) * Math.pow(0.5, count)
    }
    const before = percent
    percent = Math.max(percent, Math.min(99, Math.round(value)))
    return before !== percent || true
  }
  function line(text) {
    let match
    if ((match = text.match(COMPILE))) {
      const file = match[1]
      // res/*.rs é o recurso já compilado virando objeto: ainda é a etapa de recursos.
      // O cabeçalho da ROM (src/boot) é compilado antes dos recursos: não muda de etapa.
      return /\.rs$/.test(file) || /(^|\/)boot\//.test(file) ? false : advance('compile', file)
    }
    if ((match = text.match(RESOURCE))) return advance('resources', match[1])
    if (LINK.test(text)) return advance('link', '')
    if (ROM.test(text)) return advance('rom', '')
    if ((match = text.match(EXPORT))) return advance('export', match[1])
    return false
  }
  return {
    /** Recebe um pedaço da saída; devolve o estado se algo mudou, senão null. */
    feed(chunk) {
      pending += String(chunk || '')
      const lines = pending.split(/\r?\n/); pending = lines.pop() || ''
      if (pending.length > 65536) pending = ''
      let changed = false
      for (const text of lines) if (line(text)) changed = true
      return changed ? this.state() : null
    },
    finish() { stage = 'done'; percent = 100; detail = ''; return this.state() },
    state: () => ({ stage, percent, detail })
  }
}
