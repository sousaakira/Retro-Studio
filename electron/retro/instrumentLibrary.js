// #89: instrumentos da internet para o compositor. Duas entradas:
// - bibliotecas conhecidas no GitHub (hoje a do Furnace Tracker): a listagem vem numa única chamada à
//   API de árvores (o limite sem login é de 60 por hora) e fica em cache por um dia; cada arquivo é
//   baixado do raw.githubusercontent.com só se estiver na listagem, e guardado pelo hash do Git;
// - um link https colado pela pessoa (sem endereços locais, até 2 MiB, poucos redirecionamentos).
// Aqui só se baixam bytes; quem interpreta é o importador puro (shared/retro/instrumentFormats.js).
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns/promises'

export const INSTRUMENT_LIBRARIES = Object.freeze({
  furnace: {
    name: 'Biblioteca do Furnace Tracker',
    owner: 'tildearrow', repo: 'furnace', ref: 'master', root: 'instruments',
    url: 'https://github.com/tildearrow/furnace/tree/master/instruments',
    credit: 'Instrumentos da comunidade do Furnace Tracker (pasta instruments do repositório tildearrow/furnace).',
    // Pastas com instrumentos do Mega Drive: YM2612 (OPN) e PSG (SN76489).
    folders: { OPN: 'FM · YM2612', uhrwerk: 'FM · série Uhrwerk', SN7: 'PSG · SN76489' }
  }
})
const FORMAT = /\.(tfi|dmp|fui|opni|wopn)$/i
const TREE_TTL = 24 * 3600 * 1000, FILE_LIMIT = 1024 * 1024, URL_LIMIT = 2 * 1024 * 1024, TIMEOUT = 20000

async function download(url, limit, fetchImpl, { redirects = 3, lookup } = {}) {
  let target = new URL(url)
  for (let hop = 0; ; hop++) {
    assertPublicHttps(target)
    await assertResolvesPublic(target.hostname, lookup)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const response = await fetchImpl(target.href, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'RetroStudio', Accept: '*/*' } })
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        if (hop >= redirects) throw new Error('Redirecionamentos demais.')
        target = new URL(response.headers.get('location'), target)
        continue
      }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new Error('O GitHub limitou as consultas por agora (60 por hora sem login). Tente de novo mais tarde.')
      if (!response.ok) throw new Error('O servidor respondeu ' + response.status + '.')
      const declared = Number(response.headers.get('content-length') || 0)
      if (declared > limit) throw new Error('Arquivo grande demais (' + Math.ceil(declared / 1024) + ' KiB).')
      // Lê em pedaços para não confiar só no cabeçalho.
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > limit) { controller.abort(); throw new Error('Arquivo grande demais.') }
        chunks.push(chunk)
      }
      return { bytes: Buffer.concat(chunks.map(chunk => Buffer.from(chunk))), url: target.href }
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('O download demorou demais.')
      throw error
    } finally { clearTimeout(timer) }
  }
}

/** Só https e só endereços públicos: nada de localhost, rede local ou IP privado digitado no link. */
export function assertPublicHttps(target) {
  const url = target instanceof URL ? target : new URL(target)
  if (url.protocol !== 'https:') throw new Error('Use um link https.')
  if (url.username || url.password) throw new Error('Link com usuário e senha não é aceito.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !net.isIP(host)) throw new Error('Endereço local não é aceito.')
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error('Endereço de rede local não é aceito.')
  return url
}
export function isPrivateAddress(address) {
  const host = address.toLowerCase()
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  if (host.startsWith('::ffff:')) return net.isIP(host.slice(7)) === 4 ? isPrivateAddress(host.slice(7)) : true
  return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
}
/** Um nome que resolve para a rede local também é recusado. */
async function assertResolvesPublic(hostname, lookup = dns.lookup) {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return
  const addresses = await lookup(host, { all: true }).catch(() => { throw new Error('Não foi possível encontrar ' + host + '.') })
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new Error('O endereço aponta para a rede local; não é aceito.')
}

export function createInstrumentLibrary({ cacheDir, fetchImpl = globalThis.fetch, now = () => Date.now(), lookup }) {
  const listings = new Map()
  const library = id => {
    const found = Object.hasOwn(INSTRUMENT_LIBRARIES, id) ? INSTRUMENT_LIBRARIES[id] : null
    if (!found) throw new Error('Biblioteca desconhecida.')
    return found
  }
  const treeFile = id => path.join(cacheDir, id + '-tree.json')

  /** Instrumentos da biblioteca (das pastas do Mega Drive), com pasta, categoria e nome. */
  async function list(id, { refresh = false } = {}) {
    const source = library(id)
    let cached = null
    try { cached = JSON.parse(fs.readFileSync(treeFile(id), 'utf8')) } catch {}
    let tree = cached?.tree, fetchedAt = cached?.fetchedAt || 0, stale = false
    if (!Array.isArray(tree) || refresh || now() - fetchedAt > TREE_TTL) {
      try {
        const api = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.ref}:${source.root}?recursive=1`
        const { bytes } = await download(api, 8 * 1024 * 1024, fetchImpl, { lookup })
        const data = JSON.parse(bytes.toString('utf8'))
        if (!Array.isArray(data.tree)) throw new Error('Resposta inesperada do GitHub.')
        tree = data.tree.filter(entry => entry?.type === 'blob' && typeof entry.path === 'string' && typeof entry.sha === 'string').map(entry => ({ path: entry.path, sha: entry.sha, size: entry.size || 0 }))
        fetchedAt = now()
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(treeFile(id), JSON.stringify({ fetchedAt, tree }))
      } catch (error) {
        // Sem internet (ou limite do GitHub): usa a listagem antiga, se houver.
        if (!Array.isArray(tree)) throw error
        stale = true
      }
    }
    // "(OPM)" no nome: patch do YM2151 (arcade), outro chip.
    const entries = tree.filter(entry => FORMAT.test(entry.path) && entry.size <= FILE_LIMIT && Object.hasOwn(source.folders, entry.path.split('/')[0]) && !/\(OPM\)/i.test(entry.path)).map(entry => {
      const parts = entry.path.split('/'), file = parts[parts.length - 1]
      return { path: entry.path, sha: entry.sha, size: entry.size, folder: parts[0], category: parts.length > 2 ? parts.slice(1, -1).join('/') : '', name: file.replace(FORMAT, ''), format: file.match(FORMAT)[1].toLowerCase() }
    }).sort((a, b) => a.folder.localeCompare(b.folder) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    listings.set(id, new Map(entries.map(entry => [entry.path, entry])))
    return { library: { id, name: source.name, url: source.url, credit: source.credit, folders: source.folders }, entries, fetchedAt, stale }
  }

  /** Bytes de um arquivo da listagem (só caminhos que a listagem trouxe). */
  async function file(id, filePath) {
    const source = library(id)
    if (!listings.has(id)) await list(id)
    const entry = listings.get(id).get(filePath)
    if (!entry || !/^[0-9a-f]{40}$/.test(entry.sha)) throw new Error('Instrumento fora da biblioteca.')
    const cached = path.join(cacheDir, id, entry.sha)
    try { return { name: path.basename(filePath), path: filePath, bytes: new Uint8Array(fs.readFileSync(cached)) } } catch {}
    const raw = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${[source.root, ...filePath.split('/')].map(encodeURIComponent).join('/')}`
    const { bytes } = await download(raw, FILE_LIMIT, fetchImpl, { redirects: 0, lookup })
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, bytes)
    return { name: path.basename(filePath), path: filePath, bytes: new Uint8Array(bytes) }
  }

  /** Bytes de um link https colado pela pessoa. */
  async function fromUrl(link) {
    if (typeof link !== 'string' || link.length > 2048) throw new Error('Link inválido.')
    let url
    try { url = new URL(link.trim()) } catch { throw new Error('Link inválido.') }
    const { bytes, url: final } = await download(url.href, URL_LIMIT, fetchImpl, { lookup })
    const name = decodeURIComponent(new URL(final).pathname.split('/').pop() || 'instrumento')
    return { name, url: final, bytes: new Uint8Array(bytes) }
  }

  return { list, file, fromUrl }
}
