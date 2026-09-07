#!/usr/bin/env node
/**
 * Smoke: gera compile_flags / compile_commands para um projeto de exemplo.
 * Uso: node scripts/smoke-compile-flags.mjs [projectPath]
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeCompileFlags, resolveGdkIncDir, getToolkitPathFromSettings } from '../electron/retro/compileFlags.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const project = path.resolve(process.argv[2] || path.join(root, 'assets/toolkit/examples/hello-world-sgdk'))

if (!fs.existsSync(project)) {
  console.error('[smoke-compile-flags] project missing:', project)
  process.exit(1)
}

try {
  const toolkit = getToolkitPathFromSettings()
  const result = writeCompileFlags(project, { toolkitPath: toolkit })
  console.log('[smoke-compile-flags] toolkit:', toolkit || '(none)')
  console.log('[smoke-compile-flags] gdkInc:', result.gdkInc || '(none)')
  console.log('[smoke-compile-flags] flags:', result.flags.length)
  console.log('[smoke-compile-flags] db:', result.dbPath)
  if (!fs.existsSync(result.flagsPath)) throw new Error('flagsPath missing')
  if (!fs.existsSync(result.dbPath)) throw new Error('dbPath missing')
  const db = JSON.parse(fs.readFileSync(result.dbPath, 'utf8'))
  if (!Array.isArray(db) || db.length < 1) throw new Error('empty compile_commands')
  console.log('[smoke-compile-flags] PASS entries=', db.length)
  process.exit(0)
} catch (e) {
  console.error('[smoke-compile-flags] FAIL', e.message || e)
  process.exit(1)
}
