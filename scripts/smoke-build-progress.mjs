// Barra de progresso do build: etapas e porcentagem lidas da saída do make (SGDK/MarsDev).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createBuildProgress, BUILD_STAGES } from '../shared/retro/buildProgress.js'
const gcc = file => `/tk/bin/m68k-elf-gcc -DSGDK_GCC -m68000 -Wall -Iinc -flto -MMD -c ${file} -o out/${file.replace(/\.c$/, '.o')}\n`
const output = [
  'python3 tools/export-map.py\n', 'node tools/compile-cutscenes.mjs\n', 'make release RETROSTUDIO_GENERATION_READY=1\n', 'mkdir -p out\n',
  gcc('src/boot/rom_head.c'), '/tk/bin/m68k-elf-objcopy -O binary out/rom_head.o out/rom_head.bin\n',
  'java -jar /tk/bin/rescomp.jar res/audio_resources.res res/audio_resources.rs -dep out/res/audio_resources.o\n', 'Resource: WAV sfx "a.wav" XGM\n',
  '/tk/bin/m68k-elf-gcc -x assembler-with-cpp -c res/audio_resources.rs -o out/res/audio_resources.o\n',
  'java -jar /tk/bin/rescomp.jar res/resources.res res/resources.rs -dep out/res/resources.o\n',
  gcc('src/main.c'), gcc('src/retro_runtime/retro_core.c'), gcc('src/retro_runtime/retro_world.c'), gcc('src/retro_runtime/retro_hud.c'),
  '/tk/bin/m68k-elf-gcc -B/tk/bin -n -T /tk/md.ld -nostdlib out/sega.o @out/cmd_ /tk/lib/libmd.a -lgcc -o out/rom.out -Wl,--gc-sections\n',
  '/tk/bin/m68k-elf-objcopy -O binary out/rom.out out/rom.bin\n', 'java -jar sizebnd.jar out/rom.bin -sizealign 131072 -checksum\n'
]
{
  const progress = createBuildProgress({ sources: 4, resources: 2 }), seen = []
  assert.deepEqual(progress.state(), { stage: 'start', percent: 0, detail: '' })
  for (const text of output) { const state = progress.feed(text); if (state) seen.push(state) }
  assert.deepEqual(seen.map(state => state.stage).filter((stage, index, all) => stage !== all[index - 1]), ['export', 'resources', 'compile', 'link', 'rom'])
  for (let index = 1; index < seen.length; index++) assert.ok(seen[index].percent >= seen[index - 1].percent, 'só anda para a frente')
  const at = file => seen.find(state => state.detail === file)
  assert.equal(at('tools/export-map.py').stage, 'export'); assert.equal(at('res/resources.res').percent, 35); assert.equal(at('src/retro_runtime/retro_hud.c').percent, 90)
  assert.ok(!at('src/boot/rom_head.c') && !at('res/audio_resources.rs'), 'cabeçalho da ROM e recurso compilado não mudam de etapa')
  assert.ok(seen.at(-1).percent <= 99, 'só o fim confirmado chega a 100'); assert.deepEqual(progress.finish(), { stage: 'done', percent: 100, detail: '' })
}
// Saída em pedaços arbitrários (como chega do processo) dá o mesmo resultado; linha cortada espera o resto.
{
  const whole = createBuildProgress({ sources: 4, resources: 2 }), pieces = createBuildProgress({ sources: 4, resources: 2 }), text = output.join('')
  whole.feed(text); for (let index = 0; index < text.length; index += 37) pieces.feed(text.slice(index, index + 37))
  assert.deepEqual(pieces.state(), whole.state())
  const cut = createBuildProgress({ sources: 1 }); assert.equal(cut.feed(gcc('src/main.c').slice(0, 60)), null); assert.equal(cut.feed(gcc('src/main.c').slice(60)).stage, 'compile')
}
// Build incremental (só liga) e total desconhecido: avança sem passar do limite da etapa nem voltar.
{
  const incremental = createBuildProgress({ sources: 30, resources: 2 }); assert.equal(incremental.feed(output.at(-3)).stage, 'link'); assert.equal(incremental.feed(gcc('src/late.c')), null, 'etapa anterior não volta')
  const unknown = createBuildProgress(); let last = 0
  for (let index = 0; index < 40; index++) { const state = unknown.feed(gcc(`src/f${index}.c`)); assert.ok(state.percent >= last && state.percent <= 90); last = state.percent }
  assert.ok(last > 80); assert.equal(createBuildProgress().feed('texto qualquer sem etapa\nerror: x\n'), null); assert.deepEqual(BUILD_STAGES, ['start', 'export', 'resources', 'compile', 'link', 'rom', 'done'])
}
// Ligações: o build envia o progresso, o preload entrega e a tela mostra sem travar a IDE.
{
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const game = read('../electron/retro/game.js'), preload = read('../electron/preload.cjs'), state = read('../src/composables/useRetroBuild.js'), bar = read('../src/components/retro/BuildProgressBar.vue'), shell = read('../src/App.vue')
  assert.match(game, /const progress = createBuildProgress\(countBuildInputs\(projectPath\)\)/); assert.match(game, /sendProgress\(progress\.feed\(text\)\)/); assert.match(game, /markBuildFlavor\(projectPath, flavor\.flavor\)\s*sendProgress\(progress\.finish\(\)\)/, '100% só depois de um build que deu certo')
  assert.match(preload, /onBuildProgress: \(callback\) => \{[\s\S]{0,200}'retro:build-progress'/)
  assert.equal((state.match(/startProgress\(\)\n/g) || []).length, 3, 'construir, jogar e empacotar-após-build começam do zero'); assert.match(state, /Math\.max\(buildProgress\.value\.percent, Math\.min\(100, value\.percent\)\)/)
  assert.match(shell, /<BuildProgressBar :progress="buildProgress" :building="isBuilding" :playing="isPlaying" @stop="stopEverything" @done="buildProgress = null" \/>/)
  assert.match(bar, /role="progressbar"/); assert.match(bar, /\.build-progress\{[^}]*pointer-events:none/, 'não bloqueia a tela'); assert.match(bar, /prefers-reduced-motion: reduce/)
  assert.match(bar, /if \(props\.progress\.stage === 'done'\) \{ finished\.value = true;[\s\S]{0,120}\}\s*else emit\('done'\)/, 'falha ou parada: some na hora')
  for (const locale of ['pt-BR', 'en', 'es', 'ja']) { const text = JSON.parse(read('../src/locales/' + locale + '.json')).buildProgress; for (const key of ['titleBuild', 'titlePlay', 'done', 'stop', 'aria', ...BUILD_STAGES.filter(stage => stage !== 'done')]) assert.ok(text?.[key], locale + ' ' + key) }
}
console.log('Build progress: stages from real make output, monotonic percent, chunked input, incremental and unknown totals, wiring from build to bar.')
