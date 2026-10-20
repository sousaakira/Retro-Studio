// Inimigos: definições reutilizáveis (enemies/enemies.json) + instâncias colocadas nos mapas
// (objetos type="enemy" do TMX). Funções puras, usadas pelo editor e pelo exportador.
// O C gerado alimenta o runtime assets/toolkit/lib/runtime/enemy (veja docs/ENEMY_RUNTIME.md).
export const ENEMY_FORMAT = 'retro-studio.enemies'
export const ENEMY_VERSION = 1
export const ENEMY_ROLES = ['idle', 'walk', 'attack', 'hurt', 'death']
export const ENEMY_ROLE_LABELS = { idle: 'Parado', walk: 'Andando', attack: 'Ataque', hurt: 'Dano', death: 'Morte' }
/** Comportamentos conhecidos. Para um novo: entrada aqui, campos em BEHAVIOR_FIELDS e
 * a função de tick com o mesmo id em retro_enemy.c. */
export const ENEMY_BEHAVIORS = {
  'ground-patrol': { id: 1, label: 'Patrulheiro terrestre', description: 'Anda entre limites, vira em paredes e (opcional) antes de cair de bordas.' }
}
export const ENEMY_RESPAWN = { room: 0, never: 1, delay: 2 }
export const ENEMY_RESPAWN_LABELS = { room: 'Ao voltar à sala', never: 'Nunca (fica derrotado)', delay: 'Após um tempo, fora da tela' }
/** Limites fixos do runtime (RETRO_ENEMY_POOL_MAX e RETRO_ENEMY_ROOM_SPAWN_MAX). */
export const ENEMY_POOL_MAX = 8
export const ENEMY_ROOM_SPAWN_MAX = 32
export const ENEMY_DEFINITION_MAX = 64
export const ENEMY_INSTANCE_MAX = 1024
export const ENEMY_SOURCE = 'enemies/enemies.json'
export const ENEMY_HEADER = 'src/generated/enemy_data.h'
export const ENEMY_RESOURCE_FILE = 'res/enemies.res'

const ID = /^[a-z][a-z0-9_]{0,39}$/
const rectKeys = ['x', 'y', 'width', 'height']
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const macro = text => String(text || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
const cString = text => String(text).replace(/\*\//g, '* /').replace(/[\r\n]/g, ' ')

export function createEnemyConfiguration() {
  return {
    format: ENEMY_FORMAT, version: ENEMY_VERSION,
    settings: { maxActive: 4, activationMargin: 32, gravity: 900, maxFall: 240, palette: { mode: 'shared', slot: 1, from: '' } },
    definitions: []
  }
}

export function createEnemyDefinition(id = 'inimigo', name = 'Inimigo') {
  return {
    id, name, character: '',
    animations: { idle: '', walk: '', attack: '', hurt: '', death: '' },
    behavior: { type: 'ground-patrol', turnAtEdges: true, turnAtWalls: true, pauseMs: 250 },
    health: 3, speed: 45, contactDamage: 1, detectionRange: 0,
    body: null, hurt: null,
    attack: { enabled: false, box: null, damage: 1, windupMs: 300, strikeMs: 150, recoveryMs: 400 },
    hurtMs: null, invulnerableMs: 500
  }
}

function rect(value, label) {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value) || !rectKeys.every(key => integer(value[key], -256, 256)) || value.width < 1 || value.height < 1)
    throw new Error(label + ': use x, y, largura e altura inteiros (largura e altura a partir de 1).')
  return value
}

/** Valida a estrutura (não resolve personagens nem salas). Lança Error com a mensagem para a interface. */
export function validateEnemyConfiguration(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.format !== ENEMY_FORMAT) throw new Error('Arquivo de inimigos em formato desconhecido.')
  if (config.version !== ENEMY_VERSION) throw new Error('Arquivo de inimigos na versão ' + config.version + '; esta IDE lê a versão ' + ENEMY_VERSION + '.')
  const s = config.settings
  if (!s || typeof s !== 'object') throw new Error('Inimigos sem a seção de ajustes gerais.')
  if (!integer(s.maxActive, 1, ENEMY_POOL_MAX)) throw new Error('Inimigos ativos ao mesmo tempo: de 1 a ' + ENEMY_POOL_MAX + '.')
  if (!integer(s.activationMargin, 0, 512)) throw new Error('Margem de ativação: de 0 a 512 pixels.')
  if (!finite(s.gravity, 0, 4000)) throw new Error('Gravidade dos inimigos: de 0 a 4000 pixels/s².')
  if (!finite(s.maxFall, 0, 960)) throw new Error('Queda máxima dos inimigos: de 0 a 960 pixels/s.')
  const p = s.palette
  if (!p || !['shared', 'own'].includes(p.mode) || !integer(p.slot, 0, 3)) throw new Error('Paleta dos inimigos: escolha "compartilhada" ou "própria" e uma linha de 0 a 3.')
  if (p.mode === 'shared' && (typeof p.from !== 'string' || (p.from && !/^charsets\/[^/\\]+\.charset\.json$/.test(p.from)))) throw new Error('Paleta compartilhada: escolha o personagem cuja paleta já está na linha (ex.: o jogador).')
  if (p.reserved !== undefined && (!Array.isArray(p.reserved) || p.reserved.some(slot => !integer(slot, 0, 3)))) throw new Error('Linhas de paleta reservadas: números de 0 a 3.')
  if (!Array.isArray(config.definitions) || config.definitions.length > ENEMY_DEFINITION_MAX) throw new Error('Inimigos: no máximo ' + ENEMY_DEFINITION_MAX + ' definições.')
  const ids = new Set()
  for (const d of config.definitions) {
    const where = 'Inimigo "' + (d && d.name || d && d.id || '?') + '"'
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Definição de inimigo inválida.')
    if (typeof d.id !== 'string' || !ID.test(d.id)) throw new Error(where + ': o ID usa letras minúsculas, números e _ (começando por letra, até 40).')
    if (ids.has(d.id)) throw new Error('ID de inimigo repetido: ' + d.id + '.')
    ids.add(d.id)
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 60) throw new Error(where + ': dê um nome (até 60 caracteres).')
    if (typeof d.character !== 'string' || (d.character && !/^charsets\/[^/\\]+\.charset\.json$/.test(d.character))) throw new Error(where + ': o personagem precisa ser um projeto do Charset Maker em charsets/.')
    if (!d.animations || typeof d.animations !== 'object') throw new Error(where + ': sem animações.')
    for (const role of ENEMY_ROLES) if (typeof d.animations[role] !== 'string' || d.animations[role].length > 80) throw new Error(where + ': animação inválida para "' + ENEMY_ROLE_LABELS[role] + '".')
    for (const key of Object.keys(d.animations)) if (!ENEMY_ROLES.includes(key)) throw new Error(where + ': papel de animação desconhecido: ' + key + '.')
    const b = d.behavior
    if (!b || !ENEMY_BEHAVIORS[b.type]) throw new Error(where + ': comportamento desconhecido' + (b && b.type ? ' (' + b.type + ')' : '') + '.')
    if (b.type === 'ground-patrol' && (typeof b.turnAtEdges !== 'boolean' || typeof b.turnAtWalls !== 'boolean' || !integer(b.pauseMs, 0, 10000))) throw new Error(where + ': ajustes do patrulheiro inválidos.')
    if (!integer(d.health, 1, 999)) throw new Error(where + ': vida de 1 a 999.')
    if (!finite(d.speed, 0, 600)) throw new Error(where + ': velocidade de 0 a 600 pixels/s.')
    if (!integer(d.contactDamage, 0, 99)) throw new Error(where + ': dano de contato de 0 a 99.')
    if (!integer(d.detectionRange, 0, 512)) throw new Error(where + ': alcance de detecção de 0 a 512 pixels.')
    rect(d.body, where + ', corpo'); rect(d.hurt, where + ', área vulnerável')
    const a = d.attack
    if (!a || typeof a.enabled !== 'boolean' || !integer(a.damage, 0, 99) || !integer(a.windupMs, 0, 10000) || !integer(a.strikeMs, 0, 10000) || !integer(a.recoveryMs, 0, 10000)) throw new Error(where + ': ajustes de ataque inválidos.')
    rect(a.box, where + ', área de ataque')
    if (d.hurtMs !== null && !integer(d.hurtMs, 0, 10000)) throw new Error(where + ': tempo de dano de 0 a 10000 ms (ou vazio para usar a animação).')
    if (!integer(d.invulnerableMs, 0, 10000)) throw new Error(where + ': invulnerabilidade de 0 a 10000 ms.')
  }
  return config
}

/** Propriedades de uma instância no mapa (TMX). A referência estável é "enemy"; "kind" continua
 * aceito (projetos antigos) e é mantido igual ao ID pelo editor de mapas. */
export const ENEMY_INSTANCE_PROPERTIES = ['enemy', 'kind', 'facing', 'patrolLeft', 'patrolRight', 'activation', 'respawn', 'respawnDelayMs']
export function enemyInstance(object, settings) {
  const props = object.properties || {}
  const text = key => props[key] === undefined || props[key] === null ? '' : String(props[key]).trim()
  const number = (key, fallback, min, max, label) => {
    const raw = text(key)
    if (raw === '') return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(label + ' precisa ser um inteiro de ' + min + ' a ' + max + '.')
    return value
  }
  const reference = text('enemy') || text('kind')
  const facing = text('facing') || 'right'
  if (!['left', 'right'].includes(facing)) throw new Error('Orientação inicial: "left" ou "right".')
  const respawn = text('respawn') || 'room'
  if (!(respawn in ENEMY_RESPAWN)) throw new Error('Reaparecimento: room, never ou delay.')
  return {
    reference, facingLeft: facing === 'left',
    patrolLeft: number('patrolLeft', 0, 0, 4096, 'Limite de patrulha à esquerda'),
    patrolRight: number('patrolRight', 0, 0, 4096, 'Limite de patrulha à direita'),
    activation: number('activation', settings.activationMargin, 0, 512, 'Ativação por proximidade'),
    respawn, respawnDelayMs: number('respawnDelayMs', 3000, 0, 600000, 'Tempo para reaparecer')
  }
}

/** Painel do objeto no editor de mapas: escolher o tipo grava "enemy" e mantém "kind" igual
 * (compatibilidade); vazio limpa "enemy" e deixa "kind" vazio. Devolve propriedades novas. */
export function setEnemyInstanceType(properties, id) {
  const next = { ...(properties || {}) }
  if (id) { next.enemy = id; next.kind = id } else { delete next.enemy; next.kind = '' }
  return next
}
/** Uma propriedade da instância: vazio remove (usa o padrão); números viram inteiros >= 0. */
export function setEnemyInstanceProperty(properties, key, value) {
  const next = { ...(properties || {}) }, text = String(value ?? '').trim()
  if (text === '') delete next[key]
  else next[key] = ['patrolLeft', 'patrolRight', 'activation', 'respawnDelayMs'].includes(key) ? Math.max(0, Math.round(Number(text) || 0)) : text
  return next
}

/** Objetos do TMX (sem DOM): id, name, type/class, x, y, width, height e propriedades. */
export function parseTmxObjects(xml) {
  const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const attributes = text => Object.fromEntries([...text.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)].map(match => [match[1], decode(match[2])]))
  const objects = []
  for (const match of String(xml).matchAll(/<object\b([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g)) {
    const a = attributes(match[1]), properties = {}
    for (const prop of (match[3] || '').matchAll(/<property\b([^>]*?)(\/>|>([\s\S]*?)<\/property>)/g)) {
      const p = attributes(prop[1])
      if (p.name) properties[p.name] = p.value !== undefined ? p.value : decode(prop[3] || '')
    }
    objects.push({ id: Number(a.id) || 0, name: a.name || '', type: a.type || a.class || '', x: Number(a.x) || 0, y: Number(a.y) || 0,
      width: Number(a.width) || 0, height: Number(a.height) || 0, properties })
  }
  return objects
}

const ticks = (ms, hz) => Math.max(1, Math.min(65535, Math.round(ms * hz / 1000)))
const optionalTicks = (ms, hz) => ms ? ticks(ms, hz) : 0
const perTick = (pixelsPerSecond, hz) => Math.round(pixelsPerSecond * 256 / hz)
const perTick2 = (pixelsPerSecond2, hz) => Math.round(pixelsPerSecond2 * 256 / (hz * hz))
const scaleTicks = (list, hz) => list.map(value => hz === 60 ? value : Math.max(1, Math.round(value * hz / 60)))
const rectC = r => '{' + [r.x, r.y, r.width, r.height].join(',') + '}'

/**
 * Resolve definições contra os personagens e as instâncias contra as definições.
 * characters: Map(caminho do charset → { name, resource, frameWidth, frameHeight, anchorX, anchorY,
 *   body, hurt, animations: Map(nome → { index, ticks: number[] (60 Hz), loop, attack|null }) } | { problem })
 * rooms: [{ id, numericId, name, map, objects: parseTmxObjects() } | { id, name, problem }]
 * palette: { slot, resources: Map(caminho do charset → símbolo do sprite a usar), header: 'enemies.h'|null, ownPalette: símbolo|null }
 * Devolve { problems, warnings, definitions, rooms, instanceCount } — problems vazios = pronto para gerar.
 */
export function resolveEnemies(config, characters, rooms) {
  const problems = [], warnings = [], index = new Map()
  const definitions = config.definitions.map((d, position) => {
    const where = 'Inimigo "' + d.name + '"'
    index.set(d.id, position)
    const out = { id: d.id, name: d.name, position, character: null, roles: {}, fallbacks: {} }
    if (!d.character) { problems.push(where + ': escolha o personagem (do Charset Maker).'); return out }
    const character = characters.get(d.character)
    if (!character) { problems.push(where + ': o personagem ' + d.character + ' não foi encontrado.'); return out }
    if (character.problem) { problems.push(where + ': ' + character.problem); return out }
    out.character = character
    for (const role of ENEMY_ROLES) {
      const name = d.animations[role]
      if (!name) continue
      if (!character.animations.has(name)) problems.push(where + ': a animação "' + name + '" (' + ENEMY_ROLE_LABELS[role] + ') não existe mais em ' + character.name + '.')
      else out.roles[role] = name
    }
    if (!d.animations.idle) problems.push(where + ': escolha a animação "Parado" (obrigatória; as outras usam fallback).')
    // Fallbacks explícitos, mostrados no editor e comentados no C gerado.
    const chain = { walk: ['idle'], attack: ['idle'], hurt: ['idle'], death: ['hurt'] }
    for (const role of ENEMY_ROLES.slice(1)) {
      if (out.roles[role]) continue
      const from = chain[role].find(other => out.roles[other])
      out.fallbacks[role] = from || 'none'
      if (role === 'death' && !from) warnings.push(where + ': sem animação de morte nem de dano; o inimigo pisca e some.')
    }
    if (d.attack.enabled) {
      if (!d.detectionRange) problems.push(where + ': o ataque precisa de alcance de detecção maior que 0.')
      const box = d.attack.box || (out.roles.attack && character.animations.get(out.roles.attack).attack)
      if (!box) problems.push(where + ': defina a área de ataque (ou marque-a na animação de ataque, no Charset Maker).')
      out.attackBox = box || null
    }
    out.body = d.body || character.body
    out.hurt = d.hurt || character.hurt || out.body
    if (!out.body) problems.push(where + ': defina o corpo de colisão (ou marque-o no Charset Maker).')
    return out
  })
  let uid = 0
  const resolvedRooms = []
  for (const room of rooms) {
    if (room.problem) { problems.push('Sala "' + room.name + '": ' + room.problem); continue }
    const spawns = []
    for (const object of room.objects.filter(o => String(o.type).toLowerCase() === 'enemy').sort((a, b) => a.id - b.id)) {
      const where = 'Sala "' + room.name + '", objeto #' + object.id + (object.name ? ' (' + object.name + ')' : '')
      let instance
      try { instance = enemyInstance(object, config.settings) } catch (error) { problems.push(where + ': ' + error.message); continue }
      if (!instance.reference) { problems.push(where + ': escolha qual inimigo é esta instância — selecione o objeto no mapa e escolha o "Tipo de inimigo" no painel (propriedade "enemy").'); continue }
      if (!index.has(instance.reference)) { problems.push(where + ': o inimigo "' + instance.reference + '" não está cadastrado em Inimigos.'); continue }
      const x = Math.round(object.x + object.width / 2), y = Math.round(object.y + object.height)
      if (x < 0 || y < 0 || x > 32767 || y > 32767) { problems.push(where + ': posição fora da sala.'); continue }
      const left = instance.patrolLeft || instance.patrolRight ? Math.max(0, x - instance.patrolLeft) : 0
      const right = instance.patrolLeft || instance.patrolRight ? x + instance.patrolRight : 0
      spawns.push({ uid: uid++, objectId: object.id, name: object.name, definition: index.get(instance.reference), x, y, left, right, ...instance })
    }
    if (spawns.length > ENEMY_ROOM_SPAWN_MAX) problems.push('Sala "' + room.name + '": ' + spawns.length + ' inimigos; o runtime aceita até ' + ENEMY_ROOM_SPAWN_MAX + ' por sala.')
    resolvedRooms.push({ id: room.id, numericId: room.numericId, name: room.name, spawns })
  }
  if (uid > ENEMY_INSTANCE_MAX) problems.push('Inimigos colocados: ' + uid + '; o limite é ' + ENEMY_INSTANCE_MAX + '.')
  return { problems, warnings, definitions, rooms: resolvedRooms, instanceCount: uid }
}

function definitionC(config, d, def, hz, ticksName, palette) {
  const c = def.character, s = config.settings
  const anim = role => {
    const name = def.roles[role] || (def.fallbacks[role] && def.fallbacks[role] !== 'none' ? def.roles[def.fallbacks[role]] : '')
    if (!name) return '{0,0,RETRO_ENEMY_NO_ANIMATION,0}'
    const a = c.animations.get(name)
    return '{' + a.ticks.length + ',' + ticksName(name) + ',' + a.index + ',' + (role === 'death' || role === 'attack' || role === 'hurt' ? 0 : a.loop ? 1 : 0) + '}'
  }
  const sum = name => name ? scaleTicks(c.animations.get(name).ticks, hz).reduce((total, value) => total + value, 0) : 0
  const hurtName = def.roles.hurt || (def.fallbacks.hurt !== 'none' ? def.roles[def.fallbacks.hurt] : '')
  const deathName = def.roles.death || (def.fallbacks.death !== 'none' ? def.roles[def.fallbacks.death] : '')
  const flags = []
  if (d.behavior.turnAtEdges) flags.push('RETRO_ENEMY_TURN_AT_EDGES')
  if (d.behavior.turnAtWalls) flags.push('RETRO_ENEMY_TURN_AT_WALLS')
  if (d.attack.enabled) flags.push('RETRO_ENEMY_CAN_ATTACK')
  const attackBox = d.attack.enabled && def.attackBox ? def.attackBox : { x: 0, y: 0, width: 0, height: 0 }
  return ' { /* ' + cString(d.name) + ' (' + d.id + ') */\n' +
    '  .behavior=' + ENEMY_BEHAVIORS[d.behavior.type].id + ',.flags=' + (flags.join('|') || '0') + ',.health=' + d.health + ',\n' +
    '  .speed=' + perTick(d.speed, hz) + ',.gravity=' + perTick2(s.gravity, hz) + ',.maxFall=' + perTick(s.maxFall, hz) + ',\n' +
    '  .contactDamage=' + d.contactDamage + ',.attackDamage=' + (d.attack.enabled ? d.attack.damage : 0) + ',.detectionRange=' + (d.attack.enabled ? d.detectionRange : 0) + ',\n' +
    '  .body=' + rectC(def.body) + ',.hurt=' + rectC(def.hurt) + ',.attack=' + rectC(attackBox) + ',\n' +
    '  .windupTicks=' + ticks(d.attack.windupMs, hz) + ',.strikeTicks=' + ticks(d.attack.strikeMs, hz) + ',.recoveryTicks=' + ticks(d.attack.recoveryMs, hz) + ',\n' +
    '  .hurtTicks=' + (d.hurtMs === null ? Math.max(1, sum(hurtName) || ticks(250, hz)) : optionalTicks(d.hurtMs, hz)) +
    ',.invulnerableTicks=' + optionalTicks(d.invulnerableMs, hz) + ',.deathTicks=' + (sum(deathName) || ticks(500, hz)) + ',.pauseTicks=' + optionalTicks(d.behavior.pauseMs, hz) + ',\n' +
    '  .animations={' + ENEMY_ROLES.map(anim).join(',') + '},\n' +
    '  .visual=&' + palette.resources.get(d.character) + ',.palette=PAL' + config.settings.palette.slot + ',\n' +
    '  .frameWidth=' + c.frameWidth + ',.frameHeight=' + c.frameHeight + ',.anchorX=' + c.anchorX + ',.anchorY=' + c.anchorY + '\n }'
}

/** C do runtime (src/generated/enemy_data.h). Incluir em um único .c (tem tabelas static). */
export function compileEnemyHeader(config, resolved, palette) {
  if (resolved.problems.length) throw new Error(resolved.problems[0])
  const lines = ['/* Gerado pelo Retro Studio (modo Jogo → Inimigos). Não edite: refeito a cada exportação.',
    ' * Fonte: ' + ENEMY_SOURCE + ' + objetos type="enemy" das salas. Inclua em um único .c. */',
    '#ifndef RETROSTUDIO_ENEMY_DATA_H', '#define RETROSTUDIO_ENEMY_DATA_H', '#include <genesis.h>',
    '#include "../retro_runtime/retro_enemy.h"', '#include "../../res/resources.h"']
  if (palette.header) lines.push('#include "../../res/' + palette.header + '"')
  lines.push('#if RETRO_RUNTIME_ENEMY_VERSION < 1', '#error "Instale o módulo de runtime enemy (Jogo → Runtime)."', '#endif',
    '#define RETRO_ENEMY_DATA_DEFINITION_COUNT ' + config.definitions.length,
    '#define RETRO_ENEMY_DATA_INSTANCE_COUNT ' + resolved.instanceCount,
    '#define RETRO_ENEMY_DATA_DEFEATED_BYTES ' + Math.max(1, Math.ceil(resolved.instanceCount / 8)),
    '#define RETRO_ENEMY_DATA_MAX_ACTIVE ' + config.settings.maxActive,
    '#define RETRO_ENEMY_DATA_PALETTE PAL' + config.settings.palette.slot,
    '#define RETRO_ENEMY_DATA_PALETTE_SHARED ' + (config.settings.palette.mode === 'shared' ? 1 : 0))
  config.definitions.forEach((d, i) => lines.push('#define RETRO_ENEMY_' + macro(d.id) + ' ' + i))
  const ticksArrays = []
  const tickName = (hz, character, name) => 'retroEnemyTicks' + (hz === 60 ? 'Ntsc' : 'Pal') + '_' + macro(character.name) + '_' + macro(name)
  for (const hz of [60, 50]) {
    const seen = new Set()
    resolved.definitions.forEach(def => {
      for (const name of Object.values(def.roles)) {
        const key = def.character.name + '/' + name
        if (seen.has(key)) continue
        seen.add(key)
        ticksArrays.push('static const uint16_t ' + tickName(hz, def.character, name) + '[]={' + scaleTicks(def.character.animations.get(name).ticks, hz).join(',') + '};')
      }
    })
  }
  lines.push(...ticksArrays)
  for (const hz of [60, 50]) {
    lines.push('static const RetroEnemyDefinition retroEnemyDefinitions' + (hz === 60 ? 'Ntsc' : 'Pal') + '[' + Math.max(1, config.definitions.length) + ']={')
    lines.push(config.definitions.map((d, i) => definitionC(config, d, resolved.definitions[i], hz, name => tickName(hz, resolved.definitions[i].character, name), palette)).join(',\n') || ' {0}')
    lines.push('};')
  }
  const respawnC = { room: 'RETRO_ENEMY_RESPAWN_ROOM', never: 'RETRO_ENEMY_RESPAWN_NEVER', delay: 'RETRO_ENEMY_RESPAWN_DELAY' }
  for (const hz of [60, 50]) for (const room of resolved.rooms) {
    if (!room.spawns.length) continue
    lines.push('static const RetroEnemySpawn retroEnemyRoom' + room.numericId + (hz === 60 ? 'Ntsc' : 'Pal') + '[]={ /* ' + cString(room.name) + ' */')
    lines.push(room.spawns.map(s => ' {' + [s.uid, s.definition, s.x, s.y, s.left, s.right, s.activation, s.respawn === 'delay' ? ticks(s.respawnDelayMs, hz) : 0, s.facingLeft ? 1 : 0, respawnC[s.respawn]].join(',') +
      '} /* #' + s.objectId + (s.name ? ' ' + cString(s.name) : '') + ' */').join(',\n'))
    lines.push('};')
  }
  lines.push('typedef struct {u16 room;const RetroEnemySpawn *ntsc,*pal;u16 count;} RetroEnemyRoomData;')
  const withSpawns = resolved.rooms.filter(room => room.spawns.length)
  lines.push('#define RETRO_ENEMY_DATA_ROOM_COUNT ' + withSpawns.length)
  lines.push('static const RetroEnemyRoomData retroEnemyRooms[' + Math.max(1, withSpawns.length) + ']={')
  lines.push(withSpawns.map(room => ' {' + room.numericId + ',retroEnemyRoom' + room.numericId + 'Ntsc,retroEnemyRoom' + room.numericId + 'Pal,' + room.spawns.length + '}').join(',\n') || ' {0xFFFF,0,0,0}')
  lines.push('};')
  lines.push('static inline const RetroEnemyDefinition *retroEnemyDataDefinitions(void) {return IS_PAL_SYSTEM?retroEnemyDefinitionsPal:retroEnemyDefinitionsNtsc;}')
  lines.push('/* Instâncias da sala; count 0 e NULL quando a sala não tem inimigos. */')
  lines.push('static inline const RetroEnemySpawn *retroEnemyDataRoom(u16 room,u16 *count) {u16 i;for(i=0;i<RETRO_ENEMY_DATA_ROOM_COUNT;i++)if(retroEnemyRooms[i].room==room){*count=retroEnemyRooms[i].count;return IS_PAL_SYSTEM?retroEnemyRooms[i].pal:retroEnemyRooms[i].ntsc;}*count=0;return 0;}')
  if (config.settings.palette.mode === 'own') lines.push('/* Paleta própria: carregue depois da sala (a sala não usa a linha ' + config.settings.palette.slot + '). */',
    'static inline void retroEnemyDataLoadPalette(void) {PAL_setPalette(RETRO_ENEMY_DATA_PALETTE,' + palette.ownPalette + '.palette->data,DMA);}')
  else lines.push('/* Paleta compartilhada: a linha ' + config.settings.palette.slot + ' já é carregada pelo jogo; nada a fazer. */', 'static inline void retroEnemyDataLoadPalette(void) {}')
  lines.push('#endif', '')
  return lines.join('\n')
}
