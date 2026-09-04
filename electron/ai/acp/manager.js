/**
 * Gerencia uma sessão ACP OpenCode por janela / workspace.
 */

import path from 'node:path'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { AcpClient } from './AcpClient.js'

async function resolveOpenCodeBinary(commandPath) {
  if (commandPath && existsSync(commandPath)) return commandPath
  const homeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode')
  if (existsSync(homeBin)) return homeBin
  // PATH lookup is done by caller via system:which when possible
  return null
}

export class AcpSessionManager {
  constructor() {
    /** @type {Map<number, AcpClient>} webContentsId -> client */
    this.clients = new Map()
  }

  get(webContentsId) {
    return this.clients.get(webContentsId) || null
  }

  async start(webContentsId, { workspacePath, commandPath, send }) {
    await this.stop(webContentsId)

    let bin = commandPath && existsSync(commandPath) ? commandPath : null
    if (!bin) bin = await resolveOpenCodeBinary(commandPath)
    if (!bin) {
      throw new Error('OpenCode não encontrado. Instale o CLI ou configure o caminho.')
    }

    const client = new AcpClient({
      command: bin,
      args: ['acp', '--cwd', workspacePath],
      cwd: workspacePath,
      workspaceRoot: workspacePath
    })

    client.on('update', (params) => send('acp:update', params))
    client.on('permission', (payload) => send('acp:permission', payload))
    client.on('fileWritten', (payload) => send('acp:fileWritten', payload))
    client.on('stderr', (text) => send('acp:stderr', { text }))
    client.on('exit', (info) => {
      send('acp:exit', info)
      this.clients.delete(webContentsId)
    })
    client.on('parseError', (info) => send('acp:parseError', info))

    // Allow renderer to supply unsaved buffer / write into editor
    client.readFileOverride = null
    client.writeFileOverride = null

    this.clients.set(webContentsId, client)

    const init = await client.initialize()
    const session = await client.newSession()

    return {
      sessionId: session.sessionId,
      agentInfo: init.agentInfo || null,
      authMethods: init.authMethods || [],
      configOptions: session.configOptions || [],
      binary: bin
    }
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
