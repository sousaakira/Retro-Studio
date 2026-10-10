// #56: diagnostics switch exported to the game, production by default, build identity and ROM association.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createDebugConfiguration,validateDebugConfiguration,compileDebugHeader} from '../shared/retro/debugConfiguration.js'
import {debugConfigurationStatus,saveDebugConfiguration,validateDebugForBuild,debugBuildId} from '../electron/retro/debugConfiguration.js'
import {copyProjectTemplate,prepareNewProject} from '../electron/retro/starterProject.js'
import {installNewProjectRuntime} from '../electron/retro/newProject.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {validateWorldForBuild} from '../electron/retro/worldConfiguration.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),template=path.join(repository,'assets/toolkit/examples/sgdk-starter')
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-debug-config-'))
const copy=(source,target)=>fs.cpSync(source,target,{recursive:true,filter:file=>!file.includes(path.sep+'out'+path.sep)&&!file.endsWith(path.sep+'out')})
try{
 const root=path.join(temporary,'game'),other=path.join(temporary,'other');fs.mkdirSync(root);fs.mkdirSync(other)
 copyProjectTemplate(template,root,copy);installNewProjectRuntime(root);installCutsceneRuntime(root)
 const project=JSON.parse(fs.readFileSync(path.join(template,'retro-studio.json'),'utf8'))
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({name:'game',resourcePath:'res',assets:[],mapExport:project.mapExport,retroStudio:project.retroStudio},null,2))
 assert.equal((await prepareNewProject(root)).complete,true)
 for(const name of ['retro_debug.h','retro_debug.c','retro_debug_sgdk.h'])assert.ok(fs.statSync(path.join(root,'src/retro_runtime',name)).isFile(),'runtime installer distributes '+name)
 // Production is the default and nothing is gated or written before the first export.
 assert.deepEqual(validateDebugForBuild(root),{configured:false});const otherStatus=debugConfigurationStatus(other)
 let status=debugConfigurationStatus(root);assert.deepEqual(status.config,createDebugConfiguration());assert.equal(status.build,'');assert.equal(status.lastBuild,null);assert.ok(!status.exported&&!status.foreign)
 for(const bad of [{...status.config,enabled:'yes'},{...status.config,transport:'usb'},{...status.config,serial:0},{...status.config,overlay:{performance:true}},{...status.config,version:2},{...status.config,seed:-1}])assert.throws(()=>validateDebugConfiguration(bad))
 const off=compileDebugHeader(status.config,'ABCDEF');assert.match(off,/#define RETRO_PROJECT_DEBUG 0\n/);assert.match(off,/RETRO_PROJECT_DEBUG_BUILD ""/);assert.doesNotMatch(off,/_(PERFORMANCE|SUBJECT|BOXES|KDEBUG) 1/)
 assert.throws(()=>compileDebugHeader(status.config,'xyz'),/identifier/)
 // Diagnostic export: switches, an identifier, a project seed and a new identifier on every export.
 const config={...status.config,enabled:true,overlay:{performance:true,subject:true,boxes:true},transport:'kdebug'}
 let saved=saveDebugConfiguration(root,{config,revision:status.revision});assert.equal(saved.success,true);assert.match(saved.build,/^[0-9A-F]{6}$/);assert.equal(saved.build,debugBuildId(saved.config))
 assert.ok(saved.exported);assert.ok(saved.config.seed>0);assert.equal(saved.config.serial,1)
 const headerPath=path.join(root,'src/generated/debug_config.h');let header=fs.readFileSync(headerPath,'utf8')
 for(const text of ['#define RETRO_PROJECT_DEBUG 1','#define RETRO_PROJECT_DEBUG_PERFORMANCE 1','#define RETRO_PROJECT_DEBUG_BOXES 1','#define RETRO_PROJECT_DEBUG_KDEBUG 1','#define RETRO_PROJECT_DEBUG_BUILD "'+saved.build+'"'])assert.ok(header.includes(text),text)
 assert.deepEqual(debugConfigurationStatus(other),otherStatus);assert.throws(()=>saveDebugConfiguration(root,{config,revision:status.revision}),/changed/)
 const again=saveDebugConfiguration(root,{config:saved.config,revision:saved.revision});assert.notEqual(again.build,saved.build,'every export has its own identifier');assert.equal(again.config.serial,2);assert.equal(again.config.seed,saved.config.seed)
 // Two projects with the same options never share an identifier; the serial wraps with a new seed.
 {const twin=path.join(temporary,'twin');fs.mkdirSync(twin);const first=saveDebugConfiguration(twin,{config,revision:debugConfigurationStatus(twin).revision});assert.notEqual(first.build,saved.build)
  fs.writeFileSync(path.join(twin,'debug/debug.json'),JSON.stringify({...first.config,serial:0xFFFFFF}));fs.rmSync(path.join(twin,'src/generated/debug_config.h'));fs.rmSync(path.join(twin,'.retrostudio/debug-export.json'))
  const wrapped=saveDebugConfiguration(twin,{config:first.config,revision:debugConfigurationStatus(twin).revision});assert.equal(wrapped.config.serial,1);assert.notEqual(wrapped.config.seed,first.config.seed)}
 assert.deepEqual(validateDebugForBuild(root),{configured:true,revision:again.revision,enabled:true,build:again.build})
 assert.equal(validateWorldForBuild(root).configured,true,'saving diagnostics never makes exported maps look stale')
 // Association with the ROM on disk: only what can be proven is stated.
 const crypto=await import('node:crypto'),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
 const romPath=path.join(root,'out/rom.bin');fs.mkdirSync(path.join(root,'out'),{recursive:true});fs.mkdirSync(path.join(root,'.retro-studio/builds'),{recursive:true})
 const receipt=(rom,headerHash,extra={})=>fs.writeFileSync(path.join(root,'.retro-studio/builds/latest.json'),JSON.stringify({version:1,producer:'retro-studio-build',finishedAt:'2026-10-10T12:00:00.000Z',inputStability:'unchanged-between-observations',
  inputs:headerHash?[{path:'src/generated/debug_config.h',size:1,hash:headerHash}]:[],outputs:[{path:'out/rom.bin',size:rom.length,hash:digest(rom)}],...extra}))
 const last=()=>debugConfigurationStatus(root).lastBuild,headerNow=()=>digest(fs.readFileSync(headerPath))
 const withId=Buffer.from('SEGA....'+again.build+'....'),withoutId=Buffer.from('SEGA............')
 fs.writeFileSync(romPath,withId);receipt(withId,headerNow());assert.deepEqual([last().state,last().build],['diagnostic',again.build])
 fs.writeFileSync(romPath,withoutId);receipt(withoutId,headerNow());assert.deepEqual([last().state,last().reason],['unknown','identifier-not-in-rom'],'a matching header does not prove the game was recompiled')
 fs.writeFileSync(romPath,withId);receipt(withoutId,headerNow());assert.equal(last().reason,'rom-changed','a ROM built elsewhere is never described by an old receipt')
 fs.rmSync(romPath);assert.equal(last(),null);fs.writeFileSync(romPath,withId)
 receipt(withId,'b'.repeat(64));assert.equal(last().reason,'other-configuration');receipt(withId,null);assert.equal(last().reason,'no-header')
 receipt(withId,headerNow(),{inputStability:'changed-during-build'});assert.equal(last().reason,'inputs-changed')
 // The configuration file edited behind the IDE: the header no longer is its export, so nothing is claimed.
 {const file=path.join(root,'debug/debug.json'),good=fs.readFileSync(file);receipt(withId,headerNow())
  fs.writeFileSync(file,JSON.stringify({...again.config,enabled:false}));let s=debugConfigurationStatus(root);assert.deepEqual([s.exported,s.build,s.lastBuild.reason],[false,'','other-configuration'],'a diagnostic ROM is never called production')
  fs.writeFileSync(file,JSON.stringify({...again.config,serial:77}));s=debugConfigurationStatus(root);assert.deepEqual([s.exported,s.build],[false,''],'an identifier that is not in the header is never announced');fs.writeFileSync(file,good)}
 for(const text of ['{bad','{"version":1,"producer":"other"}']){fs.writeFileSync(path.join(root,'.retro-studio/builds/latest.json'),text);assert.equal(last(),null,'an unreadable or foreign receipt is unknown, never guessed')}
 fs.rmSync(path.join(root,'out'),{recursive:true,force:true})
 // "debug" is a common name: files of other tools never gate the build nor get overwritten.
 {const legacy=path.join(temporary,'legacy');fs.mkdirSync(path.join(legacy,'debug'),{recursive:true});fs.writeFileSync(path.join(legacy,'debug/debug.json'),'{"level":"verbose"}')
  assert.deepEqual(validateDebugForBuild(legacy),{configured:false});const foreign=debugConfigurationStatus(legacy);assert.equal(foreign.foreign,true)
  assert.throws(()=>saveDebugConfiguration(legacy,{config,revision:foreign.revision}),/another tool/);assert.equal(fs.readFileSync(path.join(legacy,'debug/debug.json'),'utf8'),'{"level":"verbose"}')
  const plain=path.join(temporary,'plain');fs.mkdirSync(plain);fs.writeFileSync(path.join(plain,'debug'),'a build output file');assert.deepEqual(validateDebugForBuild(plain),{configured:false});assert.equal(debugConfigurationStatus(plain).foreign,true)}
 const sdk=argument('--sgdk')
 if(sdk){
  // The same game source: diagnostic ROM carries the instrumentation, production ROM carries none of it.
  const options={cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024}
  const build=()=>{const clean=spawnSync('make',['clean','GDK='+sdk,'NODE='+process.execPath],options);assert.equal(clean.status,0,clean.stderr);const made=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],options);assert.equal(made.status,0,(made.stdout+made.stderr).slice(-5000));return fs.readFileSync(path.join(root,'out/rom.bin'))}
  const diagnostic=build();assert.ok(diagnostic.includes(Buffer.from(again.build)),'the diagnostic ROM carries its build identifier');assert.ok(diagnostic.includes(Buffer.from('RSD1 b=')))
  if(argument('--keep-rom'))fs.writeFileSync(argument('--keep-rom'),diagnostic)
  // The receipt-based association on the real ROM: confirmed by the identifier inside it.
  {const crypto2=await import('node:crypto');fs.mkdirSync(path.join(root,'.retro-studio/builds'),{recursive:true})
   fs.writeFileSync(path.join(root,'.retro-studio/builds/latest.json'),JSON.stringify({version:1,producer:'retro-studio-build',finishedAt:'now',inputStability:'unchanged-between-observations',
    inputs:[{path:'src/generated/debug_config.h',size:1,hash:crypto2.createHash('sha256').update(fs.readFileSync(headerPath)).digest('hex')}],outputs:[{path:'out/rom.bin',size:diagnostic.length,hash:crypto2.createHash('sha256').update(diagnostic).digest('hex')}]}))
   assert.equal(debugConfigurationStatus(root).lastBuild.state,'diagnostic')}
  const production=saveDebugConfiguration(root,{config:{...again.config,enabled:false},revision:debugConfigurationStatus(root).revision});assert.equal(production.build,'')
  const plain=build();assert.ok(!plain.includes(Buffer.from('RSD1 b='))&&!plain.includes(Buffer.from(again.build))&&!plain.includes(Buffer.from(' BLK '))&&!plain.includes(Buffer.from(' MAX ')),'production ROM has no instrumentation strings');assert.ok(diagnostic.includes(Buffer.from(' BLK ')))
  console.log('PASS same game source: diagnostic ROM '+again.build+' with instrumentation, production ROM without it ('+plain.length+' bytes)')
  header=fs.readFileSync(headerPath,'utf8')
 }
 // Stale source and customized header: reported, never overwritten.
 const current=JSON.parse(fs.readFileSync(path.join(root,'debug/debug.json'),'utf8'))
 fs.writeFileSync(path.join(root,'debug/debug.json'),JSON.stringify({...current,enabled:!current.enabled}));assert.throws(()=>validateDebugForBuild(root),/mudou/)
 fs.writeFileSync(path.join(root,'debug/debug.json'),JSON.stringify(current,null,2)+'\n');assert.equal(validateDebugForBuild(root).configured,true)
 fs.appendFileSync(headerPath,'/* manual */');assert.ok(debugConfigurationStatus(root).headerConflict);assert.throws(()=>validateDebugForBuild(root),/personalizado/)
 assert.throws(()=>saveDebugConfiguration(root,{config:current,revision:debugConfigurationStatus(root).revision}),/customized/);assert.ok(fs.readFileSync(headerPath,'utf8').endsWith('/* manual */'))
 for(const text of ['null','{bad']){fs.writeFileSync(path.join(root,'.retrostudio/debug-export.json'),text);assert.throws(()=>debugConfigurationStatus(root),/Unsupported debug export record/)}
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Debug configuration: production default, switches, per-export build identifier, ROM association by exact header, project isolation, build gate and conflicts passed.')
