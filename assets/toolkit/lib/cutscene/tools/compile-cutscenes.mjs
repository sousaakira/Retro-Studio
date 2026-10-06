#!/usr/bin/env node
// Compiles cutscenes/*.cutscene.json into the C headers read by
// src/retrostudio/cutscene_runner.c. Retro Studio runs the same compiler when a
// cutscene is saved; this script lets the Makefile or a terminal do it too.
//
// Usage: node tools/compile-cutscenes.mjs [--project <dir>] [--check]
//   --check  validate only; do not write headers
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileProject, defaultCutsceneConfig, parseJson } from './cutscene-compiler.mjs'

const args = process.argv.slice(2)
const projectIndex = args.indexOf('--project')
const project = resolve(projectIndex >= 0 ? args[projectIndex + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'))
const checkOnly = args.includes('--check')
const cutsceneDir = join(project, 'cutscenes')

async function findScenes(dir) {
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
  const found = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await findScenes(path))
    else if (entry.name.endsWith('.cutscene.json')) found.push(path)
  }
  return found
}

async function writeIfChanged(path, text) {
  let current = null
  try { current = await readFile(path, 'utf8') } catch { /* new file */ }
  if (current === text) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return true
}

const errors = []
let config = defaultCutsceneConfig()
try {
  const parsed = parseJson(await readFile(join(cutsceneDir, 'cutscene-config.json'), 'utf8'), 'cutscenes/cutscene-config.json')
  if (parsed.error) errors.push(parsed.error)
  else config = parsed.value
} catch {
  console.warn('compile-cutscenes: cutscenes/cutscene-config.json não encontrado; usando configuração padrão.')
}

const files = []
for (const path of (await findScenes(cutsceneDir)).sort()) {
  const rel = relative(project, path).split('\\').join('/')
  const parsed = parseJson(await readFile(path, 'utf8'), rel)
  if (parsed.error) errors.push(parsed.error)
  else files.push({ path: rel, scene: parsed.value })
}

const result = compileProject(files, config)
errors.push(...result.errors)
if (errors.length) {
  for (const error of errors) console.error(`erro: ${error}`)
  process.exit(1)
}
if (!checkOnly) {
  const idsPath = join(project, config.output?.ids || 'src/cutscene_ids.h')
  const dataPath = join(project, config.output?.data || 'src/cutscene_data.h')
  const changed = [await writeIfChanged(idsPath, result.idsHeader), await writeIfChanged(dataPath, result.dataHeader)]
  console.log(`compile-cutscenes: ${result.scripts.length} cena(s)${changed.some(Boolean) ? ', cabeçalhos atualizados' : ', sem mudanças'}.`)
} else console.log(`compile-cutscenes: ${result.scripts.length} cena(s) válidas.`)
