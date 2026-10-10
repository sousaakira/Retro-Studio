#!/usr/bin/env node
// Uses the same bounded compiler, ownership and publication journal as the IDE.
// node tools/compile-cutscenes.mjs [--project <dir>] [--check]
// --check validates saved sources without writing any output or metadata.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCutsceneExport, publishCutsceneExport } from './cutscene-export.mjs'

try {
  const args = process.argv.slice(2)
  let project = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
  let checkOnly = false
  let hasProject = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') checkOnly = true
    else if (args[index] === '--project' && !hasProject && args[index + 1] && !args[index + 1].startsWith('--')) {
      project = resolve(args[++index]); hasProject = true
    } else throw Error('Usage: node tools/compile-cutscenes.mjs [--project <dir>] [--check]')
  }
  const result = checkOnly ? checkCutsceneExport(project) : publishCutsceneExport(project)
  if (!result.success) {
    for (const error of result.errors || ['Cutscene compilation failed.']) console.error('erro: ' + error)
    process.exitCode = 1
  } else if (checkOnly) console.log('compile-cutscenes: ' + result.scripts + ' cena(s) válidas.')
  else console.log('compile-cutscenes: ' + (result.changed.length ? 'publicação concluída.' : 'sem mudanças.'))
} catch (error) {
  console.error('compile-cutscenes: ' + error.message)
  process.exitCode = 1
}
