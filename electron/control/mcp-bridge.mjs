/**
 * Servidor MCP "retro-studio" para agentes ACP (#77). O agente inicia este arquivo com o próprio
 * executável do Retro Studio (ELECTRON_RUN_AS_NODE=1), então não depende de `node` no PATH.
 * Não tem estado: repassa tools/list e tools/call para a IDE aberta pelo socket local.
 *
 * Env:
 *   RETRO_CONTROL_SOCKET — socket/pipe da IDE (obrigatório)
 *   RETRO_CONTROL_TOKEN  — token desta sessão (obrigatório; nunca é impresso)
 */
import net from 'node:net'

const socketPath = process.env.RETRO_CONTROL_SOCKET || ''
const token = process.env.RETRO_CONTROL_TOKEN || ''
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const CALL_TIMEOUT_MS = 15 * 60 * 1000 // um build completo pode demorar

function write(message) { process.stdout.write(JSON.stringify(message) + '\n') }
const respond = (id, result) => write({ jsonrpc: '2.0', id, result })
const respondError = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })

let connection = null
let nextId = 1
const pending = new Map()

function connect() {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    if (!socketPath || !token) { reject(new Error('Retro Studio: ponte MCP iniciada sem socket ou token.')); return }
    const socket = net.createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => resolve(socket))
    socket.on('data', chunk => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        let message
        try { message = JSON.parse(line) } catch { continue }
        const entry = pending.get(message.id)
        if (!entry) continue
        pending.delete(message.id)
        clearTimeout(entry.timer)
        if (message.error) entry.reject(new Error(message.error.message || 'Falha no Retro Studio.'))
        else entry.resolve(message.result)
      }
    })
    const fail = error => {
      connection = null
      const reason = new Error('O Retro Studio não está acessível (a IDE foi fechada?). ' + (error?.message || ''))
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(reason) }
      pending.clear()
      reject(reason)
    }
    socket.once('error', fail)
    socket.once('close', () => fail(new Error('conexão encerrada')))
  })
  return connection
}

async function request(method, payload = {}) {
  const socket = await connect()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('O Retro Studio não respondeu a tempo.')) }, CALL_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    socket.write(JSON.stringify({ id, token, method, ...payload }) + '\n')
  })
}

// JSON compacto: indentação vira token no contexto do agente.
function toMcpResult(result) {
  const content = [{ type: 'text', text: JSON.stringify(result?.data ?? null) }]
  if (result?.image?.base64) content.push({ type: 'image', data: result.image.base64, mimeType: result.image.mimeType || 'image/png' })
  return { content, isError: !!result?.isError }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return
  const { id, method, params } = message
  if (method === 'initialize') {
    const asked = params?.protocolVersion
    respond(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'retro-studio', version: '1.0.0' },
      instructions: 'Ferramentas do Retro Studio (IDE de Mega Drive) agindo sobre o projeto aberto na IDE: estado da tela, captura da janela, árvore e leitura de arquivos, build e emulador. Prefira build_run para compilar. Quando o usuário falar de um lugar do mapa, leia as notas que ele marcou com map_notes (área em pixels, instrução e objetos da área), veja a área com map_note_image e, ao terminar, marque com map_note_update. O que mudou em cada versão de teste do jogo está em release_list/release_read (releases/CHANGELOG.md).'
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'ping') { respond(id, {}); return }
  if (method === 'tools/list') {
    try {
      const { commands } = await request('list')
      respond(id, {
        tools: commands.map(command => ({
          name: command.name,
          description: command.description,
          inputSchema: command.inputSchema,
          annotations: { readOnlyHint: command.kind === 'read' }
        }))
      })
    } catch (error) { respondError(id, -32000, error.message) }
    return
  }
  if (method === 'tools/call') {
    try { respond(id, toMcpResult(await request('call', { name: params?.name, args: params?.arguments || {} }))) }
    catch (error) { respond(id, { content: [{ type: 'text', text: error.message }], isError: true }) }
    return
  }
  if (id != null) respondError(id, -32601, `Método não encontrado: ${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    handleMessage(message).catch(error => { if (message?.id != null) respondError(message.id, -32000, error.message) })
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
