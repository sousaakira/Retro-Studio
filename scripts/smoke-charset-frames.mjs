import assert from 'node:assert/strict'
import { charsetFrameTicks, charsetTimeline, charsetFrames, charsetFrameAnchor, charsetLayout, getCharsetFrameGrid, buildSgdkSpriteResource } from '../src/utils/retro/charsetMaker.js'

const regular = { name: 'idle', region: { x: 9, y: 12, width: 103, height: 47 },
  frameWidth: 31, frameHeight: 47, spacingX: 5, spacingY: 0, fps: 8, frameCount: 3 }
assert.equal(getCharsetFrameGrid(regular.region, 31, 47, 5, 0).count, 3)
assert.deepEqual(charsetFrames(regular).map(f => f.x), [9, 45, 81])
const sourcedGrid = { ...regular, sourceId: 'sheet-sword' }
assert.ok(charsetFrames(sourcedGrid).every(frame => frame.sourceId === 'sheet-sword'), 'Grid conversion must preserve its source sheet')
const mixedSources = { ...sourcedGrid, frames: [{ x: 0, y: 0, width: 16, height: 16 }, { x: 8, y: 8, width: 16, height: 16, sourceId: 'sheet-main' }] }
assert.deepEqual(charsetFrames(mixedSources).map(frame => frame.sourceId), ['sheet-sword', 'sheet-main'], 'Explicit frame sheets override the animation default')
assert.deepEqual(charsetLayout([regular]), { width: 32, height: 48, anchorX: 15, anchorY: 47 })

const attack = { name: 'sword', fps: 8, frameCount: 3, frames: [
  { x: 100, y: 20, width: 27, height: 47, anchorX: 13, anchorY: 45 },
  { x: 160, y: 0, width: 73, height: 65, anchorX: 19, anchorY: 63 },
  { x: 255, y: 10, width: 89, height: 52, anchorX: 55, anchorY: 49 }
] }
const layout = charsetLayout([regular, attack])
assert.deepEqual(layout, { width: 112, height: 72, anchorX: 55, anchorY: 63 })
for (const animation of [regular, attack]) for (const frame of charsetFrames(animation)) {
  const anchor = charsetFrameAnchor(frame)
  const x = layout.anchorX - anchor.x, y = layout.anchorY - anchor.y
  assert.equal(x + anchor.x, layout.anchorX)
  assert.equal(y + anchor.y, layout.anchorY)
  assert.ok(x >= 0 && y >= 0 && x + frame.width <= layout.width && y + frame.height <= layout.height, 'Frame clipped by common export cell')
}
assert.deepEqual(charsetFrames(JSON.parse(JSON.stringify(attack))), attack.frames, 'Manual cuts and anchors must survive saving')
const legacy = { ...regular, frameWidth: 32, frameHeight: 48, region: { x: 0, y: 0, width: 96, height: 48 }, spacingX: 0 }
assert.deepEqual(charsetLayout([legacy]), { width: 32, height: 48, anchorX: 16, anchorY: 48 }, 'Legacy uniform atlas dimensions changed')
assert.equal(getCharsetFrameGrid(regular.region, 0, 47).count, 0)
assert.match(buildSgdkSpriteResource({ resourceName: 'SPR_SWORD', imageName: 'sword.png', frameWidth: layout.width, frameHeight: layout.height, animations: [regular, attack] }), /14 9 NONE \[\[8,8,8\]\[8,8,8\]\]/)
console.log('Charset: grid em pixels, recortes livres, alinhamento, persistência e dimensões SGDK conferidos.')

const timingAnimation = { ...attack, fps: 10, frames: attack.frames.map(frame => ({ ...frame })) }
timingAnimation.frames[0].durationTicks = 12
timingAnimation.frames[1].durationTicks = 3
assert.deepEqual([0, 1, 2].map(i => charsetFrameTicks(timingAnimation, i)), [12, 3, 6])
const timingResource = buildSgdkSpriteResource({ resourceName: 'SPR_SWORD', imageName: 'sword.png', frameWidth: layout.width, frameHeight: layout.height, animations: [timingAnimation] })
assert.match(timingResource, /\[\[12,3,6\]\]/)
assert.equal(charsetTimeline([timingAnimation], 60)[0].seconds, 21 / 60)
assert.equal(charsetTimeline([timingAnimation], 50)[0].seconds, 21 / 50)
const savedTiming = JSON.parse(JSON.stringify(timingAnimation))
assert.equal(charsetFrameTicks(savedTiming, 0), 12)
const [movedFrame] = savedTiming.frames.splice(0, 1)
savedTiming.frames.push(movedFrame)
assert.deepEqual([0, 1, 2].map(i => charsetFrameTicks(savedTiming, i)), [3, 6, 12], 'Duration must move with its pose')
delete savedTiming.frames[1].durationTicks
assert.equal(charsetFrameTicks(savedTiming, 1), 6)
savedTiming.frames[0].durationTicks = 999
assert.equal(charsetFrameTicks(savedTiming, 0), 255)
console.log('Timeline: tempos SGDK por pose, PAL/NTSC, reordenação e persistência conferidos.')
