import { charsetFrames } from './charsetMaker.js'
import { charsetFrameOffset } from '../../../shared/retro/charsetAlignment.js'

/** Detach before changing positions so planning, cancelling and undo keep the original intact. */
export function alignCharsetFrames(animation, indices, dx = 0, dy = 0, reset = false) {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error('Use deslocamentos inteiros em pixels.')
  const frames = charsetFrames(animation)
  if (!indices.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= frames.length)) {
    throw new Error('Selecione os quadros que deseja alinhar.')
  }
  const result = JSON.parse(JSON.stringify(animation))
  result.frames = JSON.parse(JSON.stringify(frames))
  for (const index of new Set(indices)) {
    const frame = result.frames[index]
    const previous = charsetFrameOffset(frame)
    const next = reset ? { offsetX: 0, offsetY: 0 } : { offsetX: previous.x + dx, offsetY: previous.y + dy }
    charsetFrameOffset(next) // Validate before the result can replace an authored animation.
    if (next.offsetX) frame.offsetX = next.offsetX; else delete frame.offsetX
    if (next.offsetY) frame.offsetY = next.offsetY; else delete frame.offsetY
  }
  result.frameCount = result.frames.length
  result.frameWidth = Math.max(...result.frames.map(frame => frame.width))
  result.frameHeight = Math.max(...result.frames.map(frame => frame.height))
  result.region = { x: frames[0].x, y: frames[0].y, width: frames[0].width, height: frames[0].height }
  result.columns = frames.length; result.rows = 1
  result.sourceId = frames[0].sourceId || animation.sourceId
  return result
}
