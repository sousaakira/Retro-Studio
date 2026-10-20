// API de controle por IA (#77): camada de comandos, socket com token e ponte MCP de verdade
// (processo filho falando MCP por stdio), sem Electron. A janela e o build são falsos.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createControlServer } from '../electron/control/server.js'
import { controlCommands } from '../electron/control/commands.js'
import { AcpSessionManager } from '../electron/ai/acp/manager.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const bridge = path.join(root, 'electron', 'control', 'mcp-bridge.mjs')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-control-'))

function startBridge(env) {
  const child = spawn(process.execPath, [bridge], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = '', nextId = 1
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
      pending.get(message.id)?.(message); pending.delete(message.id)
    }
  })
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => reject(new Error('sem resposta: ' + method)), 10000)
    pending.set(id, message => { clearTimeout(timer); resolve(message) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return { request, call: async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result, stop: () => child.kill() }
}

const text = result => JSON.parse(result.content[0].text)

let server
try {
  const home = path.join(temporary, 'home', '.retrostudio')
  const project = path.join(temporary, 'game')
  const other = path.join(temporary, 'other')
  fs.mkdirSync(path.join(project, 'src'), { recursive: true })
  fs.mkdirSync(path.join(project, '.git'), { recursive: true })
  fs.mkdirSync(path.join(project, 'node_modules', 'x'), { recursive: true })
  fs.mkdirSync(other, { recursive: true })
  fs.writeFileSync(path.join(project, 'retro-studio.json'), JSON.stringify({ name: 'game' }))
  fs.writeFileSync(path.join(project, 'src', 'main.c'), 'int main(void)\n{\n  return 0;\n}\n')
  fs.writeFileSync(path.join(other, 'secret.txt'), 'conteudo-secreto')
  fs.symlinkSync(other, path.join(project, 'link-out'))
  const workspace = fs.realpathSync(project)

  let openWorkspace = workspace
  const builds = []
  const fakeWindow = {
    isDestroyed: () => false,
    async executeJavaScript(expression) {
      if (expression.includes('getIdeState')) return JSON.stringify({ editorMode: 'maps', activeFile: path.join(workspace, 'src', 'main.c'), unsavedTabs: 1 })
      if (expression.includes('retroStudioToastHistory')) return JSON.stringify([{ type: 'error', message: 'aviso 1' }, { type: 'info', message: 'aviso 2' }])
      throw new Error('expressão inesperada: ' + expression)
    },
    async capturePage() {
      const image = size => ({ getSize: () => size, toPNG: () => Buffer.from('PNG'),
        resize: ({ width }) => image({ width, height: Math.round(size.height * width / size.width) }) })
      return image({ width: 1600, height: 800 })
    }
  }
  server = createControlServer({
    baseDirectory: home,
    deps: {
      async runBuild(projectPath, options) { builds.push({ projectPath, options }); return builds.length === 1 ? { success: true, romPath: path.join(projectPath, 'out', 'rom.bin'), exitCode: 0 } : { success: false, exitCode: 2, error: 'Erro de compilação', errors: [{ file: 'src/main.c', line: 3, message: 'x' }], stderr: 'falhou' } },
      async runEmulator(rom) { return { success: true, message: 'Emulador iniciado com ' + path.basename(rom) } },
      findRom: () => null,
      toolkitPath: () => null,
      appVersion: '9.9.9'
    },
    resolveContext: async () => ({ workspace: openWorkspace, webContents: fakeWindow })
  })
  const socketPath = await server.start()
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(socketPath)).mode & 0o777, 0o700, 'pasta do socket só do usuário')
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600, 'socket só do usuário')
  }
  const token = server.openSession({ webContentsId: 1, workspace })

  // Ponte MCP com token válido.
  const mcp = startBridge({ RETRO_CONTROL_SOCKET: socketPath, RETRO_CONTROL_TOKEN: token })
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
  assert.equal(init.result.serverInfo.name, 'retro-studio')
  assert.equal(init.result.protocolVersion, '2025-06-18')
  const tools = (await mcp.request('tools/list')).result.tools
  const names = tools.map(tool => tool.name)
  for (const name of ['project_info', 'project_tree', 'file_read', 'ide_state', 'ide_notifications', 'ide_screenshot', 'build_run', 'build_errors', 'build_rom', 'run_emulator'])
    assert.ok(names.includes(name), 'ferramenta ' + name)
  assert.ok(names.every(name => /^[a-zA-Z0-9_-]{1,64}$/.test(name)), 'nomes válidos para MCP')
  assert.equal(tools.find(tool => tool.name === 'file_read').annotations.readOnlyHint, true)
  assert.equal(tools.find(tool => tool.name === 'build_run').annotations.readOnlyHint, false)
  assert.equal(names.length, controlCommands.filter(command => command.agents.includes('acp')).length)

  const info = text(await mcp.call('project_info'))
  assert.equal(info.workspace, workspace)
  assert.equal(info.isRetroProject, true)
  assert.equal(info.ideVersion, '9.9.9')

  const tree = text(await mcp.call('project_tree', { depth: 3 }))
  const treeNames = tree.children.map(node => node.name)
  assert.ok(treeNames.includes('src') && treeNames.includes('retro-studio.json'))
  assert.ok(!treeNames.includes('.git') && !treeNames.includes('node_modules'), 'sem pastas ocultas nem node_modules')

  const file = text(await mcp.call('file_read', { path: 'src/main.c', startLine: 2, endLine: 3 }))
  assert.equal(file.content, '{\n  return 0;')
  assert.equal(file.totalLines, 5)
  for (const outside of ['../other/secret.txt', path.join(other, 'secret.txt'), 'link-out/secret.txt']) {
    const refused = await mcp.call('file_read', { path: outside })
    assert.equal(refused.isError, true, 'fora do projeto: ' + outside)
    assert.match(refused.content[0].text, /fora do projeto|Não encontrado/)
    assert.doesNotMatch(refused.content[0].text, /conteudo-secreto/)
  }
  assert.equal((await mcp.call('project_tree', { path: 'link-out' })).isError, true, 'árvore por link para fora')

  assert.equal(text(await mcp.call('ide_state')).editorMode, 'maps')
  assert.deepEqual(text(await mcp.call('ide_notifications', { limit: 1 })).notifications.map(item => item.message), ['aviso 2'])
  const shot = await mcp.call('ide_screenshot', { maxWidth: 800 })
  assert.deepEqual(text(shot), { width: 800, height: 400 })
  assert.equal(shot.content[1].type, 'image')
  assert.equal(Buffer.from(shot.content[1].data, 'base64').toString(), 'PNG')

  const built = await mcp.call('build_run', { clean: true, flavor: 'debug' })
  assert.equal(built.isError, false)
  assert.deepEqual(builds[0].options, { clean: true, flavor: 'debug' })
  const record = JSON.parse(fs.readFileSync(path.join(project, '.retrostudio', 'last-acp-build.json'), 'utf8'))
  assert.equal(record.action, 'build'); assert.equal(record.success, true); assert.ok(record.at > 0, 'contrato do painel ACP')
  const failed = await mcp.call('build_rom')
  assert.equal(failed.isError, true)
  assert.equal(text(failed).errors[0].line, 3)
  const lastBuild = text(await mcp.call('build_errors'))
  assert.equal(lastBuild.success, false); assert.equal(lastBuild.stderrTail, 'falhou'); assert.equal(lastBuild.errors[0].line, 3)
  fs.writeFileSync(path.join(project, '.retrostudio', 'last-acp-build.json'), JSON.stringify({ action: 'build', success: true, romPath: 'out/rom.bin', stdout: 'x'.repeat(100000), at: 1 }))
  const legacy = text(await mcp.call('build_errors'))
  assert.equal(legacy.success, true); assert.equal(legacy.stdout, undefined, 'registro antigo sem o stdout inteiro')
  const played = await mcp.call('run_emulator')
  assert.equal(played.isError, true, 'sem ROM, compila antes; o build falso falha')
  assert.equal(builds.length, 3)

  assert.equal((await mcp.call('nao_existe')).isError, true)

  // Projeto trocado na IDE: a sessão do agente deixa de valer.
  openWorkspace = fs.realpathSync(other)
  assert.match((await mcp.call('project_info')).content[0].text, /mudou/)
  openWorkspace = workspace

  // Token errado e sessão encerrada.
  const intruder = startBridge({ RETRO_CONTROL_SOCKET: socketPath, RETRO_CONTROL_TOKEN: 'x'.repeat(64) })
  await intruder.request('initialize', {})
  assert.match((await intruder.request('tools/list')).error.message, /Token inválido/)
  assert.equal((await intruder.call('project_info')).isError, true)
  intruder.stop()
  server.closeSession(token)
  assert.match((await mcp.call('project_info')).content[0].text, /Token inválido/)
  mcp.stop()

  // Sem IDE: a ponte responde com erro em vez de travar.
  const orphan = startBridge({ RETRO_CONTROL_SOCKET: path.join(temporary, 'nada.sock'), RETRO_CONTROL_TOKEN: token })
  assert.match((await orphan.call('project_info')).content[0].text, /não está acessível/)
  orphan.stop()

  // Gerenciador ACP: usa a fábrica e revoga o token quando o agente sai.
  const manager = new AcpSessionManager()
  let closed = 0
  manager.setMcpServerFactory(({ webContentsId, workspaceRoot }) => ({ server: { name: 'retro-studio', command: 'x', args: [], env: [{ name: 'W', value: `${webContentsId}:${workspaceRoot}` }] }, close: () => closed++ }))
  const created = manager.createMcpServers(7, workspace)
  assert.equal(created.servers[0].env[0].value, `7:${workspace}`)
  created.close(); assert.equal(closed, 1)
  const fake = { closeControl: () => closed++, dispose: async () => {} }
  manager.clients.set(7, fake); await manager.stopNow(7); assert.equal(closed, 2, 'stop revoga o token')
  manager.clients.set(8, { closeControl: () => closed++, killNow() {} }); manager.killAll(); assert.equal(closed, 3, 'saída do app revoga o token')

  await server.stop()
  if (process.platform !== 'win32') assert.equal(fs.existsSync(socketPath), false, 'socket removido ao sair')
  server = null

  // HOME com caminho longo: o socket não cabe no limite do Unix e vai para uma pasta privada.
  if (process.platform !== 'win32') {
    server = createControlServer({ baseDirectory: path.join(temporary, 'x'.repeat(120)), deps: {}, resolveContext: async () => ({}) })
    const longPath = await server.start()
    assert.ok(Buffer.byteLength(longPath) <= 100 && longPath.startsWith(os.tmpdir()), longPath)
    assert.equal(fs.statSync(path.dirname(longPath)).mode & 0o777, 0o700)
    await server.stop()
    server = null
  }
  console.log('control api ok')
} finally {
  await server?.stop()
  fs.rmSync(temporary, { recursive: true, force: true })
}
