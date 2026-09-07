#!/usr/bin/env node
/**
 * Smoke test ACP (headless):
 * initialize → session/new → prompt → write confinado → write fora (deve falhar) → dispose
 *
 * Uso: node scripts/smoke-acp.mjs [workspacePath]
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import { AcpClient } from '../electron/ai/acp/AcpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function resolveBin() {
  const homeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode')
  if (existsSync(homeBin)) return homeBin
  return 'opencode'
}

async function main() {
  const bin = resolveBin()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-acp-smoke-'))
  console.log('[smoke-acp] binary:', bin)
  console.log('[smoke-acp] workspace:', workspace)

  const client = new AcpClient({
    command: bin,
    args: ['acp'],
    cwd: workspace,
    workspaceRoot: workspace
  })

  let fileWritten = null
  client.on('fileWritten', (payload) => { fileWritten = payload })
  client.on('stderr', (t) => {
    const s = String(t || '').trim()
    if (s) console.error('[stderr]', s.slice(0, 400))
  })

  try {
    const init = await client.initialize()
    console.log('[smoke-acp] initialize ok', {
      protocolVersion: init?.protocolVersion,
      agent: init?.agentInfo?.name || init?.agentInfo?.title,
      authMethods: (init?.authMethods || []).length
    })

    const session = await client.newSession()
    console.log('[smoke-acp] session/new ok', { sessionId: session?.sessionId || client.sessionId })

    try {
      const result = await Promise.race([
        client.prompt('Responda apenas: ok'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('prompt timeout 45s')), 45000))
      ])
      console.log('[smoke-acp] prompt ok', { stopReason: result?.stopReason })
    } catch (e) {
      console.warn('[smoke-acp] prompt skipped/failed:', e.message || e)
    }

    // Write confinado via handler do cliente (mesmo caminho do agente)
    const inside = path.join(workspace, 'smoke-write.txt')
    fileWritten = null
    await client._handleWriteTextFile({ path: inside, content: 'retro-studio smoke\n' })
    const disk = await fs.readFile(inside, 'utf8')
    if (!disk.includes('retro-studio smoke')) {
      throw new Error('write confinado não persistiu no disco')
    }
    if (!fileWritten?.path) {
      throw new Error('evento fileWritten não emitido')
    }
    console.log('[smoke-acp] write ok', { path: fileWritten.path })

    // Write fora do workspace deve falhar
    const outside = path.join(os.tmpdir(), `retro-acp-outside-${Date.now()}.txt`)
    let denied = false
    try {
      await client._handleWriteTextFile({ path: outside, content: 'should-fail\n' })
    } catch (e) {
      denied = /fora do workspace/i.test(String(e?.message || e))
      if (!denied) throw e
    }
    if (!denied) throw new Error('write fora do workspace não foi bloqueado')
    console.log('[smoke-acp] confinement ok')

    try { client.cancel() } catch (_) { /* ignore */ }
    await client.dispose()
    try { await fs.rm(workspace, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    console.log('[smoke-acp] PASS')
    process.exit(0)
  } catch (e) {
    console.error('[smoke-acp] FAIL', e.message || e)
    try { await client.dispose() } catch (_) { /* ignore */ }
    try { await fs.rm(workspace, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    process.exit(1)
  }
}

main()
