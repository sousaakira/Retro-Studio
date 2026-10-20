// #90: importação de imagem como mapa. Cópias espelhadas de um tile viram o mesmo tile, com o
// espelhamento na célula (como o console guarda); mais de 2048 tiles diferentes são aceitos (o
// jogo carrega por streaming); o tamanho do mapa vale por lado e pela área.
import assert from 'node:assert/strict'
import { rasterToTilemap, mapSizeFits, MAX_MAP_SIDE, MAX_MAP_CELLS } from '../src/utils/retro/rasterTilemap.js'

const colors = [[0, 0, 0], [238, 238, 238], [34, 68, 170], [170, 102, 34]]
function image(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = paint(x, y)
    if (color < 0) continue
    data.set([...colors[color], 255], (y * width + x) * 4)
  }
  return data
}
// Um tile assimétrico e as três cópias espelhadas, lado a lado; depois um tile vazio.
const shape = (x, y) => (x < 3 && y < 2) ? 1 : (x === 7 && y > 4) ? 2 : (x + y * 3) % 5 === 0 ? 3 : 0
const mirrored = image(40, 8, (x, y) => {
  const tile = Math.floor(x / 8), lx = x % 8
  if (tile === 4) return -1
  const h = tile === 1 || tile === 3, v = tile === 2 || tile === 3
  return shape(h ? 7 - lx : lx, v ? 7 - y : y)
})
const flips = rasterToTilemap(mirrored, 40, 8)
assert.equal(flips.tileCount, 1, 'as quatro orientações são um tile só')
assert.deepEqual(flips.map, [1, 1, 1, 1, 0])
assert.deepEqual(flips.flipH, [false, true, false, true, false])
assert.deepEqual(flips.flipV, [false, false, true, true, false])
// Desenhar cada célula com o tile guardado e os espelhos dela reproduz a imagem.
for (let cell = 0; cell < 4; cell++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const sx = flips.flipH[cell] ? 7 - x : x, sy = flips.flipV[cell] ? 7 - y : y
  const from = (sy * flips.atlasWidth + sx) * 4, to = (y * 40 + cell * 8 + x) * 4
  assert.deepEqual([...flips.atlas.subarray(from, from + 4)], [...mirrored.subarray(to, to + 4)], `célula ${cell} pixel ${x},${y}`)
}
// Simétrico: igual a si mesmo espelhado, sem marcar espelho.
const symmetric = rasterToTilemap(image(16, 8, () => 1), 16, 8)
assert.deepEqual([symmetric.tileCount, symmetric.map, symmetric.flipH, symmetric.flipV], [1, [1, 1], [false, false], [false, false]])

// 3000 tiles diferentes (12 bits por tile + um canto que quebra a simetria): antes recusado em 2048.
const wide = 3000, many = image(wide * 8, 8, (x, y) => {
  const index = Math.floor(x / 8), lx = x % 8
  if (lx === 7 && y === 7) return 2
  return (index >> ((lx >> 1) + (y >> 1) * 4)) & 1 ? 1 : 0
})
const big = rasterToTilemap(many, wide * 8, 8)
assert.equal(big.tileCount, wide, 'mais de 2048 tiles importados')
assert.equal(new Set(big.map).size, wide)

// Tamanho: até 1024 por lado e 65.536 no total (a fase de 566 × 68 cabe; 256 × 256 continua cabendo).
assert.deepEqual([MAX_MAP_SIDE, MAX_MAP_CELLS], [1024, 65536])
assert.ok(mapSizeFits(566, 68) && mapSizeFits(256, 256) && mapSizeFits(1024, 64))
assert.ok(!mapSizeFits(1025, 8) && !mapSizeFits(1024, 65) && !mapSizeFits(0, 8))
console.log('Raster import: mirrored tiles share one pattern with flips in the cell, 3000 distinct tiles accepted, map size limited by side and area.')
