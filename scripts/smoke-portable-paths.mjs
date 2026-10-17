// #42: referências guardadas em arquivos de projeto valem depois de mover o projeto de lugar.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { toPortablePath, fromPortablePath, samePortablePath, portableCandidates, isAbsolutePath } from '../shared/retro/portablePath.js'
import { sameCharsetOwner } from '../shared/retro/charsetSources.js'

assert.equal(toPortablePath('/home/ana/jogo', '/home/ana/jogo/art/heroi.png'), 'art/heroi.png')
assert.equal(toPortablePath('/home/ana/jogo/', '/home/ana/jogo/art/heroi.png'), 'art/heroi.png')
assert.equal(toPortablePath('C:\\Jogos\\Meu Jogo', 'c:\\jogos\\meu jogo\\res\\Herói.png'), 'res/Herói.png')
// Fora do projeto não há como ser portátil: o caminho absoluto é mantido, nunca "../".
assert.equal(toPortablePath('/home/ana/jogo', '/home/ana/arte/heroi.png'), '/home/ana/arte/heroi.png')
assert.equal(toPortablePath('/home/ana/jogo', '/home/ana/jogo-2/heroi.png'), '/home/ana/jogo-2/heroi.png')
assert.equal(toPortablePath('/home/ana/jogo', 'art/./heroi.png'), 'art/heroi.png')
assert.equal(toPortablePath('/home/ana/jogo', ''), '')
// Abrir em outra máquina: o relativo acompanha a raiz atual.
assert.equal(fromPortablePath('/mnt/bia/copia', 'art/heroi.png'), '/mnt/bia/copia/art/heroi.png')
assert.equal(fromPortablePath('D:/copia', 'art\\heroi.png'), 'D:/copia/art/heroi.png')
assert.equal(fromPortablePath('/mnt/bia/copia', '/home/ana/arte/heroi.png'), '/home/ana/arte/heroi.png')
assert.equal(fromPortablePath('/mnt/bia/copia', '../fora.png'), '', 'um relativo nunca sobe acima do projeto')
assert.equal(fromPortablePath('/mnt/bia/copia', 'a/../../fora.png'), '')
assert.equal(fromPortablePath('/mnt/bia/copia', ''), '')
// Projeto antigo (absoluto) e projeto novo (relativo) são reconhecidos como a mesma folha.
assert.ok(samePortablePath('/home/ana/jogo', '/home/ana/jogo/art/heroi.png', 'art/heroi.png'))
assert.ok(samePortablePath('/home/ana/jogo', 'art\\heroi.png', '/home/ana/jogo/art/heroi.png'))
assert.ok(!samePortablePath('/home/ana/jogo', 'art/heroi.png', 'art/vilao.png'))
assert.ok(!samePortablePath('/home/ana/jogo', '', ''))
assert.ok(!samePortablePath('/home/ana/jogo', undefined, 'art/heroi.png'))
assert.ok(isAbsolutePath('C:\\a') && isAbsolutePath('/a') && !isAbsolutePath('a/b'))
// O Charset Maker e a exportação de personagem usam o utilitário em todos os pontos que leem a origem.
const maker = fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue', import.meta.url), 'utf8')
assert.ok(maker.includes("source: { path: toPortablePath(props.projectPath, sourceFile.value?.path || ''), name: sourceFile.value?.name || '' }"))
assert.ok(maker.includes('sources: sheets.value.map'))
assert.ok(maker.includes('for (const candidate of portableCandidates(props.projectPath, source.path).slice(0, 12)) {'))
// Projeto antigo (absoluto) aberto em OUTRA máquina: o final do caminho localiza a folha aqui.
assert.deepEqual(portableCandidates('/home/bia/proj', '/home/ana/proj/res/heroi.png'), ['/home/ana/proj/res/heroi.png', '/home/bia/proj/ana/proj/res/heroi.png', '/home/bia/proj/proj/res/heroi.png', '/home/bia/proj/res/heroi.png'])
assert.deepEqual(portableCandidates('/home/bia/proj', 'res/heroi.png'), ['/home/bia/proj/res/heroi.png'])
assert.deepEqual(portableCandidates('/home/bia/proj', '/home/bia/proj/res/heroi.png'), ['/home/bia/proj/res/heroi.png'])
assert.deepEqual(portableCandidates('/home/bia/proj', ''), [])
assert.ok(samePortablePath('/home/bia/proj', '/home/ana/proj/res/heroi.png', '/home/bia/proj/res/heroi.png'))
assert.ok(samePortablePath('/home/bia/proj', '/home/bia/proj/res/heroi.png', '/home/ana/outro/res/heroi.png'))
assert.ok(!samePortablePath('/home/bia/proj', '/home/ana/proj/res/heroi.png', '/home/bia/proj/res/vilao.png'))
assert.ok(!samePortablePath('/home/bia/proj', '/home/ana/arte/heroi.png', '/home/bia/proj/heroi.png'), 'nome solto, sem pasta, não basta')
// Windows: letras de unidade e caixa não diferenciam o mesmo arquivo.
assert.ok(samePortablePath('C:/Users/Ana/Jogo', 'res/Heroi.png', 'c:\\users\\ana\\jogo\\res\\heroi.png'))
assert.ok(!samePortablePath('/home/ana/jogo', 'res/Heroi.png', '/home/ana/jogo/res/heroi.png'), 'em sistemas que diferenciam caixa, são arquivos distintos')
assert.ok(!/source\?\.path\?\.replace|source\?\.path === /.test(maker), 'comparação direta de caminho de origem voltou')
const exporter = fs.readFileSync(new URL('../electron/retro/characterExport.js', import.meta.url), 'utf8')
assert.ok(exporter.includes('sameCharsetOwner(root, saved, data)'))
assert.ok(sameCharsetOwner('/game', { source:{path:'/game/art/hero.png'} }, { source:{path:'art/hero.png'} }))
assert.ok(sameCharsetOwner('/game', {version:7,characterId:'hero'}, {version:7,characterId:'hero',source:{path:'new.png'}}))
assert.ok(!sameCharsetOwner('/game', {version:7,characterId:'hero'}, {version:7,characterId:'other',source:{path:'new.png'}}))
console.log('Caminhos portáveis: relativos dentro do projeto, absolutos fora, compatibilidade com projetos antigos conferidos.')
