/**
 * Cliente mínimo ACP (Agent Client Protocol) v1 sobre stdio NDJSON.
 * Sem dependências externas — JSON-RPC 2.0 linha a linha.
 *
 * Ref: https://agentclientprotocol.com/protocol/v1/overview
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'

function assertWithinWorkspace(filePath, workspaceRoot) {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(filePath)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path fora do workspace: ${filePath}`)
  }
  return target
}

export class AcpClient extends EventEmitter {
  constructor(options = {}) {
    super()
    this.command = options.command
    this.args = options.args || ['acp']
    this.cwd = options.cwd
    this.env = options.env || process.env
    this.workspaceRoot = options.workspaceRoot || options.cwd
    this.proc = null
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.sessionId = null
    this.agentInfo = null
    this.agentCapabilities = null
    this.authMethods = []
    this.configOptions = []
    this.closed = false
    /** @type {Map<number, { resolve: Function, reject: Function }>} */
    this._permissionWaiters = new Map()
  }

  start() {
    if (this.proc) return
    if (!this.command || !existsSync(this.command)) {
      throw new Error(`Binário ACP não encontrado: ${this.command}`)
    }
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: {
        ...this.env,
        TERM: 'dumb'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')

    this.proc.stdout.on('data', (chunk) => this._onStdout(chunk))
    this.proc.stderr.on('data', (chunk) => {
      this.emit('stderr', String(chunk))
    })
    this.proc.on('exit', (code, signal) => {
      this.closed = true
      for (const [, p] of this.pending) {
        p.reject(new Error(`ACP process exited (${code ?? signal})`))
      }
      this.pending.clear()
      this.emit('exit', { code, signal })
    })
  }

  async initialize() {
    this.start()
    const result = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false
      },
      clientInfo: {
        name: 'retro-studio',
        title: 'Retro Studio',
        version: '0.7.0'
      }
    })
    this.agentCapabilities = result?.agentCapabilities || null
    this.agentInfo = result?.agentInfo || null
    this.authMethods = result?.authMethods || []
    if (result?.protocolVersion !== 1) {
      throw new Error(`Protocolo ACP incompatível: ${result?.protocolVersion}`)
    }
    this.emit('initialized', result)
    return result
  }

  async newSession() {
    const result = await this.request('session/new', {
      cwd: this.workspaceRoot,
      mcpServers: []
    })
    this.sessionId = result?.sessionId || null
    this.configOptions = result?.configOptions || []
    this.emit('session', result)
    return result
  }

  async prompt(text, { currentFilePath, currentFileContent } = {}) {
    if (!this.sessionId) throw new Error('Nenhuma sessão ACP ativa')
    const prompt = [{ type: 'text', text: String(text || '') }]
    if (currentFilePath && currentFileContent != null) {
      const uri = currentFilePath.startsWith('file://')
        ? currentFilePath
        : `file://${currentFilePath}`
      prompt.push({
        type: 'resource',
        resource: {
          uri,
          mimeType: 'text/plain',
          text: String(currentFileContent)
        }
      })
    }
    return this.request('session/prompt', {
      sessionId: this.sessionId,
      prompt
    })
  }

  cancel() {
    if (!this.sessionId) return
    this.notify('session/cancel', { sessionId: this.sessionId })
  }

  async closeSession() {
    if (!this.sessionId) return
    const caps = this.agentCapabilities?.sessionCapabilities
    if (caps?.close) {
      try {
        await this.request('session/close', { sessionId: this.sessionId })
      } catch (_) { /* ignore */ }
    } else {
      this.cancel()
    }
    this.sessionId = null
  }

  /**
   * Resposta do usuário a session/request_permission
   */
  resolvePermission(requestId, outcome) {
    const waiter = this._permissionWaiters.get(requestId)
    if (!waiter) return false
    this._permissionWaiters.delete(requestId)
    // result shape: { outcome: { outcome: 'selected', optionId } | { outcome: 'cancelled' } }
    waiter.resolve(outcome)
    return true
  }

  async dispose() {
    try {
      await this.closeSession()
    } catch (_) { /* ignore */ }
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
    }
    this.proc = null
    this.closed = true
  }

  request(method, params = {}) {
    const id = this.nextId++
    const msg = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this._write(msg)
    })
  }

  notify(method, params = {}) {
    this._write({ jsonrpc: '2.0', method, params })
  }

  _write(obj) {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new Error('ACP stdin fechado')
    }
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  _onStdout(chunk) {
    this.buffer += chunk
    let idx
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (e) {
        this.emit('parseError', { line, error: e.message })
        continue
      }
      this._dispatch(msg)
    }
  }

  async _dispatch(msg) {
    // Response to our request
    if (msg.id != null && (msg.result !== undefined || msg.error)) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(Object.assign(new Error(msg.error.message || 'ACP error'), { code: msg.error.code, data: msg.error.data }))
        else pending.resolve(msg.result)
      }
      return
    }

    // Notification or server→client request
    const method = msg.method
    if (!method) return

    if (method === 'session/update') {
      this.emit('update', msg.params)
      return
    }

    if (method === 'session/request_permission') {
      const id = msg.id
      const params = msg.params || {}
      this.emit('permission', { id, ...params })
      const result = await new Promise((resolve, reject) => {
        this._permissionWaiters.set(id, { resolve, reject })
        const allowOpt = (params.options || []).find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
        setTimeout(() => {
          if (!this._permissionWaiters.has(id)) return
          this._permissionWaiters.delete(id)
          if (allowOpt) {
            resolve({ outcome: { outcome: 'selected', optionId: allowOpt.optionId } })
          } else {
            resolve({ outcome: { outcome: 'cancelled' } })
          }
        }, 120000)
      })
      this._write({ jsonrpc: '2.0', id, result })
      return
    }

    if (method === 'fs/read_text_file') {
      try {
        const result = await this._handleReadTextFile(msg.params || {})
        this._write({ jsonrpc: '2.0', id: msg.id, result })
      } catch (e) {
        this._write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: e.message || String(e) }
        })
      }
      return
    }

    if (method === 'fs/write_text_file') {
      try {
        await this._handleWriteTextFile(msg.params || {})
        this._write({ jsonrpc: '2.0', id: msg.id, result: null })
        this.emit('fileWritten', {
          path: msg.params?.path,
          sessionId: msg.params?.sessionId
        })
      } catch (e) {
        this._write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: e.message || String(e) }
        })
      }
      return
    }

    // Método desconhecido do agent → erro JSON-RPC se for request
    if (msg.id != null) {
      this._write({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${method}` }
      })
    } else {
      this.emit('unknownNotification', msg)
    }
  }

  async _handleReadTextFile(params) {
    const filePath = assertWithinWorkspace(params.path, this.workspaceRoot)
    // Preferir conteúdo do editor (callback) se registrado
    if (typeof this.readFileOverride === 'function') {
      const override = await this.readFileOverride(filePath)
      if (override != null) {
        return { content: this._sliceLines(override, params.line, params.limit) }
      }
    }
    const content = await fs.readFile(filePath, 'utf8')
    return { content: this._sliceLines(content, params.line, params.limit) }
  }

  async _handleWriteTextFile(params) {
    const filePath = assertWithinWorkspace(params.path, this.workspaceRoot)
    if (typeof this.writeFileOverride === 'function') {
      const handled = await this.writeFileOverride(filePath, params.content ?? '')
      if (handled) return
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, params.content ?? '', 'utf8')
  }

  _sliceLines(content, line, limit) {
    if (line == null && limit == null) return content
    const lines = String(content).split('\n')
    const start = Math.max(0, (Number(line) || 1) - 1)
    const end = limit != null ? start + Number(limit) : lines.length
    return lines.slice(start, end).join('\n')
  }
}

export default AcpClient
