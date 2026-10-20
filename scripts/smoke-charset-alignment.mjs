// #86: authored offsets reach the real atlas, stay out of runtime offsets, and survive reuse.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { alignCharsetFrames } from '../src/utils/retro/charsetAlignment.js'
import { charsetFrameOffset, charsetProjectVersion } from '../shared/retro/charsetAlignment.js'
import { charsetFrames, charsetLayout, charsetFramePlacement, charsetFrameAnchor, buildSgdkAnimationHeader, charsetGeometryHeader } from '../src/utils/retro/charsetMaker.js'
import { repeatCharsetSequence } from '../src/utils/retro/charsetSequence.js'
import { createDocumentHistory } from '../shared/retro/documentHistory.js'

const pose = (width, height) => ({ x: 0, y: 0, width, height, anchorX: width / 2, anchorY: height, sourceId: 'sheet', durationTicks: 7 })
const crouch = { id: 'crouch', name: 'crouch', fps: 8, frameCount: 1, frames: [pose(40, 32)], loop: true }
const attack = { id: 'attack', name: 'attack', fps: 8, frameCount: 2, frames: [pose(80, 40), pose(80, 40)], loop: false,
  controller: { interruptible: false, events: [{ frame: 1, type: 3, argument: 9 }], transitions: [] } }
const original = JSON.stringify(attack)
const aligned = alignCharsetFrames(attack, [0, 1], 20, -2)
assert.equal(JSON.stringify(attack), original)
assert.equal(aligned.frames[0].x, attack.frames[0].x, 'the source crop must not move')
assert.deepEqual(charsetFrameAnchor(aligned.frames[0]), charsetFrameAnchor(attack.frames[0]), 'fine shift must not rewrite foot pivots')
assert.deepEqual(aligned.controller, attack.controller)
assert.equal(aligned.frames[0].durationTicks, 7)
assert.equal(charsetProjectVersion([crouch, attack]), 7)
assert.equal(charsetProjectVersion([crouch, aligned]), 8)
const layout = charsetLayout([crouch, aligned])
for (const animation of [crouch, aligned]) for (const frame of charsetFrames(animation)) {
  const position = charsetFramePlacement(frame, layout)
  assert.ok(position.x >= 0 && position.y >= 0)
  assert.ok(position.x + frame.width <= layout.width && position.y + frame.height <= layout.height, 'padding must contain the entire adjusted pose')
}
const current = charsetFramePlacement(aligned.frames[0], layout), reference = charsetFramePlacement(crouch.frames[0], layout)
assert.equal(current.x + 20, reference.x + 20, 'body pixel at local x20 aligns across different crop widths')
assert.equal(current.y + 40 - layout.anchorY, -2, 'Y offset may move feet above the crop bottom')
const bothSigns = [alignCharsetFrames(attack, [0], -128, 128), alignCharsetFrames(attack, [1], 128, -128)]
for (const animation of bothSigns) {
  const box = charsetLayout([animation])
  for (const frame of animation.frames) {
    const at = charsetFramePlacement(frame, box)
    assert.ok(at.x >= 0 && at.y >= 0 && at.x + frame.width <= box.width && at.y + frame.height <= box.height)
  }
}
const reset = alignCharsetFrames(aligned, [0, 1], 0, 0, true)
assert.equal(charsetProjectVersion([reset]), 7, 'clearing all adjustments restores legacy compatibility')
assert.equal(reset.frames[0].offsetX, undefined)
assert.deepEqual(charsetLayout([reset]), charsetLayout([attack]))
assert.deepEqual(JSON.parse(JSON.stringify(aligned)), aligned)
const repeated = repeatCharsetSequence(aligned, 0, 1, 4)
assert.ok(repeated.frames.every(frame => frame.offsetX === 20 && frame.offsetY === -2), 'repetition preserves authored fine positions')
const grid = { id: 'grid', name: 'grid', region: { x: 0, y: 0, width: 96, height: 48 }, frameWidth: 32, frameHeight: 48, frameCount: 3, sourceId: 'sheet', fps: 8 }
const converted = alignCharsetFrames(grid, [1], -4, 3)
assert.equal(converted.frames[0].offsetX, undefined)
assert.equal(converted.frames[1].offsetX, -4)
assert.deepEqual(converted.frames.map(frame => frame.x), [0, 32, 64])
assert.equal(grid.frames, undefined)
for (const value of [NaN, Infinity, 1.5, '3', 129, -129]) assert.throws(() => charsetFrameOffset({ offsetX: value }))
assert.throws(() => alignCharsetFrames(aligned, [0], 128, 0))
assert.equal(JSON.stringify(attack), original)

const history = createDocumentHistory()
history.reset(attack); history.record(aligned, { merge: false })
assert.deepEqual(history.undo(), attack); assert.deepEqual(history.redo(), aligned)
const header = buildSgdkAnimationHeader('hero', [crouch, aligned])
assert.ok(header.includes(`{${layout.width},${layout.height},${layout.anchorX},${layout.anchorY},0,0}`), 'already baked: runtime must not offset the pose twice')
const geometry = charsetGeometryHeader('hero', [crouch, aligned], {x:-8,y:-32,width:16,height:32}, {x:-8,y:-32,width:16,height:32})
assert.ok(geometry.includes(`HERO_ANCHOR_X ${layout.anchorX}`))

// Execute the actual SFC atlas builder, recording Canvas2D destinations.
const source = fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue', import.meta.url), 'utf8')
const atlasCode = source.match(/function createAtlas\(\) \{[\s\S]*?\n\}/)[0]
const calls = [], canvas = { getContext: () => ({ drawImage: (...args) => calls.push(args) }) }
const context = { Math, Error, charsetFrames, charsetFramePlacement, animations: { value: [crouch, aligned] },
  exportLayout: { value: layout }, exportFrameWidth: { value: layout.width }, exportFrameHeight: { value: layout.height },
  getFrameSource(animation, index) { const frame=charsetFrames(animation)[index]; return { image: {}, sx:frame.x,sy:frame.y,sw:frame.width,sh:frame.height } },
  document: { createElement: () => canvas } }
vm.createContext(context);vm.runInContext(atlasCode, context);context.createAtlas()
assert.equal(calls.length, 3)
assert.deepEqual(calls[1].slice(5, 7), [current.x, layout.height + current.y])
assert.deepEqual(calls[2].slice(5, 7), [layout.width + current.x, layout.height + current.y])
assert.match(source,/version: charsetProjectVersion\(animations.value\)/)
assert.match(source,/data.version > 8/)
// Switching from crouch to attack must keep the comparison tab open.
const selectCode = source.match(/function selectAnimation\(animation\) \{[\s\S]*?\n\}/)[0]
const selection = {
  inspectorTab:{value:'align'},selectedAnimationId:{value:''},selectedFrame:{value:0},
  nextTick:callback=>callback(),inspectorContent:{value:null},
  sheets:{value:[{id:'sheet'}]},captureMode:{value:'free'},savedSelection:{value:null},animationName:{value:''},
  charsetAnchor:animation=>charsetFrameAnchor(animation.frames[0]),
  stopPlayback(){},activateSheet(){},selectManualFrame(){},revealSelectionOnSheet(){}
}
for (const name of ['frameWidth','frameHeight','spacingX','spacingY','anchorX','anchorY']) selection[name]={value:0}
vm.createContext(selection);vm.runInContext(selectCode,selection);selection.selectAnimation(attack)
assert.equal(selection.inspectorTab.value,'align','reference comparison stays visible when selecting another animation')
selection.inspectorTab.value='body';selection.selectAnimation(crouch)
assert.equal(selection.inspectorTab.value,'crop','other tab selection keeps existing behavior')
console.log('PASS fine alignment: crouch/attack registration, signed shifts, source/timing/events, margins, real atlas destinations, stable runtime boxes, versioning, repetition and undo (#86).')
