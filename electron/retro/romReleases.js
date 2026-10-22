// Versões de ROM para teste (#100): build limpo de release, cópia numerada da ROM com o cabeçalho
// ajustado, registro em releases/releases.json, CHANGELOG.md e LEIA-ME para quem testa.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { captureBuildInputs } from './buildSnapshot.js'
import {
  RELEASES_DIRECTORY, RELEASES_MANIFEST, RELEASES_CHANGELOG, VERSION_HEADER, MAX_NOTES,
  validVersion, nextVersion, slug, parseChanges, headerTitle, patchRomHeader, versionHeader,
  diffInputs, summarizeFiles, parseManifest, serializeManifest, releaseMarkdown, changelogMarkdown
} from '../../shared/retro/romReleases.js'

const run = promisify(execFile)
const busy = new Set()

function inside(root, file) {
  const relative = path.relative(root, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
/** Caminho dentro do projeto que não passa por link simbólico (o que existir dele). */
function safePath(root, relative) {
  const file = path.join(root, relative)
  if (!inside(root, file)) throw new Error('Caminho fora do projeto: ' + relative)
  let probe = file
  while (probe !== root) {
    if (fs.existsSync(probe) && fs.lstatSync(probe).isSymbolicLink()) throw new Error('Link simbólico no caminho das versões: ' + path.relative(root, probe))
    probe = path.dirname(probe)
  }
  return file
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + process.pid
  fs.writeFileSync(temporary, data)
  fs.renameSync(temporary, file)
}
function gameName(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'retro-studio.json'), 'utf8')).name || path.basename(root) } catch { return path.basename(root) }
}
function readManifest(root) {
  const file = safePath(root, RELEASES_MANIFEST)
  return parseManifest(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)
}

async function git(root, args) {
  try { return (await run('git', args, { cwd: root, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout.trim() } catch { return null }
}
/** Commit atual, ramo, alterações pendentes e commits desde a versão anterior (se for repositório). */
async function gitInfo(root, previousCommit) {
  const commit = await git(root, ['rev-parse', 'HEAD'])
  if (!commit) return null
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await git(root, ['status', '--porcelain', '--untracked-files=no'])
  // Desde a versão anterior; na primeira versão, os 30 commits mais recentes.
  const known = previousCommit && /^[0-9a-f]{7,40}$/.test(previousCommit)
  const log = known && previousCommit === commit ? '' : await git(root, ['log', '--format=%h%x09%aI%x09%s', ...(known ? ['-n', '200', previousCommit + '..HEAD'] : ['-n', '30'])])
  const commits = (log || '').split('\n').filter(Boolean).map(line => { const [hash, date, ...subject] = line.split('\t'); return { hash, date, subject: subject.join('\t') } })
  return { commit, branch: branch && branch !== 'HEAD' ? branch : '', dirty: !!status, commits }
}

/** Situação para a tela: versões, próxima sugerida e título do cabeçalho. */
export function releasesStatus(projectPath) {
  const root = fs.realpathSync(projectPath)
  const { manifest, problem } = readManifest(root)
  return { success: true, game: gameName(root), title: manifest.title, releases: [...manifest.releases].reverse(), next: nextVersion(manifest.releases),
    problem, directory: RELEASES_DIRECTORY, busy: busy.has(root) }
}

export function readRelease(projectPath, version) {
  const root = fs.realpathSync(projectPath)
  const { manifest, problem } = readManifest(root)
  if (problem) throw new Error(problem)
  const release = manifest.releases.find(item => item.version === version)
  if (!release) throw new Error(`A versão ${version} não existe. Versões: ${manifest.releases.map(item => item.version).join(', ') || 'nenhuma'}.`)
  return release
}

/**
 * Gera a versão: header da versão → build limpo de release → cópia da ROM com o cabeçalho
 * ajustado → registro. runBuild(projectPath, { clean, flavor }) é o build da IDE (buildForTools).
 * onProgress(texto) informa as etapas.
 */
export async function createRelease(projectPath, request = {}, { runBuild, onProgress = () => {} } = {}) {
  const root = fs.realpathSync(projectPath)
  const version = String(request.version ?? '').trim()
  if (!validVersion(version)) throw new Error('Versão inválida. Use três números, como 0.3.0 (ou 0.3.0-beta).')
  const changes = parseChanges(request.changes)
  const notes = String(request.notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTES)
  if (!changes.length && !notes) throw new Error('Escreva o que mudou nesta versão: é o que quem testa e a IA vão ler.')
  if (typeof runBuild !== 'function') throw new Error('Build indisponível.')
  if (busy.has(root)) throw new Error('Já há uma versão sendo gerada neste projeto.')
  busy.add(root)
  try {
    const { manifest, problem } = readManifest(root)
    if (problem) throw new Error(problem + ' Corrija ou mova o arquivo antes de gerar outra versão.')
    if (manifest.releases.some(item => item.version === version)) throw new Error(`A versão ${version} já existe. Use outro número.`)
    if (request.title !== undefined) manifest.title = headerTitle(request.title)
    const previous = manifest.releases[manifest.releases.length - 1] || null
    const number = (previous?.number || 0) + 1
    const createdAt = new Date().toISOString()
    onProgress('Conferindo o git…')
    const gitData = await gitInfo(root, previous?.git?.commit)
    const draft = { version, number, createdAt, git: gitData }
    // O jogo pode mostrar a versão: o header entra antes do build.
    if (fs.existsSync(path.join(root, 'src'))) writeAtomic(safePath(root, VERSION_HEADER), versionHeader(draft))
    onProgress('Compilando a versão de release (build limpo)…')
    const build = await runBuild(root, { clean: true, flavor: 'release' })
    if (!build?.success || !build.romPath) {
      const first = (build?.errors || []).slice(0, 5).map(item => `${item.file || '?'}${item.line ? ':' + item.line : ''} ${item.message || ''}`.trim())
      throw new Error('O build falhou; a versão não foi gerada.' + (first.length ? '\n' + first.join('\n') : build?.error ? ' ' + build.error : ''))
    }
    onProgress('Gravando a ROM e o registro…')
    const original = fs.readFileSync(build.romPath)
    const { rom, checksum, serial } = patchRomHeader(original, { revision: number, title: manifest.title })
    const name = slug(gameName(root))
    const romRelative = `${RELEASES_DIRECTORY}/${version}/${name}-${version}.bin`
    const inputs = captureBuildInputs(root).files.map(({ path: file, hash }) => ({ path: file, hash }))
    let previousInputs = null
    if (previous) {
      try { previousInputs = JSON.parse(fs.readFileSync(safePath(root, `${RELEASES_DIRECTORY}/${previous.version}/inputs.json`), 'utf8')).files } catch { previousInputs = null }
    }
    const diff = previousInputs ? diffInputs(previousInputs, inputs) : null
    const release = {
      version, number, createdAt, changes, ...(notes ? { notes } : {}),
      rom: { file: romRelative, size: rom.length, sha256: crypto.createHash('sha256').update(rom).digest('hex'), checksum: '0x' + checksum.toString(16).padStart(4, '0'), serial },
      build: { flavor: build.flavor || 'release' },
      ...(gitData ? { git: gitData } : {}),
      files: diff ? { ...diff, summary: summarizeFiles(diff) } : { first: true, count: inputs.length }
    }
    writeAtomic(safePath(root, romRelative), Buffer.from(rom))
    writeAtomic(safePath(root, `${RELEASES_DIRECTORY}/${version}/inputs.json`), JSON.stringify({ version, files: inputs }) + '\n')
    writeAtomic(safePath(root, `${RELEASES_DIRECTORY}/${version}/LEIA-ME.txt`),
      `${gameName(root)} — versão ${version} para teste\n\nArquivo: ${path.basename(romRelative)}\nRode num emulador de Mega Drive (Genesis Plus GX, BlastEm, Kega Fusion) ou num flashcart.\n\n${releaseMarkdown(release, { heading: '', forTesters: true }).replace(/^ /, '')}`)
    manifest.releases.push(release)
    writeAtomic(safePath(root, RELEASES_MANIFEST), serializeManifest(manifest))
    writeAtomic(safePath(root, RELEASES_CHANGELOG), changelogMarkdown(manifest, gameName(root)))
    // ROMs ficam fora do git por padrão; o registro e o changelog são versionados.
    const ignore = safePath(root, `${RELEASES_DIRECTORY}/.gitignore`)
    if (!fs.existsSync(ignore)) writeAtomic(ignore, '# ROMs das versões para teste (Retro Studio): o registro e o changelog vão para o git.\n*.bin\n')
    return { success: true, release, romPath: path.join(root, romRelative) }
  } finally { busy.delete(root) }
}
