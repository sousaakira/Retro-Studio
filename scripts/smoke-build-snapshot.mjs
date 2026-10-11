import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beginBuildSnapshot, finishBuildSnapshot, inspectBuildSnapshot } from '../electron/retro/buildSnapshot.js'
import { inspectCompiledResources } from '../electron/retro/compiledResources.js'

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-build-snapshot-'))
try {
  const root=path.join(temporary,'game');fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.mkdirSync(path.join(root,'out'))
  const source=path.join(root,'src/main.c'),rom=path.join(root,'out/rom.bin'),receiptPath=path.join(root,'.retro-studio/builds/latest.json')
  fs.writeFileSync(source,'int main(void){return 0;}\n');fs.writeFileSync(rom,Buffer.alloc(32,7))
  for (const directory of ['charsets','scenes','world','physics','controls','camera','progress','audio','debug']) {
    fs.mkdirSync(path.join(root,directory));fs.writeFileSync(path.join(root,directory,'authoring.json'),'{}')
  }
  assert.equal(inspectBuildSnapshot(root).status,'not-recorded')
  const started=beginBuildSnapshot(root)
  assert.equal(finishBuildSnapshot(root,started,rom).status,'recorded')
  const original=fs.readFileSync(receiptPath)
  let report=inspectBuildSnapshot(root)
  assert.equal(report.status,'matches-recorded-files');assert.equal(report.compilerDependencyProof,false)
  assert.equal(report.inputStability,'unchanged-between-observations');assert.equal(report.incomplete,false)
  assert.equal(inspectCompiledResources(root).buildSnapshot.status,'matches-recorded-files')
  assert.equal(inspectCompiledResources(root).buildSnapshot.artifactAssociation,'unproven','no ELF does not associate compiled facts')
  for (const directory of ['charsets','scenes','world','physics','controls','camera','progress','audio','debug']) {
    const file=path.join(root,directory,'authoring.json');fs.writeFileSync(file,'{"edited":true}')
    assert.ok(inspectBuildSnapshot(root).changed.includes(directory+'/authoring.json'))
    fs.writeFileSync(file,'{}')
  }
  fs.writeFileSync(source,'int main(void){return 1;}\n')
  assert.deepEqual(inspectBuildSnapshot(root).changed,['src/main.c'])
  fs.writeFileSync(path.join(root,'src/new.c'),'new')
  assert.deepEqual(inspectBuildSnapshot(root).added,['src/new.c'])
  fs.unlinkSync(source);assert.deepEqual(inspectBuildSnapshot(root).missing,['src/main.c'])
  fs.writeFileSync(rom,Buffer.alloc(32,8));assert.ok(inspectBuildSnapshot(root).changed.includes('out/rom.bin'))
  const next=beginBuildSnapshot(root);fs.writeFileSync(path.join(root,'src/new.c'),'changed while make ran')
  assert.equal(finishBuildSnapshot(root,next,rom).inputStability,'changed-during-build')
  assert.equal(inspectBuildSnapshot(root).status,'matches-recorded-files')
  assert.equal(inspectBuildSnapshot(root).inputStability,'changed-during-build','matching hashes do not erase observation limits')
  const outside=path.join(temporary,'private');fs.writeFileSync(outside,'preserve')
  fs.symlinkSync(outside,path.join(root,'src/link.c'))
  assert.ok(beginBuildSnapshot(root).inputs.diagnostics.length)
  assert.equal(finishBuildSnapshot(root,beginBuildSnapshot(root),rom).status,'recorded')
  assert.equal(inspectBuildSnapshot(root).incomplete,true)
  fs.unlinkSync(path.join(root,'src/link.c'))
  fs.writeFileSync(receiptPath,original)
  const forged=JSON.parse(original);forged.inputs[0].path='../private'
  fs.writeFileSync(receiptPath,JSON.stringify(forged))
  assert.equal(inspectBuildSnapshot(root).status,'unavailable')
  assert.equal(fs.readFileSync(outside,'utf8'),'preserve')
  fs.writeFileSync(receiptPath,'{"version":9,"producer":"someone-else"}')
  const unmanaged=fs.readFileSync(receiptPath)
  assert.equal(finishBuildSnapshot(root,beginBuildSnapshot(root),rom).status,'unavailable')
  assert.deepEqual(fs.readFileSync(receiptPath),unmanaged,'foreign metadata is not adopted')
  fs.unlinkSync(receiptPath);fs.symlinkSync(outside,receiptPath)
  assert.equal(finishBuildSnapshot(root,beginBuildSnapshot(root),rom).status,'unavailable')
  assert.equal(inspectBuildSnapshot(root).status,'unavailable');assert.equal(fs.readFileSync(outside,'utf8'),'preserve')
  const other=path.join(temporary,'other');fs.mkdirSync(other)
  assert.equal(finishBuildSnapshot(other,started,rom).status,'unavailable','a build cannot change its root')
  for(const module of ['game','buildForTools']) {
    const code=fs.readFileSync(new URL('../electron/retro/'+module+'.js',import.meta.url),'utf8')
    assert.match(code,/beginBuildSnapshot\(projectPath\)/);assert.match(code,/finishBuildSnapshot\(projectPath, snapshotStart, romPath\)/)
  }
  // Run the production tools build path against an owned make fixture.
  // Replace Electron settings/emulator discovery only; spawn/make and snapshot are real.
  if (process.platform !== 'win32') {
    const emulatorSource=fs.readFileSync(new URL('../electron/retro/emulatorUtils.js',import.meta.url),'utf8')
    const findRom=emulatorSource.slice(emulatorSource.indexOf('export function findRomOutput')).replace('export function','function')
    let buildSource=fs.readFileSync(new URL('../electron/retro/buildForTools.js',import.meta.url),'utf8')
    buildSource=buildSource.replace("import { loadConfigFile } from './utils.js'",'const loadConfigFile = (_name, fallback) => fallback')
      .replace("import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'",'const resolveEmulatorPath = () => null\n'+findRom)
      .replace("'./errorParser.js'",JSON.stringify(new URL('../electron/retro/errorParser.js',import.meta.url).href))
      .replace("'./buildSnapshot.js'",JSON.stringify(new URL('../electron/retro/buildSnapshot.js',import.meta.url).href))
      .replace("'./worldConfiguration.js'",JSON.stringify(new URL('../electron/retro/worldConfiguration.js',import.meta.url).href))
      .replace("'./cameraConfiguration.js'",JSON.stringify(new URL('../electron/retro/cameraConfiguration.js',import.meta.url).href))
      .replace("'./progressConfiguration.js'",JSON.stringify(new URL('../electron/retro/progressConfiguration.js',import.meta.url).href))
      .replace("'./audioConfiguration.js'",JSON.stringify(new URL('../electron/retro/audioConfiguration.js',import.meta.url).href))
      .replace("'./cutsceneAdapter.js'",JSON.stringify(new URL('../electron/retro/cutsceneAdapter.js',import.meta.url).href))
      .replace("'./debugConfiguration.js'",JSON.stringify(new URL('../electron/retro/debugConfiguration.js',import.meta.url).href))
      .replace("'./paletteConfiguration.js'",JSON.stringify(new URL('../electron/retro/paletteConfiguration.js',import.meta.url).href))
      .replace("'./buildFlavor.js'",JSON.stringify(new URL('../electron/retro/buildFlavor.js',import.meta.url).href))
      .replace("'./hudConfiguration.js'",JSON.stringify(new URL('../electron/retro/hudConfiguration.js',import.meta.url).href))
      .replace("'./gameHost.js'",JSON.stringify(new URL('../electron/retro/gameHost.js',import.meta.url).href))
      .replace("'../../shared/retro/toolchain.js'",JSON.stringify(new URL('../shared/retro/toolchain.js',import.meta.url).href))
      .replace("'../../shared/retro/buildProgress.js'",JSON.stringify(new URL('../shared/retro/buildProgress.js',import.meta.url).href))
    const modulePath=path.join(temporary,'tools-build.mjs');fs.writeFileSync(modulePath,buildSource)
    const {runBuildAsync}=await import(pathToFileURL(modulePath).href)
    const built=path.join(temporary,'built'),toolkit=path.join(temporary,'toolkit')
    fs.mkdirSync(built);fs.mkdirSync(path.join(toolkit,'m68k-elf'),{recursive:true})
    fs.writeFileSync(path.join(toolkit,'m68k-elf/makefile.gen'),'')
    fs.writeFileSync(path.join(built,'Makefile'),'all:\n\tmkdir -p out\n\tprintf fixture > out/rom.bin\n')
    const success=await runBuildAsync(built,toolkit)
    assert.equal(success.success,true,success.stderr);assert.equal(success.buildSnapshot.status,'recorded')
    assert.equal(inspectBuildSnapshot(built).status,'matches-recorded-files')
    const recorded=fs.readFileSync(path.join(built,'.retro-studio/builds/latest.json'))
    fs.writeFileSync(path.join(built,'Makefile'),'all:\n\tfalse\n')
    assert.equal((await runBuildAsync(built,toolkit)).success,false)
    assert.deepEqual(fs.readFileSync(path.join(built,'.retro-studio/builds/latest.json')),recorded,'failed make preserves the last successful record')
  }
  console.log('Build records: hashes, source additions/removals, ROM changes, build-time changes, confinement, malformed/foreign metadata and report integration passed.')
} finally {fs.rmSync(temporary,{recursive:true,force:true})}
