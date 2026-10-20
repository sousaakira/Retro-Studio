// #85: finite sequence repetition survives save and SGDK export; no game files touched.
import assert from 'node:assert/strict'
import { repeatCharsetSequence } from '../src/utils/retro/charsetSequence.js'
import { charsetFrames, charsetFrameTicks, charsetTimeline, charsetLayout, buildSgdkSpriteResource, buildSgdkAnimationHeader } from '../src/utils/retro/charsetMaker.js'
import { createDocumentHistory } from '../shared/retro/documentHistory.js'

const animation = {
  id: 'blade', name: 'blade', fps: 8, frameCount: 10, loop: false,
  frames: Array.from({ length: 10 }, (_, index) => ({
    x: index * 64, y: 12, width: 30 + index, height: 43, anchorX: 15, anchorY: 42,
    sourceId: index % 2 ? 'sword' : 'body', durationTicks: index + 2,
    custom: { value: index }
  })),
  controller: { interruptible: false, transitions: [], events: [
    { frame: 1, type: 1, argument: 10 }, { frame: 4, type: 2, argument: 20 }, { frame: 9, type: 5, argument: 30 }
  ] }
}
const before = JSON.stringify(animation)
const repeated = repeatCharsetSequence(animation, 3, 8, 4)
assert.equal(repeated.frameCount, 28, 'ten originals plus three copies of six frames')
assert.deepEqual(repeated.frames.map(frame => frame.x), [
  ...animation.frames.slice(0, 3), ...Array(4).fill(animation.frames.slice(3, 9)).flat(), animation.frames[9]
].map(frame => frame.x))
assert.equal(JSON.stringify(animation), before, 'planning/repetition must not mutate the original')
assert.deepEqual(repeated.frames[9], animation.frames[3], 'crop, sheet, foot pivot and ticks all travel together')
assert.equal(repeated.loop, false, 'finite repetition must not enable endless looping')
assert.deepEqual(repeated.controller.events.map(event => event.frame), [1, 4, 10, 16, 22, 27])
assert.equal(repeated.controller.interruptible, false)
assert.deepEqual(charsetLayout([repeated]), charsetLayout([animation]), 'repetition must not change export alignment')
const expectedTicks = animation.frames.reduce((sum, frame) => sum + frame.durationTicks, 0) +
  3 * animation.frames.slice(3, 9).reduce((sum, frame) => sum + frame.durationTicks, 0)
assert.equal(charsetTimeline([repeated], 60)[0].seconds, expectedTicks / 60)
assert.equal(charsetTimeline([repeated], 50)[0].seconds, expectedTicks / 50)
const saved = JSON.parse(JSON.stringify(repeated))
assert.deepEqual(saved, repeated, 'existing JSON format preserves the resulting timeline')
const ticks = repeated.frames.map((_frame, index) => charsetFrameTicks(repeated, index))
assert.ok(buildSgdkSpriteResource({ resourceName: 'SPR_BLADE', imageName: 'blade.png', frameWidth: 48, frameHeight: 48, animations: [saved] }).includes('[[' + ticks.join(',') + ']]'))
const header = buildSgdkAnimationHeader('ninja', [saved])
assert.ok(header.includes('{27,5,30}'), 'exported event after sequence follows its original pose')
assert.ok(header.includes('{22,2,20}'), 'event repeats on the fourth pass')
repeated.frames[9].custom.value = 999
assert.equal(repeated.frames[3].custom.value, 3, 'repeated frames can be edited independently')
assert.equal(animation.frames[3].custom.value, 3)

const history = createDocumentHistory()
history.reset(animation)
history.record(saved, { merge: false })
assert.deepEqual(history.undo(), animation, 'one undo restores the original sequence')
assert.deepEqual(history.redo(), saved)

const grid = { id: 'grid', name: 'grid', region: { x: 0, y: 0, width: 96, height: 48 }, frameWidth: 32,
  frameHeight: 48, frameCount: 3, sourceId: 'sheet', fps: 8, loop: true }
const converted = repeatCharsetSequence(grid, 1, 2, 4)
assert.deepEqual(converted.frames.map(frame => frame.x), [0, 32, 64, 32, 64, 32, 64, 32, 64])
assert.ok(converted.frames.every(frame => frame.sourceId === 'sheet'))
assert.equal(charsetFrameTicks(converted, 3), 8, 'grid keeps FPS-derived timing')
assert.deepEqual(charsetLayout([converted]), charsetLayout([grid]))
assert.equal(charsetFrames(repeatCharsetSequence(animation, 9, 9, 2)).length, 11)
const full = { ...animation, frameCount: 250, frames: Array(250).fill(animation.frames[0]), controller: undefined }
assert.equal(repeatCharsetSequence(full, 0, 0, 6).frameCount, 255)
for (const args of [[-1, 2, 4], [5, 3, 4], [0, 10, 4], [0.5, 2, 4], [0, 1, 1], [0, 1, 2.5], [0, 1, NaN], [0, 1, Infinity], [0, 9, 26]]) {
  assert.throws(() => repeatCharsetSequence(animation, ...args))
}
assert.throws(() => repeatCharsetSequence({ ...animation, controller: { events: Array(1025).fill({ frame: 0, type: 1, argument: 0 }) } }, 0, 0, 2), /2048 eventos/)
const afterAttack = repeatCharsetSequence({ ...animation, attack: { enabled: true, firstFrame: 8, lastFrame: 9 } }, 1, 3, 4)
assert.deepEqual([afterAttack.attack.firstFrame, afterAttack.attack.lastFrame], [17, 18])
const active = repeatCharsetSequence({ ...animation, attack: { enabled: true, firstFrame: 2, lastFrame: 6 } }, 3, 5, 4)
assert.deepEqual([active.attack.firstFrame, active.attack.lastFrame], [2, 15])
assert.throws(() => repeatCharsetSequence({ ...animation, attack: { enabled: true, firstFrame: 4, lastFrame: 6 } }, 3, 8, 4), /ataque e de descanso/)
console.log('PASS charset sequence: four passes, order, multi-sheet alignment/ticks, copied events, limits, attack windows, JSON, one undo/redo and SGDK export (#85).')
