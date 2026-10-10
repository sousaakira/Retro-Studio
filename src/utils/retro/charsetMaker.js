import { CHARACTER_CONDITIONS, validateCharacterControllers } from './characterController.js'
export const SGDK_SPRITE_FRAME_LIMIT = 255
export const SGDK_SPRITE_TILE_LIMIT = 31

const MAX_SGDK_OPAQUE_COLORS = 15

function colorKey(r, g, b) {
  return (r << 16) | (g << 8) | b
}

function buildSgdkPalette(rgba) {
  const counts = new Map()
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) continue
    const key = colorKey(rgba[offset], rgba[offset + 1], rgba[offset + 2])
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const colors = [...counts].map(([key, count]) => ({
    key,
    count,
    r: (key >>> 16) & 255,
    g: (key >>> 8) & 255,
    b: key & 255
  }))
  if (colors.length <= MAX_SGDK_OPAQUE_COLORS) return { colors, sourceColorCount: colors.length }

  let boxes = [colors]
  while (boxes.length < MAX_SGDK_OPAQUE_COLORS) {
    let selectedIndex = -1
    let selectedRange = -1
    let selectedChannel = 'r'
    boxes.forEach((box, index) => {
      if (box.length < 2) return
      const ranges = ['r', 'g', 'b'].map(channel => {
        let min = 255, max = 0
        for (const color of box) { min = Math.min(min, color[channel]); max = Math.max(max, color[channel]) }
        return max - min
      })
      const range = Math.max(...ranges)
      if (range > selectedRange) {
        selectedRange = range
        selectedIndex = index
        selectedChannel = ['r', 'g', 'b'][ranges.indexOf(range)]
      }
    })
    if (selectedIndex < 0) break
    const box = boxes[selectedIndex].slice().sort((a, b) => a[selectedChannel] - b[selectedChannel])
    const halfWeight = box.reduce((sum, color) => sum + color.count, 0) / 2
    let weight = 0
    let splitAt = 1
    for (let index = 0; index < box.length - 1; index++) {
      weight += box[index].count
      splitAt = index + 1
      if (weight >= halfWeight) break
    }
    boxes.splice(selectedIndex, 1, box.slice(0, splitAt), box.slice(splitAt))
  }
  const palette = boxes.map(box => {
    const total = box.reduce((sum, color) => sum + color.count, 0)
    const average = channel => Math.round(box.reduce((sum, color) => sum + color[channel] * color.count, 0) / total)
    return { r: average('r'), g: average('g'), b: average('b') }
  })
  return { colors: palette, sourceColorCount: colors.length }
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let value = 0; value < 256; value++) {
    let crc = value
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    table[value] = crc >>> 0
  }
  return table
})()

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  let crc = 0xffffffff
  for (let index = 4; index < 8 + data.length; index++) crc = crcTable[(crc ^ chunk[index]) & 255] ^ (crc >>> 8)
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0)
  return chunk
}

function concatenateBytes(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

/** Encode a canvas atlas as an indexed PNG with index 0 transparent and at most 15 opaque colors. */
export async function encodeSgdkIndexedPng(imageData) {
  const { width, height, data: rgba } = imageData
  const { colors, sourceColorCount } = buildSgdkPalette(rgba)
  const pixels = new Uint8Array(width * height)
  for (let source = 0, target = 0; source < rgba.length; source += 4, target++) {
    if (rgba[source + 3] === 0 || colors.length === 0) continue
    const r = rgba[source], g = rgba[source + 1], b = rgba[source + 2]
    let nearest = 0
    let nearestDistance = Infinity
    for (let index = 0; index < colors.length; index++) {
      const color = colors[index]
      const dr = r - color.r, dg = g - color.g, db = b - color.b
      const distance = dr * dr + dg * dg + db * db
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance }
    }
    pixels[target] = nearest + 1
  }

  const scanlines = new Uint8Array(height * (width + 1))
  for (let y = 0; y < height; y++) scanlines.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  const compressedStream = new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'))
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer())
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width)
  headerView.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 3 // indexed color
  const palette = new Uint8Array((colors.length + 1) * 3)
  colors.forEach((color, index) => palette.set([color.r, color.g, color.b], (index + 1) * 3))
  const transparency = new Uint8Array([0])
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const png = concatenateBytes([
    signature,
    pngChunk('IHDR', header),
    pngChunk('PLTE', palette),
    pngChunk('tRNS', transparency),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array())
  ])
  return { blob: new Blob([png], { type: 'image/png' }), sourceColorCount, exportedColorCount: colors.length }
}

export function getCharsetFrameGrid(region, frameWidth, frameHeight, spacingX = 0, spacingY = 0) {
  const width = Number(frameWidth), height = Number(frameHeight)
  const gapX = Math.max(0, Math.round(Number(spacingX) || 0))
  const gapY = Math.max(0, Math.round(Number(spacingY) || 0))
  if (!region || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    return { columns: 0, rows: 0, count: 0, stepX: 0, stepY: 0 }
  const stepX = width + gapX, stepY = height + gapY
  const columns = Math.max(0, Math.floor((region.width + gapX) / stepX))
  const rows = Math.max(0, Math.floor((region.height + gapY) / stepY))
  return { columns, rows, count: columns * rows, stepX, stepY }
}

export function buildSgdkSpriteResource({ resourceName, imageName, frameWidth, frameHeight, animations }) {
  const frameTimes = animations.map(animation => {
    return `[${Array.from({ length: animation.frameCount }, (_, index) => charsetFrameTicks(animation, index)).join(',')}]`
  }).join('')
  return `SPRITE ${resourceName} "${imageName}" ${frameWidth / 8} ${frameHeight / 8} NONE [${frameTimes}] NONE`
}

export function buildSgdkAnimationHeader(name, animations) {
  const guard = `${name}_ANIMATIONS_H`.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const prefix = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const helper = prefix.toLowerCase()
  const defines = animations.map((animation, index) => {
    const id = animation.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    return `#define ${prefix}_ANIM_${id} ${index}`
  }).join('\n')
  const cases = animations.filter(animation => !animation.loop).map(animation =>
    `        case ${prefix}_ANIM_${animation.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}:`).join('\n')
  return `#ifndef ${guard}
#define ${guard}

#include <genesis.h>

/* Animation row indexes. */
${defines}
#define ${prefix}_ANIM_COUNT ${animations.length}

/* SGDK calls this after setting the frame timer. Never modify resource data in ROM.
 * If the game has its own frame-change callback, call this helper from it instead. */
static inline void ${helper}_on_frame_changed(Sprite *sprite)
{
    if (!sprite || !sprite->animation) return;
${cases ? `    switch (sprite->animInd)
    {
${cases}
            if (sprite->frameInd == sprite->animation->numFrame - 1) sprite->timer = 0;
            break;
        default:
            break;
    }` : ''}
}

/* Installs the callback above. Call on animation transitions. */
static inline void ${helper}_set_animation(Sprite *sprite, u16 animation)
{
    if (!sprite || animation >= ${prefix}_ANIM_COUNT) return;
    SPR_setFrameChangeCallback(sprite, ${helper}_on_frame_changed);
    SPR_setAnim(sprite, animation);
}

${buildCharsetControllerHeader(name, animations)}
#endif
`
}

/** Common export cell: align each crop's foot pivot without scaling its pixels. */
export function charsetAnchor(animation) {
  const bound = (value, fallback, max) => Math.max(0, Math.min(max, Math.round(Number.isFinite(Number(value)) ? Number(value) : fallback)))
  return {
    x: bound(animation.anchorX, Math.floor(animation.frameWidth / 2), animation.frameWidth),
    y: bound(animation.anchorY, animation.frameHeight, animation.frameHeight)
  }
}

export function charsetLayout(animations) {
  if (!animations.length) return { width: 8, height: 8, anchorX: 0, anchorY: 0 }
  let left = 0, right = 0, top = 0, bottom = 0
  for (const animation of animations) {
    for (const frame of charsetFrames(animation)) {
      const anchor = charsetFrameAnchor(frame)
      left = Math.max(left, anchor.x)
      top = Math.max(top, anchor.y)
      right = Math.max(right, frame.width - anchor.x)
      bottom = Math.max(bottom, frame.height - anchor.y)
    }
  }
  return { width: Math.ceil((left + right) / 8) * 8, height: Math.ceil((top + bottom) / 8) * 8, anchorX: left, anchorY: top }
}


/** Source rectangles in playback order; supports regular grids and hand-picked frames. */
export function charsetFrames(animation) {
  if (Array.isArray(animation.frames)) return animation.frames
  const grid = getCharsetFrameGrid(animation.region, animation.frameWidth, animation.frameHeight, animation.spacingX, animation.spacingY)
  const anchor = charsetAnchor(animation)
  return Array.from({ length: grid.count }, (_, index) => ({
    x: animation.region.x + (index % grid.columns) * grid.stepX,
    y: animation.region.y + Math.floor(index / grid.columns) * grid.stepY,
    width: animation.frameWidth, height: animation.frameHeight,
    anchorX: anchor.x, anchorY: anchor.y
  }))
}

export function charsetFrameAnchor(frame) {
  return charsetAnchor({ ...frame, frameWidth: frame.width, frameHeight: frame.height })
}

export function charsetGeometryHeader(name, animations, body, hurtBox) {
  const prefix = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const layout = charsetLayout(animations)
  const n = value => Math.max(-32768, Math.min(32767, Math.round(Number(value) || 0)))
  const hurt = hurtBox?.custom === true ? hurtBox : body
  const boxes = animations.map(a => {
    const attack = a.attack || {}
    return '    {' + [attack.enabled ? 1 : 0, n(attack.x), n(attack.y), n(attack.width), n(attack.height),
      Math.max(0, n(attack.firstFrame)), Math.max(0, n(attack.lastFrame))].join(', ') + '}'
  }).join(',\n')
  const runtimeBoxes = animations.map(a => {
    const attack = a.attack || {}
    return '    {{' + [n(attack.x), n(attack.y), n(attack.width), n(attack.height)].join(', ') + '}, ' +
      [Math.max(0, n(attack.firstFrame)), Math.max(0, n(attack.lastFrame)), attack.enabled ? 1 : 0].join(', ') + '}'
  }).join(',\n')
  return `/* Geometry is independent from the transparent export cell.
 * Place sprite at (feetX - ANCHOR_X, feetY - ANCHOR_Y).
 * With horizontal flip use (feetX - (FRAME_WIDTH - ANCHOR_X), feetY - ANCHOR_Y).
 * Body/attack x,y are relative to the feet; mirror a box with x = -x - width.
 * Attack frame indexes are zero-based. The game applies collisions and damage. */
#define ${prefix}_FRAME_WIDTH ${layout.width}
#define ${prefix}_FRAME_HEIGHT ${layout.height}
#define ${prefix}_ANCHOR_X ${layout.anchorX}
#define ${prefix}_ANCHOR_Y ${layout.anchorY}
#define ${prefix}_BODY_X ${n(body.x)}
#define ${prefix}_BODY_Y ${n(body.y)}
#define ${prefix}_BODY_WIDTH ${n(body.width)}
#define ${prefix}_BODY_HEIGHT ${n(body.height)}
#define ${prefix}_HURT_X ${n(hurt.x)}
#define ${prefix}_HURT_Y ${n(hurt.y)}
#define ${prefix}_HURT_WIDTH ${n(hurt.width)}
#define ${prefix}_HURT_HEIGHT ${n(hurt.height)}
/* Each row: enabled, x, y, width, height, firstFrame, lastFrame. */
static const s16 ${prefix.toLowerCase()}_attack_boxes[${animations.length}][7] = {
${boxes}
};
/* Opt-in collision metadata. Include retro_collision.h before this header.
 * Attack rows follow animationId, not state ID. Windows are inclusive frames.
 * Use facing XOR pose flips when the gameplay box follows the visual pose. */
#ifdef RETRO_STUDIO_COLLISION_H
static const RetroRect ${prefix.toLowerCase()}_body_box = {
    ${[n(body.x), n(body.y), n(body.width), n(body.height)].join(', ')}
};
static const RetroRect ${prefix.toLowerCase()}_hurt_box = {
    ${[n(hurt.x), n(hurt.y), n(hurt.width), n(hurt.height)].join(', ')}
};
static const RetroFrameBox ${prefix.toLowerCase()}_attack_geometry[${animations.length}] = {
${runtimeBoxes}
};
#endif
`
}

/** ResComp timers count video frames (1..255), not milliseconds. */
export function charsetFrameTicks(animation, index) {
  const custom = animation.frames?.[index]?.durationTicks
  const ticks = custom == null ? Math.round(60 / (Number(animation.fps) || 8)) : Number(custom)
  return Math.max(1, Math.min(255, Math.round(Number.isFinite(ticks) ? ticks : 1)))
}

/** Opt-in runtime data. Include retro_character.h before the generated header.
 * The exported atlas aligns every crop to the common foot pivot; source crop
 * anchors must not be applied again by the runtime renderer. */
export function buildCharsetControllerHeader(name, animations) {
  const controllers = validateCharacterControllers(animations)
  if (!animations.length || animations.length > 128) return '/* Character controller requires 1..128 animations. Legacy helpers remain available. */'
  const prefix = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const helper = prefix.toLowerCase()
  const layout = charsetLayout(animations)
  const arrays = animations.map((animation, index) => {
    const ticks = Array.from({ length: animation.frameCount }, (_, frame) => charsetFrameTicks(animation, frame))
    const poses = ticks.map(() => `    {${layout.width},${layout.height},${layout.anchorX},${layout.anchorY},0,0}`)
    const events = controllers[index].events
    const eventArray = events.length ? `static const RetroCharacterEvent ${helper}_state_events_${index}[] = {${events.map(e => `{${e.frame},${e.type},${e.argument}}`).join(',')}};` : ''
    return `${eventArray}
static const uint16_t ${helper}_state_ticks_${index}[] = {${ticks.join(',')}};
static const RetroCharacterPose ${helper}_state_poses_${index}[] = {\n${poses.join(',\n')}\n};`
  }).join('\n')
  const rows = animations.map((animation, index) => {
    const id = `${prefix}_ANIM_${animation.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
    return `    {${id},${id},${animation.frameCount},${helper}_state_ticks_${index},${helper}_state_poses_${index},${controllers[index].events.length ? helper + '_state_events_' + index : '0'},${controllers[index].events.length},${animation.loop ? 1 : 0},${controllers[index].interruptible ? 1 : 0}}`
  }).join(',\n')
  const transitions = controllers.flatMap((c,index) => c.transitions.map(t => {
    const target = animations.findIndex(a => a.id === t.target)
    return `    {${index},${target},${t.requireAll}UL,${t.requireNone}UL,${t.minimumTicks},${t.predicate},${t.priority},${t.finished ? 1 : 0}}`
  }))
  const transitionArray = transitions.length ? `static const RetroCharacterTransition ${helper}_character_transitions[] = {\n${transitions.join(',\n')}\n};` : ''
  const conditions = CHARACTER_CONDITIONS.map(c => `#define ${prefix}_CONDITION_${c.name} ${c.bit}UL`).join('\n')
  return `/* Optional controller data; legacy callbacks above remain unchanged. */
#ifdef RETRO_STUDIO_CHARACTER_H
${conditions}
${arrays}
static const RetroCharacterState ${helper}_character_states[] = {
${rows}
};
${transitionArray}
static const RetroCharacterDefinition ${helper}_character_definition = {
    ${helper}_character_states, ${prefix}_ANIM_COUNT, ${transitions.length ? helper + "_character_transitions" : "0"}, ${transitions.length}
};
#endif
`
}

export function charsetTimeline(animations, hz = 60) {
  return animations.map(animation => ({
    name: animation.name,
    ticks: Array.from({ length: animation.frameCount }, (_, index) => charsetFrameTicks(animation, index)),
    seconds: Array.from({ length: animation.frameCount }, (_, index) => charsetFrameTicks(animation, index)).reduce((a, b) => a + b, 0) / hz
  }))
}
