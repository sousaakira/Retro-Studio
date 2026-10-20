/**
 * Liga a API de controle por IA (#77) ao Electron: sobe o socket local, entrega aos agentes ACP
 * o MCP "retro-studio" (ponte executada pelo próprio Retro Studio) e expõe ao agente interno
 * os comandos marcados para ele.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { webContents as allWebContents, BrowserWindow } from 'electron'
import { createControlServer } from './server.js'
import { controlCommands, runControlCommand } from './commands.js'

/** Caminho da ponte fora do app.asar: o executável em modo Node não carrega módulos ESM de dentro do pacote. */
export function bridgeScriptPath(app) {
  const inside = path.join(app.getAppPath(), 'electron', 'control', 'mcp-bridge.mjs')
  return app.isPackaged ? inside.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`) : inside
}

async function canonical(workspace) {
  if (!workspace) return null
  try { return await fs.realpath(workspace) } catch { return path.resolve(workspace) }
}

/**
 * @param {{
 *   app: Electron.App,
 *   baseDirectory: string,                      // ~/.retrostudio
 *   getWorkspace: () => string | null,          // workspace aberto na IDE
 *   deps: object,                               // runBuild, runEmulator, findRom, toolkitPath
 *   acpSessionManager: { setMcpServerFactory: Function },
 *   registerInternalTools?: (commands: object[], run: Function) => void,
 *   log?: Function
 * }} options
 */
export async function setupControlApi({ app, baseDirectory, getWorkspace, deps, acpSessionManager, registerInternalTools, log = () => {} }) {
  const fullDeps = { ...deps, appVersion: app.getVersion() }
  const server = createControlServer({
    baseDirectory,
    deps: fullDeps,
    log,
    async resolveContext(session) {
      const contents = allWebContents.fromId(session.webContentsId)
      return { workspace: await canonical(getWorkspace()), webContents: contents && !contents.isDestroyed() ? contents : null }
    }
  })

  const bridge = bridgeScriptPath(app)
  let socketPath = null
  try {
    if (!existsSync(bridge)) throw new Error(`ponte MCP não encontrada em ${bridge}`)
    socketPath = await server.start()
  } catch (error) {
    log('error', 'control:start', `API de controle indisponível: ${error.message}`)
  }

  if (socketPath) {
    acpSessionManager.setMcpServerFactory(({ webContentsId, workspaceRoot }) => {
      const token = server.openSession({ webContentsId, workspace: workspaceRoot })
      return {
        server: {
          name: 'retro-studio',
          command: process.execPath,
          args: [bridge],
          env: [
            { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
            { name: 'RETRO_CONTROL_SOCKET', value: socketPath },
            { name: 'RETRO_CONTROL_TOKEN', value: token }
          ]
        },
        close: () => server.closeSession(token)
      }
    })
  }

  // O agente interno roda no processo principal: chama a mesma camada, na janela principal.
  registerInternalTools?.(
    controlCommands.filter(command => command.agents.includes('internal')),
    async (name, args) => {
      const win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed()) || null
      const result = await runControlCommand(name, args, { workspace: await canonical(getWorkspace()), webContents: win?.webContents || null }, fullDeps)
      return result.data
    }
  )

  return { socketPath, stop: () => server.stop() }
}
