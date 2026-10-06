import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, createSSRApp, h, reactive, nextTick } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createI18n } from 'vue-i18n'

const directory = await mkdtemp(join(tmpdir(), 'retro-animation-'))
let app
try {
  const source = await readFile(new URL('../src/components/retro/tilemap/TilemapAnimationEditor.vue', import.meta.url), 'utf8')
  let code = compileScript(parse(source).descriptor, { id: 'animation-smoke' }).content
  for (const dependency of ['vue', 'vue-i18n']) code = code.replaceAll(`from '${dependency}'`, `from '${import.meta.resolve(dependency)}'`)
  const frameSource = await readFile(new URL('../src/components/retro/tilemap/TilemapSpriteFrame.vue', import.meta.url), 'utf8')
  let frameCode = compileScript(parse(frameSource).descriptor, { id: 'frame-smoke', inlineTemplate: true }).content
  frameCode = frameCode.replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`).replaceAll('from "vue"', `from '${import.meta.resolve('vue')}'`)
  await writeFile(join(directory, 'frame.mjs'), frameCode)
  const frameComponent = (await import(pathToFileURL(join(directory, 'frame.mjs')))).default
  const frameProps = { viewBox: '64 48 64 48', href: 'sheet.png', imageWidth: 512, imageHeight: 576 }
  const markup = await renderToString(createSSRApp({ render: () => h('div', [h(frameComponent, frameProps), h(frameComponent, frameProps)]) }))
  assert.match(markup, /<rect x="64" y="48" width="64" height="48"/)
  const clipIds = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(clipIds).size, 2, 'every preview must have an independent clipping mask')
  for (const id of clipIds) assert.ok(markup.includes(`clip-path="url(#${id})"`), 'the sheet image must be clipped to the frame itself, including letterboxed previews')
  console.log('PASS: exact frame clipping and unique masks for multiple previews')
  code = code.replace("'./TilemapSpriteFrame.vue'", "'./frame.mjs'")
  const file = join(directory, 'component.mjs')
  await writeFile(file, code)
  const component = (await import(pathToFileURL(file))).default
  const setup = component.setup
  let editor
  component.setup = (props, context) => { editor = setup(props, context); return () => h('div') }
  const renderer = createRenderer({
    createElement: () => ({}), insert() {}, remove() {}, patchProp() {}, setElementText() {},
    createText: () => ({}), setText() {}, createComment: () => ({}), parentNode() {}, nextSibling() {}
  })
  const visual = reactive({ x: 0, y: 0, w: 1, h: 1, frames: 1, fps: 12, loop: false })
  const tileset = { id: 'alice', columns: 64, tilecount: 64 * 72, preview: '' }
  app = renderer.createApp(component, { visual, tileset, onUpdate: patch => Object.assign(visual, patch) })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: {} } }))
  app.mount({})
  editor.setPreset('64×48')
  assert.deepEqual([visual.x, visual.y, visual.w, visual.h], [0, 0, 8, 6])
  editor.update({ frames: 8 })
  assert.equal(editor.count.value, 8)
  editor.setRegion(56, 66, 8, 6)
  assert.equal(visual.frames, 1, 'selection at sheet edge must not read outside the image')
  editor.resizeFrame('w', 9999)
  assert.equal(visual.w, 64)
  assert.equal(visual.x, 0)
  editor.setPreset('64×48')
  const target = { focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }
  editor.pointerDown({ button: 0, pointerId: 1, clientX: 150, clientY: 110, currentTarget: target, preventDefault() {} })
  assert.deepEqual([visual.x, visual.y], [8, 6], 'click selects whole frame in next animation row')
  editor.drawRegion.value = true
  editor.pointerDown({ button: 0, pointerId: 1, clientX: 128, clientY: 96, currentTarget: target, preventDefault() {} })
  editor.pointerMove({ clientX: 16, clientY: 16, currentTarget: target })
  editor.endDrag()
  assert.deepEqual([visual.x, visual.y, visual.w, visual.h], [1, 1, 8, 6], 'reverse drag selects entire rectangular crop')
  editor.moveSelection({ key: 'ArrowRight', shiftKey: true, preventDefault() {} })
  assert.equal(visual.x, 2, 'fine positioning moves by one tile')
  editor.setPreset('64×48')
  editor.update({ frames: 2 })
  await nextTick()
  editor.togglePlayback()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(editor.currentFrame.value, 1)
  assert.equal(editor.playing.value, false, 'non-loop playback stops at last frame')
  console.log('PASS: Alice frame sizing, sheet bounds, frame selection, reverse drag, keyboard adjustment and playback')
} finally {
  app?.unmount()
  await rm(directory, { recursive: true, force: true })
}
