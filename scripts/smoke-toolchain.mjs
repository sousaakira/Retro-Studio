// #61: toolchain record, environment/project diagnosis and build failure classification.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {TOOLCHAIN_FILE,createToolchainRecord,validateToolchainRecord,compareToolchain,classifyBuildFailure} from '../shared/retro/toolchain.js'
import {detectToolchain,libraryVersions,toolchainStatus,recordToolchain} from '../electron/retro/toolchain.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-toolchain-'))
try{
 // A fake toolkit: only the files the detector looks at. Tool probes are injected.
 const toolkit=path.join(temporary,'toolkit'),sdk=path.join(toolkit,'m68k-elf')
 fs.mkdirSync(path.join(sdk,'inc'),{recursive:true});fs.mkdirSync(path.join(sdk,'bin'))
 fs.writeFileSync(path.join(sdk,'inc/genesis.h'),'#ifndef _GENESIS_H_\n#define SGDK_VERSION    1.81\n')
 fs.writeFileSync(path.join(sdk,'bin/m68k-elf-gcc'),'');fs.writeFileSync(path.join(sdk,'bin/rescomp.jar'),'')
 const tools={make:'GNU Make 4.3',java:'openjdk version "17"',python3:'Python 3.12.3'}
 const probeTool=(command,_args)=>command.endsWith('m68k-elf-gcc')?'m68k-elf-gcc (GCC) 13.1.0':tools[command]||''
 let detected=detectToolchain(toolkit,{probeTool})
 assert.deepEqual(detected,{toolkit,sdk:{name:'sgdk',version:'1.81',root:sdk},compiler:'m68k-elf-gcc 13.1.0',rescomp:true,tools,layout:''})
 assert.deepEqual(detectToolchain(path.join(temporary,'missing'),{probeTool:()=>''}),{toolkit:'',sdk:null,compiler:'',rescomp:false,tools:{make:'',java:'',python3:''},layout:''})
 {const direct=detectToolchain(sdk,{probeTool});assert.equal(direct.sdk.root,sdk);if(process.platform!=='win32'){assert.equal(direct.layout,'sdk-root');assert.ok(compareToolchain(null,direct,libraryVersions()).some(item=>item.code==='toolkit-layout'),'the build would not find the SDK there: warned')}}
 // Tools are probed with the toolkit's bin first in PATH, as the build runs them.
 {const seen=[];detectToolchain(toolkit,{probeTool:(command,_args,env)=>{seen.push([command,env?.PATH||'']);return ''}});assert.ok(seen.find(item=>item[0]==='make')[1].startsWith(path.join(toolkit,'bin')))}
 const library=libraryVersions()
 for(const id of ['core','camera','progress','audio','cutscene-host'])assert.ok(Number.isInteger(library.modules[id]),id)
 assert.equal(library.generators['cutscene-bytecode'],2);assert.ok(library.generators['cutscene-runtime']>=2);assert.match(library.ide,/^\d+\.\d+\.\d+/)
 // Legacy project: nothing recorded, nothing written, only an informative note.
 const root=path.join(temporary,'game');fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 const main=fs.readFileSync(path.join(root,'src/main.c'),'utf8')
 let status=toolchainStatus(root,{toolkit,probeTool})
 assert.equal(status.record,null);assert.deepEqual(status.issues.map(item=>item.code),['not-recorded']);assert.equal(status.environmentErrors,0);assert.deepEqual(status.installed,{})
 assert.equal(fs.existsSync(path.join(root,TOOLCHAIN_FILE)),false)
 // Record: SDK, compiler, installed modules, generators and IDE version; game files untouched.
 installRuntimeModules(root,{moduleIds:['camera','audio']})
 const recorded=recordToolchain(root,{toolkit,revision:status.revision,probeTool})
 assert.equal(recorded.success,true);assert.deepEqual(recorded.record.sdk,{name:'sgdk',version:'1.81'});assert.equal(recorded.record.compiler,'m68k-elf-gcc 13.1.0')
 assert.deepEqual(recorded.record.runtime.modules,{core:library.modules.core,camera:library.modules.camera,audio:library.modules.audio});assert.deepEqual(recorded.record.generators,library.generators)
 assert.deepEqual(recorded.issues,[]);assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),main)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,TOOLCHAIN_FILE),'utf8')),recorded.record)
 assert.throws(()=>recordToolchain(root,{toolkit,revision:status.revision,probeTool}),/changed/)
 // Environment problems are told apart from project ones.
 const codes=(record,found,lib=library)=>compareToolchain(record,found,lib).map(item=>item.scope+':'+item.severity+':'+item.code)
 assert.deepEqual(codes(recorded.record,detectToolchain('',{probeTool:()=>''})),['environment:error:toolkit-missing','environment:error:tool-missing','environment:error:tool-missing','environment:warning:tool-missing'])
 fs.rmSync(path.join(sdk,'bin/rescomp.jar'));fs.rmSync(path.join(sdk,'bin/m68k-elf-gcc'))
 assert.deepEqual(codes(recorded.record,detectToolchain(toolkit,{probeTool})),['environment:error:compiler-missing','environment:error:rescomp-missing'])
 fs.writeFileSync(path.join(sdk,'bin/m68k-elf-gcc'),'');fs.writeFileSync(path.join(sdk,'bin/rescomp.jar'),'')
 fs.writeFileSync(path.join(sdk,'inc/genesis.h'),'#define SGDK_VERSION 2.00\n')
 status=toolchainStatus(root,{toolkit,probeTool});assert.deepEqual(status.issues.map(item=>item.scope+':'+item.severity+':'+item.code),['environment:error:sdk-version']);assert.equal(status.environmentErrors,1)
 assert.match(status.issues[0].message,/registrado para o SGDK 1\.81 e o toolkit configurado tem o SGDK 2\.00/)
 fs.writeFileSync(path.join(sdk,'inc/genesis.h'),'#define SGDK_VERSION 1.90\n');assert.deepEqual(codes(recorded.record,detectToolchain(toolkit,{probeTool})),['environment:warning:sdk-version'])
 fs.writeFileSync(path.join(sdk,'inc/genesis.h'),'#define SGDK_VERSION    1.81\n')
 // Updates keep old projects: a newer IDE only offers the update; an older IDE warns.
 const newer={...library,modules:{...library.modules,camera:library.modules.camera+1},generators:{...library.generators,'cutscene-bytecode':library.generators['cutscene-bytecode']+1}}
 assert.deepEqual(codes(recorded.record,detected,newer),['project:info:module-outdated','project:info:generator-version'])
 const older={...library,modules:{core:library.modules.core,camera:library.modules.camera},generators:{'cutscene-bytecode':0}}
 assert.deepEqual(codes({...recorded.record,runtime:{modules:{...recorded.record.runtime.modules,camera:library.modules.camera+3}}},detected,older),['project:warning:module-newer','project:warning:module-unknown','project:warning:generator-version'])
 // The record follows what the project installs; re-recording is explicit.
 installRuntimeModules(root,{moduleIds:['progress']});status=toolchainStatus(root,{toolkit,probeTool})
 assert.ok(status.installed.progress&&!status.record.runtime.modules.progress)
 assert.ok(recordToolchain(root,{toolkit,revision:status.revision,probeTool}).record.runtime.modules.progress)
 // A corrupted runtime installation record is reported and never recorded as "no modules".
 {const file=path.join(root,'.retrostudio/runtime-installation.json'),good=fs.readFileSync(file);fs.writeFileSync(file,'{broken')
  const broken=toolchainStatus(root,{toolkit,probeTool});assert.equal(broken.issues[0].code,'runtime-record-invalid');assert.equal(broken.recordInvalid,true)
  assert.throws(()=>recordToolchain(root,{toolkit,revision:broken.revision,probeTool}),/unreadable/);fs.writeFileSync(file,good)}
 // A record written by a newer IDE says so.
 {const file=path.join(root,TOOLCHAIN_FILE),good=fs.readFileSync(file);fs.writeFileSync(file,JSON.stringify({format:'retro-studio.toolchain',version:2}))
  assert.match(toolchainStatus(root,{toolkit,probeTool}).issues[0].message,/IDE mais nova/);fs.writeFileSync(file,'x'.repeat(70000));assert.equal(toolchainStatus(root,{toolkit,probeTool}).issues[0].code,'record-invalid');fs.writeFileSync(file,good)}
 fs.writeFileSync(path.join(sdk,'inc/genesis.h'),'/* no version */\n');assert.deepEqual(codes(recorded.record,detectToolchain(toolkit,{probeTool})),['environment:warning:sdk-version']);fs.writeFileSync(path.join(sdk,'inc/genesis.h'),'#define SGDK_VERSION    1.81\n')
 // Unreadable record: preserved and reported; never replaced silently.
 fs.writeFileSync(path.join(root,TOOLCHAIN_FILE),'{"format":"other"}');status=toolchainStatus(root,{toolkit,probeTool})
 assert.equal(status.recordInvalid,true);assert.equal(status.issues[0].code,'record-invalid');assert.throws(()=>recordToolchain(root,{toolkit,revision:status.revision,probeTool}),/unreadable/)
 assert.equal(fs.readFileSync(path.join(root,TOOLCHAIN_FILE),'utf8'),'{"format":"other"}')
 fs.rmSync(path.join(root,TOOLCHAIN_FILE));assert.throws(()=>recordToolchain(root,{toolkit:path.join(temporary,'missing'),revision:toolchainStatus(root,{probeTool}).revision,probeTool}),/não foi encontrado/)
 for(const bad of [{},{format:'retro-studio.toolchain',version:2},{...recorded.record,sdk:{name:'SGDK',version:'1'}},{...recorded.record,runtime:{modules:{core:0}}},{...recorded.record,generators:{x:'a b'}}])assert.throws(()=>validateToolchainRecord(bad))
 assert.equal(createToolchainRecord({sdk:{name:'sgdk',version:'1.81',root:'/x'}}).sdk.root,undefined,'machine paths are never recorded')
 // Build failures: environment first, then game, otherwise unknown.
 const scope=text=>classifyBuildFailure(text).scope
 for(const text of ['/bin/sh: 1: make: not found','bash: line 1: java: command not found',"'make' is not recognized as an internal or external command",'Error: Unable to access jarfile /opt/sgdk/bin/rescomp.jar',
  'make: python3: No such file or directory','make: node: No such file or directory','make: java: Command not found','/bin/sh: line 1: java: command not found','make[1]: m68k-elf-gcc: No such file or directory',
  '\'"C:\\tk\\bin\\make.exe"\' is not recognized as an internal or external command,','process_begin: CreateProcess(NULL, java -jar rescomp.jar, ...) failed.',
  'make: /opt/x/makefile.gen: No such file or directory',"make: *** No rule to make target '/opt/x/makefile.gen'.  Stop.",'/bin/sh: 1: m68k-elf-gcc: not found',"ModuleNotFoundError: No module named 'PIL'",'write error: No space left on device',
  'java.lang.UnsupportedClassVersionError: sgdk/rescomp/Launcher'])assert.equal(scope(text),'environment',text)
 for(const text of ["src/main.c:12:5: error: 'x' undeclared (first use in this function)",'res/resources.res:3: error: cannot open file',"out/src/main.o: undefined reference to `playerUpdate'","multiple definition of `score'",
  "ld: region `rom' overflowed by 1200 bytes",'Validação do áudio: Efeito “jump”: arquivo original não encontrado (audio/sfx/jump.wav).'])assert.equal(scope(text),'game',text)
 assert.match(classifyBuildFailure("src/player.c:40:9: error: expected ';'").message,/src\/player\.c, linha 40/)
 assert.equal(scope("/bin/sh: 1: java: not found\nsrc/main.c:3:10: fatal error: resources.h: No such file or directory"),'environment','a missing tool explains the follow-up compiler error')
 assert.equal(scope('make: *** [out/rom.bin] Error 1'),'unknown');assert.equal(scope(''),'unknown')
 // Text of the game that merely mentions a tool or a module is never blamed on the machine.
 assert.equal(scope("Traceback (most recent call last):\nModuleNotFoundError: No module named 'my_game_tools'"),'unknown')
 assert.equal(scope("node not found in the level list\nsrc/main.c:10:3: error: 'x' undeclared"),'game');assert.equal(scope('src/main.c:3:3: error: #error Unable to access jarfile foo'),'game')
 assert.equal(scope('make not found here\nsrc/main.c:1:1: error: stray'),'game')
 if(argument('--toolkit')){
  const real=detectToolchain(argument('--toolkit'))
  assert.equal(real.sdk?.name,'sgdk');assert.match(real.sdk.version,/^\d+\.\d+/);assert.match(real.compiler,/^m68k-elf-gcc \d+\.\d+/);assert.equal(real.rescomp,true);assert.ok(real.tools.make)
  console.log('PASS real toolkit detected: SGDK '+real.sdk.version+', '+real.compiler+', make '+(real.tools.make?'ok':'-')+', java '+(real.tools.java?'ok':'-')+', python3 '+(real.tools.python3?'ok':'-'))
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Toolchain: detection, record of SDK/compiler/modules/generators, legacy projects, environment vs project issues, update paths, unreadable records and build failure classification passed.')
