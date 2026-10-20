/**
 * Socket local da API de controle (#77). A ponte MCP (mcp-bridge.mjs), iniciada pelo agente ACP,
 * conversa com a IDE aberta por aqui. Sem dependência do Electron.
 *
 * - Unix: ~/.retrostudio/run/control-<pid>.sock, pasta 0700 e socket 0600. Windows: named pipe.
 * - Cada sessão ACP recebe um token aleatório; pedido sem token válido é recusado.
 * - O token prende a sessão à janela e ao workspace em que o agente foi iniciado: se o projeto
 *   aberto mudar, os comandos são recusados.
 * - Protocolo: uma linha JSON por mensagem.
 *   pedido   { id, token, method: 'list' | 'call', name?, args? }
 *   resposta { id, result } | { id, error: { message } }
 * - Tokens e argumentos nunca vão para o log.
 */

import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { controlCommands, runControlCommand, ControlError } from './commands.js'

const MAX_LINE_BYTES = 1024 * 1024
const MAX_CONNECTIONS = 16

// sun_path do Unix tem ~108 bytes; com HOME longo o socket vai para uma pasta privada em /tmp.
const MAX_SOCKET_PATH = 100

function socketPathFor(baseDirectory) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\retro-studio-control-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  const name = `control-${process.pid}.sock`
  const preferred = path.join(baseDirectory, 'run', name)
  if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH) return preferred
  return path.join(os.tmpdir(), `retro-studio-${process.getuid?.() ?? 'user'}`, name)
}

/** Pasta do socket: criada 0700 e recusada se for de outro usuário ou um link. */
function preparePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error('pasta do socket insegura')
  fs.chmodSync(directory, 0o700)
}

function sameToken(expected, received) {
  if (typeof received !== 'string' || received.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

/**
 * @param {{
 *   baseDirectory: string,                         // ~/.retrostudio
 *   deps: object,                                  // dependências dos comandos (build, emulador…)
 *   resolveContext: (session) => Promise<object>,  // { workspace, webContents } atual da janela da sessão
 *   log?: (level: string, message: string, data?: object) => void
 * }} options
 */
export function createControlServer({ baseDirectory, deps, resolveContext, log = () => {} }) {
  const sessions = new Map() // token -> { webContentsId, workspace, agents }
  const sockets = new Set()
  let server = null
  let socketPath = null

  async function handle(message, reply) {
    const { id } = message || {}
    const session = message && typeof message.token === 'string'
      ? [...sessions.entries()].find(([token]) => sameToken(token, message.token))?.[1]
      : null
    if (!session) return reply({ id, error: { message: 'Token inválido ou sessão encerrada.' } })
    try {
      if (message.method === 'list') {
        const list = controlCommands.filter(command => command.agents.includes('acp'))
          .map(({ name, description, inputSchema, kind }) => ({ name, description, inputSchema, kind }))
        return reply({ id, result: { commands: list } })
      }
      if (message.method !== 'call') throw new ControlError('Método desconhecido.')
      const command = controlCommands.find(item => item.name === message.name)
      if (!command || !command.agents.includes('acp')) throw new ControlError(`Comando desconhecido: ${message.name}`)
      const context = await resolveContext(session)
      if (!context?.workspace) throw new ControlError('Nenhum projeto aberto na IDE.')
      if (context.workspace !== session.workspace) throw new ControlError('O projeto aberto na IDE mudou desde que o agente foi iniciado. Reinicie o agente.')
      const started = Date.now()
      const result = await runControlCommand(command.name, message.args, context, deps)
      log('info', 'control:call', `${command.name} (${Date.now() - started} ms)`)
      return reply({ id, result })
    } catch (error) {
      const expected = error instanceof ControlError
      if (!expected) log('error', 'control:call', `${message.name || message.method}: ${error.message}`)
      return reply({ id, error: { message: error.message || 'Falha no comando.' } })
    }
  }

  function onConnection(socket) {
    if (sockets.size >= MAX_CONNECTIONS) { socket.destroy(); return }
    sockets.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    const reply = payload => { if (!socket.destroyed) socket.write(JSON.stringify(payload) + '\n') }
    socket.on('data', chunk => {
      buffer += chunk
      if (buffer.length > MAX_LINE_BYTES) { socket.destroy(); return }
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { reply({ id: null, error: { message: 'JSON inválido.' } }); continue }
        void handle(message, reply)
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  }

  return {
    get socketPath() { return socketPath },

    async start() {
      if (server) return socketPath
      socketPath = socketPathFor(baseDirectory)
      if (process.platform !== 'win32') {
        preparePrivateDirectory(path.dirname(socketPath))
        try { fs.unlinkSync(socketPath) } catch { /* não existia */ }
      }
      server = net.createServer(onConnection)
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, () => { server.off('error', reject); resolve() })
      })
      if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600)
      return socketPath
    },

    /** Nova sessão para um agente; devolve o token (passado só por variável de ambiente). */
    openSession({ webContentsId, workspace }) {
      const token = crypto.randomBytes(32).toString('hex')
      sessions.set(token, { webContentsId, workspace })
      return token
    },

    closeSession(token) {
      sessions.delete(token)
    },

    async stop() {
      sessions.clear()
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      if (!server) return
      await new Promise(resolve => server.close(() => resolve()))
      server = null
      if (process.platform !== 'win32' && socketPath) { try { fs.unlinkSync(socketPath) } catch { /* já removido */ } }
    }
  }
}
