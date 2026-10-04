import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runConfiguredMapExporter } from '../electron/retro/mapExporter.js'

const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-map-export-'))
try {
  await fs.mkdir(path.join(projectPath, 'maps'), { recursive: true })
  await fs.mkdir(path.join(projectPath, 'tools'), { recursive: true })
  const mapPath = path.join(projectPath, 'maps', 'active.tmx')
  const exampleMapPath = path.join(projectPath, 'maps', 'example.tmx')
  await fs.writeFile(mapPath, '<map />')
  await fs.writeFile(exampleMapPath, '<map />')
  await fs.writeFile(path.join(projectPath, 'tools', 'export.py'), "from pathlib import Path\nPath('export-ran').write_text('ok')\n")
  await fs.writeFile(path.join(projectPath, 'retro-studio.json'), JSON.stringify({
    mapExport: { script: 'tools/export.py', sourceMaps: ['maps/active.tmx'] }
  }))

  const exported = await runConfiguredMapExporter({ projectPath, mapPath })
  assert.equal(exported.configured, true)
  assert.equal(exported.exported, true, exported.error)
  assert.equal(await fs.readFile(path.join(projectPath, 'export-ran'), 'utf8'), 'ok')

  const skipped = await runConfiguredMapExporter({ projectPath, mapPath: exampleMapPath })
  assert.equal(skipped.skipped, true, 'Unlisted example maps must not trigger the project exporter')

  await assert.rejects(
    runConfiguredMapExporter({ projectPath, mapPath: path.join(projectPath, '..', 'outside.tmx') }),
    /dentro do projeto/
  )
  console.log('smoke-map-export: PASS')
} finally {
  await fs.rm(projectPath, { recursive: true, force: true })
}
