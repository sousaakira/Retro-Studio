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
