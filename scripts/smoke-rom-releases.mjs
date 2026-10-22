// Versões de ROM para teste (#100): numeração, cabeçalho da cópia entregue (revisão, título e
// checksum), registro e changelog, git (commit e commits desde a anterior), arquivos alterados
// entre versões, header da versão para o jogo, comandos da IA e a tela do modo Rodar.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validVersion, compareVersions, nextVersion, parseChanges, slug, headerTitle, romChecksum, patchRomHeader, diffInputs, summarizeFiles,
  parseManifest, versionHeader } from '../shared/retro/romReleases.js'
import { createRelease, releasesStatus, readRelease } from '../electron/retro/romReleases.js'
import { runControlCommand } from '../electron/control/commands.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

// Números de versão.
for (const good of ['0.1.0', '1.20.3', '0.3.0-beta', '0.3.0-rc.2']) assert.ok(validVersion(good), good)
for (const bad of ['1', '1.2', 'v1.2.3', '1.2.3-', '1.2.3 beta', '']) assert.ok(!validVersion(bad), bad)
assert.deepEqual(['0.10.0', '0.2.0', '0.3.0', '0.3.0-beta', '0.2.10'].sort(compareVersions), ['0.2.0', '0.2.10', '0.3.0-beta', '0.3.0', '0.10.0'])
assert.equal(nextVersion([]), '0.1.0')
assert.equal(nextVersion([{ version: '0.2.9' }, { version: '0.2.10' }]), '0.2.11')
assert.equal(nextVersion([{ version: '0.3.0-beta' }]), '0.3.0')
assert.deepEqual(parseChanges('- Corrigida a rampa\n\n* Água   com correnteza\n2) Novo inimigo\n'), ['Corrigida a rampa', 'Água com correnteza', 'Novo inimigo'])
assert.equal(slug('Sota: A Lenda'), 'sota-a-lenda')
assert.equal(headerTitle('Sotã — Ibirapuera'), 'Sota  Ibirapuera')

// Cabeçalho: revisão no serial, título nos dois campos e checksum de 0x200 ao fim.
const rom = Buffer.alloc(0x1000, 0)
rom.write('SEGA MEGA DRIVE ', 0x100, 'ascii'); rom.write('SAMPLE PROGRAM'.padEnd(48), 0x120, 'ascii'); rom.write('SAMPLE PROGRAM'.padEnd(48), 0x150, 'ascii')
rom.write('GM 00000000-00', 0x180, 'ascii')
for (let i = 0x200; i < rom.length; i++) rom[i] = (i * 7) & 0xFF
const patched = patchRomHeader(rom, { revision: 103, title: 'Sota' })
const out = Buffer.from(patched.rom)
assert.equal(out.toString('ascii', 0x180, 0x18E), 'GM 00000000-03')
assert.equal(out.toString('ascii', 0x120, 0x150), 'SOTA'.padEnd(48))
assert.equal(out.toString('ascii', 0x150, 0x180), 'SOTA'.padEnd(48))
assert.equal(out.readUInt16BE(0x18E), romChecksum(out))
assert.ok(out.subarray(0x200).equals(rom.subarray(0x200)), 'o código do jogo não muda')
assert.equal(Buffer.from(patchRomHeader(rom, {}).rom).toString('ascii', 0x120, 0x12E), 'SAMPLE PROGRAM', 'sem título, o cabeçalho fica')
assert.throws(() => patchRomHeader(Buffer.alloc(0x1000)), /SEGA/)
assert.match(versionHeader({ version: '1.2.3', number: 4, createdAt: '2026-10-22T10:00:00Z', git: { commit: 'abcdef123456' } }),
  /#define GAME_VERSION "1\.2\.3"\n#define GAME_VERSION_MAJOR 1\n#define GAME_VERSION_MINOR 2\n#define GAME_VERSION_PATCH 3\n#define GAME_RELEASE_NUMBER 4\n#define GAME_BUILD_DATE "2026-10-22"\n#define GAME_COMMIT "abcdef1"/)
const diff = diffInputs([{ path: 'maps/a.tmx', hash: '1' }, { path: 'src/main.c', hash: '1' }, { path: 'res/old.png', hash: '1' }, { path: 'src/generated/game_version.h', hash: '1' }],
  [{ path: 'maps/a.tmx', hash: '2' }, { path: 'src/main.c', hash: '1' }, { path: 'res/new.png', hash: '1' }, { path: 'src/generated/game_version.h', hash: '2' }])
assert.deepEqual(diff, { added: ['res/new.png'], removed: ['res/old.png'], changed: ['maps/a.tmx'] })
assert.deepEqual(summarizeFiles(diff), { recursos: 2, mapas: 1 })
assert.match(parseManifest('{').problem, /JSON/)
assert.match(parseManifest('{"format":"retro-studio.releases","version":7,"releases":[]}').problem, /mais nova/)

// Projeto de teste com git; o build é falso e devolve uma ROM com o cabeçalho.
const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'retro-releases-')))
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
try {
  for (const dir of ['src', 'maps', 'res', 'out']) fs.mkdirSync(path.join(project, dir))
  fs.writeFileSync(path.join(project, 'retro-studio.json'), JSON.stringify({ name: 'Jogo Teste' }))
  fs.writeFileSync(path.join(project, 'src/main.c'), 'int main(void){return 0;}\n')
  fs.writeFileSync(path.join(project, 'maps/fase1.tmx'), '<map/>\n')
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'primeiro')
  let builds = 0, fail = false
  const runBuild = async (dir, options) => {
    builds++
    assert.deepEqual(options, { clean: true, flavor: 'release' }, 'build limpo de release')
    assert.match(fs.readFileSync(path.join(dir, 'src/generated/game_version.h'), 'utf8'), /#define GAME_VERSION "/, 'o header da versão entra antes do build')
    if (fail) return { success: false, errors: [{ file: 'src/main.c', line: 3, message: 'erro de teste' }] }
    fs.writeFileSync(path.join(dir, 'out/rom.bin'), rom)
    return { success: true, romPath: path.join(dir, 'out/rom.bin'), flavor: 'release' }
  }
  const progress = []
  await assert.rejects(createRelease(project, { version: '1.0', changes: 'x' }, { runBuild }), /Versão inválida/)
  await assert.rejects(createRelease(project, { version: '0.1.0', changes: '' }, { runBuild }), /Escreva o que mudou/)
  assert.equal(builds, 0)

  const first = await createRelease(project, { version: '0.1.0', title: 'Jogo Teste', changes: 'Primeira fase jogável\n- Pulo duplo', notes: 'Testar a fase 1.' }, { runBuild, onProgress: text => progress.push(text) })
  assert.ok(progress.some(text => /build limpo/.test(text)))
  const file = path.join(project, 'releases/0.1.0/jogo-teste-0.1.0.bin'), bytes = fs.readFileSync(file)
  assert.equal(bytes.toString('ascii', 0x180, 0x18E), 'GM 00000000-01')
  assert.equal(bytes.toString('ascii', 0x120, 0x12A), 'JOGO TESTE')
  assert.equal(first.release.rom.sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(first.release.changes, ['Primeira fase jogável', 'Pulo duplo'])
  assert.equal(first.release.git.commit, git('rev-parse', 'HEAD'))
  assert.deepEqual(first.release.git.commits.map(item => item.subject), ['primeiro'])
  assert.equal(first.release.files.first, true)
  assert.equal(fs.readFileSync(path.join(project, 'releases/.gitignore'), 'utf8').includes('*.bin'), true, 'ROMs fora do git')
  assert.match(fs.readFileSync(path.join(project, 'releases/0.1.0/LEIA-ME.txt'), 'utf8'), /Jogo Teste — versão 0\.1\.0[\s\S]*- Primeira fase jogável[\s\S]*Testar a fase 1\./)
  assert.match(fs.readFileSync(path.join(project, 'src/generated/game_version.h'), 'utf8'), /GAME_RELEASE_NUMBER 1/)

  // Segunda versão: mapa alterado, recurso novo e dois commits desde a primeira.
  fs.writeFileSync(path.join(project, 'maps/fase1.tmx'), '<map width="2"/>\n'); git('add', '.'); git('commit', '-qm', 'gravidade na rampa')
  fs.writeFileSync(path.join(project, 'res/agua.png'), 'png'); git('add', '.'); git('commit', '-qm', 'água do lago')
  fs.writeFileSync(path.join(project, 'src/main.c'), 'int main(void){return 1;}\n') // sem commit
  await assert.rejects(createRelease(project, { version: '0.1.0', changes: 'x' }, { runBuild }), /já existe/)
  const second = await createRelease(project, { version: '0.2.0', changes: ['Rampa sem trocar a gravidade', 'Água com correnteza'] }, { runBuild })
  assert.equal(second.release.number, 2)
  assert.deepEqual(second.release.git.commits.map(item => item.subject), ['água do lago', 'gravidade na rampa'])
  assert.equal(second.release.git.dirty, true)
  assert.deepEqual(second.release.files.changed, ['maps/fase1.tmx', 'src/main.c'])
  assert.deepEqual(second.release.files.added, ['res/agua.png'])
  assert.equal(fs.readFileSync(path.join(project, 'releases/0.2.0/jogo-teste-0.2.0.bin')).toString('ascii', 0x180, 0x18E), 'GM 00000000-02')
  const changelog = fs.readFileSync(path.join(project, 'releases/CHANGELOG.md'), 'utf8')
  assert.ok(changelog.indexOf('## 0.2.0') < changelog.indexOf('## 0.1.0'), 'mais nova primeiro')
  assert.match(changelog, /- Rampa sem trocar a gravidade[\s\S]*com alterações não commitadas[\s\S]*mapas: 1[\s\S]*água do lago/)

  // Build que falha: nada registrado.
  fail = true
  await assert.rejects(createRelease(project, { version: '0.3.0', changes: 'x' }, { runBuild }), /O build falhou[\s\S]*src\/main\.c:3 erro de teste/)
  fail = false
  const status = releasesStatus(project)
  assert.deepEqual([status.game, status.next, status.title, status.releases.map(item => item.version)], ['Jogo Teste', '0.2.1', 'Jogo Teste', ['0.2.0', '0.1.0']])
  assert.ok(!fs.existsSync(path.join(project, 'releases/0.3.0')))
  assert.throws(() => readRelease(project, '9.9.9'), /não existe/)

  // IA: listar, ler e gerar (sem versão, usa a próxima sugerida).
  const context = { workspace: project, webContents: null }
  const list = (await runControlCommand('release_list', {}, context, { runBuild })).data
  assert.deepEqual(list.releases.map(item => item.version), ['0.2.0', '0.1.0'])
  assert.deepEqual(list.releases[0].areas, { mapas: 1, código: 1, recursos: 1 })
  assert.equal((await runControlCommand('release_read', { version: '0.1.0' }, context, { runBuild })).data.notes, 'Testar a fase 1.')
  await assert.rejects(runControlCommand('release_read', { version: '7.0.0' }, context, { runBuild }), /não existe/)
  const made = (await runControlCommand('release_create', { changes: ['Ajuste pela IA'] }, context, { runBuild })).data
  assert.equal(made.version, '0.2.1')
  await assert.rejects(runControlCommand('release_create', { changes: [] }, context, { runBuild }), /Escreva o que mudou/)
} finally { fs.rmSync(project, { recursive: true, force: true }) }

// Tela do modo Rodar, IPC e locales.
const run = read('src/components/retro/RunWorkspace.vue'), panel = read('src/components/retro/RomReleases.vue'), main = read('electron/main.js'), preload = read('electron/preload.cjs')
assert.match(run, /<RomReleases :project-path="projectPath"/)
assert.match(run, /releaseBuilding\.value\)/, 'os outros botões esperam a versão')
assert.match(panel, /window\.retroStudio\.retro\.createRelease\(/)
for (const channel of ['retro:releases-status', 'retro:release-create', 'retro:release-show']) { assert.ok(main.includes(`'${channel}'`), channel); assert.ok(preload.includes(`'${channel}'`), channel) }
for (const locale of ['pt-BR', 'en', 'es', 'ja']) assert.ok(JSON.parse(read(`src/locales/${locale}.json`)).romReleases?.create, locale)
console.log('ROM releases: numeração, cabeçalho (revisão, título, checksum), registro, changelog, git, arquivos alterados, header da versão, comandos da IA e tela passaram.')
