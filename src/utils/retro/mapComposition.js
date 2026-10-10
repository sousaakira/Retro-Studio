// Mega Drive normal composition (issues #48/#57). Sprite table order wins
// before the winning sprite pixel is compared with the planes' priority.
export function tilesetColumns(image, tilePx, fallback = 16) {
  const natural = Math.floor(Number(image?.naturalWidth || 0) / tilePx)
  return natural > 0 && Number.isFinite(natural) ? natural : fallback || 16
}

export function spritePriority(value) {
  return value === undefined || [true, 1, 'true', '1'].includes(value)
}

export function priorityRuns(flags, width, height) {
  const runs = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width;) {
      if (![true, 1, 'true', '1'].includes(flags?.[y * width + x])) { x++; continue }
      const start = x++
      while (x < width && [true, 1, 'true', '1'].includes(flags?.[y * width + x])) x++
      runs.push({ x: start, y, width: x - start })
    }
  }
  return runs
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height
}

function paint(ctx, sprite, originX = 0, originY = 0) {
  ctx.save()
  try {
    ctx.translate(sprite.x - originX + (sprite.flipH ? sprite.width : 0),
      sprite.y - originY + (sprite.flipV ? sprite.height : 0))
    ctx.scale(sprite.flipH ? -1 : 1, sprite.flipV ? -1 : 1)
    ctx.drawImage(sprite.image, sprite.sourceX, sprite.sourceY,
      sprite.sourceWidth, sprite.sourceHeight, 0, 0, sprite.width, sprite.height)
  } finally { ctx.restore() }
}

// One scratch surface bounded to a sprite, never additional map-sized planes.
// Valid generated sprites are <=128 world pixels. Oversized legacy previews
// are limited here to avoid allocating unbounded surfaces on each timer tick.
export function drawPrioritySprites(ctx, sprites, highPriority, createCanvas) {
  const ordered = sprites.map((sprite, index) => ({ sprite, index }))
    .sort((a, b) => Number(a.sprite.id) - Number(b.sprite.id) || a.index - b.index)
    .map(entry => entry.sprite)
  const drawn = new Set()
  let scratch = null
  ctx.save()
  try {
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    for (let i = ordered.length - 1; i >= 0; i--) {
      const sprite = ordered[i]
      if (sprite.highPriority !== highPriority) continue
      const occluders = ordered.slice(0, i).filter(front => overlaps(front, sprite))
      try {
        if (!occluders.length) paint(ctx, sprite)
        else {
          const x = Math.floor(sprite.x), y = Math.floor(sprite.y)
          const width = Math.ceil(sprite.x + sprite.width) - x
          const height = Math.ceil(sprite.y + sprite.height) - y
          if (width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024) continue
          scratch ||= createCanvas()
          // Assigning dimensions also resets transform, clipping and composite.
          scratch.width = width
          scratch.height = height
          const mask = scratch.getContext('2d')
          if (!mask) continue
          mask.imageSmoothingEnabled = false
          paint(mask, sprite, x, y)
          mask.globalCompositeOperation = 'destination-out'
          for (const front of occluders) paint(mask, front, x, y)
          ctx.drawImage(scratch, x, y)
        }
        drawn.add(sprite.id)
      } catch (_) { /* source not drawable: caller retains its authoring marker */ }
    }
  } finally { ctx.restore() }
  return drawn
}

// Plane A is high priority in the generic map exporter. Keeping this ordering
// in one function lets the pixel regression exercise the same path as the UI.
export function composeMapArtwork(ctx, sprites, { drawBG, drawHighBG, drawFG, createCanvas }) {
  drawBG()
  const drawn = drawPrioritySprites(ctx, sprites, false, createCanvas)
  if (sprites.some(sprite => !sprite.highPriority)) drawHighBG()
  drawFG()
  for (const id of drawPrioritySprites(ctx, sprites, true, createCanvas)) drawn.add(id)
  return drawn
}
