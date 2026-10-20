// #88: exercise actual crop controls and the source rectangle used by rendering/export.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { charsetFrameAnchor, charsetFramePlacement, charsetLayout } from '../src/utils/retro/charsetMaker.js'

const filename = 'src/components/retro/CharsetMaker.vue'
const source = fs.readFileSync(filename, 'utf8')
const { descriptor, errors } = parse(source, { filename })
assert.deepEqual(errors, [])
compileScript(descriptor, { id: 'crop-smoke' })
assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'crop-smoke' }).errors, [])
const body = descriptor.scriptSetup.content
function fn(name) {
  const start = body.indexOf(`function ${name}(`)
  assert.ok(start >= 0)
  const end = body.indexOf('\n}', start) + 2
  return body.slice(start, end)
}
const ref = value => ({ value })
const frame = { x: 10, y: 20, width: 40, height: 40, anchorX: 20, anchorY: 35, offsetX: 3, durationTicks: 9, sourceId: 'sheet', custom: 'keep' }
const original = structuredClone(frame)
const ctx = vm.createContext({
  savedSelection: ref({ x: 10, y: 20, width: 40, height: 40 }),
  captureDraft: ref(frame), busy: ref(false), exporting: ref(false), dragRect: ref(null),
  sheetImage: ref({ naturalWidth: 100, naturalHeight: 100 }),
  keepPlaying: ref(false), stopPlayback() {}, anchorX: ref(20), anchorY: ref(35), frameWidth: ref(40), frameHeight: ref(40),
  charsetFrameAnchor, charsetFramePlacement, charsetLayout,
  selectionRect: null, draftTarget: ref('replace'), selectedFrame: ref(0),
  selectedAnimation: ref({ frames: [frame] }), activeSourceId: ref('sheet'), syncManualAnimation() {},
})
ctx.selectionRect = ctx.savedSelection
for (const name of ['adjustCaptureEdge', 'nudgeCaptureAnchor', 'moveCapturePose', 'draftFrame', 'replaceManualFrame']) vm.runInContext(fn(name), ctx)
const call = code => vm.runInContext(code, ctx)
const pos = () => {
  const draft = call('draftFrame()')
  const layout = { anchorX: 64, anchorY: 64 }
  const at = charsetFramePlacement(draft, layout)
  // position of a retained source pixel at (30,40), independent of crop origin
  return [at.x + 30 - draft.x, at.y + 40 - draft.y]
}
const initialPixel = pos()
call("adjustCaptureEdge('left', 1, { shiftKey: true })")
assert.equal(ctx.savedSelection.value.x, 18)
assert.equal(ctx.savedSelection.value.width, 32)
assert.equal(ctx.anchorX.value, 12)
assert.deepEqual(pos(), initialPixel, 'left trim keeps retained pixels registered against reference')
call("adjustCaptureEdge('top', 1)")
assert.equal(ctx.savedSelection.value.y, 21)
assert.equal(ctx.anchorY.value, 34)
assert.deepEqual(pos(), initialPixel, 'top trim keeps retained pixels registered')
call("adjustCaptureEdge('right', 1, { shiftKey: true })")
assert.equal(ctx.savedSelection.value.x + ctx.savedSelection.value.width, 42, 'neighbour at source x45 is excluded')
assert.equal(ctx.selectedAnimation.value.frames[0].width, 40, 'changes remain pending until replace')
call('replaceManualFrame()')
const saved = ctx.selectedAnimation.value.frames[0]
assert.equal(saved.x + saved.width, 42)
assert.equal(saved.durationTicks, 9)
assert.equal(saved.offsetX, 3)
assert.equal(saved.custom, 'keep')
assert.deepEqual(original, frame, 'original frame was replaced without mutation')
call("moveCapturePose('ArrowRight', { shiftKey: true })")
assert.equal(ctx.anchorX.value, 4, 'moving pose right moves local pivot left by 8')
for (let i = 0; i < 20; i++) call("adjustCaptureEdge('left', -1, { shiftKey: true })")
assert.equal(ctx.savedSelection.value.x, 0)
for (let i = 0; i < 20; i++) call("adjustCaptureEdge('right', -1, { shiftKey: true })")
assert.equal(ctx.savedSelection.value.width, 100, 'expansion stops at sheet boundary')
for (let i = 0; i < 20; i++) call("adjustCaptureEdge('bottom', 1, { shiftKey: true })")
assert.equal(ctx.savedSelection.value.height, 1)
assert.ok(ctx.anchorY.value <= 1, 'excluded foot pivot is clamped to new crop')
const beforeBusy = JSON.stringify(ctx.savedSelection.value)
ctx.busy.value = true
call("adjustCaptureEdge('right', 1)")
assert.equal(JSON.stringify(ctx.savedSelection.value), beforeBusy)
ctx.busy.value = false
ctx.savedSelection.value = { x: 0, y: 0, width: 248, height: 40 }
ctx.sheetImage.value.naturalWidth = 500
call("adjustCaptureEdge('right', -1)")
assert.equal(ctx.savedSelection.value.width, 248, 'SGDK crop limit is enforced')

// The real preview receives exactly the trimmed source rectangle; reference is optional.
const draws = []
ctx.captureDraft.value = saved
ctx.captureLayout = ref(charsetLayout([{ frames: [saved] }]))
ctx.captureCanvas = ref({ getContext: () => ({ drawImage: (...args) => draws.push(args), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }) })
ctx.showCaptureReference = ref(false); ctx.captureReferenceFrame = ref(null); ctx.captureOpacity = ref(35)
ctx.imageForFrame = () => ctx.sheetImage.value
vm.runInContext(fn('drawCapturePreview'), ctx)
call('drawCapturePreview()')
assert.equal(draws.length, 1)
assert.deepEqual(draws[0].slice(1, 5), [saved.x, saved.y, saved.width, saved.height])
assert.ok(draws[0][1] + draws[0][3] < 45, 'neighbour pixels cannot enter the preview')
console.log('PASS free crop: four edges, pixel steps, registration, source bounds, pending replacement, metadata and real preview (#88).')
