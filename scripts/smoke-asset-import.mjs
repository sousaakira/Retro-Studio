// #42: importar não sobrescreve conteúdo diferente, não acumula cópias e registra a origem.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importProjectAsset, registerResourceEntry, readAssetOrigins, ASSET_ORIGINS_PATH } from '../electron/retro/assetImport.js'
import { mergeUnpackedAssets } from '../electron/retro/assetMerge.js'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-asset-import-'))
try {
  const root = path.join(temporary, 'game'), outside = path.join(temporary, 'arte da Ana')
  fs.mkdirSync(root); fs.mkdirSync(outside)
  fs.writeFileSync(path.join(root, 'retro-studio.json'), JSON.stringify({ name: 'game', custom: { keep: true } }))
  const hero = path.join(outside, 'herói.png'), files = () => fs.readdirSync(path.join(root, 'res')).sort()
  fs.writeFileSync(hero, 'PNG-HERO-1')
  const first = importProjectAsset(root, hero, { type: 'sprite' })
  assert.deepEqual({ ...first, hash: undefined }, { success: true, assetPath: 'res/herói.png', hash: undefined, reused: false, renamed: false, registered: true, symbol: 'HER_I' })
  assert.equal(fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8'), 'IMAGE HER_I "herói.png" 0\n')
  // Reimportar o mesmo arquivo: nada novo no disco, mesma resposta estável.
  const before = fs.statSync(path.join(root, 'res/herói.png')).mtimeMs
  const again = importProjectAsset(root, hero, { type: 'sprite' })
  assert.equal(again.assetPath, 'res/herói.png'); assert.equal(again.reused, true)
  assert.equal(fs.statSync(path.join(root, 'res/herói.png')).mtimeMs, before)
  assert.deepEqual(files(), ['herói.png', 'resources.res'])
  assert.equal(readAssetOrigins(root).assets.length, 1)
  // Mesmo conteúdo com outro nome: reaproveita o arquivo existente em vez de duplicar.
  const copy = path.join(outside, 'cópia.png'); fs.writeFileSync(copy, 'PNG-HERO-1')
  const duplicate = importProjectAsset(root, copy, { type: 'sprite' })
  assert.equal(duplicate.assetPath, 'res/herói.png'); assert.equal(duplicate.reused, true)
  assert.deepEqual(files(), ['herói.png', 'resources.res'])
  // Mesmo nome, conteúdo diferente: o existente é preservado e o novo ganha nome estável pelo conteúdo.
  const otherDirectory = path.join(temporary, 'outra pasta'); fs.mkdirSync(otherDirectory)
  const other = path.join(otherDirectory, 'herói.png'); fs.writeFileSync(other, 'PNG-HERO-2')
  const renamed = importProjectAsset(root, other, { type: 'sprite' })
  assert.match(renamed.assetPath, /^res\/herói-[a-f0-9]{8}\.png$/); assert.equal(renamed.renamed, true)
  assert.equal(fs.readFileSync(path.join(root, 'res/herói.png'), 'utf8'), 'PNG-HERO-1', 'o original importado antes foi preservado')
  assert.equal(fs.readFileSync(path.join(root, renamed.assetPath), 'utf8'), 'PNG-HERO-2')
  assert.match(renamed.symbol, /^HER_I_[A-F0-9]{8}$/)
  const count = files().length
  for (let i = 0; i < 3; i++) assert.equal(importProjectAsset(root, other, { type: 'sprite' }).assetPath, renamed.assetPath)
  assert.equal(files().length, count, 'reimportar três vezes não acumulou arquivos')
  assert.equal(fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8').trim().split('\n').length, 2, 'nem linhas repetidas no .res')
  // Origem registrada sem caminho absoluto: o registro vale em outra máquina.
  const origins = fs.readFileSync(path.join(root, ASSET_ORIGINS_PATH), 'utf8')
  assert.deepEqual(readAssetOrigins(root).assets.map(entry => [entry.path, entry.sourceName]), [['res/herói.png', 'herói.png'], [renamed.assetPath, 'herói.png']])
  assert.ok(!origins.includes(temporary) && !origins.includes('arte da Ana') && !origins.includes(os.userInfo().username + '/'))
  assert.ok(!fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8').includes(temporary))
  // Áudio: WAV vira linha do driver; formato só de prévia entra sem linha (rescomp não tem SOUND).
  const wav = path.join(outside, 'jump.wav'); fs.writeFileSync(wav, 'RIFF-fixture')
  assert.match(fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8') + (importProjectAsset(root, wav, { type: 'sound' }).symbol), /JUMP$/)
  assert.match(fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8'), /^WAV JUMP "jump\.wav" /m)
  const ogg = path.join(outside, 'tema.ogg'); fs.writeFileSync(ogg, 'OggS-fixture')
  assert.deepEqual([importProjectAsset(root, ogg, { type: 'sound' })].map(r => [r.assetPath, r.registered, r.symbol]), [['res/tema.ogg', false, null]])
  assert.ok(!fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8').includes('tema.ogg'))
  // Símbolo já usado por outro arquivo: o símbolo novo é desambiguado, a linha antiga fica.
  fs.appendFileSync(path.join(root, 'res/resources.res'), 'PALETTE CORES "manual.pal"\n')
  const palette = path.join(outside, 'cores.pal'); fs.writeFileSync(palette, 'PAL')
  assert.match(importProjectAsset(root, palette, { type: 'palette' }).symbol, /^CORES_[A-F0-9]{8}$/)
  assert.match(fs.readFileSync(path.join(root, 'res/resources.res'), 'utf8'), /^PALETTE CORES "manual\.pal"$/m)
  // Recusas: nada é escrito.
  const snapshot = files().join()
  assert.throws(() => importProjectAsset(root, 'relativo.png'), /origem inválido/)
  assert.throws(() => importProjectAsset(root, outside), /arquivo comum/)
  assert.throws(() => importProjectAsset(root, path.join(outside, 'ausente.png')), /ENOENT/)
  fs.writeFileSync(path.join(outside, '.oculto.png'), 'x'); assert.throws(() => importProjectAsset(root, path.join(outside, '.oculto.png')), /não suportado/)
  const big = path.join(outside, 'grande.png'); fs.writeFileSync(big, Buffer.alloc(30 * 1024 * 1024 + 1)); assert.throws(() => importProjectAsset(root, big), /30 MiB/)
  assert.equal(files().join(), snapshot)
  // Revisão da #42 -------------------------------------------------------------------------
  // Nome com aspas (quebraria a linha do .res) ou inválido no Windows é recusado antes de qualquer escrita.
  for (const bad of ['he"ro.png', 'a:b.png', 'a?.png', 'a*.png', 'a|b.png', 'a<b>.png']) {
    fs.writeFileSync(path.join(outside, bad), 'x')
    assert.throws(() => importProjectAsset(root, path.join(outside, bad), { type: 'sprite' }), /não suportado/, bad)
  }
  assert.equal(files().join(), snapshot)
  // Arquivo já declarado com "./" ou em .res com CRLF: nenhuma linha nova, símbolo existente devolvido, EOL preservado.
  const crlf = path.join(temporary, 'crlf'); fs.mkdirSync(path.join(crlf, 'res'), { recursive: true })
  fs.writeFileSync(path.join(crlf, 'res', 'resources.res'), 'IMAGE MEU_HEROI "./herói.png" 0\r\nPALETTE P "p.pal"\r\n')
  const declaredAgain = importProjectAsset(crlf, hero, { type: 'sprite' })
  assert.deepEqual([declaredAgain.symbol, declaredAgain.registered], ['MEU_HEROI', true])
  assert.equal(fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8'), 'IMAGE MEU_HEROI "./herói.png" 0\r\nPALETTE P "p.pal"\r\n')
  importProjectAsset(crlf, wav, { type: 'sound' })
  assert.match(fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8'), /"p\.pal"\r\nWAV JUMP "jump\.wav"[^\n]*\r\n$/)
  assert.ok(!/[^\r]\n/.test(fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8')), 'finais de linha não foram misturados')
  // Registro de linha (arrastar/colar): atualiza a linha do MESMO arquivo, recusa trocar a de outro.
  assert.deepEqual(registerResourceEntry(crlf, 'IMAGE MEU_HEROI "herói.png" BEST'), { symbol: 'MEU_HEROI', file: 'herói.png', updated: true })
  assert.match(fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8'), /^IMAGE MEU_HEROI "herói\.png" BEST\r\n/)
  const beforeRefusal = fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8')
  assert.throws(() => registerResourceEntry(crlf, 'IMAGE MEU_HEROI "herói.gif" 0'), /já pertence a "herói\.png"/)
  assert.throws(() => registerResourceEntry(crlf, 'IMAGE X "a.png" 0\nIMAGE Y "b.png" 0'), /inválida/)
  assert.throws(() => registerResourceEntry(crlf, 'qualquer coisa'), /inválida/)
  assert.equal(fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8'), beforeRefusal)
  assert.equal(registerResourceEntry(crlf, 'SPRITE NOVO "novo.png" 2 2 FAST 4').updated, false)
  assert.match(fs.readFileSync(path.join(crlf, 'res', 'resources.res'), 'utf8'), /\r\nSPRITE NOVO "novo\.png" 2 2 FAST 4\r\n$/)
  // Pasta de recursos escondida ou de ferramenta (.git/hooks, .retrostudio) é recusada.
  for (const folder of ['.git/hooks', '.retrostudio', 'res/.cache']) {
    const hidden = path.join(temporary, 'hidden-' + folder.replace(/\W/g, '')); fs.mkdirSync(hidden)
    fs.writeFileSync(path.join(hidden, 'retro-studio.json'), JSON.stringify({ resourcePath: folder }))
    assert.throws(() => importProjectAsset(hidden, hero), /inside the project/, folder)
    assert.deepEqual(fs.readdirSync(hidden), ['retro-studio.json'])
  }
  // Origens de arquivos que não existem mais saem do registro na próxima importação.
  const pruned = path.join(temporary, 'pruned'); fs.mkdirSync(pruned)
  importProjectAsset(pruned, hero); importProjectAsset(pruned, wav, { type: 'sound' })
  fs.rmSync(path.join(pruned, 'res', 'herói.png'))
  importProjectAsset(pruned, palette, { type: 'palette' })
  assert.deepEqual(readAssetOrigins(pruned).assets.map(entry => entry.path), ['res/jump.wav', 'res/cores.pal'])
  // Pacote da loja: mescla sem substituir; conflitos são devolvidos e o arquivo do projeto fica.
  const unpacked = path.join(temporary, 'unpacked'), store = path.join(temporary, 'store', 'res')
  fs.mkdirSync(path.join(unpacked, 'sub'), { recursive: true }); fs.mkdirSync(store, { recursive: true })
  fs.writeFileSync(path.join(unpacked, 'novo.png'), 'N'); fs.writeFileSync(path.join(unpacked, 'igual.png'), 'I'); fs.writeFileSync(path.join(unpacked, 'meu.png'), 'DA LOJA'); fs.writeFileSync(path.join(unpacked, 'sub', 'x.png'), 'X')
  fs.symlinkSync(hero, path.join(unpacked, 'link.png'))
  fs.writeFileSync(path.join(store, 'igual.png'), 'I'); fs.writeFileSync(path.join(store, 'meu.png'), 'DO PROJETO')
  assert.deepEqual(await mergeUnpackedAssets(unpacked, store), { added: ['novo.png', 'sub/x.png'], unchanged: ['igual.png'], conflicts: ['meu.png'] })
  assert.equal(fs.readFileSync(path.join(store, 'meu.png'), 'utf8'), 'DO PROJETO'); assert.ok(!fs.existsSync(path.join(store, 'link.png')))
  const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8')
  assert.ok(main.includes('return await mergeUnpackedAssets(unpacked, resDir)') && !main.includes('await extract(tmpZip, { dir: resDir })'))
  assert.ok(main.includes("if (existsSync(targetPath) && options?.replace !== true) {"), 'arrastar para a árvore não substitui conteúdo diferente')
  // Pasta de recursos fora do projeto ou via symlink é recusada.
  const escape = path.join(temporary, 'escape'); fs.mkdirSync(escape)
  fs.writeFileSync(path.join(escape, 'retro-studio.json'), JSON.stringify({ resourcePath: '../fora' }))
  assert.throws(() => importProjectAsset(escape, hero), /inside the project/)
  const linked = path.join(temporary, 'linked'); fs.mkdirSync(linked); fs.mkdirSync(path.join(temporary, 'alvo'))
  fs.symlinkSync(path.join(temporary, 'alvo'), path.join(linked, 'res'))
  assert.throws(() => importProjectAsset(linked, hero))
  assert.deepEqual(fs.readdirSync(path.join(temporary, 'alvo')), [])
  // Registro de origens adulterado não é reescrito por cima.
  fs.writeFileSync(path.join(root, ASSET_ORIGINS_PATH), JSON.stringify({ version: 1, assets: [{ path: '../x', hash: 'a', size: 1, sourceName: 'a', importedAt: '' }] }))
  const fresh = path.join(outside, 'novo.png'); fs.writeFileSync(fresh, 'PNG-NEW')
  assert.throws(() => importProjectAsset(root, fresh), /Invalid asset origin/)
  assert.ok(!fs.existsSync(path.join(root, 'res/novo.png')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'retro-studio.json'), 'utf8')).custom.keep, true)
  const project = fs.readFileSync(new URL('../electron/retro/project.js', import.meta.url), 'utf8')
  assert.ok(project.includes("try { return importProjectAsset(projectPath, assetPath, { type: typeof asset?.type === 'string' ? asset.type : '' }) }"))
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
console.log('Importação de recursos: sem sobrescrita, reaproveitamento por conteúdo, nomes estáveis, origem portátil e recusas conferidos.')
