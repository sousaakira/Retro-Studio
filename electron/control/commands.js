/**
 * API de controle por IA (#77): lista única de comandos usada pelo agente interno e pelo MCP
 * dos agentes ACP. Sem dependência do Electron: o processo principal injeta `deps` e cada
 * chamada recebe o contexto da janela (`workspace` canônico e `webContents`).
 *
 * Cada comando: name, description (pt-BR), kind ('read' | 'write'), inputSchema (JSON Schema),
 * agents (quem pode usar: 'acp', 'internal') e run(args, context, deps).
 * run devolve { data } (vira texto JSON) e, opcionalmente, { image: { base64, mimeType } }.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { listSongs, loadSong, saveSong } from '../retro/musicProject.js'
import { songFromAuthoring, songToAuthoring, analyzeSong } from '../../shared/retro/songAuthoring.js'
import { PRESET_INSTRUMENTS, INSTRUMENT_CATEGORIES } from '../../shared/retro/chipInstruments.js'
import { SONG_LIMITS } from '../../shared/retro/song.js'
import { MAP_NOTES_DIRECTORY, NOTE_STATUS, MAX_NOTE_TEXT, mapNotesFile, normalizeMapPath, parseMapNotes, serializeMapNotes, describeNotes } from '../../shared/retro/mapNotes.js'
import { parseTmxObjects } from '../../shared/retro/enemies.js'
import { writeTextFileAtomically } from '../retro/atomicText.js'
import { releasesStatus, readRelease, createRelease } from '../retro/romReleases.js'

export class ControlError extends Error {}

const MAX_FILE_BYTES = 256 * 1024
const MAX_TREE_ENTRIES = 1500
const SKIPPED_DIRECTORIES = new Set(['node_modules'])
const RENDERER_TIMEOUT_MS = 5000
const BUILD_RESULT_FILE = path.join('.retrostudio', 'last-acp-build.json')

/** Caminho do projeto informado pela IA (relativo ou absoluto) → caminho real dentro do workspace. */
export async function resolveInsideWorkspace(workspace, requested) {
  if (typeof requested !== 'string' || !requested.trim() || requested.includes('\0'))
    throw new ControlError('Caminho inválido.')
  const lexical = path.resolve(workspace, requested.trim())
  let real
  try { real = await fs.realpath(lexical) }
  catch { throw new ControlError(`Não encontrado: ${path.relative(workspace, lexical) || '.'}`) }
  const root = workspace.endsWith(path.sep) ? workspace : workspace + path.sep
  if (real !== workspace && !real.startsWith(root)) throw new ControlError('Caminho fora do projeto aberto.')
  return real
}

function relative(workspace, absolute) {
  return path.relative(workspace, absolute).split(path.sep).join('/') || '.'
}

/** Avalia uma expressão fixa (nunca vinda da IA) na janela da IDE, com prazo. */
async function askRenderer(context, expression) {
  const contents = context.webContents
  if (!contents || contents.isDestroyed?.()) throw new ControlError('A janela da IDE não está disponível.')
  let timer
  try {
    return await Promise.race([
      contents.executeJavaScript(expression, true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new ControlError('A IDE não respondeu a tempo.')), RENDERER_TIMEOUT_MS) })
    ])
  } finally { clearTimeout(timer) }
}

function summarizeBuild(result, extra = {}) {
  return {
    success: !!result?.success,
    romPath: result?.romPath || null,
    exitCode: result?.exitCode ?? null,
    error: result?.success ? null : (result?.error || result?.message || 'O build falhou.'),
    errors: Array.isArray(result?.errors) ? result.errors.slice(0, 40) : [],
    validation: result?.validation || null,
    stderrTail: result?.success ? '' : String(result?.stderrTail ?? result?.stderr ?? '').slice(-4000),
    ...extra
  }
}

/** Mantém o contrato de `.retrostudio/last-acp-build.json`, lido pelo painel ACP e pelo contexto de hardware. */
async function recordBuildResult(workspace, payload) {
  const file = path.join(workspace, BUILD_RESULT_FILE)
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ ...payload, at: Date.now() }, null, 2))
  } catch { /* o resultado continua indo na resposta */ }
}

async function runProjectBuild(context, deps, { clean = false, flavor } = {}) {
  const options = { clean: !!clean }
  if (flavor === 'debug' || flavor === 'release') options.flavor = flavor
  const result = await deps.runBuild(context.workspace, options)
  const summary = summarizeBuild(result)
  await recordBuildResult(context.workspace, { action: 'build', ...summary })
  return summary
}

async function walkTree(workspace, directory, depth, state) {
  let entries
  try { entries = await fs.readdir(directory, { withFileTypes: true }) }
  catch { return [] }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
  const children = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))) continue
    if (state.count >= MAX_TREE_ENTRIES) { state.truncated = true; break }
    state.count++
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const node = { name: entry.name, path: relative(workspace, absolute), kind: 'dir' }
      if (depth > 1) node.children = await walkTree(workspace, absolute, depth - 1, state)
      else node.collapsed = true
      children.push(node)
    } else if (entry.isFile()) {
      children.push({ name: entry.name, path: relative(workspace, absolute), kind: 'file' })
    }
  }
  return children
}

// Compositor (#89): guia de composição para a IA (formato, limites do chip e instrumentos).
const SONG_ID = /^[a-z][a-z0-9_]{0,31}$/
const MUSIC_GUIDE = {
  formato: 'Música em tempos: { id, name, tempo (BPM 30-300), beatsPerBar (padrão 4), bars (opcional), loop (true = música toda, false, ou {start, end} em compassos a partir de 1), fmChannels (6, ou 5 para deixar o FM 6 para efeitos PCM), instruments (opcional: instrumentos próprios), tracks: [{ name, instrument (ID), notes: [{ at, len, note, vel }] }] }.',
  notas: 'at = início em tempos (semínimas) a partir de 0; len = duração em tempos (0.5 = colcheia, 0.25 = semicolcheia); note = "C4" (dó central = 60), "F#3", "Bb2" ou 0..127; vel = 1..127 (padrão 100).',
  chip: 'YM2612: até 6 notas FM ao mesmo tempo (5 com fmChannels 5). PSG: 3 notas de onda quadrada (só de A2 para cima) e 1 de ruído. Acima do limite, a nota mais antiga é cortada. Cada faixa usa um instrumento; acordes numa faixa FM gastam uma voz FM por nota.',
  bateria: 'Use uma faixa por peça: bumbo (FM, notas graves ~C2-C3), tom (FM), caixa/chimbal/chimbal-aberto/prato/palmas (ruído do PSG; a altura da nota quase não importa; um ruído por vez).',
  dicas: 'Baixos soam bem entre E1 e E3; leads entre C4 e C6; acordes de cordas/pad com 3 notas. Deixe o ruído para a bateria. Confira music_write.analysis.warnings e ajuste.',
  exemplo: { id: 'tema_exemplo', name: 'Tema de exemplo', tempo: 120, loop: true, tracks: [
    { name: 'Baixo', instrument: 'baixo-slap', notes: [{ at: 0, len: 0.5, note: 'A1' }, { at: 0.5, len: 0.5, note: 'A2' }] },
    { name: 'Melodia', instrument: 'lead-quadrado', notes: [{ at: 0, len: 1, note: 'E5', vel: 110 }] },
    { name: 'Bumbo', instrument: 'bumbo', notes: [{ at: 0, len: 0.25, note: 'C2' }] }] }
}
function songArgument(value) {
  let input = value
  if (typeof input === 'string') { try { input = JSON.parse(input) } catch { throw new ControlError('"song" deve ser um objeto JSON.') } }
  try { return songFromAuthoring(input) } catch (error) { throw new ControlError(error.message) }
}
async function musicWorkspaceNotice(context, expression) {
  // Avisar o modo Música é opcional: sem janela (testes, IDE fechando), o comando segue.
  try { return JSON.parse(await askRenderer(context, expression) || 'null') } catch { return null }
}

// Notas para a IA nos mapas (#93): .retrostudio/map-notes/<mapa>.tmx.json, fora do TMX.
const MAP_NOTES_LIMIT_MAPS = 50
function noteMapPath(workspace, requested) {
  let value = typeof requested === 'string' ? requested.trim().replace(/\\/g, '/') : ''
  const root = workspace.split(path.sep).join('/') + '/'
  if (value.startsWith(root)) value = value.slice(root.length)
  const map = normalizeMapPath(value)
  if (!map) throw new ControlError('Informe o mapa como caminho .tmx relativo ao projeto (ex.: res/maps/fase1.tmx).')
  return map
}
async function readNotesFile(workspace, map) {
  const lexical = path.join(workspace, mapNotesFile(map))
  let file
  try { file = await resolveInsideWorkspace(workspace, lexical) } catch { return { file: lexical, raw: null } }
  return { file, raw: await fs.readFile(file, 'utf8') }
}
/** Tamanho e objetos do TMX (colisões, rampas, spawn...) para cruzar com a área das notas. */
async function readMapFacts(workspace, map) {
  try {
    const file = await resolveInsideWorkspace(workspace, map)
    const stat = await fs.stat(file)
    if (stat.size > 8 * 1024 * 1024) return { problem: 'TMX grande demais para ler os objetos.' }
    const xml = await fs.readFile(file, 'utf8')
    const head = /<map\b([^>]*)>/.exec(xml)?.[1] || ''
    const attr = name => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(head)?.[1]) || 0
    return { width: attr('width'), height: attr('height'), tileSize: attr('tilewidth') || 8, objects: parseTmxObjects(xml) }
  } catch (error) { return { problem: error instanceof ControlError ? error.message : 'Não foi possível ler o TMX.' } }
}
async function listNoteMaps(workspace) {
  const base = path.join(workspace, MAP_NOTES_DIRECTORY), found = []
  async function walk(dir, depth) {
    if (depth > 8 || found.length >= MAP_NOTES_LIMIT_MAPS) return
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && /\.tmx\.json$/i.test(entry.name)) {
        const map = normalizeMapPath(relative(base, full).replace(/\.json$/i, ''))
        if (map) found.push(map)
      }
    }
  }
  await walk(base, 0)
  return found.sort()
}
async function notesWorkspaceNotice(context, map) {
  try { return JSON.parse(await askRenderer(context, `Promise.resolve(window.retroStudioContext?.mapNotesChanged?.(${JSON.stringify(map)}) ?? null).then(value => JSON.stringify(value))`) || 'null') } catch { return null }
}

const commands = [
  {
    name: 'project_info',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Resumo do projeto aberto no Retro Studio: pasta, nome, configuração (retro-studio.json), toolkit configurado e ROM atual.',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, context, deps) {
      const { workspace } = context
      let config = null
      try {
        const raw = await fs.readFile(path.join(workspace, 'retro-studio.json'), 'utf8')
        config = raw.length <= MAX_FILE_BYTES ? JSON.parse(raw) : { error: 'retro-studio.json grande demais para resumir.' }
      } catch (error) {
        if (error.code !== 'ENOENT') config = { error: 'retro-studio.json inválido.' }
      }
      const rom = await deps.findRom?.(workspace)
      return {
        data: {
          workspace,
          name: path.basename(workspace),
          isRetroProject: !!config && !config.error,
          config,
          toolkitConfigured: !!(await deps.toolkitPath?.()),
          romPath: rom || null,
          ideVersion: deps.appVersion || null
        }
      }
    }
  },
  {
    name: 'project_tree',
    kind: 'read',
    agents: ['acp'],
    description: 'Árvore de arquivos do projeto (ignora pastas ocultas e node_modules). Use "path" para começar numa subpasta e "depth" (1 a 6) para a profundidade.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Pasta relativa ao projeto. Padrão: raiz.' },
        depth: { type: 'integer', minimum: 1, maximum: 6, description: 'Profundidade. Padrão: 2.' }
      }
    },
    async run(args, context) {
      const directory = await resolveInsideWorkspace(context.workspace, args.path || '.')
      const stat = await fs.stat(directory)
      if (!stat.isDirectory()) throw new ControlError('O caminho não é uma pasta.')
      const depth = Math.min(6, Math.max(1, Number.parseInt(args.depth, 10) || 2))
      const state = { count: 0, truncated: false }
      const children = await walkTree(context.workspace, directory, depth, state)
      return { data: { path: relative(context.workspace, directory), depth, entries: state.count, truncated: state.truncated, children } }
    }
  },
  {
    name: 'file_read',
    kind: 'read',
    agents: ['acp'],
    description: 'Lê um arquivo de texto do projeto (até 256 KB). "startLine"/"endLine" (a partir de 1) limitam o trecho.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Arquivo relativo ao projeto.' },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 }
      }
    },
    async run(args, context) {
      const file = await resolveInsideWorkspace(context.workspace, args.path)
      const stat = await fs.stat(file)
      if (!stat.isFile()) throw new ControlError('O caminho não é um arquivo.')
      if (stat.size > MAX_FILE_BYTES) throw new ControlError(`Arquivo grande demais (${stat.size} bytes; limite ${MAX_FILE_BYTES}).`)
      const content = await fs.readFile(file, 'utf8')
      if (content.includes('\0')) throw new ControlError('O arquivo é binário.')
      const lines = content.split('\n')
      const start = Math.max(1, Number.parseInt(args.startLine, 10) || 1)
      const end = Math.min(lines.length, Number.parseInt(args.endLine, 10) || lines.length)
      if (end < start) throw new ControlError('Intervalo de linhas vazio.')
      return { data: { path: relative(context.workspace, file), totalLines: lines.length, startLine: start, endLine: end, content: lines.slice(start - 1, end).join('\n') } }
    }
  },
  {
    name: 'ide_state',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'O que está na tela do Retro Studio: editor ativo (código, mapas, cenas, personagens), arquivo atual, abas abertas e não salvas, se está compilando ou rodando o jogo, e quantos erros de compilação há.',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, context) {
      const state = await askRenderer(context, 'JSON.stringify(window.retroStudioContext?.getIdeState?.() ?? null)')
      if (!state || state === 'null') throw new ControlError('A IDE ainda não terminou de abrir.')
      return { data: JSON.parse(state) }
    }
  },
  {
    name: 'ide_notifications',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Avisos e erros mostrados ao usuário na IDE recentemente (os mais novos por último).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Padrão: 20.' } } },
    async run(args, context) {
      const raw = await askRenderer(context, 'JSON.stringify(window.retroStudioToastHistory || [])')
      const limit = Math.min(50, Math.max(1, Number.parseInt(args.limit, 10) || 20))
      return { data: { notifications: JSON.parse(raw || '[]').slice(-limit) } }
    }
  },
  {
    name: 'ide_screenshot',
    kind: 'read',
    agents: ['acp'],
    description: 'Imagem PNG da janela do Retro Studio como o usuário está vendo agora.',
    inputSchema: { type: 'object', properties: { maxWidth: { type: 'integer', minimum: 320, maximum: 2560, description: 'Largura máxima. Padrão: 1280.' } } },
    async run(args, context) {
      const contents = context.webContents
      if (!contents || contents.isDestroyed?.()) throw new ControlError('A janela da IDE não está disponível.')
      let image = await contents.capturePage()
      const maxWidth = Math.min(2560, Math.max(320, Number.parseInt(args.maxWidth, 10) || 1280))
      const size = image.getSize()
      if (size.width > maxWidth) image = image.resize({ width: maxWidth, quality: 'good' })
      const final = image.getSize()
      return { data: { width: final.width, height: final.height }, image: { base64: image.toPNG().toString('base64'), mimeType: 'image/png' } }
    }
  },
  {
    name: 'build_run',
    kind: 'write',
    agents: ['acp'],
    description: 'Compila o projeto (SGDK/MarsDev) como o botão Build da IDE. Devolve a ROM ou os erros (arquivo, linha, mensagem). Grava só na pasta de saída do build.',
    inputSchema: {
      type: 'object',
      properties: {
        clean: { type: 'boolean', description: 'Limpa antes de compilar.' },
        flavor: { type: 'string', enum: ['release', 'debug'], description: 'Tipo de build. Padrão: o atual do projeto.' }
      }
    },
    async run(args, context, deps) {
      const summary = await runProjectBuild(context, deps, args)
      return { data: summary, isError: !summary.success }
    }
  },
  {
    name: 'build_errors',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Resultado do último build feito por um agente (sucesso, ROM e erros), sem compilar de novo.',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, context) {
      try {
        // Registros antigos (MCP 0.8) guardavam o stdout inteiro: devolve só o resumo.
        const record = JSON.parse(await fs.readFile(path.join(context.workspace, BUILD_RESULT_FILE), 'utf8'))
        return { data: { action: record.action || null, at: record.at ? new Date(record.at).toISOString() : null, ...summarizeBuild(record) } }
      } catch {
        return { data: { action: null, message: 'Nenhum build feito por agente neste projeto ainda.' } }
      }
    }
  },
  // Nomes da primeira versão do MCP (0.8): continuam funcionando para sessões e prompts existentes.
  {
    name: 'build_rom',
    kind: 'write',
    agents: ['acp'],
    description: 'Nome antigo de build_run: compila o projeto e devolve a ROM ou os erros.',
    inputSchema: { type: 'object', properties: { clean: { type: 'boolean', description: 'Limpa antes de compilar.' } } },
    async run(args, context, deps) {
      const summary = await runProjectBuild(context, deps, { clean: args.clean })
      return { data: summary, isError: !summary.success }
    }
  },
  {
    name: 'run_emulator',
    kind: 'write',
    agents: ['acp'],
    description: 'Roda a ROM do projeto no emulador configurado. Compila antes se ainda não houver ROM.',
    inputSchema: { type: 'object', properties: { romPath: { type: 'string', description: 'ROM dentro do projeto (opcional).' } } },
    async run(args, context, deps) {
      let rom = args.romPath ? await resolveInsideWorkspace(context.workspace, args.romPath) : await deps.findRom?.(context.workspace)
      if (!rom) {
        const built = await runProjectBuild(context, deps, {})
        if (!built.success) return { data: { ok: false, error: 'O build antes de jogar falhou.', build: built }, isError: true }
        rom = built.romPath
      }
      const result = await deps.runEmulator(rom, context.workspace)
      await recordBuildResult(context.workspace, { action: 'play', success: !!result?.success, romPath: rom, message: result?.message || null })
      return { data: { ok: !!result?.success, romPath: rom, message: result?.message || null }, isError: !result?.success }
    }
  },
  {
    name: 'music_guide',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Como compor uma música do Mega Drive no Retro Studio: formato (tempos e nomes de nota), limites do YM2612/PSG, dicas e a lista de instrumentos (ID, nome, tipo). Leia antes de music_write.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const instruments = PRESET_INSTRUMENTS.map(item => ({ id: item.id, name: item.name, kind: item.kind, category: item.category }))
      return { data: { ...MUSIC_GUIDE, limites: { faixas: SONG_LIMITS.tracks, compassos: SONG_LIMITS.bars, instrumentosProprios: SONG_LIMITS.instruments }, categorias: INSTRUMENT_CATEGORIES, instrumentos: instruments } }
    }
  },
  {
    name: 'music_list',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Músicas do compositor neste projeto (music/*.song.json): ID, nome e se já foram exportadas para o jogo.',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, context) { return { data: { songs: listSongs(context.workspace) } } }
  },
  {
    name: 'music_read',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Lê uma música do compositor em tempos e nomes de nota (o mesmo formato de music_write), com a revisão para salvar por cima e a análise do que o chip consegue tocar.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'ID da música (music_list).' } } },
    async run(args, context) {
      if (!SONG_ID.test(String(args.id || ''))) throw new ControlError('ID de música inválido.')
      let loaded
      try { loaded = loadSong(context.workspace, args.id) } catch (error) { throw new ControlError(error.message) }
      return { data: { revision: loaded.revision, song: songToAuthoring(loaded.song), analysis: analyzeSong(loaded.song) } }
    }
  },
  {
    name: 'music_write',
    kind: 'write',
    agents: ['acp', 'internal'],
    description: 'Cria ou substitui uma música do compositor (music/<id>.song.json) no formato de music_guide. Música nova: sem "revision". Para mudar uma existente, passe a "revision" de music_read (recusa se o usuário mudou depois). "exportToGame": também gera res/music/<id>.vgm e cadastra no catálogo de áudio do jogo. Devolve a análise (vozes por chip e avisos) para você ajustar.',
    inputSchema: {
      type: 'object',
      required: ['song'],
      properties: {
        song: { type: 'object', description: 'Música no formato de music_guide.' },
        revision: { type: 'string', description: 'Revisão de music_read, para substituir uma música existente.' },
        exportToGame: { type: 'boolean', description: 'Também exportar o VGM e cadastrar no catálogo de áudio. Padrão: false.' }
      }
    },
    async run(args, context, deps) {
      const song = songArgument(args.song)
      let result
      try {
        result = saveSong(context.workspace, { song, revision: typeof args.revision === 'string' ? args.revision : null, exportToGame: args.exportToGame === true }, { toolkit: await deps.toolkitPath?.() || undefined })
      } catch (error) { throw new ControlError(error.message) }
      const editor = await musicWorkspaceNotice(context, `Promise.resolve(window.retroStudioContext?.musicChanged?.(${JSON.stringify(song.id)}) ?? null).then(value => JSON.stringify(value))`)
      return { data: { id: song.id, revision: result.revision, file: 'music/' + song.id + '.song.json', vgm: result.vgm, catalog: result.catalog, analysis: analyzeSong(result.song), editor } }
    }
  },
  {
    name: 'music_open',
    kind: 'write',
    agents: ['acp', 'internal'],
    description: 'Abre uma música no modo Música do Retro Studio para o usuário ouvir e editar; "play" já começa a tocar. Não abre se a música aberta tiver alterações não salvas.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, play: { type: 'boolean', description: 'Tocar ao abrir. Padrão: false.' } } },
    async run(args, context) {
      if (!SONG_ID.test(String(args.id || ''))) throw new ControlError('ID de música inválido.')
      const result = await askRenderer(context, `window.retroStudioContext?.openMusic?.(${JSON.stringify(args.id)}, ${args.play === true}).then(value => JSON.stringify(value))`)
      const data = JSON.parse(result || 'null')
      if (!data) throw new ControlError('O modo Música não está disponível nesta janela.')
      if (!data.ok) throw new ControlError(data.reason || 'Não foi possível abrir a música.')
      return { data }
    }
  },
  {
    name: 'map_notes',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Notas que o usuário marcou nos mapas para a IA (editor de mapas → aba Notas): cada nota é uma área do mapa com uma instrução (problema, tarefa ou informação), a camada a que se refere e os objetos do TMX que tocam a área (colisões, rampas, spawn, inimigos...). Coordenadas em pixels do mapa, origem no canto superior esquerdo; tiles = pixels / tileSize. Use antes de mexer no que o usuário apontou no mapa.',
    inputSchema: { type: 'object', properties: {
      map: { type: 'string', description: 'Mapa .tmx relativo ao projeto. Sem ele, lista todos os mapas com notas.' },
      status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Padrão: open (só as não resolvidas).' } } },
    async run(args, context) {
      const status = ['open', 'done', 'all'].includes(args.status) ? args.status : 'open'
      const maps = args.map ? [noteMapPath(context.workspace, args.map)] : await listNoteMaps(context.workspace)
      const result = []
      for (const map of maps) {
        const { raw } = await readNotesFile(context.workspace, map)
        const facts = await readMapFacts(context.workspace, map)
        const parsed = parseMapNotes(raw, facts.width ? { width: facts.width * facts.tileSize, height: facts.height * facts.tileSize } : null)
        const notes = parsed.notes.filter(note => status === 'all' || note.status === status)
        if (!args.map && !notes.length) continue
        result.push({ map, ...(facts.problem ? { mapProblem: facts.problem } : { width: facts.width, height: facts.height, tileSize: facts.tileSize }),
          ...(parsed.problem ? { problem: parsed.problem } : {}),
          total: parsed.notes.length, notes: describeNotes(notes, { objects: facts.objects || [], tileSize: facts.tileSize || 8 }) })
      }
      return { data: { status, maps: result,
        hint: result.length ? 'Para ver a área: map_note_image. Ao terminar: map_note_update com status "done" e uma resposta curta do que foi feito.' : 'Nenhuma nota encontrada. O usuário marca notas no editor de mapas, aba Notas (tecla N).' } }
    }
  },
  {
    name: 'map_note_image',
    kind: 'read',
    agents: ['acp'],
    description: 'Imagem PNG da área de uma nota como aparece no editor de mapas (com a grade e as marcas de colisão ligadas pelo usuário). O mapa da nota precisa estar aberto no modo Mapas; o editor rola até a nota.',
    inputSchema: { type: 'object', required: ['map', 'id'], properties: {
      map: { type: 'string', description: 'Mapa .tmx relativo ao projeto.' },
      id: { type: 'integer', minimum: 1, description: 'Número da nota (#).' },
      maxWidth: { type: 'integer', minimum: 160, maximum: 1600, description: 'Largura máxima. Padrão: 900.' } } },
    async run(args, context) {
      const map = noteMapPath(context.workspace, args.map), id = Number.parseInt(args.id, 10)
      if (!(id > 0)) throw new ControlError('Informe o número da nota.')
      const answer = JSON.parse(await askRenderer(context, `Promise.resolve(window.retroStudioContext?.focusMapNote?.(${JSON.stringify(map)}, ${id}) ?? null).then(value => JSON.stringify(value))`) || 'null')
      if (!answer) throw new ControlError('A IDE ainda não terminou de abrir.')
      if (answer.error) throw new ControlError(answer.error)
      const contents = context.webContents
      const zoom = Number(contents.getZoomFactor?.()) || 1
      const rect = ['x', 'y', 'width', 'height'].reduce((out, key) => ({ ...out, [key]: Math.max(0, Math.round(Number(answer.rect?.[key]) * zoom)) }), {})
      if (rect.width < 2 || rect.height < 2) throw new ControlError('A nota não ficou visível na tela.')
      let image = await contents.capturePage(rect)
      const maxWidth = Math.min(1600, Math.max(160, Number.parseInt(args.maxWidth, 10) || 900))
      if (image.getSize().width > maxWidth) image = image.resize({ width: maxWidth, quality: 'good' })
      const size = image.getSize()
      return { data: { map, id, width: size.width, height: size.height, cropped: !!answer.cropped },
        image: { base64: image.toPNG().toString('base64'), mimeType: 'image/png' } }
    }
  },
  {
    name: 'map_note_update',
    kind: 'write',
    agents: ['acp', 'internal'],
    description: 'Atualiza uma nota de mapa: marca como resolvida (status "done") ou reaberta e grava uma resposta curta para o usuário (o que foi feito ou a dúvida). Não muda o texto nem a área marcados pelo usuário.',
    inputSchema: { type: 'object', required: ['map', 'id'], properties: {
      map: { type: 'string', description: 'Mapa .tmx relativo ao projeto.' },
      id: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: NOTE_STATUS },
      reply: { type: 'string', maxLength: MAX_NOTE_TEXT, description: 'Resposta mostrada ao usuário na nota (pt-BR).' } } },
    async run(args, context) {
      const map = noteMapPath(context.workspace, args.map), id = Number.parseInt(args.id, 10)
      if (args.status === undefined && args.reply === undefined) throw new ControlError('Informe status ou reply.')
      if (args.status !== undefined && !NOTE_STATUS.includes(args.status)) throw new ControlError('status deve ser "open" ou "done".')
      if (args.reply !== undefined && typeof args.reply !== 'string') throw new ControlError('reply deve ser texto.')
      const { file, raw } = await readNotesFile(context.workspace, map)
      const parsed = parseMapNotes(raw)
      if (parsed.problem) throw new ControlError(parsed.problem)
      const note = parsed.notes.find(item => item.id === id)
      if (!note) throw new ControlError(`A nota #${args.id} não existe em ${map}.`)
      if (args.status !== undefined) note.status = args.status
      if (args.reply !== undefined) note.reply = args.reply.slice(0, MAX_NOTE_TEXT)
      note.updatedAt = new Date().toISOString()
      await writeTextFileAtomically(file, serializeMapNotes(map, parsed.notes))
      const editor = await notesWorkspaceNotice(context, map)
      return { data: { map, id, status: note.status, reply: note.reply, editor } }
    }
  },
  {
    name: 'release_list',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Versões de teste do jogo (Rodar → Versões para teste), da mais nova para a mais antiga: número, data, o que mudou segundo o usuário, commit, arquivo da ROM e um resumo das áreas alteradas. Use para saber o que já foi entregue a quem testa e em que versão algo mudou.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Padrão: 20.' } } },
    async run(args, context) {
      const status = releasesStatus(context.workspace), limit = Math.min(100, Math.max(1, Number.parseInt(args.limit, 10) || 20))
      return { data: { game: status.game, next: status.next, ...(status.problem ? { problem: status.problem } : {}), changelog: 'releases/CHANGELOG.md',
        releases: status.releases.slice(0, limit).map(item => ({ version: item.version, createdAt: item.createdAt, changes: item.changes, ...(item.notes ? { notes: item.notes } : {}),
          rom: item.rom?.file, commit: item.git?.commit?.slice(0, 10) || null, dirty: !!item.git?.dirty, areas: item.files?.summary || null })) } }
    }
  },
  {
    name: 'release_read',
    kind: 'read',
    agents: ['acp', 'internal'],
    description: 'Detalhes de uma versão de teste: o que mudou, observações, ROM (arquivo, tamanho, SHA-256, serial e checksum do cabeçalho), commits desde a versão anterior e os arquivos do projeto adicionados, alterados ou removidos.',
    inputSchema: { type: 'object', required: ['version'], properties: { version: { type: 'string', description: 'Ex.: 0.3.0' } } },
    async run(args, context) {
      try { return { data: readRelease(context.workspace, String(args.version || '').trim()) } } catch (error) { throw new ControlError(error.message) }
    }
  },
  {
    name: 'release_create',
    kind: 'write',
    agents: ['acp', 'internal'],
    description: 'Gera uma versão de teste: build limpo de release, cópia da ROM em releases/<versão>/ com a revisão no cabeçalho, src/generated/game_version.h e o registro no CHANGELOG. Use só quando o usuário pedir uma versão. Escreva as mudanças em pt-BR, uma por item, do ponto de vista de quem joga.',
    inputSchema: { type: 'object', required: ['changes'], properties: {
      version: { type: 'string', description: 'Ex.: 0.3.0. Sem ela, usa a próxima sugerida.' },
      changes: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'O que mudou, um item por mudança.' },
      notes: { type: 'string', maxLength: 4000, description: 'Observações para quem testa (opcional).' } } },
    async run(args, context, deps) {
      const version = String(args.version || '').trim() || releasesStatus(context.workspace).next
      try {
        const result = await createRelease(context.workspace, { version, changes: Array.isArray(args.changes) ? args.changes : [], notes: args.notes }, { runBuild: deps.runBuild })
        return { data: { version: result.release.version, rom: result.release.rom, changelog: 'releases/CHANGELOG.md', commits: result.release.git?.commits?.length || 0, areas: result.release.files?.summary || null } }
      } catch (error) { throw new ControlError(error.message) }
    }
  }
]

export const controlCommands = Object.freeze(commands.map(command => Object.freeze(command)))

export function findControlCommand(name) {
  return controlCommands.find(command => command.name === name) || null
}

/** Executa um comando validando o básico da entrada; erros esperados viram ControlError. */
export async function runControlCommand(name, args, context, deps) {
  const command = findControlCommand(name)
  if (!command) throw new ControlError(`Comando desconhecido: ${name}`)
  if (args != null && (typeof args !== 'object' || Array.isArray(args))) throw new ControlError('Argumentos devem ser um objeto.')
  if (!context?.workspace) throw new ControlError('Nenhum projeto aberto na IDE.')
  return command.run(args || {}, context, deps)
}
