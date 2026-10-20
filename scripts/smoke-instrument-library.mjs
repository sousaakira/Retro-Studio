// #89: instrumentos da internet — listagem da biblioteca (uma chamada, cache de um dia), download só de
// arquivos listados, links https públicos, sem rede local nem arquivos grandes. Sem internet: fetch e DNS falsos.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInstrumentLibrary, assertPublicHttps, isPrivateAddress } from '../electron/retro/instrumentLibrary.js'

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-ins-lib-'))
const sha = n => String(n).repeat(40).slice(0, 40)
const tree = { tree: [
  { type: 'blob', path: 'OPN/bass/Slap.dmp', sha: sha(1), size: 51 },
  { type: 'blob', path: 'OPN/keys/E.Piano.fui', sha: sha(2), size: 90 },
  { type: 'blob', path: 'OPN/readme.txt', sha: sha(3), size: 10 },
  { type: 'blob', path: 'OPL/bass.fui', sha: sha(4), size: 80 },
  { type: 'blob', path: 'SN7/Hat.dmp', sha: sha(5), size: 30 },
  { type: 'blob', path: 'uhrwerk/R1.dmp', sha: sha(6), size: 51 },
  { type: 'blob', path: 'OPN/huge.tfi', sha: sha(7), size: 5 * 1024 * 1024 },
  { type: 'tree', path: 'OPN/bass', sha: sha(8) }
] }
const calls = []
const response = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: (async function* () { if (body) yield Buffer.from(body) })() })
let routes = {}
const fetchImpl = async url => { calls.push(url); const route = routes[url]; if (!route) return response(404, ''); return typeof route === 'function' ? route() : route }
const publicDns = async () => [{ address: '185.199.108.133', family: 4 }]
let clock = 1_000_000
const api = 'https://api.github.com/repos/tildearrow/furnace/git/trees/master:instruments?recursive=1'
routes[api] = () => response(200, JSON.stringify(tree))
try {
  const library = createInstrumentLibrary({ cacheDir, fetchImpl, now: () => clock, lookup: publicDns })
  const listed = await library.list('furnace')
  assert.deepEqual(listed.entries.map(entry => entry.path), ['OPN/bass/Slap.dmp', 'OPN/keys/E.Piano.fui', 'SN7/Hat.dmp', 'uhrwerk/R1.dmp'], 'only Mega Drive folders, supported formats, not too big')
  assert.deepEqual(listed.entries[0], { path: 'OPN/bass/Slap.dmp', sha: sha(1), size: 51, folder: 'OPN', category: 'bass', name: 'Slap', format: 'dmp' })
  assert.match(listed.library.credit, /Furnace/)

  // Cache de um dia: a segunda listagem não chama a API; depois de um dia, chama.
  await library.list('furnace'); assert.equal(calls.filter(url => url === api).length, 1)
  clock += 25 * 3600 * 1000; await library.list('furnace'); assert.equal(calls.filter(url => url === api).length, 2)
  // Sem internet (ou limite do GitHub): fica a listagem antiga, avisando.
  routes[api] = () => response(403, '', { 'x-ratelimit-remaining': '0' })
  clock += 25 * 3600 * 1000
  const stale = await library.list('furnace'); assert.equal(stale.stale, true); assert.equal(stale.entries.length, 4)
  const fresh = createInstrumentLibrary({ cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'retro-ins-lib-')), fetchImpl, lookup: publicDns })
  await assert.rejects(fresh.list('furnace'), /60 por hora/)
  await assert.rejects(library.list('outra'), /Biblioteca desconhecida/)

  // Arquivo: só da listagem, guardado pelo hash do Git (o segundo pedido não baixa de novo).
  const raw = 'https://raw.githubusercontent.com/tildearrow/furnace/master/instruments/OPN/keys/E.Piano.fui'
  routes[raw] = () => response(200, 'FINS-bytes')
  const first = await library.file('furnace', 'OPN/keys/E.Piano.fui')
  assert.equal(Buffer.from(first.bytes).toString(), 'FINS-bytes'); assert.equal(first.name, 'E.Piano.fui')
  await library.file('furnace', 'OPN/keys/E.Piano.fui'); assert.equal(calls.filter(url => url === raw).length, 1)
  await assert.rejects(library.file('furnace', '../../etc/passwd'), /fora da biblioteca/)
  await assert.rejects(library.file('furnace', 'OPL/bass.fui'), /fora da biblioteca/)
  routes['https://raw.githubusercontent.com/tildearrow/furnace/master/instruments/SN7/Hat.dmp'] = () => response(200, 'x'.repeat(2 * 1024 * 1024))
  await assert.rejects(library.file('furnace', 'SN7/Hat.dmp'), /grande demais/)

  // Link colado: https público, redirecionamento só para https, até 2 MiB.
  routes['https://exemplo.com/sons/Baixo%20FM.tfi'] = () => response(200, 'tfi')
  const pasted = await library.fromUrl('https://exemplo.com/sons/Baixo%20FM.tfi')
  assert.equal(pasted.name, 'Baixo FM.tfi')
  await assert.rejects(library.fromUrl('http://exemplo.com/a.tfi'), /https/)
  await assert.rejects(library.fromUrl('https://localhost/a.tfi'), /local/)
  await assert.rejects(library.fromUrl('https://192.168.0.10/a.tfi'), /rede local/)
  await assert.rejects(library.fromUrl('https://usuario:senha@exemplo.com/a.tfi'), /usuário e senha/)
  await assert.rejects(library.fromUrl('não é link'), /Link inválido/)
  routes['https://exemplo.com/vai'] = () => response(302, '', { location: 'http://exemplo.com/a.tfi' })
  await assert.rejects(library.fromUrl('https://exemplo.com/vai'), /https/, 'a redirect to http is refused')
  routes['https://exemplo.com/grande.wopn'] = () => response(200, '', { 'content-length': String(3 * 1024 * 1024) })
  await assert.rejects(library.fromUrl('https://exemplo.com/grande.wopn'), /grande demais/)
  const rebinding = createInstrumentLibrary({ cacheDir, fetchImpl, lookup: async () => [{ address: '10.0.0.5', family: 4 }] })
  await assert.rejects(rebinding.fromUrl('https://exemplo.com/sons/Baixo%20FM.tfi'), /rede local/, 'a public name resolving to a LAN address is refused')

  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) assert.ok(isPrivateAddress(address), address)
  for (const address of ['185.199.108.133', '8.8.8.8', '2606:4700::1111']) assert.ok(!isPrivateAddress(address), address)
  assert.throws(() => assertPublicHttps('https://intranet/a.tfi'), /local/)
} finally { fs.rmSync(cacheDir, { recursive: true, force: true }) }
console.log('instrument-library smoke passed: listing, cache, offline fallback, listed files only, https links, LAN and size limits.')
