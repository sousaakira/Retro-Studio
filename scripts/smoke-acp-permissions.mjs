// Permissões do painel ACP: pedidos simultâneos esperam a vez (antes o segundo apagava o primeiro e
// o agente ficava esperando), pedido expirado sai da tela e resposta que não chega vira aviso.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { AcpClient } from '../electron/ai/acp/AcpClient.js'

const panel = fs.readFileSync(new URL('../src/components/AcpAgentPanel.vue', import.meta.url), 'utf8')
const manager = fs.readFileSync(new URL('../electron/ai/acp/manager.js', import.meta.url), 'utf8')
const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
assert.match(panel, /if \(permission\.value\) permissionQueue\.push\(payload\)\n  else permission\.value = payload/, 'fila de pedidos')
assert.match(panel, /if \(permission\.value === request\) showNextPermission\(\)/, 'responder mostra o próximo')
assert.match(panel, /if \(!answer\?\.success\) pushSystem\(t\('acp\.permissionExpired'\)\)/, 'resposta perdida avisa')
assert.match(panel, /:disabled="answeringPermission"/, 'um clique por pedido')
// O SDK do Claude ACP numera os pedidos a partir de 0: o primeiro clique era ignorado.
assert.match(panel, /if \(permission\.value\?\.id == null \|\| answeringPermission\.value\) return/, 'id 0 é um pedido válido')
assert.doesNotMatch(panel, /!permission\.value\?\.id\b/)
assert.match(panel, /const pending = \[permission\.value, \.\.\.permissionQueue\]/, 'cancelar responde todos')
assert.match(panel, /unsubs\.push\(acp\.onPermissionClosed\?\.\(handlePermissionClosed\)\)/)
assert.equal((panel.match(/permission\.value = null/g) || []).length, 1, 'limpar sempre pela fila')
assert.match(manager, /client\.on\('permissionClosed', \(payload\) => send\('acp:permissionClosed', payload\)\)/)
assert.match(preload, /onPermissionClosed:/)
for (const locale of ['pt-BR', 'en', 'es', 'ja']) {
  const acp = JSON.parse(fs.readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')).acp
  assert.ok(acp.permissionExpired && acp.permissionFailed?.includes('{error}'), locale)
}

// Cliente: dois pedidos ao mesmo tempo são respondidos um a um, cada um com a sua resposta.
const client = Object.create(AcpClient.prototype)
EventEmitter.call(client)
client._permissionWaiters = new Map()
const written = []
client._write = message => written.push(message)
const asked = []
client.on('permission', payload => asked.push(payload.id))
const first = client._dispatch.bind(client)
const a = first({ jsonrpc: '2.0', id: 0, method: 'session/request_permission', params: { toolCall: { title: 'a' }, options: [] } })
const b = first({ jsonrpc: '2.0', id: 2, method: 'session/request_permission', params: { toolCall: { title: 'b' }, options: [] } })
await new Promise(resolve => setImmediate(resolve))
assert.deepEqual(asked, [0, 2])
assert.equal(client.resolvePermission(2, { outcome: { outcome: 'selected', optionId: 'no' } }), true)
assert.equal(client.resolvePermission(0, { outcome: { outcome: 'selected', optionId: 'yes' } }), true)
assert.equal(client.resolvePermission(0, { outcome: { outcome: 'cancelled' } }), false, 'pedido já respondido')
await Promise.all([a, b])
assert.deepEqual(written.map(m => [m.id, m.result.outcome.optionId]).sort(), [[0, 'yes'], [2, 'no']])
console.log('ACP permissions: pedido com id 0, fila de pedidos simultâneos, pedido expirado e resposta perdida passaram.')
