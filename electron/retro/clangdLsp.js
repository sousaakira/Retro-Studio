/**
 * Cliente LSP mínimo para clangd (stdio + Content-Length).
 * Um processo por workspace. Sem deps externas.
 */
import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { pathToFileURL, fileURLToPath } from 'url'
import { writeCompileFlags, getToolkitPathFromSettings } from './compileFlags.js'

function resolveClangdBinary(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath
  try {
    const uiPath = path.join(os.homedir(), '.retrostudio', 'ui-settings.json')
    if (fs.existsSync(uiPath)) {
      const ui = JSON.parse(fs.readFileSync(uiPath, 'utf8'))
      const fromSettings = ui.clangdPath || ''
      if (fromSettings && fs.existsSync(fromSettings)) return fromSettings
    }
  } catch { /* ignore */ }
  try {
    const cmd = process.platform === 'win32' ? 'where clangd' : 'command -v clangd'
    const out = execSync(cmd, { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (out && fs.existsSync(out)) return out
  } catch {
    /* not found */
  }
  return null
}

function toUri(filePath) {
  return pathToFileURL(path.resolve(filePath)).href
}

function fromUri(uri) {
  if (!uri) return null
  try {
    if (uri.startsWith('file:')) return fileURLToPath(uri)
  } catch {
    /* fallthrough */
  }
  return uri.replace(/^file:\/\//, '')
}

class ClangdSession {
  constructor(projectPath, binary) {
    this.projectPath = path.resolve(projectPath)
    this.binary = binary
    this.proc = null
    this.nextId = 1
    this.pending = new Map()
    this.buffer = Buffer.alloc(0)
    this.initialized = false
    this.openDocs = new Map() // uri -> version
    this.starting = null
  }

  async ensureStarted() {
    if (this.initialized && this.proc && !this.proc.killed) return
    if (this.starting) return this.starting
    this.starting = this._start()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  async _start() {
    writeCompileFlags(this.projectPath)

    this.proc = spawn(this.binary, [
      `--compile-commands-dir=${path.join(this.projectPath, '.retrostudio')}`,
      '--background-index=false',
      '--clang-tidy=false'
    ], {
      cwd: this.projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    this.proc.stdout.on('data', (chunk) => this._onData(chunk))
    this.proc.stderr.on('data', (chunk) => {
      const s = String(chunk || '').trim()
      if (s) console.warn('[clangd]', s.slice(0, 500))
    })
    this.proc.on('exit', () => {
      this.initialized = false
      this.proc = null
      for (const [, p] of this.pending) {
        p.reject(new Error('clangd exited'))
      }
      this.pending.clear()
      this.openDocs.clear()
    })

    await this.request('initialize', {
      processId: process.pid,
      rootUri: toUri(this.projectPath),
      rootPath: this.projectPath,
      capabilities: {
        textDocument: {
          definition: { linkSupport: true },
          synchronization: { didSave: true }
        }
      },
      workspaceFolders: [{
        uri: toUri(this.projectPath),
        name: path.basename(this.projectPath)
      }]
    })
    this.notify('initialized', {})
    this.initialized = true
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.slice(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const len = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return
      const body = this.buffer.slice(bodyStart, bodyStart + len).toString('utf8')
      this.buffer = this.buffer.slice(bodyStart + len)
      try {
        const msg = JSON.parse(body)
        this._handleMessage(msg)
      } catch (e) {
        console.warn('[clangd] parse error', e?.message || e)
      }
    }
  }

  _handleMessage(msg) {
    if (msg.id != null && (msg.result !== undefined || msg.error)) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else pending.resolve(msg.result)
      return
    }
    // notifications from server ignored (diagnostics etc.)
  }

  _write(msg) {
    if (!this.proc?.stdin?.writable) throw new Error('clangd stdin closed')
    const json = JSON.stringify(msg)
    const payload = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`
    this.proc.stdin.write(payload)
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this._write({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        this.pending.delete(id)
        reject(e)
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`clangd timeout: ${method}`))
        }
      }, 20000)
    })
  }

  notify(method, params) {
    this._write({ jsonrpc: '2.0', method, params })
  }

  async syncOpen(filePath, content, languageId = 'c') {
    await this.ensureStarted()
    const uri = toUri(filePath)
    const text = content == null ? fs.readFileSync(filePath, 'utf8') : String(content)
    if (this.openDocs.has(uri)) {
      const version = (this.openDocs.get(uri) || 1) + 1
      this.openDocs.set(uri, version)
      this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }]
      })
    } else {
      this.openDocs.set(uri, 1)
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text
        }
      })
    }
  }

  async syncClose(filePath) {
    if (!this.initialized) return
    const uri = toUri(filePath)
    if (!this.openDocs.has(uri)) return
    this.openDocs.delete(uri)
    this.notify('textDocument/didClose', {
      textDocument: { uri }
    })
  }

  /**
   * @returns {Promise<{ path: string, line: number, column: number }|null>}
   */
  async definition(filePath, line, character, content) {
    await this.ensureStarted()
    await this.syncOpen(filePath, content)
    const uri = toUri(filePath)
    // LSP is 0-based
    const result = await this.request('textDocument/definition', {
      textDocument: { uri },
      position: {
        line: Math.max(0, (Number(line) || 1) - 1),
        character: Math.max(0, (Number(character) || 1) - 1)
      }
    })
    const loc = Array.isArray(result) ? result[0] : result
    if (!loc) return null
    // Location | LocationLink
    const targetUri = loc.targetUri || loc.uri
    const range = loc.targetSelectionRange || loc.targetRange || loc.range
    if (!targetUri || !range?.start) return null
    return {
      path: fromUri(targetUri),
      line: (range.start.line || 0) + 1,
      column: (range.start.character || 0) + 1
    }
  }

  async dispose() {
    try {
      if (this.initialized) {
        await Promise.race([
          this.request('shutdown', null),
          new Promise((r) => setTimeout(r, 1000))
        ]).catch(() => {})
        try { this.notify('exit', undefined) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    try { this.proc?.kill() } catch { /* ignore */ }
    this.proc = null
    this.initialized = false
    this.openDocs.clear()
  }
}

class ClangdManager {
  constructor() {
    /** @type {Map<string, ClangdSession>} */
    this.sessions = new Map()
  }

  status(explicitPath) {
    const bin = resolveClangdBinary(explicitPath)
    return {
      available: !!bin,
      path: bin,
      installHint: process.platform === 'win32'
        ? 'Instale LLVM/clangd e adicione ao PATH, ou configure clangdPath nas settings.'
        : 'sudo apt install clangd   # ou: brew install llvm'
    }
  }

  getSession(projectPath) {
    const key = path.resolve(projectPath || '')
    if (!key) throw new Error('projectPath obrigatório')
    let session = this.sessions.get(key)
    if (!session) {
      const bin = resolveClangdBinary()
      if (!bin) throw new Error('clangd não encontrado no PATH')
      session = new ClangdSession(key, bin)
      this.sessions.set(key, session)
    }
    return session
  }

  async definition(payload) {
    const { projectPath, filePath, line, character, content } = payload || {}
    if (!projectPath || !filePath) return null
    const session = this.getSession(projectPath)
    return session.definition(filePath, line, character, content)
  }

  async sync(payload) {
    const { projectPath, action, filePath, content, languageId } = payload || {}
    if (!projectPath || !filePath) return { ok: false }
    const status = this.status()
    if (!status.available) return { ok: false, ...status }
    const session = this.getSession(projectPath)
    if (action === 'close') {
      await session.syncClose(filePath)
    } else {
      await session.syncOpen(filePath, content, languageId || 'c')
    }
    return { ok: true }
  }

  async ensureFlags(projectPath) {
    return writeCompileFlags(projectPath, {
      toolkitPath: getToolkitPathFromSettings()
    })
  }

  async stop(projectPath) {
    if (!projectPath) {
      for (const [, s] of this.sessions) await s.dispose()
      this.sessions.clear()
      return
    }
    const key = path.resolve(projectPath)
    const s = this.sessions.get(key)
    if (s) {
      await s.dispose()
      this.sessions.delete(key)
    }
  }
}

export const clangdManager = new ClangdManager()
export { resolveClangdBinary, writeCompileFlags }
