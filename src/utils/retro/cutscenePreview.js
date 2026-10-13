// Editor-side mirror of src/retrostudio/cutscene_runner.c. It runs the op list
// produced by compileCutscene so the preview shows the same pages, branches and
// timing as the game. Keep both in sync when adding opcodes.
import { OP } from '../../../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'

const getAt = (root, path) => String(path).split('.').reduce((node, key) => (node == null ? undefined : node[key]), root)
const approach = (value, target, step) => value < target ? Math.min(target, value + step) : value > target ? Math.max(target, value - step) : value

/**
 * @param {{ops:object[]}} compiled result of compileCutscene
 * @param {object} scene the cutscene JSON (steps are read by op.path)
 * @param {object} config cutscene-config.json
 * @param {Record<string,{x:number,y:number}>} positions initial actor feet positions
 */
export function createPreview(compiled, scene, config, positions) {
  const actors = {}
  for (const actor of config.actors || []) {
    const start = positions[actor.id] || { x: 0, y: 0 }
    actors[actor.id] = { id: actor.id, name: actor.name || actor.id, color: actor.color || '#7dd3fc', x: start.x, y: start.y, lift: 0, left: false, visible: true, animation: 'auto', moving: false }
  }
  const screen = config.screen || { width: 320, height: 224 }
  return {
    ops: compiled.ops || [], scene, config, screen, actors,
    pc: 0, frame: 0, state: 'run', timer: 0, waitActor: '',
    moves: {}, dialogue: null, choice: null, flags: new Set(),
    camera: { fixed: false, x: 0, target: 0, speed: 0, moving: false },
    fade: { value: 0, from: 0, to: 0, frames: 0, elapsed: 0 },
    fastForward: false, done: false, log: [], currentPath: ''
  }
}

function note(sim, text) {
  sim.log.push({ frame: sim.frame, text })
  if (sim.log.length > 40) sim.log.shift()
}

function stepOf(sim, op) { return getAt(sim.scene, op.path) || {} }

const FLOAT_BOB = [0, -1, -1, -2, -2, -2, -1, -1, 0, 1, 1, 2, 2, 2, 1, 1]

/** Loads route steps until one takes time; false when the route is over (mirror of routeNext in C). */
function routeNext(sim, actorId) {
  const move = sim.moves[actorId]
  const actor = sim.actors[actorId]
  for (let guard = 0; guard < 64; guard++) {
    if (move.index >= move.route.length) {
      if (!move.route.length || (move.repeat > 0 && --move.repeat === 0)) return false
      move.index = 0
    }
    const a = move.route[move.index++]
    const word = value => value >= 0x8000 ? value - 0x10000 : value
    let tx = actor.x, ty = actor.y
    move.timer = move.jumpFrames = 0
    if (a[0] === 0) {
      if (a[4] & 2) { tx += word(a[1]); if (!(a[4] & 4)) ty += word(a[2]) }
      else { tx = word(a[1]); if (!(a[4] & 4)) ty = word(a[2]) }
      move.speed = (a[3] || 256) / 256
    } else if (a[0] === 1) {
      tx += word(a[1]); ty += word(a[2])
      move.jumpHeight = a[3]; move.jumpFrames = a[4] || 1; move.jumpFrame = 0
      move.startX = actor.x; move.startY = actor.y
    } else if (a[0] === 2) {
      if (!a[1]) continue
      move.timer = a[1]
      return true
    } else {
      if (a[0] === 3) actor.left = a[1] !== 0
      continue
    }
    move.x = tx; move.y = ty
    if (tx !== actor.x && !(move.flags & 4)) actor.left = tx < actor.x
    if (move.jumpFrames || tx !== actor.x || ty !== actor.y) return true
  }
  return false
}

function endRoute(sim, actorId) {
  const actor = sim.actors[actorId]
  actor.moving = false
  actor.lift = 0
  delete sim.moves[actorId]
}

function finishRoute(sim, actorId) {
  const move = sim.moves[actorId]
  const actor = sim.actors[actorId]
  if (move.repeat >= 0) {
    do { actor.x = move.x; actor.y = move.y } while (routeNext(sim, actorId))
  }
  endRoute(sim, actorId)
}

function startRoute(sim, actorId, flags, repeat, route) {
  const actor = sim.actors[actorId]
  if (!actor) return
  sim.moves[actorId] = { route, index: 0, flags, repeat: repeat || -1, timer: 0, tick: 0, jumpFrames: 0, x: actor.x, y: actor.y, speed: 1 }
  if (!routeNext(sim, actorId)) endRoute(sim, actorId)
  else if (sim.fastForward) finishRoute(sim, actorId)
}

function updateRoute(sim, actorId) {
  const move = sim.moves[actorId]
  const actor = sim.actors[actorId]
  let done
  move.tick++
  if (move.timer) done = --move.timer === 0
  else if (move.jumpFrames) {
    move.jumpFrame++
    done = move.jumpFrame >= move.jumpFrames
    actor.x = done ? move.x : move.startX + Math.trunc((move.x - move.startX) * move.jumpFrame / move.jumpFrames)
    actor.y = done ? move.y : move.startY + Math.trunc((move.y - move.startY) * move.jumpFrame / move.jumpFrames)
  } else {
    actor.x = approach(actor.x, move.x, move.speed)
    actor.y = approach(actor.y, move.y, move.speed)
    done = actor.x === move.x && actor.y === move.y
  }
  if (done && !routeNext(sim, actorId)) { endRoute(sim, actorId); return }
  actor.moving = !move.timer
  actor.lift = (move.jumpFrames ? -Math.trunc(4 * move.jumpHeight * move.jumpFrame * (move.jumpFrames - move.jumpFrame) / (move.jumpFrames * move.jumpFrames)) : 0) +
    (move.flags & 2 ? FLOAT_BOB[(move.tick >> 2) & 15] : 0)
}

function startMove(sim, actorId, x, y, speed) {
  const actor = sim.actors[actorId]
  if (!actor) return
  actor.lift = 0
  if (x !== actor.x) actor.left = x < actor.x
  sim.moves[actorId] = { x, y, speed: Math.max(1 / 256, speed) }
  if (sim.fastForward || (x === actor.x && y === actor.y)) finishMove(sim, actorId)
}

function finishMove(sim, actorId) {
  const move = sim.moves[actorId]
  const actor = sim.actors[actorId]
  if (move?.route && actor) { finishRoute(sim, actorId); return }
  if (move && actor) { actor.x = move.x; actor.y = move.y; actor.moving = false }
  delete sim.moves[actorId]
}

function followX(sim) {
  const player = Object.values(sim.actors)[0]
  return player ? player.x - sim.screen.width / 2 : 0
}

function hideDialogue(sim) { sim.dialogue = null; sim.choice = null }

function nextIsText(sim) {
  const next = sim.ops[sim.pc]
  return next && (next.op === OP.SAY || next.op === OP.CHOICE)
}

function stop(sim) {
  for (const id of Object.keys(sim.moves)) finishMove(sim, id)
  hideDialogue(sim)
  sim.camera.fixed = sim.camera.moving = false
  sim.done = true
  sim.state = 'done'
  note(sim, 'Fim da cena')
}

function execute(sim) {
  const op = sim.ops[sim.pc]
  if (!op) { stop(sim); return false }
  const step = stepOf(sim, op)
  sim.currentPath = op.path
  sim.pc++
  switch (op.op) {
    case OP.END: stop(sim); return false
    case OP.WAIT: sim.timer = op.args[0]; sim.state = 'wait'; return true
    case OP.MOVE: {
      const actor = sim.actors[step.actor]
      if (!actor) return true
      const hasY = step.y !== undefined && step.y !== null && step.y !== ''
      const x = step.relative ? actor.x + Number(step.x || 0) : Number(step.x || 0)
      const y = hasY ? (step.relative ? actor.y + Number(step.y || 0) : Number(step.y)) : actor.y
      startMove(sim, step.actor, x, y, (op.args[3] || 256) / 256)
      if ((op.args[4] & 1) && sim.moves[step.actor]) { sim.waitActor = step.actor; sim.state = 'move' }
      return true
    }
    case OP.PLACE: {
      const actor = sim.actors[step.actor]
      if (!actor) return true
      delete sim.moves[step.actor]
      actor.lift = 0
      actor.moving = false
      actor.x = Number(step.x || 0)
      if (step.y !== undefined && step.y !== null && step.y !== '') actor.y = Number(step.y)
      return true
    }
    case OP.FACE: {
      const actor = sim.actors[step.actor]
      if (!actor) return true
      if (step.direction === 'actor') {
        const target = sim.actors[step.target]
        if (target && target.x !== actor.x) actor.left = target.x < actor.x
      } else actor.left = step.direction === 'left'
      return true
    }
    case OP.ANIMATE: if (sim.actors[step.actor]) sim.actors[step.actor].animation = step.animation || 'auto'; return true
    case OP.VISIBLE: if (sim.actors[step.actor]) sim.actors[step.actor].visible = step.visible !== false; return true
    case OP.SAY:
      if (sim.fastForward) return true
      sim.choice = null
      sim.dialogue = { speaker: op.speaker, lines: op.lines, portrait: op.portrait, side: op.side, actor: op.actor }
      sim.state = 'dialogue'
      return true
    case OP.CHOICE: {
      const cursor = Math.min(op.args[2] || 0, Math.max(0, op.options.length - 1))
      if (sim.fastForward || !op.options.length) { sim.pc = op.targets?.[cursor] ?? sim.pc; return true }
      sim.dialogue = null
      sim.choice = { prompt: op.prompt, options: op.options, cursor, targets: op.targets || [] }
      sim.state = 'choice'
      return true
    }
    case OP.CAMERA: {
      if (step.mode === 'follow') { sim.camera.fixed = sim.camera.moving = false; return true }
      if (!sim.camera.fixed) sim.camera.x = clampCamera(sim, followX(sim))
      const target = clampCamera(sim, step.mode === 'x' ? Number(step.x || 0) : (sim.actors[step.actor]?.x || 0) - sim.screen.width / 2)
      sim.camera.fixed = true
      sim.camera.target = target
      sim.camera.speed = (op.args[2] || 0) / 256
      if (!op.args[2] || sim.fastForward) { sim.camera.x = target; sim.camera.moving = false }
      else { sim.camera.moving = true; if (op.args[3] & 1) sim.state = 'camera' }
      return true
    }
    case OP.FADE: {
      const to = op.args[0] ? 1 : 0
      const frames = sim.fastForward ? 0 : op.args[1]
      sim.fade = { value: frames ? sim.fade.value : to, from: sim.fade.value, to, frames, elapsed: 0 }
      sim.timer = frames
      sim.state = 'wait'
      return true
    }
    case OP.SOUND: if (!sim.fastForward) note(sim, `♪ Som: ${step.sound}`); return true
    case OP.MUSIC: note(sim, `♫ Música: ${step.music || 'room'}`); return true
    case OP.SET_FLAG:
      if (step.value === false) sim.flags.delete(step.flag); else sim.flags.add(step.flag)
      note(sim, `⚑ ${step.flag} = ${step.value !== false}`)
      return true
    case OP.IF_FLAG:
      if (sim.flags.has(step.flag) !== (step.value !== false)) sim.pc = op.target
      return true
    case OP.JUMP: sim.pc = op.target; return true
    case OP.ABILITY: note(sim, `★ Habilidade: ${step.ability}`); return true
    case OP.EVENT: note(sim, `⚙ Evento: ${step.event} (${step.arg || 0})`); return true
    case OP.WAIT_MOVES: sim.state = 'moves'; return true
    case OP.ROUTE: {
      const count = op.args[3]
      const route = sim.ops.slice(sim.pc, sim.pc + count).map(item => item.args)
      sim.pc += count
      startRoute(sim, step.actor, op.args[1], op.args[2], route)
      if ((op.args[1] & 1) && sim.moves[step.actor]) { sim.waitActor = step.actor; sim.state = 'move' }
      return true
    }
    default: return true
  }
}

export function clampCamera(sim, x) {
  const width = sim.mapWidth || sim.screen.width
  return Math.max(0, Math.min(Math.max(0, width - sim.screen.width), Math.round(x)))
}

/** Advances one frame. input: { confirm, up, down, skip } of new presses. */
export function previewStep(sim, input = {}) {
  if (sim.done) return
  sim.frame++
  if (input.skip && !sim.fastForward) {
    sim.fastForward = true
    if (sim.state === 'choice') { sim.pc = sim.choice.targets[sim.choice.cursor] ?? sim.pc; sim.state = 'run' }
    else if (sim.state === 'dialogue') sim.state = 'run'
    hideDialogue(sim)
  }
  for (const [id, move] of Object.entries(sim.moves)) {
    const actor = sim.actors[id]
    if (sim.fastForward) { finishMove(sim, id); continue }
    if (move.route) { updateRoute(sim, id); continue }
    actor.x = approach(actor.x, move.x, move.speed)
    actor.y = approach(actor.y, move.y, move.speed)
    actor.moving = true
    if (actor.x === move.x && actor.y === move.y) finishMove(sim, id)
  }
  if (sim.camera.moving) {
    sim.camera.x = sim.fastForward ? sim.camera.target : approach(sim.camera.x, sim.camera.target, sim.camera.speed)
    if (sim.camera.x === sim.camera.target) sim.camera.moving = false
  }
  if (sim.fade.frames) {
    sim.fade.elapsed = Math.min(sim.fade.frames, sim.fade.elapsed + 1)
    sim.fade.value = sim.fade.from + (sim.fade.to - sim.fade.from) * sim.fade.elapsed / sim.fade.frames
  }
  let confirm = !!input.confirm
  for (let guard = 0; guard < 64 && !sim.done; guard++) {
    switch (sim.state) {
      case 'wait':
        if (!sim.fastForward && sim.timer > 0) { sim.timer--; return }
        sim.state = 'run'; break
      case 'move':
        if (sim.moves[sim.waitActor]) return
        sim.state = 'run'; break
      case 'moves':
        if (Object.values(sim.moves).some(move => !(move.route && move.repeat < 0))) return
        sim.state = 'run'; break
      case 'camera':
        if (sim.camera.moving) return
        sim.state = 'run'; break
      case 'dialogue':
        if (!confirm) return
        confirm = false
        if (!nextIsText(sim)) hideDialogue(sim)
        sim.state = 'run'; break
      case 'choice':
        if (input.up || input.down) {
          const count = sim.choice.options.length
          sim.choice.cursor = (sim.choice.cursor + (input.up ? count - 1 : 1)) % count
          input = { ...input, up: false, down: false }
        }
        if (!confirm) return
        confirm = false
        sim.pc = sim.choice.targets[sim.choice.cursor] ?? sim.pc
        if (!nextIsText(sim)) hideDialogue(sim)
        else sim.choice = null
        sim.state = 'run'; break
      default:
        if (!execute(sim)) return
    }
  }
}

/** Camera x the preview should show this frame. */
export function previewCameraX(sim) {
  return sim.camera.fixed ? sim.camera.x : clampCamera(sim, followX(sim))
}
