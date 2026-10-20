// Issue #84: real ACP stdio transport, deterministic agent, no network or credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AcpClient } from '../electron/ai/acp/AcpClient.js'
import { AcpSessionManager } from '../electron/ai/acp/manager.js'
import { clipboardImageFiles } from '../src/utils/chatImages.js'
import {
  validateImageAttachments, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT
} from '../shared/ai/imageAttachments.js'

const png = {
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
}
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-acp-images-'))
const clients = []
const timer = setTimeout(() => { throw new Error('ACP image smoke timeout') }, 30000)
try {
  const fixture = path.join(workspace, 'agent.mjs')
  await fs.writeFile(fixture, `
import { createInterface } from 'node:readline'
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const { id, method, params } = JSON.parse(line)
  if (id == null) continue
  let result = {}
  if (method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {
    promptCapabilities: { image: process.argv[2] === 'vision', embeddedContext: process.argv[2] === 'vision' }, loadSession: true
  } }
  if (method === 'session/new' || method === 'session/load') result = { sessionId: 'test-session' }
  if (method === 'session/prompt') result = { stopReason: 'end_turn', received: params }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
}
`)
  const manager = new AcpSessionManager()
  for (const vision of [true, false]) {
    const client = new AcpClient({
      command: process.execPath, args: [fixture, vision ? 'vision' : 'text'],
      cwd: workspace, workspaceRoot: workspace
    })
    clients.push(client)
    client.provider = 'opencode'
    client.send = () => {}
    const info = await manager.initializeAndOpen(client, {
      provider: 'opencode', bin: process.execPath, workspaceRoot: workspace, mode: 'new'
    })
    assert.equal(info.capabilities.image, vision, 'UI receives the handshake image capability')
    const loaded = await manager.openOnClient(client, { mode: 'load', sessionId: 'test-session' })
    assert.equal(loaded.capabilities.image, vision, 'loading preserves the image capability')
    manager.clients.set(1, client)
    const plain = await manager.prompt(1, 'Texto normal')
    assert.deepEqual(plain.received.prompt, [{ type: 'text', text: 'Texto normal' }])
    if (!vision) {
      await assert.rejects(client.prompt('Veja', { images: [png] }), { code: 'ACP_IMAGE_UNSUPPORTED' })
      // Arquivo salvo: só o link, sem o conteúdo (economiza tokens a cada mensagem).
      const linked = await client.prompt('Olhe', { currentFilePath: path.join(workspace, 'main.c') })
      assert.deepEqual(linked.received.prompt[1], { type: 'resource_link', uri: 'file://' + path.join(workspace, 'main.c'), name: 'main.c' })
      // Não salvo, agente sem embeddedContext: o conteúdo vai como texto.
      const unsaved = await client.prompt('Olhe', { currentFilePath: path.join(workspace, 'main.c'), currentFileContent: 'int x;' })
      assert.equal(unsaved.received.prompt[1].type, 'text')
      assert.match(unsaved.received.prompt[1].text, /não salvo[\s\S]*int x;/)
    } else {
      const sent = await manager.prompt(1, 'Veja o erro', {
        images: [{ ...png, name: 'not-a-path.png', uri: 'file:///private', ignored: 'field' }],
        contextNotes: ['Build com erro'], currentFilePath: path.join(workspace, 'main.c'), currentFileContent: 'int main(void) {}'
      })
      assert.deepEqual(sent.received.prompt.map(block => block.type), ['text', 'image', 'text', 'resource'])
      assert.deepEqual(sent.received.prompt[1], { type: 'image', ...png }, 'only inline data crosses ACP')
      assert.equal(sent.received.prompt[2].text, 'Build com erro')
      assert.equal(sent.received.prompt[3].resource.text, 'int main(void) {}')
      const imageOnly = await client.prompt('', { images: [png] })
      assert.deepEqual(imageOnly.received.prompt, [{ type: 'image', ...png }])
      const before = client.nextId
      for (const images of [
        null, 'file:///private', [{ mimeType: 'image/svg+xml', data: 'test' }],
        [{ mimeType: 'image/png', data: 'https://invalid/image.png' }],
        [{ mimeType: 'image/png', data: 'data:image/png;base64,' + png.data }],
        [{ mimeType: 'image/png', data: Buffer.from('not an image').toString('base64') }],
        [{ ...png, data: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) }],
        Array(MAX_IMAGE_COUNT + 1).fill(png)
      ]) await assert.rejects(client.prompt('Invalid', { images }), /ACP_IMAGE_/, 'invalid input rejected before request')
      assert.equal(client.nextId, before, 'rejected image payloads never reach the agent')
    }
    await client.dispose()
  }

  const large = { mimeType: 'image/png', data: Buffer.concat([
    Buffer.from(png.data, 'base64').subarray(0, 16), Buffer.alloc(MAX_IMAGE_BYTES - 16)
  ]).toString('base64') }
  assert.throws(() => validateImageAttachments([large, large, large]), { code: 'ACP_IMAGE_TOTAL' })
  assert.throws(() => validateImageAttachments([{ ...png, data: '!!!!' }]), { code: 'ACP_IMAGE_INVALID' })

  const file = { type: 'image/png', name: 'clipboard.png' }
  assert.deepEqual(clipboardImageFiles({ items: [{ kind: 'file', type: file.type, getAsFile: () => file }] }), [file])
  assert.deepEqual(clipboardImageFiles({ files: [file] }), [file])
  assert.deepEqual(clipboardImageFiles({ items: [{ kind: 'string', type: 'text/plain' }] }), [])

  for (const locale of ['pt-BR', 'en', 'es', 'ja']) {
    const strings = JSON.parse(await fs.readFile(new URL('../src/locales/' + locale + '.json', import.meta.url), 'utf8')).acp.images
    for (const key of ['attach', 'preview', 'remove', 'unsupported', 'reading', 'format', 'invalid', 'size', 'total', 'count', 'sendFailed']) {
      assert.equal(typeof strings[key], 'string', locale + ': ' + key)
    }
  }
  console.log('PASS ACP image transport, capabilities, text/context compatibility, payload limits, clipboard extraction and four locales (#84).')
} finally {
  clearTimeout(timer)
  for (const client of clients) await client.dispose()
  await fs.rm(workspace, { recursive: true, force: true })
}
