// Leitura de PNG sem dependências (zlib do Node): indexado (1/2/4/8 bits), cinza, RGB e RGBA
// de 8 bits, sem entrelaçamento — os formatos que o Charset Maker e o rescomp usam.
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** { width, height, colorType, palette: [[r,g,b]...] | null, transparent: Set(índices), indices: Uint8Array | null, rgba: Uint8Array } */
export function decodePng(bytes) {
  const data = Buffer.from(bytes)
  if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE)) throw new Error('Arquivo não é um PNG.')
  let offset = 8, header = null, palette = null, alpha = null
  const parts = []
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset), type = data.toString('latin1', offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (body.length !== length) throw new Error('PNG truncado.')
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colorType: body[9], interlace: body[12] }
    else if (type === 'PLTE') { palette = []; for (let i = 0; i + 2 < body.length; i += 3) palette.push([body[i], body[i + 1], body[i + 2]]) }
    else if (type === 'tRNS') alpha = Uint8Array.from(body)
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header || !parts.length) throw new Error('PNG sem cabeçalho ou sem dados.')
  const { width, height, depth, colorType, interlace } = header
  const channels = CHANNELS[colorType]
  if (!channels || interlace || width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('Formato de PNG não suportado.')
  if (colorType === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8) throw new Error('Profundidade de cor do PNG não suportada.')
  if (colorType === 3 && !palette) throw new Error('PNG indexado sem paleta.')
  const bitsPerPixel = depth * channels, stride = Math.ceil(width * bitsPerPixel / 8), step = Math.max(1, bitsPerPixel >> 3)
  const raw = zlib.inflateSync(Buffer.concat(parts))
  if (raw.length < (stride + 1) * height) throw new Error('PNG com dados incompletos.')
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride), previous = y ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? out[x - step] : 0, b = previous ? previous[x] : 0, c = previous && x >= step ? previous[x - step] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      else if (filter !== 0) throw new Error('Filtro de PNG inválido.')
      out[x] = value & 255
    }
  }
  const rgba = new Uint8Array(width * height * 4), indices = colorType === 3 ? new Uint8Array(width * height) : null
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, o = i * 4, row = y * stride
    if (colorType === 3) {
      const bit = x * depth, value = (pixels[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
      indices[i] = value
      const color = palette[value] || [0, 0, 0]
      rgba.set(color, o); rgba[o + 3] = alpha && value < alpha.length ? alpha[value] : 255
    } else {
      const p = row + x * channels
      if (colorType === 0 || colorType === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p]; rgba[o + 3] = colorType === 4 ? pixels[p + 1] : 255 }
      else { rgba[o] = pixels[p]; rgba[o + 1] = pixels[p + 1]; rgba[o + 2] = pixels[p + 2]; rgba[o + 3] = colorType === 6 ? pixels[p + 3] : 255 }
    }
  }
  const transparent = new Set()
  if (colorType === 3 && alpha) alpha.forEach((value, index) => { if (value === 0) transparent.add(index) })
  return { width, height, colorType, palette, transparent, indices, rgba }
}
