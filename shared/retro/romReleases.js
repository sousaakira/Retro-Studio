// Versões de ROM para teste (#100): numeração, cabeçalho Mega Drive da cópia entregue, registro
// em releases/releases.json e changelog legível por pessoas e pela IA. Sem Node nem Electron.

export const RELEASES_DIRECTORY = 'releases'
export const RELEASES_MANIFEST = 'releases/releases.json'
export const RELEASES_CHANGELOG = 'releases/CHANGELOG.md'
export const RELEASES_FORMAT = 'retro-studio.releases'
export const RELEASES_VERSION = 1
export const VERSION_HEADER = 'src/generated/game_version.h'
export const MAX_CHANGES = 100
export const MAX_CHANGE_TEXT = 300
export const MAX_NOTES = 4000
export const MAX_TITLE = 48

const VERSION_PATTERN = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([0-9A-Za-z][0-9A-Za-z.-]{0,19}))?$/

export function validVersion(value) { return VERSION_PATTERN.test(String(value ?? '').trim()) }

/** Ordem das versões: números e, no mesmo número, a prévia (-beta) antes da final. */
export function compareVersions(a, b) {
  const x = VERSION_PATTERN.exec(String(a)), y = VERSION_PATTERN.exec(String(b))
  if (!x || !y) return String(a).localeCompare(String(b))
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i])
  if (!x[4] !== !y[4]) return x[4] ? -1 : 1
  return String(x[4] || '').localeCompare(String(y[4] || ''), 'en', { numeric: true })
}

/** Próxima versão sugerida: a última com o terceiro número + 1 (sem a prévia), ou 0.1.0. */
export function nextVersion(releases) {
  const last = [...(releases || [])].map(item => item.version).filter(validVersion).sort(compareVersions).pop()
  if (!last) return '0.1.0'
  const [, major, minor, patch, label] = VERSION_PATTERN.exec(last)
  return label ? `${major}.${minor}.${patch}` : `${major}.${minor}.${Number(patch) + 1}`
}

export function slug(name) {
  const text = String(name || 'jogo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return text || 'jogo'
}

/** Linhas do campo "o que mudou": uma mudança por linha, sem marcadores. */
export function parseChanges(text) {
  const list = Array.isArray(text) ? text : String(text ?? '').split(/\r?\n/)
  return list.map(line => String(line ?? '').replace(/^\s*(?:[-*•+]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHANGE_TEXT))
    .filter(Boolean).slice(0, MAX_CHANGES)
}

/** Título do cabeçalho: ASCII imprimível, sem acentos, até 48 caracteres. */
export function headerTitle(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, MAX_TITLE)
}

/** Checksum do cabeçalho Mega Drive: soma das palavras de 16 bits de 0x200 ao fim. */
export function romChecksum(rom) {
  let sum = 0
  for (let i = 0x200; i + 1 < rom.length; i += 2) sum = (sum + ((rom[i] << 8) | rom[i + 1])) & 0xFFFF
  if (rom.length & 1 && rom.length > 0x200) sum = (sum + (rom[rom.length - 1] << 8)) & 0xFFFF
  return sum
}

/**
 * Cópia da ROM para entregar: revisão nos dois últimos dígitos do serial ("GM 00000000-RR"),
 * título (doméstico e internacional) se informado e checksum corrigido. O código do jogo não
 * muda. rom: Uint8Array/Buffer. Devolve { rom, checksum, serial }.
 */
export function patchRomHeader(rom, { revision = 0, title = '' } = {}) {
  if (!rom || rom.length < 0x200) throw new Error('A ROM é pequena demais para ter o cabeçalho do Mega Drive.')
  const copy = new Uint8Array(rom)
  const text = (offset, length) => String.fromCharCode(...copy.subarray(offset, offset + length))
  if (!text(0x100, 16).startsWith('SEGA')) throw new Error('A ROM não tem o cabeçalho do Mega Drive ("SEGA" em 0x100).')
  const write = (offset, length, value) => { for (let i = 0; i < length; i++) copy[offset + i] = i < value.length ? value.charCodeAt(i) : 0x20 }
  const clean = headerTitle(title)
  if (clean) { write(0x120, 48, clean.toUpperCase()); write(0x150, 48, clean.toUpperCase()) }
  // Serial "GM XXXXXXXX-RR": só a revisão muda; um serial fora do padrão fica como está.
  let serial = text(0x180, 14)
  if (/^.. .{8}-\d\d$/.test(serial)) { serial = serial.slice(0, 12) + String(Math.max(0, revision) % 100).padStart(2, '0'); write(0x180, 14, serial) }
  const checksum = romChecksum(copy)
  copy[0x18E] = checksum >> 8; copy[0x18F] = checksum & 0xFF
  return { rom: copy, checksum, serial }
}

/** Header C para o jogo mostrar a versão (título, tela de pausa, diagnóstico). */
export function versionHeader(release) {
  const [, major, minor, patch] = VERSION_PATTERN.exec(release.version) || [0, 0, 0, 0]
  const quoted = value => '"' + String(value).replace(/[\\"]/g, '') + '"'
  return ['/* Gerado pelo Retro Studio em cada versão para teste (Rodar → Versões). Não edite. */',
    '#ifndef RETROSTUDIO_GAME_VERSION_H', '#define RETROSTUDIO_GAME_VERSION_H',
    `#define GAME_VERSION ${quoted(release.version)}`,
    `#define GAME_VERSION_MAJOR ${Number(major)}`, `#define GAME_VERSION_MINOR ${Number(minor)}`, `#define GAME_VERSION_PATCH ${Number(patch)}`,
    `#define GAME_RELEASE_NUMBER ${Number(release.number) || 0}`,
    `#define GAME_BUILD_DATE ${quoted(String(release.createdAt || '').slice(0, 10))}`,
    `#define GAME_COMMIT ${quoted(release.git?.commit ? release.git.commit.slice(0, 7) : '')}`,
    '#endif', ''].join('\n')
}

/** Arquivos de entrada que mudaram entre duas versões: { added, removed, changed } (caminhos). */
export function diffInputs(previous, current, ignore = [VERSION_HEADER]) {
  const before = new Map((previous || []).map(item => [item.path, item.hash]))
  const now = new Map((current || []).map(item => [item.path, item.hash]))
  const skip = path => ignore.includes(path)
  const added = [], removed = [], changed = []
  for (const [path, hash] of now) if (!skip(path)) { if (!before.has(path)) added.push(path); else if (before.get(path) !== hash) changed.push(path) }
  for (const path of before.keys()) if (!skip(path) && !now.has(path)) removed.push(path)
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() }
}

/** Resumo por área (mapas, código, gráficos...) para o changelog e a IA. */
export function summarizeFiles(files) {
  const area = path => /^maps\/|\.tmx$/i.test(path) ? 'mapas' : /^(src|inc)\//.test(path) ? 'código' : /^res\//.test(path) ? 'recursos'
    : /^(charset|charsets)\//.test(path) ? 'personagens' : /^(scenes|cutscenes)\//.test(path) ? 'cenas' : /^world\//.test(path) ? 'mundo'
    : /^(physics|controls|camera|progress|audio|debug)\//.test(path) ? 'configuração do jogo' : 'outros'
  const counts = {}
  for (const path of [...(files?.added || []), ...(files?.changed || []), ...(files?.removed || [])]) counts[area(path)] = (counts[area(path)] || 0) + 1
  return counts
}

export function emptyManifest() { return { format: RELEASES_FORMAT, version: RELEASES_VERSION, title: '', releases: [] } }

export function parseManifest(raw) {
  if (raw == null || String(raw).trim() === '') return { manifest: emptyManifest(), problem: '' }
  let data
  try { data = JSON.parse(raw) } catch { return { manifest: emptyManifest(), problem: 'releases/releases.json não é um JSON válido.' } }
  if (data?.format !== RELEASES_FORMAT || !Array.isArray(data.releases)) return { manifest: emptyManifest(), problem: 'releases/releases.json não está no formato do Retro Studio.' }
  if (Number(data.version) > RELEASES_VERSION) return { manifest: emptyManifest(), problem: 'releases/releases.json foi gravado por uma versão mais nova do Retro Studio.' }
  const releases = data.releases.filter(item => item && validVersion(item.version)).sort((a, b) => compareVersions(a.version, b.version))
  return { manifest: { format: RELEASES_FORMAT, version: RELEASES_VERSION, title: headerTitle(data.title), releases }, problem: '' }
}

export function serializeManifest(manifest) {
  return JSON.stringify({ format: RELEASES_FORMAT, version: RELEASES_VERSION, title: headerTitle(manifest.title),
    releases: [...manifest.releases].sort((a, b) => compareVersions(a.version, b.version)) }, null, 2) + '\n'
}

const kib = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MiB' : Math.ceil(bytes / 1024) + ' KiB'

/** Texto de uma versão: vai no LEIA-ME de quem testa e no CHANGELOG.md. */
export function releaseMarkdown(release, { heading = '##', forTesters = false } = {}) {
  const lines = [`${heading} ${release.version} — ${String(release.createdAt || '').slice(0, 10)}`, '']
  if (release.changes?.length) { lines.push('O que mudou:'); for (const change of release.changes) lines.push(`- ${change}`); lines.push('') }
  else lines.push('Sem lista de mudanças informada.', '')
  if (release.notes) lines.push(release.notes.trim(), '')
  if (forTesters) return lines.join('\n')
  const rom = release.rom || {}
  lines.push(`- ROM: \`${rom.file || ''}\` (${kib(rom.size || 0)}), revisão ${String(release.number % 100).padStart(2, '0')} no cabeçalho, SHA-256 \`${rom.sha256 || ''}\``)
  if (release.git?.commit) lines.push(`- Commit: \`${release.git.commit.slice(0, 10)}\`${release.git.dirty ? ' (com alterações não commitadas)' : ''}${release.git.branch ? ` em \`${release.git.branch}\`` : ''}`)
  const areas = Object.entries(release.files?.summary || {}).map(([area, count]) => `${area}: ${count}`)
  if (areas.length) lines.push(`- Arquivos alterados desde a versão anterior — ${areas.join(', ')}`)
  for (const commit of (release.git?.commits || []).slice(0, 30)) lines.push(`  - ${commit.hash} ${commit.subject}`)
  lines.push('')
  return lines.join('\n')
}

export function changelogMarkdown(manifest, gameName) {
  const releases = [...manifest.releases].sort((a, b) => compareVersions(b.version, a.version))
  return [`# Versões de ${gameName || 'jogo'}`, '',
    'Gerado pelo Retro Studio (Rodar → Versões para teste). Os dados completos de cada versão, como os commits e os arquivos alterados, estão em `releases/releases.json`.', '',
    ...releases.map(release => releaseMarkdown(release))].join('\n')
}
