// #103: player de VGM da IDE. Leitura de VGM do compositor e de outros programas (DAC por bloco
// 0x67 + 0x80–0x8F + 0xE0, streams 0x90–0x95, GD3, comandos de outros chips pulados), loop,
// estado no meio da música, VGZ, som nos chips emulados e ligação nas telas.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { createSong, songLength, SONG_PPQ } from '../shared/retro/song.js'
import { songTimeline } from '../shared/retro/songTimeline.js'
import { writeVgm, readVgm } from '../shared/retro/vgm.js'
import { parseVgm, VgmCursor, vgmStateAt, isGzip, formatSeconds, VGM_SAMPLE_RATE } from '../shared/retro/vgmPlayback.js'
import { Ym2612 } from '../shared/retro/ym2612.js'
import { Sn76489 } from '../shared/retro/sn76489.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = file => fs.readFileSync(root + file, 'utf8')
const collect = (vgm, until = Infinity, options) => { const out = []; new VgmCursor(vgm, options).run(until, (time, write) => out.push([time, ...write])); return out }

// VGM do compositor: as mesmas escritas, nos mesmos tempos, que o leitor estrito.
const song = createSong({ id: 'tema', name: 'Tema', tempo: 150 })
song.bars = 2; song.loop = { start: SONG_PPQ * 4, end: songLength(song) }
song.tracks[0].notes = [{ t: 0, d: 24, n: 60, v: 100 }, { t: 48, d: 48, n: 67, v: 90 }, { t: 192, d: 192, n: 72, v: 110 }]
song.tracks.push({ id: 'ruido', name: 'Ruído', instrument: 'chimbal', mute: false, solo: false, notes: [{ t: 0, d: 6, n: 42, v: 100 }] })
const bytes = writeVgm(songTimeline(song), { title: 'Tema da floresta', author: 'Akira' })
const strict = readVgm(bytes), vgm = parseVgm(bytes)
assert.deepEqual(collect(vgm, Infinity, { loop: false }), strict.commands.map(c => c.chip === 'fm' ? [c.time, 0, c.port, c.address, c.data] : [c.time, 1, c.data]))
assert.equal(vgm.samples, strict.samples); assert.equal(vgm.loopOffset, strict.loopOffset)
assert.equal(vgm.tags.title, 'Tema da floresta'); assert.equal(vgm.tags.author, 'Akira')
assert.ok(Math.abs(vgm.seconds - strict.samples / VGM_SAMPLE_RATE) < 1e-9)

// Loop: depois do fim volta para o ponto de loop, com o tempo seguindo.
const loopStart = vgm.samples - vgm.loopSamples
const looping = new VgmCursor(vgm), once = collect(vgm, Infinity, { loop: false })
const twice = []; looping.run(vgm.samples + vgm.loopSamples, (time, write) => twice.push([time, ...write]))
assert.equal(looping.loops, 1)
// No instante do fim: as últimas escritas da música e, depois do salto, o trecho do loop deslocado.
const shift = vgm.samples - loopStart
const expectedLap = [...once.filter(([time]) => time === vgm.samples),
  ...once.filter(([time]) => time >= loopStart && time < vgm.samples).map(([time, ...write]) => [time + shift, ...write])]
assert.ok(expectedLap.length > 0)
assert.deepEqual(twice.filter(([time]) => time >= vgm.samples), expectedLap, 'a segunda volta repete o trecho do loop')

// Arquivo de outro programa: cabeçalho 1.71, GD3, bloco de PCM, DAC direto, stream e comandos de outros chips.
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b }
function synthetic() {
  const pcm = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80])
  const body = Buffer.concat([
    Buffer.from([0x67, 0x66, 0x00]), u32(4), pcm.subarray(0, 4),    // bloco 0: 4 bytes
    Buffer.from([0x67, 0x66, 0x00]), u32(4), pcm.subarray(4),       // bloco 1: 4 bytes
    Buffer.from([0x67, 0x66, 0x81]), u32(2), Buffer.from([1, 2]),   // outro tipo: ignorado
    Buffer.from([0x4f, 0xff, 0xa0, 0x01, 0x02, 0xb0, 0x00, 0x00]), // Game Gear, AY8910, RF5C68: pulados
    Buffer.from([0x52, 0x2b, 0x80]),                                  // liga o DAC
    Buffer.from([0xe0]), u32(2),                                      // ponteiro do PCM em 2
    Buffer.from([0x81, 0x82, 0x80]),                                  // DAC 0x30 (+1), 0x40 (+2), 0x50 (+0)
    Buffer.from([0x90, 0x00, 0x02, 0x00, 0x2a, 0x91, 0x00, 0x00, 0x01, 0x00, 0x92, 0x00]), u32(11025), // stream 0 → YM2612 0x2A, 11025 Hz
    Buffer.from([0x95, 0x00, 0x01, 0x00, 0x00]),                      // toca o bloco 1 (4 bytes)
    Buffer.from([0x61]), Buffer.from([20, 0]),                        // espera 20 amostras: 4 escritas a cada 4
    Buffer.from([0x50, 0x9f]),
    Buffer.from([0x66])
  ])
  const header = Buffer.alloc(0x100)
  header.write('Vgm ', 0); header.writeUInt32LE(0x171, 8); header.writeUInt32LE(3579545, 0x0c)
  header.writeUInt32LE(30, 0x18); header.writeUInt32LE(7670453, 0x2c); header.writeUInt32LE(0x100 - 0x34, 0x34)
  const text = s => Buffer.from(s + '\0', 'utf16le')
  const gd3Body = Buffer.concat(['Fase 1', '', 'Jogo X', '', 'Mega Drive', '', 'Alguém', '', '2026', 'ripador', ''].map(text))
  const gd3 = Buffer.concat([Buffer.from('Gd3 '), u32(0x100), u32(gd3Body.length), gd3Body])
  const file = Buffer.concat([header, body, gd3])
  file.writeUInt32LE(0x100 + body.length - 0x14, 0x14); file.writeUInt32LE(file.length - 4, 4)
  return file
}
const other = parseVgm(synthetic())
assert.equal(other.version, 0x171); assert.equal(other.pcm.length, 8); assert.deepEqual(other.blocks, [{ offset: 0, length: 4 }, { offset: 4, length: 4 }])
assert.deepEqual([other.tags.title, other.tags.game, other.tags.system, other.tags.author], ['Fase 1', 'Jogo X', 'Mega Drive', 'Alguém'])
const writes = collect(other, Infinity, { loop: false })
const dac = writes.filter(w => w[1] === 0 && w[3] === 0x2a).map(([time, , , , value]) => [time, value])
assert.deepEqual(dac, [[0, 0x30], [1, 0x40], [3, 0x50], [3, 0x50], [7, 0x60], [11, 0x70], [15, 0x80]], 'DAC direto e o stream do bloco 1 a 11025 Hz')
assert.deepEqual(writes.at(-1), [23, 1, 0x9f], 'PSG depois da espera')
assert.ok(!writes.some(w => w[1] === 0 && w[3] === 0x01), 'comandos de outros chips não viram escrita')

// Erros claros: comando desconhecido, arquivo que não é VGM, VGZ ainda compactado.
const broken = synthetic(); broken[0x100 + 7 + 4 + 7 + 4 + 7 + 2] = 0x64
assert.throws(() => parseVgm(broken), /Comando de VGM desconhecido 0x64/)
assert.throws(() => parseVgm(new Uint8Array(0x80)), /Não é um arquivo VGM/)
const vgz = zlib.gzipSync(bytes)
assert.ok(isGzip(vgz)); assert.throws(() => parseVgm(vgz), /descompacte/)
assert.equal(parseVgm(zlib.gunzipSync(vgz)).samples, vgm.samples)

// Começar do meio: o estado dos registradores (sem key on nem DAC) e o PSG remontado.
const middle = Math.floor(vgm.samples / 2)
const { writes: state, cursor } = vgmStateAt(vgm, middle)
assert.ok(cursor.time >= middle)
assert.ok(!state.some(w => w[0] === 0 && w[2] === 0x28 && (w[3] & 0xf0)), 'nenhum key on no estado')
assert.ok(state.some(w => w[0] === 0 && w[2] === 0xb0), 'patch carregado')
const psg = new Sn76489(), replay = new Sn76489()
for (const [time, chip, value] of collect(vgm, cursor.time)) if (chip === 1 && time < cursor.time) psg.write(value)
for (const write of state) if (write[0] === 1) replay.write(write[1])
assert.deepEqual(JSON.parse(JSON.stringify(replay)), JSON.parse(JSON.stringify(psg)), 'PSG igual ao tocado até ali')

// Som: as escritas nos chips emulados (o mesmo do worklet) produzem áudio.
const fm = new Ym2612(), noise = new Sn76489()
let energy = 0, index = 0
const timed = collect(vgm, VGM_SAMPLE_RATE, { loop: false })
for (let sample = 0; sample < VGM_SAMPLE_RATE; sample++) {
  while (index < timed.length && timed[index][0] <= sample) { const [, chip, a, b, c] = timed[index++]; if (chip === 0) fm.write(a, b, c); else noise.write(a) }
  fm.step(); energy += Math.abs(fm.left) + Math.abs(noise.sample(VGM_SAMPLE_RATE))
}
assert.ok(energy > 100, 'o VGM soa nos chips emulados: ' + energy.toFixed(1))
assert.equal(formatSeconds(64.5), '1:04'); assert.equal(formatSeconds(0), '0:00')

// Telas: Jogo → Áudio, música do cenário no editor de mapas, explorador, prévia no processo principal e worklet.
const audio = read('src/components/retro/AudioEditor.vue'), sidebar = read('src/components/retro/tilemap/TilemapSidebar.vue')
const state2 = read('src/composables/useTilemapEditorState.js'), app = read('src/App.vue'), project = read('electron/retro/project.js'), worklet = read('src/audio/chipWorklet.js')
assert.match(audio, /<VgmPlayer v-if="isVgm\(item\.source\)"/)
assert.match(audio, /if\(!item\?\.preview&&isVgm\(item\?\.source\)\)/, 'tocar como sala usa o VGM sem prévia')
assert.match(sidebar, /<VgmPlayer v-if="sv\('musicPreviewVgm'\)"/)
assert.match(state2, /`\$\{root\}\/audio\/audio\.json`/)
assert.match(state2, /musicPreviewVgm\.value = track\.source/)
// Voltar ao editor de mapas (ou abrir a lista de faixas) relê o catálogo e religa a prévia desligada ao sair.
assert.match(state2, /async function refreshMusic\(\)[\s\S]*?await loadMusicCatalog\(\)[\s\S]*?if \(stopped \|\| before\?\.source !== now\?\.source/)
assert.match(read('src/components/retro/TilemapEditor.vue'), /else void editorState\.refreshMusic\(\)/)
assert.match(sidebar, /@focus="state\.refreshMusic\(\)"/)
assert.match(app, /if \(\/\\\.vg\[mz\]\$\/i\.test\(filePath\)\) \{ vgmViewerPath\.value = filePath; return \}/)
assert.match(app, /<VgmViewer v-if="vgmViewerPath"/)
assert.match(project, /\['\.vgm', '\.vgz'\]\.includes\(ext\)/)
assert.match(worklet, /processorOptions\?\.chips===1/); assert.match(worklet, /Array\.isArray\(data\?\.batch\)/)

// VGMs reais, se a máquina tiver (o do Sota usa streams do DAC configurados sem dados).
for (const file of (process.env.RETRO_VGM_SAMPLES || '').split(':').filter(Boolean)) {
  let data = fs.readFileSync(file); if (isGzip(data)) data = zlib.gunzipSync(data)
  const real = parseVgm(data), cursorReal = new VgmCursor(real, { loop: false }); let count = 0
  cursorReal.run(Infinity, () => count++)
  assert.ok(count > 100 && cursorReal.time === real.samples, file)
}
console.log('VGM player: leitura (compositor, DAC, streams, GD3, outros chips), loop, estado no meio, VGZ, som nos chips emulados e telas passaram.')
