#!/usr/bin/env node
/**
 * Smoke test ACP (headless): resolve binário → initialize → session/new → cancel → dispose.
 * Uso: node scripts/smoke-acp.mjs [workspacePath]
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { AcpClient } from '../electron/ai/acp/AcpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const workspace = path.resolve(process.argv[2] || root)

function resolveBin() {
  const homeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode')
  if (existsSync(homeBin)) return homeBin
  return 'opencode'
}

async function main() {
  const bin = resolveBin()
  console.log('[smoke-acp] binary:', bin)
  console.log('[smoke-acp] workspace:', workspace)

  const client = new AcpClient({
    command: bin,
    args: ['acp'],
    cwd: workspace,
    workspaceRoot: workspace
  })

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

    // prompt curto (pode falhar sem auth — ainda conta como smoke da ponte)
    try {
      const result = await Promise.race([
        client.prompt('Responda apenas: ok'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('prompt timeout 45s')), 45000))
      ])
      console.log('[smoke-acp] prompt ok', { stopReason: result?.stopReason })
    } catch (e) {
      console.warn('[smoke-acp] prompt skipped/failed:', e.message || e)
    }

    try { client.cancel() } catch (_) { /* ignore */ }
    await client.dispose()
    console.log('[smoke-acp] PASS')
    process.exit(0)
  } catch (e) {
    console.error('[smoke-acp] FAIL', e.message || e)
    try { await client.dispose() } catch (_) { /* ignore */ }
    process.exit(1)
  }
}

main()
