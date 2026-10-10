// #42: caminhos guardados em arquivos de projeto precisam valer em outra máquina.
// Tudo o que está dentro do projeto é guardado relativo à raiz, com "/"; o que está
// fora continua absoluto (não há como torná-lo portátil) e pode ser apontado em relatórios.
const normalize = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
export const isAbsolutePath = value => /^(?:\/|[a-zA-Z]:\/)/.test(normalize(value))
const clean = value => {
  const parts = []
  for (const part of normalize(value).split('/')) {
    if (part === '..') { if (!parts.length || parts[parts.length - 1] === '..') return null; parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}
/** Caminho a guardar: relativo quando o arquivo está dentro do projeto. */
export function toPortablePath(projectRoot, file) {
  const root = normalize(projectRoot), target = normalize(file)
  if (!target || !isAbsolutePath(target)) return clean(target) ?? target
  if (!root) return target
  const insensitive = /^[a-zA-Z]:\//.test(root)
  const [a, b] = insensitive ? [root.toLowerCase(), target.toLowerCase()] : [root, target]
  return b.startsWith(a + '/') ? target.slice(root.length + 1) : target
}
/** Caminho a abrir: relativos são resolvidos na raiz do projeto atual; não sobem acima dela. */
export function fromPortablePath(projectRoot, stored) {
  const value = normalize(stored)
  if (!value || isAbsolutePath(value)) return value
  const relative = clean(value)
  return relative === null ? '' : normalize(projectRoot) + '/' + relative
}
const insensitive = root => /^[a-zA-Z]:\//.test(normalize(root))
/**
 * Onde um caminho guardado pode estar neste projeto, do mais ao menos provável. Um absoluto
 * gravado em OUTRA máquina (projeto antigo copiado) não existe aqui, mas o seu final costuma
 * ser o caminho dentro do projeto: /home/ana/jogo/res/heroi.png → <raiz>/res/heroi.png.
 * Só finais com pasta (dois segmentos ou mais) são tentados, para não casar por nome solto.
 */
export function portableCandidates(projectRoot, stored) {
  const direct = fromPortablePath(projectRoot, stored), root = normalize(projectRoot)
  if (!direct) return []
  const found = [direct]
  if (isAbsolutePath(stored) && root && !(insensitive(root) ? direct.toLowerCase() : direct).startsWith((insensitive(root) ? root.toLowerCase() : root) + '/')) {
    const parts = direct.split('/').filter(Boolean)
    for (let start = 1; start <= parts.length - 2; start++) found.push(root + '/' + parts.slice(start).join('/'))
  }
  return found
}
/** Duas referências (guardadas ou absolutas) apontam para o mesmo arquivo deste projeto? */
export function samePortablePath(projectRoot, first, second) {
  const fold = value => insensitive(projectRoot) ? value.toLowerCase() : value
  const a = portableCandidates(projectRoot, first).map(fold), b = portableCandidates(projectRoot, second).map(fold)
  if (!a.length || !b.length) return false
  // Igualdade direta, ou um absoluto de outra máquina cujo final é o caminho do outro aqui.
  return a[0] === b[0] || a.slice(1).includes(b[0]) || b.slice(1).includes(a[0])
}
