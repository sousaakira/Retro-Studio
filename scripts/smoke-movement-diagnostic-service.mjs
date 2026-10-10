// #58: isolated bundled build, guarded receipts and unchanged project sources.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {createMovementDiagnosticService} from '../electron/retro/movementDiagnostic.js'
import {movementConfigurationStatus,saveMovementConfiguration} from '../electron/retro/movementConfiguration.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-service-test-'))
const roots=[]
try{
 const project=path.join(temporary,'game'),other=path.join(temporary,'other'),sdk=path.join(temporary,'sdk')
 fs.mkdirSync(project);fs.mkdirSync(other);fs.mkdirSync(sdk);fs.writeFileSync(path.join(sdk,'makefile.gen'),'fixture')
 const initial=movementConfigurationStatus(project)
 const save=config=>saveMovementConfiguration(project,{config,revision:movementConfigurationStatus(project).revision})
 let status=save(initial.config),launched='',fail=false,pending,builds=0
 const service=createMovementDiagnosticService({toolkit:()=>sdk,launch:async rom=>{launched=rom;return {success:true}},runBuild:async root=>{
  builds++;roots.push(root);assert.notEqual(root,project)
  assert.ok(fs.readFileSync(path.join(root,'src/main.c'),'utf8').includes('movement-lab.inc'))
  assert.ok(fs.readFileSync(path.join(root,'Makefile'),'utf8').includes('include $(GDK)/makefile.gen'))
  if(pending)await pending;if(fail)throw Error('fixture compile failed')
  fs.mkdirSync(path.join(root,'out'));const rom=Buffer.alloc(512);rom.write('SEGA',256);fs.writeFileSync(path.join(root,'out/rom.bin'),rom)
 }})
 const readAll=root=>{const result={};function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else result[path.relative(root,file)]=fs.readFileSync(file).toString('base64')}}walk(root);return result}
 const before=readAll(project)
 const generated=await service.build(project,{revision:status.revision});assert.deepEqual(readAll(project),before);assert.equal(builds,1)
 await service.open(project,{token:generated.token,revision:status.revision});assert.equal(launched,generated.romPath)
 await assert.rejects(service.open(other,{token:generated.token,revision:status.revision}),/Gere uma ROM/)
 await assert.rejects(service.open(project,{token:'invented',revision:status.revision}),/Gere uma ROM/)
 fs.appendFileSync(generated.romPath,'changed');await assert.rejects(service.open(project,{token:generated.token,revision:status.revision}),/mudou/)
 const config=structuredClone(status.config);config.profiles.ntsc.walkSpeed=2;status=save(config)
 await assert.rejects(service.build(project,{revision:generated.revision}),/mudaram/)
 let release;pending=new Promise(resolve=>{release=resolve})
 const flight=service.build(project,{revision:status.revision});await assert.rejects(service.build(project,{revision:status.revision}),/já está/)
 status=save(status.config); // identical bytes retain revision; change a value instead
 config.profiles.ntsc.walkSpeed=3;status=save(config);release();await assert.rejects(flight,/mudaram/);pending=null
 assert.ok(!fs.existsSync(roots.at(-1)),'failed/obsolete build cleans only its owned scratch')
 fail=true;await assert.rejects(service.build(project,{revision:status.revision}),/compile failed/);assert.ok(!fs.existsSync(roots.at(-1)));fail=false
 for(let i=0;i<5;i++)await service.build(project,{revision:status.revision})
 assert.ok(!fs.existsSync(roots[0]),'old receipt scratch is bounded')
 service.dispose();for(const root of roots)assert.ok(!fs.existsSync(root),'session shutdown clears its owned receipts')
 await assert.rejects(service.build(project,{revision:status.revision}),/sessão/)
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const real=createMovementDiagnosticService({toolkit:()=>process.argv[sdkIndex+1]})
  const projectBeforeReal=readAll(project)
  const result=await real.build(project,{revision:status.revision});roots.push(path.dirname(path.dirname(result.romPath)))
  assert.ok(fs.statSync(result.romPath).size>512);assert.deepEqual(readAll(project),projectBeforeReal)
  console.log('PASS actual isolated service -> SGDK ROM '+fs.statSync(result.romPath).size+' bytes')
  real.dispose()
 }
}finally{
 for(const root of roots)fs.rmSync(root,{recursive:true,force:true})
 fs.rmSync(temporary,{recursive:true,force:true})
}
console.log('Movement diagnostic service: read-only project, bundled inputs, saved revisions, foreign/tampered receipts, concurrency, stale build, failures and bounded scratch passed.')
