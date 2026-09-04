/**
 * Gerencia uma sessão ACP OpenCode por janela / workspace.
 * Retoma a última sessão do projeto (session/load) quando possível.
 */

import path from 'node:path'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { AcpClient } from './AcpClient.js'

async function resolveOpenCodeBinary(commandPath) {
  if (commandPath && existsSync(commandPath)) return commandPath
  const homeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode')
  if (existsSync(homeBin)) return homeBin
  return null
}

function normalizeWorkspace(p) {
  try {
    return path.resolve(p || '')
  } catch {
    return String(p || '')
  }
}

export class AcpSessionManager {
  constructor() {
    /** @type {Map<number, AcpClient>} webContentsId -> client */
    this.clients = new Map()
  }

  get(webContentsId) {
    return this.clients.get(webContentsId) || null
  }

  /**
   * @param {number} webContentsId
   * @param {{
   *   workspacePath: string,
   *   commandPath?: string,
   *   send: Function,
   *   mode?: 'auto'|'new'|'load',
   *   sessionId?: string|null
   * }} options
   */
  async start(webContentsId, {
    workspacePath,
    commandPath,
    send,
    mode = 'auto',
    sessionId = null
  }) {
    await this.stop(webContentsId)

    let bin = commandPath && existsSync(commandPath) ? commandPath : null
    if (!bin) bin = await resolveOpenCodeBinary(commandPath)
    if (!bin) {
      throw new Error('OpenCode não encontrado. Instale o CLI ou configure o caminho.')
    }

    const workspaceRoot = normalizeWorkspace(workspacePath)
    const client = new AcpClient({
      command: bin,
      args: ['acp', '--cwd', workspaceRoot],
      cwd: workspaceRoot,
      workspaceRoot
    })

    client.on('update', (params) => send('acp:update', params))
    client.on('permission', (payload) => send('acp:permission', payload))
    client.on('fileWritten', (payload) => send('acp:fileWritten', payload))
    client.on('configOptions', (options) => send('acp:configOptions', { configOptions: options }))
    client.on('stderr', (text) => send('acp:stderr', { text }))
    client.on('exit', (info) => {
      send('acp:exit', info)
      this.clients.delete(webContentsId)
    })
    client.on('parseError', (info) => send('acp:parseError', info))

    client.readFileOverride = null
    client.writeFileOverride = null

    this.clients.set(webContentsId, client)

    const init = await client.initialize()
    const caps = init?.agentCapabilities || {}
    const canLoad = !!caps.loadSession
    const canList = !!caps.sessionCapabilities?.list

    let session = null
    let opened = 'new'
    let sessions = []

    if (canList) {
      try {
        const listed = await client.listSessions({ cwd: workspaceRoot })
        sessions = Array.isArray(listed?.sessions) ? listed.sessions : []
      } catch (_) {
        sessions = []
      }
    }

    const wantedId = sessionId || null
    const pickFromList = () => {
      if (!sessions.length) return null
      if (wantedId) {
        const hit = sessions.find((s) => s.sessionId === wantedId)
        if (hit) return hit.sessionId
      }
      // session/list já vem do mais recente → mais antigo
      return sessions[0]?.sessionId || null
    }

    if (mode === 'new') {
      session = await client.newSession()
      opened = 'new'
    } else if (mode === 'load' && wantedId && canLoad) {
      try {
        send('acp:replaying', { sessionId: wantedId })
        session = await client.loadSession(wantedId)
        opened = 'load'
      } catch (e) {
        send('acp:stderr', { text: `session/load falhou: ${e?.message || e}` })
        session = await client.newSession()
        opened = 'new'
      }
    } else if (mode === 'auto' && canLoad) {
      const id = pickFromList()
      if (id) {
        try {
          send('acp:replaying', { sessionId: id })
          session = await client.loadSession(id)
          opened = 'load'
        } catch (e) {
          send('acp:stderr', { text: `session/load falhou: ${e?.message || e}` })
          session = await client.newSession()
          opened = 'new'
        }
      } else {
        session = await client.newSession()
        opened = 'new'
      }
    } else {
      session = await client.newSession()
      opened = 'new'
    }

    // refresh list after open
    if (canList) {
      try {
        const listed = await client.listSessions({ cwd: workspaceRoot })
        sessions = Array.isArray(listed?.sessions) ? listed.sessions : []
      } catch (_) { /* keep previous */ }
    }

    return {
      sessionId: client.sessionId || session?.sessionId || null,
      agentInfo: init.agentInfo || null,
      authMethods: init.authMethods || [],
      configOptions: client.configOptions || session?.configOptions || [],
      binary: bin,
      opened,
      workspacePath: workspaceRoot,
      capabilities: {
        loadSession: canLoad,
        list: canList,
        resume: !!caps.sessionCapabilities?.resume,
        close: !!caps.sessionCapabilities?.close
      },
      sessions
    }
  }

  async listSessions(webContentsId) {
    const client = this.clients.get(webContentsId)
    if (!client) throw new Error('Sessão ACP não iniciada')
    const result = await client.listSessions({ cwd: client.workspaceRoot })
    return {
      sessions: Array.isArray(result?.sessions) ? result.sessions : [],
      sessionId: client.sessionId,
      workspacePath: client.workspaceRoot
    }
  }

  async openSession(webContentsId, { mode = 'new', sessionId = null, send } = {}) {
    const existing = this.clients.get(webContentsId)
    if (!existing) throw new Error('Sessão ACP não iniciada')
    const workspacePath = existing.workspaceRoot
    const commandPath = existing.command
    return this.start(webContentsId, {
      workspacePath,
      commandPath,
      send,
      mode,
      sessionId
    })
  }

  setFileHooks(webContentsId, { readFileOverride, writeFileOverride }) {
    const client = this.clients.get(webContentsId)
    if (!client) return
    if (readFileOverride) client.readFileOverride = readFileOverride
    if (writeFileOverride) client.writeFileOverride = writeFileOverride
  }

  async prompt(webContentsId, text, context = {}) {
    const client = this.clients.get(webContentsId)
    if (!client) throw new Error('Sessão ACP não iniciada')
    return client.prompt(text, context)
  }

  async setConfigOption(webContentsId, configId, value) {
    const client = this.clients.get(webContentsId)
    if (!client) throw new Error('Sessão ACP não iniciada')
    return client.setConfigOption(configId, value)
  }

  getConfigOptions(webContentsId) {
    return this.clients.get(webContentsId)?.configOptions || []
  }

  getSessionInfo(webContentsId) {
    const client = this.clients.get(webContentsId)
    if (!client) return null
    return {
      sessionId: client.sessionId,
      workspacePath: client.workspaceRoot,
      configOptions: client.configOptions || []
    }
  }

  cancel(webContentsId) {
    this.clients.get(webContentsId)?.cancel()
  }

  resolvePermission(webContentsId, requestId, outcome) {
    return this.clients.get(webContentsId)?.resolvePermission(requestId, outcome) || false
  }

  async stop(webContentsId) {
    const client = this.clients.get(webContentsId)
    if (!client) return
    this.clients.delete(webContentsId)
    await client.dispose()
  }
}

export const acpSessionManager = new AcpSessionManager()
