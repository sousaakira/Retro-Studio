import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeProjectAsset, assetContentHash } from '../electron/retro/projectAssets.js'
import { inspectProjectAssets } from '../electron/retro/assetReport.js'
import { importProjectAsset } from '../electron/retro/assetImport.js'
import { planAssetQuarantine } from '../electron/retro/assetQuarantine.js'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-asset-report-'))
try {
  const root = path.join(temporary, 'game')
  fs.mkdirSync(path.join(root, 'res', 'generated'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'charsets'))
  fs.writeFileSync(path.join(root, 'res', 'ninja.png'), 'fixture')
  fs.writeFileSync(path.join(root, 'res', 'copy.png'), 'fixture')
  fs.writeFileSync(path.join(root, 'res', 'unused.png'), 'different')
  fs.writeFileSync(path.join(root, 'res', 'resources.res'), 'SPRITE SPR_NINJA "ninja.png" 4 6 NONE\n')
  fs.writeFileSync(path.join(root, 'src', 'main.c'), 'void init(){SPR_addSprite(&SPR_NINJA,0,0,0);}')
  fs.writeFileSync(path.join(root, 'charsets', 'ninja.charset.json'), JSON.stringify({ source: { path: path.join(root,'res','ninja.png') } }))
  fs.writeFileSync(path.join(root, 'retro-studio.json'), JSON.stringify({ assets: [{path:'res/unused.png'}], secret:'DO_NOT_RETURN'}))
  fs.writeFileSync(path.join(root, 'res', 'generated', 'map-manifest.json'), '{"output":"res/unused.png"}')
  fs.writeFileSync(path.join(root, 'tool.py'), 'open(input())')
  fs.symlinkSync(temporary, path.join(root, 'external'))
  for (let i=0;i<15;i++) fs.writeFileSync(path.join(root,'res','duplicate-'+i+'.png'),'fixture')
  const ownedBytes = Buffer.from('owned atlas')
  const owned = writeProjectAsset(root, 'res', 'generated/raster-' + assetContentHash(ownedBytes) + '.png', ownedBytes)
  const report = inspectProjectAssets(root)
  assert.equal(report.assets.find(item => item.path === owned.assetPath).ownership, 'verified')
  assert.equal(report.exportRecovery.pending, false)
  assert.equal(report.assets.find(item => item.path === 'res/ninja.png').ownership, 'untracked')
  fs.writeFileSync(path.join(root, owned.assetPath), 'changed atlas')
  assert.equal(inspectProjectAssets(root).assets.find(item => item.path === owned.assetPath).ownership, 'modified-or-unverified')
  const ninja = report.assets.find(item => item.path === 'res/ninja.png')
  assert.deepEqual(ninja.references, ['charsets/ninja.charset.json','res/resources.res','src/main.c'])
  assert.ok(ninja.duplicates.includes('res/copy.png'))
  assert.equal(ninja.duplicateCount, 16)
  assert.ok(report.assets.every(item=>item.duplicates.length<=8))
  assert.equal(report.assets.find(item => item.path === 'res/unused.png').status, 'unverified')
  assert.ok(report.dynamicSources.includes('tool.py'))
  assert.ok(report.skipped.includes('external'))
  assert.ok(report.assets.every(item => item.cleanupEligible === false))
  assert.ok(!JSON.stringify(report).includes('DO_NOT_RETURN'))
  assert.equal(fs.readFileSync(path.join(root, 'res', 'unused.png'), 'utf8'), 'different')
  // #42: papel, dono, origem e destino na limpeza de cada arquivo.
  const find = (result, file) => result.assets.find(item => item.path === file)
  assert.deepEqual([ninja.role, ninja.protected, ninja.disposal, ninja.origin], ['charset-source', true, 'never', { kind: 'charset-sheet', project: 'charsets/ninja.charset.json' }])
  assert.deepEqual([find(report, 'res/unused.png').role, find(report, 'res/unused.png').disposal, find(report, 'res/unused.png').origin], ['original', 'never', null])
  const atlas = find(report, owned.assetPath)
  assert.deepEqual([atlas.role, atlas.owner, atlas.origin.kind, atlas.protected], ['derived', 'raster-import', 'generated', false])
  assert.equal(atlas.disposal, 'manual-review', 'há script no projeto: nada é classificado sozinho como descartável')
  assert.deepEqual(report.portability, [{ file: 'charsets/ninja.charset.json', value: path.join(root, 'res', 'ninja.png'), reason: 'absolute-inside-project' }])
  // Projeto sem scripts nem arquivos pulados: o derivado sem uso vira candidato; todo o resto, não.
  const clean = path.join(temporary, 'clean')
  fs.mkdirSync(path.join(clean, 'res', 'generated'), { recursive: true }); fs.mkdirSync(path.join(clean, 'charsets')); fs.mkdirSync(path.join(clean, '.retrostudio'))
  fs.writeFileSync(path.join(clean, 'retro-studio.json'), '{}')
  const cleanAtlasBytes = Buffer.from('clean atlas'), cleanAtlas = writeProjectAsset(clean, 'res', 'generated/raster-' + assetContentHash(cleanAtlasBytes) + '.png', cleanAtlasBytes)
  const outsideSheet = path.join(temporary, 'sheet.png'); fs.writeFileSync(outsideSheet, 'sheet bytes')
  const imported = importProjectAsset(clean, outsideSheet, { type: 'sprite' })
  fs.writeFileSync(path.join(clean, 'res', 'hero_sprites.png'), 'charset output')
  fs.writeFileSync(path.join(clean, 'res', 'sheet2.png'), 'second sheet')
  fs.writeFileSync(path.join(clean, 'charsets', 'sheet3.png'), 'third sheet')
  fs.writeFileSync(path.join(clean, 'charsets', 'hero.charset.json'), JSON.stringify({ source: { path: 'res/sheet2.png', name: 'sheet2.png' }, sources:[{path:'res/sheet2.png'},{path:'charsets/sheet3.png'}], exportedFileName: 'hero_sprites.png' }))
  fs.writeFileSync(path.join(clean, 'charsets', 'far.charset.json'), JSON.stringify({ source: { path: '/home/ana/arte/far.png', name: 'far.png' } }))
  fs.writeFileSync(path.join(clean, 'res', 'generated', 'world-1-bg.png'), 'world bg')
  fs.writeFileSync(path.join(clean, 'res', 'generated', 'mystery.png'), 'mystery')
  fs.writeFileSync(path.join(clean, '.retrostudio', 'world-map-export.json'), JSON.stringify({ version: 1, files: [{ path: 'res/generated/world-1-bg.png', hash: assetContentHash(Buffer.from('world bg')) }], resources: [] }))
  fs.writeFileSync(path.join(clean, 'kit.json'), JSON.stringify({ image: 'C:\\Users\\Ana\\tiles.png' }))
  const second = inspectProjectAssets(clean)
  assert.equal(find(second,'charsets/sheet3.png').role,'charset-source')
  assert.equal(find(second,'charsets/sheet3.png').protected,true)
  assert.deepEqual([second.dynamicSources, second.skipped, second.originsError], [[], [], ''])
  // Revisão da #42: qualquer arquivo que a leitura não entende impede o veredito automático,
  // e o que ele cita conta como uso. Pastas build/vendor/dist dentro do projeto são lidas.
  const verdict = (file, text) => {
    const target = path.join(clean, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text)
    try { const result = inspectProjectAssets(clean), item = result.assets.find(asset => asset.path === cleanAtlas.assetPath); return [item.disposal, result.dynamicSources.includes(file)] }
    finally { fs.rmSync(target); for (const folder of ['src', 'tools', 'docs']) fs.rmSync(path.join(clean, folder), { recursive: true, force: true }) }
  }
  const atlasName = path.basename(cleanAtlas.assetPath)
  for (const file of ['build.sh', 'CMakeLists.txt', 'makefile', 'GNUmakefile', 'tools/gen.lua', 'res/list.txt', 'src/a.cpp', 'src/level.inc', 'semextensao'])
    assert.deepEqual(verdict(file, 'load("' + atlasName + '")'), ['in-use', true], file + ': citado por arquivo não entendido')
  for (const file of ['build.sh', 'tools/run.bat', 'src/x.inc', 'binario.dat'])
    assert.deepEqual(verdict(file, file === 'binario.dat' ? '\u0000\u0001' : 'echo nada'), ['manual-review', true], file + ': presença basta para exigir revisão manual')
  for (const file of ['src/build/level.c', 'src/vendor/x.c', 'res/dist/extra.res'])
    assert.equal(verdict(file, 'const char *f = "' + atlasName + '";')[0], 'in-use', file + ': pasta com nome de saída dentro do projeto é lida')
  assert.deepEqual(verdict('docs/notas.md', atlasName), ['candidate', false], 'documentação não é dependência')
  assert.throws(() => { fs.writeFileSync(path.join(clean, 'build.sh'), 'x'); try { const plan = planAssetQuarantine(clean, [cleanAtlas.assetPath]); assert.deepEqual(plan.warnings.dynamicSources, ['build.sh']); throw new Error('avisado') } finally { fs.rmSync(path.join(clean, 'build.sh')) } }, /avisado/)
  assert.deepEqual([find(second, cleanAtlas.assetPath).disposal, find(second, cleanAtlas.assetPath).quarantineCandidate], ['candidate', true])
  assert.deepEqual(find(second, imported.assetPath).origin.sourceName, 'sheet.png')
  assert.deepEqual([find(second, imported.assetPath).role, find(second, imported.assetPath).origin.verified, find(second, imported.assetPath).disposal], ['original', true, 'never'])
  assert.deepEqual([find(second, 'res/hero_sprites.png').role, find(second, 'res/hero_sprites.png').owner, find(second, 'res/hero_sprites.png').disposal], ['charset-output', 'character-export', 'never'])
  assert.deepEqual([find(second, 'res/sheet2.png').role, find(second, 'res/sheet2.png').disposal], ['charset-source', 'never'])
  const world = find(second, 'res/generated/world-1-bg.png')
  assert.deepEqual([world.role, world.owner, world.origin.verified, world.ownership, world.disposal, world.quarantineCandidate], ['derived', 'world-map-export', true, 'untracked', 'unknown-owner', false], 'saída de mapa tem dono, mas a quarentena só aceita o que o ledger registra')
  assert.deepEqual([find(second, 'res/generated/mystery.png').role, find(second, 'res/generated/mystery.png').disposal, find(second, 'res/generated/mystery.png').quarantineCandidate], ['generated-unknown', 'unknown-owner', false])
  assert.deepEqual(second.portability.map(entry => [entry.file, entry.reason]).sort(), [['charsets/far.charset.json', 'outside-project'], ['kit.json', 'absolute-path']])
  // Dono só com prova: registro que cita um original, ou com hash que não confere, não torna nada "derivado".
  fs.writeFileSync(path.join(clean, '.retrostudio', 'world-map-export.json'), JSON.stringify({ version: 1, files: [{ path: imported.assetPath, hash: '0'.repeat(64) }, { path: 'res/generated/world-1-bg.png', hash: '0'.repeat(64) }], resources: [] }))
  const forged = inspectProjectAssets(clean)
  assert.deepEqual([find(forged, imported.assetPath).role, find(forged, imported.assetPath).owner, find(forged, imported.assetPath).protected], ['original', null, true])
  assert.deepEqual([find(forged, 'res/generated/world-1-bg.png').role, find(forged, 'res/generated/world-1-bg.png').owner], ['generated-unknown', null])
  // Portabilidade: referência relativa que sai do projeto, absolutos fora das raízes comuns, aspas simples e inventário.
  fs.mkdirSync(path.join(clean, 'maps'))
  fs.writeFileSync(path.join(clean, 'maps', 'a.tmx'), '<map><property name="bg" value="../../fora/bg.png"/><image source=\'/data/art/x.png\'/><image source="../res/sheet2.png"/><property value="/run/media/ana/usb/y.png"/></map>')
  fs.writeFileSync(path.join(clean, 'retro-studio.json'), JSON.stringify({ assets: [{ path: '/home/ana/z.png' }, { path: 'res/sheet2.png' }] }))
  assert.deepEqual(inspectProjectAssets(clean).portability.filter(entry => ['maps/a.tmx', 'retro-studio.json'].includes(entry.file)).map(entry => [entry.file, entry.value, entry.reason]).sort(),
    [['maps/a.tmx', '../../fora/bg.png', 'outside-project'], ['maps/a.tmx', '/data/art/x.png', 'absolute-path'], ['maps/a.tmx', '/run/media/ana/usb/y.png', 'absolute-path'], ['retro-studio.json', '/home/ana/z.png', 'absolute-path']])
  fs.rmSync(path.join(clean, 'maps'), { recursive: true }); fs.writeFileSync(path.join(clean, 'retro-studio.json'), '{}')
  // Limpeza de derivados nunca aceita original, folha ou saída de personagem, nem derivado sem dono no ledger.
  for (const file of [imported.assetPath, 'res/sheet2.png', 'res/hero_sprites.png', 'res/generated/world-1-bg.png', 'res/generated/mystery.png'])
    assert.throws(() => planAssetQuarantine(clean, [file]), /not an owned, verified/, file)
  assert.equal(planAssetQuarantine(clean, [cleanAtlas.assetPath]).assets.length, 1)
  // Importado e depois editado à mão: continua original, mas a origem deixa de conferir.
  fs.writeFileSync(path.join(clean, imported.assetPath), 'edited sheet')
  assert.equal(find(inspectProjectAssets(clean), imported.assetPath).origin.verified, false)
  // Registro de origens ilegível é informado e não concede nada.
  fs.writeFileSync(path.join(clean, '.retrostudio', 'asset-origins.json'), '{')
  const broken = inspectProjectAssets(clean)
  assert.ok(broken.originsError); assert.equal(find(broken, imported.assetPath).origin, null)
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
console.log('Relatório de assets: referências, duplicatas, papel/dono/origem, destino na limpeza, portabilidade e originais conferidos.')
