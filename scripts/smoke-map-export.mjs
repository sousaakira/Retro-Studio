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
  await fs.writeFile(path.join(projectPath, 'tools', 'export.py'), "raise ValueError('forest-clearing.tmx: 10 objetos animados; limite de 8 por sala')\n")
  const failed = await runConfiguredMapExporter({ projectPath, mapPath })
  assert.equal(failed.exported, false)
  assert.match(failed.error, /ValueError: forest-clearing.tmx: 10 objetos animados; limite de 8/)
  assert.match(failed.stderr, /Traceback/)
  assert.equal(await fs.readFile(mapPath, 'utf8'), '<map />', 'Export failure must preserve the saved map')

  await fs.writeFile(path.join(projectPath, 'tools', 'export.py'), "import sys\nprint('Asset terrain.png ausente')\nsys.exit(2)\n")
  const stdoutFailure = await runConfiguredMapExporter({ projectPath, mapPath })
  assert.match(stdoutFailure.error, /Asset terrain.png ausente/)

  await fs.writeFile(path.join(projectPath, 'tools', 'export.py'), "import sys\nsys.exit(3)\n")
  const silentFailure = await runConfiguredMapExporter({ projectPath, mapPath })
  assert.match(silentFailure.error, /código 3/)
  await fs.mkdir(path.join(projectPath,'src','generated'),{recursive:true})
  await fs.mkdir(path.join(projectPath,'res','generated'),{recursive:true})
  await fs.writeFile(path.join(projectPath,'src','generated','map_data.h'),'old header')
  await fs.writeFile(path.join(projectPath,'res','generated','map-bg.png'),'old atlas')
  await fs.writeFile(path.join(projectPath,'retro-studio.json'),JSON.stringify({
    mapExport:{script:'tools/export.py',sourceMaps:['maps/active.tmx'],outputProtocol:'retro-studio-map-outputs-v1'}
  }))
  const stagingScript = "import os\nfrom pathlib import Path\nstage=Path(os.environ['RETROSTUDIO_EXPORT_STAGE'])\n(stage/'src/generated').mkdir(parents=True,exist_ok=True)\n(stage/'res/generated').mkdir(parents=True,exist_ok=True)\n(stage/'src/generated/map_data.h').write_text('new header')\n(stage/'res/generated/map-bg.png').write_text('new atlas')\n"
  await fs.writeFile(path.join(projectPath,'tools','export.py'),stagingScript+"raise ValueError('staging failed')\n")
  const stagedFailure=await runConfiguredMapExporter({projectPath,mapPath})
  assert.equal(stagedFailure.success,false)
  assert.equal(await fs.readFile(path.join(projectPath,'src','generated','map_data.h'),'utf8'),'old header')
  assert.equal(await fs.readFile(path.join(projectPath,'res','generated','map-bg.png'),'utf8'),'old atlas')
  await fs.writeFile(path.join(projectPath,'tools','export.py'),stagingScript)
  const staged=await runConfiguredMapExporter({projectPath,mapPath})
  assert.equal(staged.success,true,staged.error)
  assert.ok(staged.transaction.transactionId)
  assert.equal(await fs.readFile(path.join(projectPath,'src','generated','map_data.h'),'utf8'),'new header')
  assert.equal(await fs.readFile(path.join(projectPath,'res','generated','map-bg.png'),'utf8'),'new atlas')
  await fs.writeFile(path.join(projectPath,'tools','export.py'),stagingScript+"(stage/'unexpected.txt').write_text('bad')\n")
  const unexpected=await runConfiguredMapExporter({projectPath,mapPath})
  assert.equal(unexpected.success,false)
  assert.match(unexpected.error,/Unexpected map output/)
  assert.equal(await fs.readFile(path.join(projectPath,'src','generated','map_data.h'),'utf8'),'new header')
  await fs.writeFile(path.join(projectPath,'res','terrain.png'),'original pixels')
  await fs.writeFile(path.join(projectPath,'retro-studio.json'),JSON.stringify({
    mapExport:{script:'tools/export.py',sourceMaps:['maps/active.tmx'],outputProtocol:'retro-studio-map-outputs-v1',inputPaths:['res']}
  }))
  await fs.writeFile(path.join(projectPath,'tools','export.py'),stagingScript+"Path('res/terrain.png').write_text('modified pixels')\n")
  const changedInput=await runConfiguredMapExporter({projectPath,mapPath})
  assert.equal(changedInput.success,false)
  assert.match(changedInput.error,/inputs changed/)
  assert.equal(await fs.readFile(path.join(projectPath,'src','generated','map_data.h'),'utf8'),'new header')
  await fs.writeFile(path.join(projectPath,'tools','export.py'),stagingScript+"Path('res/new-input.png').write_text('new pixels')\n")
  const createdInput=await runConfiguredMapExporter({projectPath,mapPath})
  assert.equal(createdInput.success,false)
  assert.match(createdInput.error,/inputs changed/)
  const configPath=path.join(projectPath,'retro-studio.json')
  const configBefore=await fs.readFile(configPath)
  const realRead=fs.readFile
  let configChanged=false
  fs.readFile=async (target,...args)=>{
    const bytes=await realRead(target,...args)
    if(target===configPath&&!configChanged){
      configChanged=true
      const parsed=JSON.parse(configBefore.toString('utf8'));parsed.customRevision=1
      await fs.writeFile(configPath,JSON.stringify(parsed))
    }
    return bytes
  }
  try{await assert.rejects(runConfiguredMapExporter({projectPath,mapPath}),/configuration changed before/)}
  finally{fs.readFile=realRead;await fs.writeFile(configPath,configBefore)}
  const outside=path.join(projectPath,'..','outside-'+path.basename(projectPath)+'.png')
  await fs.writeFile(outside,'outside')
  try{
    await fs.symlink(outside,path.join(projectPath,'res','linked.png'))
    await assert.rejects(runConfiguredMapExporter({projectPath,mapPath}),/symlinks/)
  }finally{await fs.unlink(outside)}
  console.log('smoke-map-export: PASS (legacy and staged transaction exports)')
} finally {
  await fs.rm(projectPath, { recursive: true, force: true })
}
