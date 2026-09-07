#!/usr/bin/env node
/**
 * Smoke LSP definition (requer clangd no PATH).
 * Uso: node scripts/smoke-lsp-definition.mjs [projectPath]
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clangdManager } from '../electron/retro/clangdLsp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const project = path.resolve(process.argv[2] || path.join(root, 'assets/toolkit/examples/hello-world-sgdk'))
const mainC = path.join(project, 'src', 'main.c')

const status = clangdManager.status()
console.log('[smoke-lsp] status', status)
if (!status.available) {
  console.warn('[smoke-lsp] SKIP — clangd não instalado')
  process.exit(0)
}
if (!fs.existsSync(mainC)) {
  console.error('[smoke-lsp] FAIL missing', mainC)
  process.exit(1)
}

const content = fs.readFileSync(mainC, 'utf8')
const lines = content.split('\n')
let line = 1
let col = 1
for (let i = 0; i < lines.length; i++) {
  const idx = lines[i].indexOf('VDP_drawText')
  if (idx >= 0) {
    line = i + 1
    col = idx + 1
    break
  }
}

try {
  const def = await clangdManager.definition({
    projectPath: project,
    filePath: mainC,
    line,
    character: col,
    content
  })
  console.log('[smoke-lsp] definition', def)
  await clangdManager.stop(project)
  if (!def?.path) {
    console.error('[smoke-lsp] FAIL no definition')
    process.exit(1)
  }
  console.log('[smoke-lsp] PASS')
  process.exit(0)
} catch (e) {
  console.error('[smoke-lsp] FAIL', e.message || e)
  try { await clangdManager.stop(project) } catch { /* ignore */ }
  process.exit(1)
}
