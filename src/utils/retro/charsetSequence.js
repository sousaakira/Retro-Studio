import { charsetFrames, SGDK_SPRITE_FRAME_LIMIT } from './charsetMaker.js'

/** Repeat an inclusive, zero-based interval. Returns a detached document, never mutates input. */
export function repeatCharsetSequence(animation, start, end, times) {
  const frames = charsetFrames(animation)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= frames.length) {
    throw new Error('Escolha um intervalo válido de quadros.')
  }
  if (!Number.isInteger(times) || times < 2 || times > SGDK_SPRITE_FRAME_LIMIT) {
    throw new Error('Informe uma quantidade inteira entre 2 e 255 vezes no total.')
  }
  const length = end - start + 1
  const added = length * (times - 1)
  if (frames.length + added > SGDK_SPRITE_FRAME_LIMIT) {
    throw new Error(`A repetição resultaria em ${frames.length + added} quadros. O limite é ${SGDK_SPRITE_FRAME_LIMIT}.`)
  }
  const events = animation.controller?.events || []
  const sequenceEvents = events.filter(event => event.frame >= start && event.frame <= end)
  if (events.length + sequenceEvents.length * (times - 1) > 2048) {
    throw new Error('A repetição ultrapassa o limite de 2048 eventos do personagem.')
  }
  const attack = animation.attack
  const overlapsAttack = attack?.enabled && attack.firstFrame <= end && attack.lastFrame >= start
  // The legacy attack box has only one contiguous active interval. Disjoint
  // windows cannot be represented without changing the game/runtime contract.
  if (overlapsAttack && !(attack.firstFrame <= start && attack.lastFrame >= end)) {
    throw new Error('O trecho contém quadros de ataque e de descanso. Selecione somente quadros ativos de ataque ou somente quadros de descanso para preservar a caixa de ataque.')
  }
  const result = JSON.parse(JSON.stringify(animation))
  const sequence = frames.slice(start, end + 1)
  const copies = Array.from({ length: times - 1 }, () => sequence).flat()
  result.frames = JSON.parse(JSON.stringify([...frames.slice(0, end + 1), ...copies, ...frames.slice(end + 1)]))
  result.frameCount = result.frames.length
  result.frameWidth = Math.max(...result.frames.map(frame => frame.width))
  result.frameHeight = Math.max(...result.frames.map(frame => frame.height))
  const first = result.frames[0]
  result.region = { x: first.x, y: first.y, width: first.width, height: first.height }
  result.sourceId = first.sourceId || animation.sourceId
  result.columns = result.frames.length
  result.rows = 1
  if (result.controller) {
    result.controller.events = events.map(event => ({ ...event, frame: event.frame > end ? event.frame + added : event.frame }))
    for (let copy = 1; copy < times; copy++) {
      result.controller.events.push(...sequenceEvents.map(event => ({ ...event, frame: event.frame + length * copy })))
    }
    result.controller.events.sort((a, b) => a.frame - b.frame)
  }
  if (result.attack?.enabled) {
    if (attack.firstFrame > end) {
      result.attack.firstFrame += added
      result.attack.lastFrame += added
    } else if (overlapsAttack) result.attack.lastFrame += added
  }
  return result
}
