// Retro Studio cutscene compiler.
// Pure ES module (no Node or browser APIs): used by the editor for validation and
// preview, and by tools/compile-cutscenes.mjs to write the C headers.
// Format reference: docs/CUTSCENES.md

export const CUTSCENE_FORMAT = 'retro-studio.cutscene'
export const CUTSCENE_CONFIG_FORMAT = 'retro-studio.cutscene-config'
export const CUTSCENE_FORMAT_VERSION = 1
export const NONE = 0xffff

export const OP = Object.freeze({
  END: 0, WAIT: 1, MOVE: 2, PLACE: 3, FACE: 4, ANIMATE: 5, VISIBLE: 6, SAY: 7, CHOICE: 8,
  CAMERA: 9, FADE: 10, SOUND: 11, MUSIC: 12, SET_FLAG: 13, IF_FLAG: 14, JUMP: 15,
  ABILITY: 16, EVENT: 17, WAIT_MOVES: 18
})
export const OP_SIZE = [1, 2, 6, 5, 4, 3, 3, 10, 12, 5, 3, 2, 2, 3, 4, 2, 2, 3, 1]

export const MAX_LINES = 4
export const MAX_CHOICES = 4
export const MAX_FLAGS = 128
export const MAX_SCRIPTS = 64

/** Step types, their fields and editor labels. The editor builds its forms from this table. */
export const STEP_TYPES = Object.freeze({
  say: { label: 'Fala', icon: '💬', fields: ['actor', 'speaker', 'portrait', 'side', 'text'] },
  choice: { label: 'Escolha', icon: '⑂', fields: ['prompt', 'default', 'options'] },
  move: { label: 'Mover', icon: '➜', fields: ['actor', 'x', 'y', 'relative', 'speed', 'wait'] },
  place: { label: 'Posicionar', icon: '⌖', fields: ['actor', 'x', 'y'] },
  face: { label: 'Virar', icon: '↔', fields: ['actor', 'direction', 'target'] },
  animate: { label: 'Animação', icon: '▶', fields: ['actor', 'animation'] },
  show: { label: 'Mostrar/ocultar', icon: '◐', fields: ['actor', 'visible'] },
  wait: { label: 'Esperar', icon: '⏱', fields: ['frames'] },
  wait_moves: { label: 'Esperar movimentos', icon: '⏸', fields: [] },
  camera: { label: 'Câmera', icon: '🎥', fields: ['mode', 'x', 'actor', 'speed', 'wait'] },
  fade: { label: 'Fade', icon: '◑', fields: ['direction', 'frames'] },
  sound: { label: 'Som', icon: '♪', fields: ['sound'] },
  music: { label: 'Música', icon: '♫', fields: ['music'] },
  set_flag: { label: 'Definir flag', icon: '⚑', fields: ['flag', 'value'] },
  if_flag: { label: 'Se flag', icon: '⎇', fields: ['flag', 'value', 'then', 'else'] },
  ability: { label: 'Conceder habilidade', icon: '★', fields: ['ability'] },
  event: { label: 'Evento do jogo', icon: '⚙', fields: ['event', 'arg'] }
})

const C_VALUE = /^(?:-?\d+|0x[0-9a-fA-F]+|[A-Za-z_][A-Za-z0-9_]*)$/
const ID = /^[a-z][a-z0-9_]*$/

export function defaultCutsceneConfig() {
  return {
    format: CUTSCENE_CONFIG_FORMAT,
    version: CUTSCENE_FORMAT_VERSION,
    output: { ids: 'src/cutscene_ids.h', data: 'src/cutscene_data.h' },
    includes: [],
    screen: { width: 320, height: 224 },
    dialogue: { charsPerLine: 32, charsPerLineWithPortrait: 26, linesPerPage: 2, asciiOnly: true, uppercaseSpeaker: true },
    actors: [{ id: 'player', name: 'Jogador', value: 0, color: '#f472b6', mapObjectType: 'player_spawn' }],
    animations: [{ id: 'idle', value: 0 }, { id: 'walk', value: 1 }],
    portraits: [],
    sounds: [],
    music: [],
    abilities: [],
    events: [],
    flags: []
  }
}

export function newCutscene(id = 'nova_cena') {
  return { format: CUTSCENE_FORMAT, version: CUTSCENE_FORMAT_VERSION, id, title: 'Nova cena', description: '', map: '', steps: [] }
}

export function newStep(type, config = defaultCutsceneConfig()) {
  const actor = config.actors?.[0]?.id || ''
  switch (type) {
    case 'say': return { type, actor, speaker: '', portrait: '', side: 'left', text: '' }
    case 'choice': return { type, prompt: '', default: 0, options: [{ text: 'Sim', steps: [] }, { text: 'Não', steps: [] }] }
    case 'move': return { type, actor, x: 0, relative: true, speed: 1, wait: true }
    case 'place': return { type, actor, x: 0 }
    case 'face': return { type, actor, direction: 'right' }
    case 'animate': return { type, actor, animation: 'auto' }
    case 'show': return { type, actor, visible: true }
    case 'wait': return { type, frames: 30 }
    case 'camera': return { type, mode: 'actor', actor, speed: 2, wait: true }
    case 'fade': return { type, direction: 'out', frames: 20 }
    case 'sound': return { type, sound: config.sounds?.[0]?.id || '' }
    case 'music': return { type, music: 'room' }
    case 'set_flag': return { type, flag: config.flags?.[0]?.id || '', value: true }
    case 'if_flag': return { type, flag: config.flags?.[0]?.id || '', value: true, then: [], else: [] }
    case 'ability': return { type, ability: config.abilities?.[0]?.id || '' }
    case 'event': return { type, event: config.events?.[0]?.id || '', arg: 0 }
    default: return { type }
  }
}

/** Child step lists of a step, used by the editor tree and by the compiler. */
export function stepBranches(step) {
  if (step?.type === 'choice') return (step.options || []).map((option, index) => ({ key: `options.${index}.steps`, label: option.text || `Opção ${index + 1}`, steps: option.steps || [] }))
  if (step?.type === 'if_flag') return [{ key: 'then', label: 'Então', steps: step.then || [] }, { key: 'else', label: 'Senão', steps: step.else || [] }]
  return []
}

const ACCENTS = { 'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', 'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ç': 'c', 'ñ': 'n', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '—': '-', '–': '-' }

/** Folds text to the printable ASCII range the SGDK font can draw. */
export function toAscii(text) {
  return String(text ?? '').replace(/[^\x20-\x7e\n]/g, char => {
    const lower = char.toLowerCase()
    const plain = ACCENTS[lower]
    if (plain === undefined) return '?'
    return char !== lower ? plain.toUpperCase() : plain
  })
}

/** Word-wraps text into lines of at most `width` characters; explicit newlines are kept. */
export function wrapText(text, width) {
  const lines = []
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word
      while (rest.length > width) {
        if (line) { lines.push(line); line = '' }
        lines.push(rest.slice(0, width))
        rest = rest.slice(width)
      }
      if (!rest) continue
      if (!line) line = rest
      else if (line.length + 1 + rest.length <= width) line += ` ${rest}`
      else { lines.push(line); line = rest }
    }
    lines.push(line)
  }
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop()
  return lines
}

/** Splits dialogue text into pages exactly as the game will show them. */
export function dialoguePages(text, config, hasPortrait) {
  const dialogue = { ...defaultCutsceneConfig().dialogue, ...(config?.dialogue || {}) }
  const width = Math.max(4, Number(hasPortrait ? dialogue.charsPerLineWithPortrait : dialogue.charsPerLine) || 32)
  const perPage = Math.max(1, Math.min(MAX_LINES, Number(dialogue.linesPerPage) || 2))
  const source = dialogue.asciiOnly === false ? String(text ?? '') : toAscii(text)
  const lines = wrapText(source, width)
  const pages = []
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage))
  return pages.length ? pages : [['']]
}

function table(config, key) {
  const map = new Map()
  for (const [index, entry] of (config?.[key] || []).entries()) {
    if (entry && typeof entry.id === 'string') map.set(entry.id, entry.value ?? index)
  }
  return map
}

function cName(id) { return String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_') }

/** Validates the project configuration; returns a list of error strings. */
export function validateConfig(config) {
  const errors = []
  if (!config || typeof config !== 'object') return ['cutscene-config.json: configuração ausente ou inválida']
  if (config.format && config.format !== CUTSCENE_CONFIG_FORMAT) errors.push(`cutscene-config.json: format deve ser "${CUTSCENE_CONFIG_FORMAT}"`)
  for (const key of ['actors', 'animations', 'portraits', 'sounds', 'music', 'abilities', 'events', 'flags']) {
    const list = config[key] || []
    if (!Array.isArray(list)) { errors.push(`cutscene-config.json: ${key} deve ser uma lista`); continue }
    const seen = new Set()
    for (const entry of list) {
      if (!entry || !ID.test(String(entry.id || ''))) errors.push(`cutscene-config.json: ${key} tem id inválido ${JSON.stringify(entry?.id)} (use minúsculas, números e _)`)
      else if (seen.has(entry.id)) errors.push(`cutscene-config.json: ${key} repete o id "${entry.id}"`)
      seen.add(entry?.id)
      if (key !== 'flags' && entry?.value !== undefined && !C_VALUE.test(String(entry.value))) errors.push(`cutscene-config.json: ${key}.${entry.id} tem valor C inválido ${JSON.stringify(entry.value)}`)
    }
  }
  if ((config.flags || []).length > MAX_FLAGS) errors.push(`cutscene-config.json: no máximo ${MAX_FLAGS} flags`)
  if ((config.actors || []).length > 16) errors.push('cutscene-config.json: no máximo 16 atores')
  return errors
}

/**
 * Compiles one cutscene into a flat op list (used by the editor preview) and
 * C words. Errors are collected instead of thrown so the editor can list them all.
 */
export function compileCutscene(scene, config, strings = createStringTable()) {
  const errors = []
  const ops = []
  const source = scene?.id || 'cena'
  const actors = table(config, 'actors')
  const animations = table(config, 'animations')
  const portraits = table(config, 'portraits')
  const sounds = table(config, 'sounds')
  const music = table(config, 'music')
  const abilities = table(config, 'abilities')
  const events = table(config, 'events')
  const flagIndex = new Map((config?.flags || []).map((flag, index) => [flag.id, index]))
  const dialogue = { ...defaultCutsceneConfig().dialogue, ...(config?.dialogue || {}) }

  if (!scene || typeof scene !== 'object') return { ops, errors: [`${source}: arquivo de cena inválido`] }
  if (scene.format && scene.format !== CUTSCENE_FORMAT) errors.push(`${source}: format deve ser "${CUTSCENE_FORMAT}"`)
  if (!ID.test(String(scene.id || ''))) errors.push(`${source}: id inválido (use minúsculas, números e _)`)
  if (!Array.isArray(scene.steps)) errors.push(`${source}: steps deve ser uma lista`)

  const word = (value, path) => {
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value < -32768 || value > 65535) errors.push(`${path}: número fora do intervalo de 16 bits`)
      return value & 0xffff
    }
    return value
  }
  const lookup = (map, value, kind, path, { optional = false } = {}) => {
    if (optional && (value === undefined || value === null || value === '')) return NONE
    if (!map.has(value)) { errors.push(`${path}: ${kind} "${value ?? ''}" não existe em cutscene-config.json`); return 0 }
    return map.get(value)
  }
  const number = (value, path, fallback, { min = -32768, max = 32767 } = {}) => {
    if (value === undefined || value === null || value === '') return fallback
    const n = Number(value)
    if (!Number.isFinite(n) || n < min || n > max) { errors.push(`${path}: valor ${JSON.stringify(value)} fora de ${min}..${max}`); return fallback ?? 0 }
    return Math.round(n)
  }
  const speedWord = (value, path, fallback) => {
    if (value === undefined || value === null || value === '') return fallback
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0 || n > 64) { errors.push(`${path}: velocidade deve estar entre 0 e 64 px/quadro`); return fallback }
    return Math.max(1, Math.round(n * 256))
  }
  const emit = (op, args, meta) => { const entry = { op, args, ...meta }; ops.push(entry); return entry }
  const flag = (value, path) => {
    if (!flagIndex.has(value)) { errors.push(`${path}: flag "${value ?? ''}" não declarada em cutscene-config.json`); return 0 }
    return flagIndex.get(value)
  }

  const compileSteps = (steps, path) => {
    if (!Array.isArray(steps)) { errors.push(`${path}: deve ser uma lista de passos`); return }
    steps.forEach((step, index) => compileStep(step, `${path}.${index}`))
  }

  const compileStep = (step, path) => {
    const where = `${source} ${path} (${step?.type || '?'})`
    const meta = { path, type: step?.type }
    switch (step?.type) {
      case 'wait':
        emit(OP.WAIT, [number(step.frames, `${where} frames`, 30, { min: 0, max: 65535 })], meta); break
      case 'wait_moves':
        emit(OP.WAIT_MOVES, [], meta); break
      case 'move': {
        const flags = (step.wait === false ? 0 : 1) | (step.relative ? 2 : 0) | (step.y === undefined || step.y === null || step.y === '' ? 4 : 0)
        emit(OP.MOVE, [lookup(actors, step.actor, 'ator', where), word(number(step.x, `${where} x`, 0), where), word(number(step.y, `${where} y`, 0), where), speedWord(step.speed, `${where} speed`, 256), flags], meta)
        break
      }
      case 'place': {
        const flags = step.y === undefined || step.y === null || step.y === '' ? 4 : 0
        emit(OP.PLACE, [lookup(actors, step.actor, 'ator', where), word(number(step.x, `${where} x`, 0), where), word(number(step.y, `${where} y`, 0), where), flags], meta)
        break
      }
      case 'face': {
        const direction = step.direction || 'right'
        if (!['left', 'right', 'actor'].includes(direction)) errors.push(`${where}: direction deve ser left, right ou actor`)
        emit(OP.FACE, [lookup(actors, step.actor, 'ator', where), direction === 'left' ? 1 : direction === 'actor' ? 2 : 0, direction === 'actor' ? lookup(actors, step.target, 'ator alvo', where) : 0], meta)
        break
      }
      case 'animate':
        emit(OP.ANIMATE, [lookup(actors, step.actor, 'ator', where), !step.animation || step.animation === 'auto' ? NONE : lookup(animations, step.animation, 'animação', where)], meta)
        break
      case 'show':
        emit(OP.VISIBLE, [lookup(actors, step.actor, 'ator', where), step.visible === false ? 0 : 1], meta); break
      case 'say': {
        const hasPortrait = !!step.portrait
        const portrait = lookup(portraits, step.portrait, 'retrato', where, { optional: true })
        const actor = lookup(actors, step.actor, 'ator', where, { optional: true })
        const actorName = (config?.actors || []).find(item => item.id === step.actor)?.name
        let speaker = step.speaker ?? ''
        if (!speaker && actorName) speaker = actorName
        if (speaker && dialogue.uppercaseSpeaker) speaker = String(speaker).toUpperCase()
        if (speaker && dialogue.asciiOnly !== false) speaker = toAscii(speaker)
        const speakerId = speaker ? strings.add(speaker) : NONE
        if (!String(step.text ?? '').trim()) errors.push(`${where}: texto vazio`)
        const side = step.side === 'right' ? 1 : 0
        for (const page of dialoguePages(step.text, config, hasPortrait)) {
          const lines = [0, 1, 2, 3].map(i => i < page.length ? strings.add(page[i]) : NONE)
          emit(OP.SAY, [actor, speakerId, portrait, side, page.length, ...lines], { ...meta, speaker, portrait: step.portrait || '', side: step.side || 'left', actor: step.actor || '', lines: page })
        }
        break
      }
      case 'choice': {
        const options = Array.isArray(step.options) ? step.options : []
        if (options.length < 1 || options.length > MAX_CHOICES) errors.push(`${where}: escolha precisa de 1 a ${MAX_CHOICES} opções`)
        const width = Math.max(4, Number(dialogue.charsPerLine) || 32) - 2
        const fold = text => (dialogue.asciiOnly === false ? String(text ?? '') : toAscii(text)).slice(0, width)
        const prompt = step.prompt ? fold(step.prompt) : ''
        const choice = emit(OP.CHOICE, [prompt ? strings.add(prompt) : NONE, Math.min(options.length, MAX_CHOICES), number(step.default, `${where} default`, 0, { min: 0, max: Math.max(0, options.length - 1) }), NONE, NONE, NONE, NONE, 0, 0, 0, 0], { ...meta, prompt, options: options.map(option => fold(option?.text)) })
        const ends = []
        options.slice(0, MAX_CHOICES).forEach((option, index) => {
          if (!String(option?.text ?? '').trim()) errors.push(`${where}: opção ${index + 1} sem texto`)
          choice.args[3 + index] = strings.add(fold(option?.text))
          choice.targets = choice.targets || []
          choice.targets[index] = ops.length
          compileSteps(option?.steps || [], `${path}.options.${index}.steps`)
          ends.push(emit(OP.JUMP, [0], { path: `${path}.options.${index}`, type: 'jump' }))
        })
        const end = ops.length
        for (const jump of ends) jump.target = end
        break
      }
      case 'camera': {
        const mode = step.mode || 'actor'
        if (!['follow', 'x', 'actor'].includes(mode)) errors.push(`${where}: mode deve ser follow, x ou actor`)
        const value = mode === 'actor' ? lookup(actors, step.actor, 'ator', where) : mode === 'x' ? word(number(step.x, `${where} x`, 0), where) : 0
        emit(OP.CAMERA, [mode === 'follow' ? 0 : mode === 'x' ? 1 : 2, value, step.speed === 0 ? 0 : speedWord(step.speed, `${where} speed`, 512), step.wait === false ? 0 : 1], meta)
        break
      }
      case 'fade': {
        if (!['in', 'out'].includes(step.direction || 'out')) errors.push(`${where}: direction deve ser in ou out`)
        emit(OP.FADE, [step.direction === 'in' ? 0 : 1, number(step.frames, `${where} frames`, 20, { min: 0, max: 255 })], meta)
        break
      }
      case 'sound':
        emit(OP.SOUND, [lookup(sounds, step.sound, 'som', where)], meta); break
      case 'music':
        emit(OP.MUSIC, [!step.music || step.music === 'room' ? NONE : lookup(music, step.music, 'música', where)], meta); break
      case 'set_flag':
        emit(OP.SET_FLAG, [flag(step.flag, where), step.value === false ? 0 : 1], meta); break
      case 'if_flag': {
        const test = emit(OP.IF_FLAG, [flag(step.flag, where), step.value === false ? 0 : 1, 0], meta)
        compileSteps(step.then || [], `${path}.then`)
        const skip = emit(OP.JUMP, [0], { path: `${path}.then`, type: 'jump' })
        test.target = ops.length
        compileSteps(step.else || [], `${path}.else`)
        skip.target = ops.length
        break
      }
      case 'ability':
        emit(OP.ABILITY, [lookup(abilities, step.ability, 'habilidade', where)], meta); break
      case 'event':
        emit(OP.EVENT, [lookup(events, step.event, 'evento', where), word(number(step.arg, `${where} arg`, 0), where)], meta); break
      default:
        errors.push(`${where}: tipo de passo desconhecido`)
    }
  }

  compileSteps(scene.steps || [], 'steps')
  emit(OP.END, [], { path: 'end', type: 'end' })

  // Resolve op indices to word offsets.
  const offsets = []
  let pc = 0
  for (const op of ops) { offsets.push(pc); pc += OP_SIZE[op.op] }
  offsets.push(pc)
  if (pc > 0xfff0) errors.push(`${source}: cena grande demais (${pc} palavras)`)
  for (const op of ops) {
    if (op.op === OP.JUMP) op.args[0] = offsets[op.target]
    if (op.op === OP.IF_FLAG) op.args[2] = offsets[op.target]
    if (op.op === OP.CHOICE) (op.targets || []).forEach((target, index) => { op.args[7 + index] = offsets[target] })
  }
  const words = ops.flatMap(op => [op.op, ...op.args])
  return { id: scene.id, ops, words, errors }
}

export function createStringTable() {
  const list = []
  const index = new Map()
  return {
    list,
    add(text) {
      const value = String(text)
      if (!index.has(value)) { index.set(value, list.length); list.push(value) }
      return index.get(value)
    }
  }
}

function cString(text) {
  let out = '"'
  for (const byte of new TextEncoder().encode(text)) {
    if (byte === 0x22 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`
    else if (byte >= 0x20 && byte < 0x7f && byte !== 0x3f) out += String.fromCharCode(byte)
    else out += `\\${byte.toString(8).padStart(3, '0')}`
  }
  return `${out}"`
}

/**
 * Compiles every cutscene of a project.
 * @param {{path:string, scene:object}[]} files
 * @returns {{ok:boolean, errors:string[], idsHeader:string, dataHeader:string, scripts:object[]}}
 */
export function compileProject(files, config) {
  const errors = [...validateConfig(config)]
  const strings = createStringTable()
  const scripts = []
  const ids = new Map()
  const sorted = [...files].sort((a, b) => String(a.scene?.id).localeCompare(String(b.scene?.id)))
  for (const file of sorted) {
    const result = compileCutscene(file.scene, config, strings)
    errors.push(...result.errors.map(error => `${file.path}: ${error}`))
    if (ids.has(result.id)) errors.push(`${file.path}: id "${result.id}" repetido (também em ${ids.get(result.id)})`)
    ids.set(result.id, file.path)
    scripts.push({ ...result, path: file.path, title: file.scene?.title || '' })
  }
  if (scripts.length > MAX_SCRIPTS) errors.push(`no máximo ${MAX_SCRIPTS} cenas por projeto`)

  const generated = '/* Generated by Retro Studio (tools/compile-cutscenes.mjs). Do not edit. */'
  const define = (name, value, comment) => `#define ${name} ${value}${comment ? ` /* ${String(comment).replace(/\*\//g, '* /')} */` : ''}`
  const idsLines = [generated, '#ifndef CUTSCENE_IDS_H', '#define CUTSCENE_IDS_H', '',
    define('CUTSCENE_COUNT', scripts.length),
    ...scripts.map((script, index) => define(`CUTSCENE_${cName(script.id)}`, index, script.title)), '',
    define('CUTSCENE_FLAG_COUNT', (config?.flags || []).length),
    ...(config?.flags || []).map((flag, index) => define(`CUTSCENE_FLAG_${cName(flag.id)}`, index, flag.description)), '',
    ...(config?.actors || []).map((actor, index) => define(`CUTSCENE_ACTOR_${cName(actor.id)}`, actor.value ?? index, actor.name)), '',
    ...(config?.portraits || []).map((portrait, index) => define(`CUTSCENE_PORTRAIT_${cName(portrait.id)}`, portrait.value ?? index, portrait.name)), '',
    ...(config?.events || []).map((event, index) => define(`CUTSCENE_EVENT_${cName(event.id)}`, event.value ?? index, event.description)), '',
    '#endif', '']

  const includes = ['retrostudio/cutscene_runner.h', 'cutscene_ids.h', ...(config?.includes || [])]
  const dataLines = [generated,
    '/* Include from exactly one C file: the arrays are static. */',
    '#ifndef CUTSCENE_DATA_H', '#define CUTSCENE_DATA_H',
    ...includes.map(file => `#include "${file}"`), '',
    `static const char *const cutsceneStrings[${Math.max(1, strings.list.length)}] = {`,
    ...(strings.list.length ? strings.list.map((text, index) => `    ${cString(text)}${index < strings.list.length - 1 ? ',' : ''}`) : ['    ""']),
    '};', '']
  scripts.forEach((script, index) => {
    dataLines.push(`/* ${script.id}: ${String(script.title).replace(/\*\//g, '* /')} (${script.path}) */`)
    dataLines.push(`static const unsigned short cutsceneCode${index}[${script.words.length}] = {`)
    for (const op of script.ops) dataLines.push(`    ${[op.op, ...op.args].map(value => typeof value === 'number' ? String(value) : `(unsigned short)(${value})`).join(', ')}, /* ${op.type} ${op.path} */`)
    dataLines.push('};', '')
  })
  dataLines.push(`static const CutsceneScript cutsceneScripts[${Math.max(1, scripts.length)}] = {`)
  dataLines.push(scripts.length ? scripts.map((script, index) => `    { cutsceneCode${index}, ${script.words.length} }`).join(',\n') : '    { 0, 0 }')
  dataLines.push('};', '')
  dataLines.push(`static const CutsceneLibrary cutsceneLibrary = { cutsceneScripts, ${scripts.length}, cutsceneStrings, ${strings.list.length} };`)
  dataLines.push('', '#endif', '')

  return { ok: errors.length === 0, errors, idsHeader: idsLines.join('\n'), dataHeader: dataLines.join('\n'), scripts }
}

/** Parses JSON text and reports the file name on failure. */
export function parseJson(text, path) {
  try { return { value: JSON.parse(text), error: null } } catch (error) { return { value: null, error: `${path}: JSON inválido (${error.message})` } }
}
