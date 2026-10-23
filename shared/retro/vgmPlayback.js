// #103: leitura de VGM para tocar na IDE — arquivos do compositor e de outros programas (Furnace,
// DefleMask, ripados de jogos). YM2612 + SN76489, samples do DAC (bloco 0x67, 0x80–0x8F, 0xE0) e
// streams do DAC (0x90–0x95). Comandos de outros chips são pulados. Puro: roda no navegador e no Node.
// As escritas seguem o formato do chipWorklet: [0, porta, registrador, valor] (FM) e [1, byte] (PSG).

export const VGM_SAMPLE_RATE = 44100
const GD3_FIELDS = ['title', 'titleJapanese', 'game', 'gameJapanese', 'system', 'systemJapanese', 'author', 'authorJapanese', 'date', 'ripper', 'notes']

// Tamanho total (com o próprio comando) dos comandos que só são pulados.
function skipSize(command) {
  if (command >= 0x30 && command <= 0x3f) return 2
  if (command === 0x4f || command === 0x50) return 2
  if (command >= 0x40 && command <= 0x5f) return 3
  if (command >= 0xa0 && command <= 0xbf) return 3
  if (command >= 0xc0 && command <= 0xdf) return 4
  if (command >= 0xe1) return 5
  return 0
}

const u32 = (data, offset) => (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0
const u16 = (data, offset) => data[offset] | data[offset + 1] << 8

function readGd3(data, offset) {
  if (!offset || offset + 12 > data.length) return {}
  if (String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]) !== 'Gd3 ') return {}
  const end = Math.min(data.length, offset + 12 + u32(data, offset + 8)), result = {}
  let index = offset + 12
  for (const field of GD3_FIELDS) {
    let text = ''
    while (index + 1 < end) {
      const code = u16(data, index); index += 2
      if (!code) break
      text += String.fromCharCode(code)
    }
    result[field] = text.trim()
  }
  return result
}

/** É um VGM compactado (.vgz)? Os dois primeiros bytes do gzip. */
export const isGzip = bytes => bytes?.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

/**
 * Lê o cabeçalho, as tags GD3 e os samples do DAC. Lança erro em arquivo que não é VGM (ou ainda
 * compactado) e em comando desconhecido, com a posição.
 */
export function parseVgm(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (isGzip(data)) throw new Error('VGM compactado (.vgz): descompacte antes de ler.')
  if (data.length < 0x40 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'Vgm ') throw new Error('Não é um arquivo VGM.')
  const version = u32(data, 8)
  const start = version >= 0x150 && u32(data, 0x34) ? 0x34 + u32(data, 0x34) : 0x40
  const loopRelative = u32(data, 0x1c)
  const vgm = {
    data, version, start,
    psgClock: u32(data, 0x0c) & 0x3fffffff,
    ymClock: (version >= 0x110 ? u32(data, 0x2c) : u32(data, 0x10)) & 0x3fffffff,
    samples: u32(data, 0x18),
    loopOffset: loopRelative ? 0x1c + loopRelative : null,
    loopSamples: u32(data, 0x20),
    tags: readGd3(data, u32(data, 0x14) ? 0x14 + u32(data, 0x14) : 0),
    pcm: new Uint8Array(0), blocks: []
  }
  if (vgm.loopOffset !== null && (vgm.loopOffset < start || vgm.loopOffset >= data.length || !vgm.loopSamples)) vgm.loopOffset = null
  // Primeira passada: junta os blocos de PCM do YM2612 (tipo 0) e confere os comandos.
  const chunks = []
  let size = 0, index = start
  while (index < data.length) {
    const command = data[index]
    if (command === 0x66) break
    if (command === 0x67) {
      const type = data[index + 2], length = u32(data, index + 3) & 0x7fffffff
      if (type === 0x00) { vgm.blocks.push({ offset: size, length }); chunks.push(data.subarray(index + 7, index + 7 + length)); size += length }
      index += 7 + length
      continue
    }
    const length = commandLength(data, index)
    if (!length) throw new Error(`Comando de VGM desconhecido 0x${command.toString(16).padStart(2, '0')} na posição 0x${index.toString(16)}.`)
    index += length
  }
  if (chunks.length) {
    vgm.pcm = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { vgm.pcm.set(chunk, offset); offset += chunk.length }
  }
  vgm.seconds = vgm.samples / VGM_SAMPLE_RATE
  vgm.loopSeconds = vgm.loopOffset !== null ? vgm.loopSamples / VGM_SAMPLE_RATE : 0
  return vgm
}

function commandLength(data, index) {
  const command = data[index]
  if (command === 0x52 || command === 0x53 || command === 0x61) return 3
  if (command === 0x62 || command === 0x63 || (command >= 0x70 && command <= 0x8f)) return 1
  if (command === 0x67) return 7 + (u32(data, index + 3) & 0x7fffffff)
  if (command === 0x68) return 12
  if (command === 0xe0) return 5
  if (command === 0x90 || command === 0x91 || command === 0x95) return 5
  if (command === 0x92) return 6
  if (command === 0x93) return 11
  if (command === 0x94) return 2
  return skipSize(command)
}

/**
 * Percorre os comandos no tempo. run(até, emit) chama emit(amostra, escrita) até a amostra pedida
 * (44100 por segundo, contando as voltas do loop). Sem loop, `ended` fica verdadeiro no fim.
 */
export class VgmCursor {
  constructor(vgm, { loop = true } = {}) {
    this.vgm = vgm; this.loop = loop && vgm.loopOffset !== null
    this.index = vgm.start; this.time = 0; this.pcmPosition = 0; this.ended = false; this.loops = 0
    this.streams = new Map()
  }

  run(until, emit) {
    const { data } = this.vgm
    while (!this.ended && this.time < until) {
      if (this.index >= data.length) { this.finish(); continue }
      const command = data[this.index]
      if (command === 0x52 || command === 0x53) { emit(this.time, [0, command - 0x52, data[this.index + 1], data[this.index + 2]]); this.index += 3 }
      else if (command === 0x50) { emit(this.time, [1, data[this.index + 1]]); this.index += 2 }
      else if (command === 0x61) { this.wait(u16(data, this.index + 1), emit); this.index += 3 }
      else if (command === 0x62) { this.wait(735, emit); this.index++ }
      else if (command === 0x63) { this.wait(882, emit); this.index++ }
      else if (command >= 0x70 && command <= 0x7f) { this.wait((command & 15) + 1, emit); this.index++ }
      else if (command >= 0x80 && command <= 0x8f) {
        emit(this.time, [0, 0, 0x2a, this.vgm.pcm[this.pcmPosition] ?? 0x80]); this.pcmPosition++
        this.index++
        if (command & 15) this.wait(command & 15, emit)
      }
      else if (command === 0xe0) { this.pcmPosition = u32(data, this.index + 1); this.index += 5 }
      else if (command >= 0x90 && command <= 0x95) { this.stream(command, emit); this.index += commandLength(data, this.index) }
      else if (command === 0x66) this.finish()
      else this.index += commandLength(data, this.index) || 1
    }
  }

  finish() {
    if (this.loop) { this.index = this.vgm.loopOffset; this.loops++ }
    else this.ended = true
  }

  // Esperas: os streams do DAC continuam escrevendo no intervalo.
  wait(samples, emit) {
    const end = this.time + samples
    for (const stream of this.streams.values()) {
      if (!stream.active || !stream.frequency) continue
      const step = VGM_SAMPLE_RATE / stream.frequency
      while (stream.active && stream.next < end) {
        if (stream.next >= this.time) emit(stream.next, [0, stream.port, stream.register, this.vgm.pcm[stream.position] ?? 0x80])
        stream.position += stream.step
        stream.next += step
        if (--stream.remaining <= 0 || stream.position >= this.vgm.pcm.length) {
          if (stream.repeat) { stream.position = stream.begin; stream.remaining = stream.length } else stream.active = false
        }
      }
    }
    this.time = end
  }

  stream(command, _emit) {
    const { data } = this.vgm, at = this.index, id = data[at + 1]
    if (command === 0x94) { for (const [key, stream] of this.streams) if (id === 0xff || key === id) stream.active = false; return }
    let stream = this.streams.get(id)
    if (!stream) { stream = { chip: 0, port: 0, register: 0x2a, step: 1, frequency: 0, position: 0, begin: 0, length: 0, remaining: 0, repeat: false, active: false, next: 0 }; this.streams.set(id, stream) }
    if (command === 0x90) { stream.chip = data[at + 2] & 0x7f; stream.port = data[at + 3]; stream.register = data[at + 4] }
    else if (command === 0x91) { stream.step = Math.max(1, data[at + 3]) }
    else if (command === 0x92) { stream.frequency = u32(data, at + 2) }
    else if (command === 0x93 || command === 0x95) {
      // Só o DAC do YM2612 (chip 2 da especificação); os outros chips não existem no Mega Drive.
      if (stream.chip !== 0x02) return
      if (command === 0x93) {
        const offset = u32(data, at + 2), mode = data[at + 6], length = u32(data, at + 7)
        if (offset !== 0xffffffff) stream.position = offset
        const kind = mode & 3
        stream.length = kind === 1 ? length : kind === 2 ? Math.round(length * stream.frequency / 1000) : Math.max(0, this.vgm.pcm.length - stream.position)
        stream.repeat = !!(mode & 0x80)
      } else {
        const block = this.vgm.blocks[u16(data, at + 2)]
        if (!block) return
        stream.position = block.offset; stream.length = block.length; stream.repeat = !!(data[at + 4] & 1)
      }
      stream.begin = stream.position; stream.remaining = Math.max(1, stream.length); stream.active = true; stream.next = this.time
    }
  }
}

/**
 * Estado dos chips num ponto da música, para começar a tocar dali: os últimos valores dos
 * registradores do FM (sem key on e sem o DAC) e do PSG, como escritas.
 */
export function vgmStateAt(vgm, sample, { loop = true } = {}) {
  const cursor = new VgmCursor(vgm, { loop })
  // Valores do PSG ao ligar: tons em 0x3FF, ruído 0 e volumes no mínimo (15 = mudo).
  const fm = new Map(), psg = [0x3ff, 15, 0x3ff, 15, 0x3ff, 15, 0, 15]
  let latched = 0
  cursor.run(sample, (_time, write) => {
    if (write[0] === 0) { if (write[2] !== 0x28 && write[2] !== 0x2a) fm.set(write[1] << 8 | write[2], write); return }
    const byte = write[1]
    if (byte & 0x80) {
      latched = (byte >> 4) & 7
      psg[latched] = latched < 6 && !(latched & 1) ? (psg[latched] & 0x3f0) | (byte & 15) : byte & 15
    } else if (latched < 6 && !(latched & 1)) psg[latched] = (psg[latched] & 15) | ((byte & 0x3f) << 4)
    else psg[latched] = byte & 15
  })
  const writes = [...fm.values()]
  for (let channel = 0; channel < 7; channel++) if ((channel & 3) !== 3) writes.push([0, 0, 0x28, channel])
  for (let register = 0; register < 8; register++) {
    const value = psg[register]
    writes.push([1, 0x80 | register << 4 | (value & 15)])
    if (register < 6 && !(register & 1)) writes.push([1, (value >> 4) & 0x3f])
  }
  return { writes, cursor }
}

/** Texto de duração: m:ss. */
export function formatSeconds(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0))
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0')
}
