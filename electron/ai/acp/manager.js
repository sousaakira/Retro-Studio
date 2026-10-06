/**
 * Gerencia uma sessão ACP por janela / workspace / provedor.
 * Retoma a última sessão do projeto (session/load) quando possível.
 */

import path from 'node:path'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { AcpClient } from './AcpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')
const MCP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'retro-studio-mcp.mjs')

async function resolveOpenCodeBinary(commandPath) {
  if (commandPath && existsSync(commandPath)) return commandPath
  const homeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode')
  if (existsSync(homeBin)) return homeBin
  return null
}

async function resolveCodexAcpBinary(commandPath) {
  if (commandPath && existsSync(commandPath)) return commandPath
  return null // Resolved in Electron main after validating the executable name.
}

function normalizeWorkspace(p) {
  const raw = String(p || '').trim()
  if (!raw) {
    throw new Error('Workspace obrigatório para iniciar o agente ACP')
  }
  try {
    const resolved = path.resolve(raw)
    try {
      return realpathSync(resolved)
    } catch {
      return resolved
    }
  } catch {
    throw new Error('Workspace inválido para o agente ACP')
  }
}

function buildRetroMcpServers(workspaceRoot) {
  if (!existsSync(MCP_SCRIPT)) return []
  const resultFile = path.join(workspaceRoot, '.retrostudio', 'last-acp-build.json')
  const env = [
    { name: 'RETRO_WORKSPACE', value: workspaceRoot },
    { name: 'RETRO_RESULT_FILE', value: resultFile }
  ]
  try {
    const uiPath = path.join(os.homedir(), '.retrostudio', 'ui-settings.json')
    if (existsSync(uiPath)) {
      const ui = JSON.parse(readFileSync(uiPath, 'utf8'))
      if (ui.toolkitPath) env.push({ name: 'RETRO_TOOLKIT', value: String(ui.toolkitPath) })
    }
  } catch {
    /* ignore */
  }
  return [{
    name: 'retro-studio',
    command: 'node',
    args: [MCP_SCRIPT],
    env
  }]
}

async function listAllSessions(client, cwd) {
  const sessions = []
  const seenCursors = new Set()
  let cursor = null
  for (let page = 0; page < 100; page += 1) {
    const result = await client.listSessions({ cwd, cursor })
    if (Array.isArray(result?.sessions)) sessions.push(...result.sessions)
    const nextCursor = result?.nextCursor || null
    if (!nextCursor || seenCursors.has(nextCursor)) break
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  const unique = new Map()
  for (const session of sessions) {
    if (session?.sessionId && !unique.has(session.sessionId)) unique.set(session.sessionId, session)
  }
  return [...unique.values()]
}

export class AcpSessionManager {
  constructor() {
    /** @type {Map<number, AcpClient>} webContentsId -> client */
    this.clients = new Map()
    /** @type {Map<number, Promise>} fila por janela: start/open/stop nunca se sobrepõem */
    this.queues = new Map()
  }

  serialize(webContentsId, task) {
    const prev = this.queues.get(webContentsId) || Promise.resolve()
    const run = prev.catch(() => {}).then(task)
    const tail = run.catch(() => {})
    this.queues.set(webContentsId, tail)
    tail.then(() => {
      if (this.queues.get(webContentsId) === tail) this.queues.delete(webContentsId)
    })
    return run
  }

  get(webContentsId) {
    return this.clients.get(webContentsId) || null
  }

  /**
   * @param {number} webContentsId
   * @param {{
   *   workspacePath: string,
   *   commandPath?: string,
   *   provider?: 'opencode'|'codex',
   *   send: Function,
   *   mode?: 'auto'|'new'|'load',
   *   sessionId?: string|null
   * }} options
   */
  start(webContentsId, options) {
    return this.serialize(webContentsId, () => this.startNow(webContentsId, options))
  }

  async startNow(webContentsId, {
    workspacePath,
    commandPath,
    provider = 'opencode',
    send,
    mode = 'auto',
    sessionId = null
  }) {
    await this.stopNow(webContentsId)

    let bin = commandPath && existsSync(commandPath) ? commandPath : null
    if (!bin) bin = provider === 'codex'
      ? await resolveCodexAcpBinary(commandPath)
      : await resolveOpenCodeBinary(commandPath)
    if (!bin) {
      throw new Error(provider === 'codex'
        ? 'Codex ACP não encontrado. Instale @agentclientprotocol/codex-acp ou configure o caminho do executável.'
        : 'OpenCode não encontrado. Instale o CLI ou configure o caminho.')
    }

    const workspaceRoot = normalizeWorkspace(workspacePath)
    const mcpServers = buildRetroMcpServers(workspaceRoot)
    const client = new AcpClient({
      command: bin,
      args: provider === 'codex' ? [] : ['acp', '--cwd', workspaceRoot],
      cwd: workspaceRoot,
      workspaceRoot,
      mcpServers
    })

    client.on('update', (params) => send('acp:update', params))
    client.on('permission', (payload) => send('acp:permission', payload))
    client.on('fileWritten', (payload) => send('acp:fileWritten', payload))
    client.on('configOptions', (options) => send('acp:configOptions', { configOptions: options }))
    client.on('stderr', (text) => send('acp:stderr', { text }))
    client.on('exit', (info) => {
      // Um processo antigo saindo não pode derrubar o cliente que o substituiu.
      if (this.clients.get(webContentsId) !== client) return
      send('acp:exit', info)
      this.clients.delete(webContentsId)
    })
    client.on('parseError', (info) => send('acp:parseError', info))

    client.readFileOverride = null
    client.writeFileOverride = null

    this.clients.set(webContentsId, client)
    client.provider = provider
    client.send = send

    try {
      return await this.initializeAndOpen(client, { provider, bin, workspaceRoot, mode, sessionId })
    } catch (e) {
      // Falha ao abrir: não deixa um processo vivo segurando lock de sessão.
      if (this.clients.get(webContentsId) === client) this.clients.delete(webContentsId)
      await client.dispose()
      throw e
    }
  }

  async initializeAndOpen(client, { provider, bin, workspaceRoot, mode, sessionId }) {
    const init = await client.initialize()
    client.initInfo = init
    const caps = init?.agentCapabilities || {}
    const canLoad = !!caps.loadSession
    const canList = !!caps.sessionCapabilities?.list

    // The ACP client must authenticate before session/new for Codex. Keep the
    // process alive so the UI can call authenticate(methodId) explicitly.
    if (provider === 'codex' && !(await this.checkAuthStatus(bin, provider)).hasCredentials) {
      return {
        sessionId: null,
        agentInfo: init.agentInfo || null,
        authMethods: init.authMethods || [],
        configOptions: client.configOptions || [],
        binary: bin,
        opened: 'auth',
        provider,
        workspacePath: workspaceRoot,
        capabilities: { loadSession: canLoad, list: canList, resume: !!caps.sessionCapabilities?.resume, close: !!caps.sessionCapabilities?.close },
        sessions: []
      }
    }

    return this.openOnClient(client, { mode, sessionId })
  }

  /** Abre (new/load/auto) uma sessão num processo ACP já inicializado. */
  async openOnClient(client, { mode = 'auto', sessionId = null }) {
    const init = client.initInfo || {}
    const caps = init.agentCapabilities || client.agentCapabilities || {}
    const canLoad = !!caps.loadSession
    const canList = !!caps.sessionCapabilities?.list
    const send = client.send
    const workspaceRoot = client.workspaceRoot
    const provider = client.provider
    const bin = client.command

    let session = null
    let opened = 'new'
    let sessions = []

    if (canList) {
      try {
        sessions = await listAllSessions(client, workspaceRoot)
      } catch (_) {
        sessions = []
      }
    }

    const wantedId = sessionId || null
    const pickFromList = () => {
      // A sessão salva nas preferências continua sendo recuperável mesmo se o
      // agente não oferecer session/list (ou estiver temporariamente vazio).
      if (wantedId) return wantedId
      if (!sessions.length) return null
      // session/list já vem do mais recente → mais antigo
      return sessions[0]?.sessionId || null
    }

    if (mode === 'new') {
      session = await client.newSession()
      opened = 'new'
    } else if (mode === 'load' && wantedId) {
      if (!canLoad) throw new Error('Este agente ACP não oferece suporte à recuperação de sessões (session/load).')
      try {
        send('acp:replaying', { sessionId: wantedId })
        session = await client.loadSession(wantedId)
        opened = 'load'
      } catch (e) {
        send('acp:stderr', { text: `session/load falhou: ${e?.message || e}` })
        // Em um pedido explícito, não descarte silenciosamente o histórico e
        // crie uma conversa vazia no lugar. Deixe a falha visível para a UI.
        throw new Error(`Não foi possível recuperar a sessão ${wantedId}: ${e?.message || e}`)
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
          // Se a preferência antiga ficou inválida, tenta a sessão mais nova
          // listada pelo agente antes de abrir uma conversa vazia.
          const latestId = sessions.find((item) => item.sessionId !== id)?.sessionId
          if (wantedId && latestId) {
            try {
              send('acp:replaying', { sessionId: latestId })
              session = await client.loadSession(latestId)
              opened = 'load'
            } catch (latestError) {
              send('acp:stderr', { text: `session/load da sessão mais recente falhou: ${latestError?.message || latestError}` })
            }
          }
          if (!session) {
            session = await client.newSession()
            opened = 'new'
          }
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
        sessions = await listAllSessions(client, workspaceRoot)
      } catch (_) { /* keep previous */ }
    }

    return {
      sessionId: client.sessionId || session?.sessionId || null,
      agentInfo: init.agentInfo || null,
      authMethods: init.authMethods || [],
      provider,
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
    return {
      sessions: await listAllSessions(client, client.workspaceRoot),
      sessionId: client.sessionId,
      workspacePath: client.workspaceRoot
    }
  }

  /**
   * Troca de conversa reaproveitando o processo ACP (como o Zed): fecha a
   * sessão atual e abre/carrega a outra, sem respawn. Só reinicia o processo
   * se ele já tiver morrido.
   */
  openSession(webContentsId, { mode = 'new', sessionId = null, send } = {}) {
    return this.serialize(webContentsId, async () => {
      const existing = this.clients.get(webContentsId)
      if (!existing) throw new Error('Sessão ACP não iniciada')
      if (send) existing.send = send
      if (!existing.closed && existing.initInfo) {
        await existing.closeSession().catch(() => {})
        return this.openOnClient(existing, { mode, sessionId })
      }
      return this.startNow(webContentsId, {
        workspacePath: existing.workspaceRoot,
        commandPath: existing.command,
        provider: existing.provider || 'opencode',
        send: send || existing.send,
        mode,
        sessionId
      })
    })
  }

  async authenticate(webContentsId, methodId) {
    const client = this.clients.get(webContentsId)
    if (!client) throw new Error('Sessão ACP não iniciada')
    if (!methodId) throw new Error('Método de autenticação ACP inválido')
    return client.authenticate(methodId)
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

  /**
   * Detecta credenciais do agente selecionado sem expor o conteúdo ao renderer.
   */
  async checkAuthStatus(commandPath, provider = 'opencode') {
    if (provider === 'codex') {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json')
      let hasCredentials = !!(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY)
      try {
        await fs.access(authPath)
        hasCredentials = true
      } catch { /* not logged in yet */ }
      return {
        hasCredentials,
        providers: hasCredentials ? ['Codex'] : [],
        binary: commandPath || 'codex-acp',
        loginCommand: 'codex login',
        provider
      }
    }
    const bin = (await resolveOpenCodeBinary(commandPath)) || 'opencode'
    const dataHome = process.env.XDG_DATA_HOME
      || path.join(os.homedir(), '.local', 'share')
    const authPath = path.join(dataHome, 'opencode', 'auth.json')
    let providers = []
    let hasCredentials = false
    try {
      const raw = await fs.readFile(authPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        providers = Object.keys(parsed)
        hasCredentials = providers.length > 0
      }
    } catch {
      hasCredentials = false
      providers = []
    }
    return {
      hasCredentials,
      providers,
      binary: bin,
      loginCommand: 'opencode auth login',
      provider
    }
  }

  stop(webContentsId) {
    return this.serialize(webContentsId, () => this.stopNow(webContentsId))
  }

  async stopNow(webContentsId) {
    const client = this.clients.get(webContentsId)
    if (!client) return
    this.clients.delete(webContentsId)
    await client.dispose()
  }

  /** Saída do app: encerra todos os agentes sem esperar. */
  killAll() {
    for (const client of this.clients.values()) client.killNow()
    this.clients.clear()
  }
}

export const acpSessionManager = new AcpSessionManager()
