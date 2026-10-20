export const CHARSET_ALIGNMENT_LIMIT = 128

/** Optional signed visual offsets. Collision coordinates still use the common foot pivot. */
export function charsetFrameOffset(frame) {
  const x = frame?.offsetX ?? 0, y = frame?.offsetY ?? 0
  if (![x, y].every(value => Number.isInteger(value) && Math.abs(value) <= CHARSET_ALIGNMENT_LIMIT)) {
    throw new Error(`O ajuste fino deve usar pixels inteiros entre -${CHARSET_ALIGNMENT_LIMIT} e ${CHARSET_ALIGNMENT_LIMIT}.`)
  }
  return { x, y }
}

export function charsetProjectVersion(animations) {
  return animations.some(animation => animation.frames?.some(frame => {
    const offset = charsetFrameOffset(frame)
    return offset.x !== 0 || offset.y !== 0
  })) ? 8 : 7
}
