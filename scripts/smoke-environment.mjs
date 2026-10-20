// #83: host setup, fixed installation arguments and preflight before any build mutation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectEnvironment, environmentInstallPlan, installEnvironment, checkBuildEnvironment, javaMajor, probeProgram } from '../electron/retro/environment.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-environment-'))
try {
  assert.equal(javaMajor('java version "1.8.0_422"'),8)
  assert.equal(javaMajor('openjdk version "17.0.12"'),17)
  assert.equal(javaMajor('openjdk 21.0.1 2024-01-01'),21)
  assert.equal(javaMajor('missing'),0)
  if(process.platform!=='win32') {
    const fakeJava=path.join(temporary,'java')
    fs.writeFileSync(fakeJava,"#!/bin/sh\nprintf '%s\\n' 'Picked up JAVA_TOOL_OPTIONS: fake-private-option' 'openjdk version \"21.0.1\"' >&2\n",{mode:0o755})
    assert.equal(await probeProgram(fakeJava,[]),'openjdk version "21.0.1"','Java option banners are not versions and must not expose environment options')
  }
  const versions={java:'openjdk version "21.0.1"',make:'GNU Make 4.3',node:'v22.1.0',npm:'10.0.0',python3:'Python 3.12',git:'git version 2.43'}
  const calls=[],probe=async(command,args,env)=>{calls.push({command,args,env});return command==='python3'&&args[0]==='-c'?'11.0.0':versions[command]||''}
  const ready=await inspectEnvironment({probe,prepare:async()=>{},toolkit:'/tk'})
  assert.equal(ready.ready,true);assert.equal(ready.items.length,process.platform==='linux'?8:7)
  assert.ok(calls.every(call=>call.env.PATH.startsWith('/tk/bin'+path.delimiter)))
  const missing=await inspectEnvironment({probe:async(command,args)=>command==='java'?'java version "1.8.0"':command==='node'?'v16.0.0':await probe(command,args,process.env),prepare:async()=>{}})
  assert.equal(missing.ready,false);assert.deepEqual(missing.items.filter(item=>!item.ok).map(item=>item.id),['java','node'])
  const plan=environmentInstallPlan(missing,{platform:'linux',exists:()=>true})
  assert.deepEqual(plan.packages,['openjdk-21-jre-headless','nodejs']);assert.equal(plan.supported,true)
  assert.equal(environmentInstallPlan(missing,{platform:'win32',exists:()=>true}).command,'')
  assert.equal(environmentInstallPlan(missing,{platform:'linux',exists:p=>!p.endsWith('pkexec')}).supported,false)
  let executed=null,inspections=0
  const installed=await installEnvironment({inspect:async()=>++inspections===1?missing:ready,plan:()=>({...plan,packages:[';evil']}),execute:async(...args)=>{executed=args}})
  assert.equal(installed.ready,true);assert.equal(inspections,2)
  assert.deepEqual(executed.slice(0,2),['/usr/bin/pkexec',['/usr/bin/apt-get','install','-y','--','openjdk-21-jre-headless','nodejs']])
  await installEnvironment({inspect:async()=>ready,execute:()=>assert.fail('Ready environment cannot run an installer')})
  await assert.rejects(installEnvironment({inspect:async()=>missing,plan:()=>({supported:false})}),/environmentManual/)
  await assert.rejects(installEnvironment({inspect:async()=>missing,plan:()=>plan,execute:async()=>{throw {code:126}}}),/environmentCancelled/)
  await assert.rejects(installEnvironment({inspect:async()=>missing,plan:()=>plan,execute:async()=>{throw {code:100}}}),/environmentInstallFailed/)
  let complete;const pending=installEnvironment({inspect:()=>new Promise(resolve=>{complete=resolve})})
  await assert.rejects(installEnvironment(),/environmentBusy/);complete(ready);await pending
  const toolkit=path.join(temporary,'toolkit');fs.mkdirSync(path.join(toolkit,'m68k-elf','bin'),{recursive:true})
  assert.equal(await checkBuildEnvironment(toolkit,{probe:()=>assert.fail('No rescomp means no Java requirement')}),null)
  fs.writeFileSync(path.join(toolkit,'m68k-elf','bin','rescomp.jar'),'fixture')
  assert.equal((await checkBuildEnvironment(toolkit,{prepare:async()=>{},probe:async()=>''})).scope,'environment')
  assert.equal((await checkBuildEnvironment(toolkit,{prepare:async()=>{},probe:async()=>'java version "1.8.0"'})).code,'java-missing')
  assert.equal(await checkBuildEnvironment(toolkit,{prepare:async()=>{},probe:async()=>'openjdk version "21"'}),null)
  const generators=path.join(temporary,'generators');fs.mkdirSync(generators)
  fs.writeFileSync(path.join(generators,'Makefile'),'all:\n\tnode tools/compile.mjs\n\tpython3 tools/export-map.py\n')
  const withoutPillow=await checkBuildEnvironment(toolkit,{projectPath:generators,prepare:async()=>{},probe:async(command,args,env)=>command==='python3'&&args[0]==='-c'&&args[1].includes('import PIL')?'':probe(command,args,env)})
  assert.deepEqual(withoutPillow.missing,['pillow'])
  assert.equal(await checkBuildEnvironment(toolkit,{prepare:async()=>{},probe:async(command,args,env)=>['npm','git'].includes(command)?'':probe(command,args,env)}),null,'Optional build tools do not block a project that does not use them')
  async function loadBuild(name) {
    const source=new URL('../electron/retro/'+name+'.js',import.meta.url)
    let code=fs.readFileSync(source,'utf8')
      .replace("import { checkBuildEnvironment } from './environment.js'",`export const checks=[];const checkBuildEnvironment=()=>new Promise(resolve=>checks.push(resolve))`)
      .replace("import { ipcMain } from 'electron'",'export const handlers=new Map();const ipcMain={on:(name,fn)=>handlers.set(name,fn)}')
      .replace("import { loadConfigFile } from './utils.js'",'const loadConfigFile=(_name,fallback)=>fallback')
      .replace("import { resolveEmulatorPath, findRomOutput } from './emulatorUtils.js'",'const resolveEmulatorPath=()=>null,findRomOutput=()=>null')
    code=code.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,(_all,start,relative,end)=>start+new URL(relative,source).href+end)
    const file=path.join(temporary,name+'.mjs');fs.writeFileSync(file,code);return import(pathToFileURL(file).href)
  }
  const root=path.join(temporary,'game');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'Makefile'),'all clean:\n\ttouch unexpected-build\n')
  const diagnosis={scope:'environment',code:'java-missing',message:'Java ausente'}
  const tools=await loadBuild('buildForTools'),pendingBuild=tools.runBuildAsync(root,toolkit,{clean:true})
  tools.checks.shift()(diagnosis);assert.equal((await pendingBuild).diagnosis.code,'java-missing')
  assert.deepEqual(fs.readdirSync(root),['Makefile'],'Preflight failure cannot clean, build or write audit files')
  let cancel;const cancelled=tools.runBuildAsync(root,toolkit,{onProcess:stop=>{cancel=stop}});cancel();tools.checks.shift()(null)
  assert.equal((await cancelled).cancelled,true)
  const ide=await loadBuild('game');ide.setupGameHandlers();const replies=[],event={reply:(...args)=>replies.push(args)}
  ide.handlers.get('retro:build-only')(event,{path:root,toolkitPath:toolkit,clean:true});assert.equal(ide.isBuildRunning(),true)
  ide.checks.shift()(diagnosis);await new Promise(setImmediate)
  assert.equal(replies[0][1].diagnosis.code,'java-missing');assert.equal(ide.isBuildRunning(),false)
  replies.length=0;ide.handlers.get('retro:build-only')(event,{path:root,toolkitPath:toolkit,clean:true});ide.handlers.get('retro:stop-build')();ide.checks.shift()(null);await new Promise(setImmediate)
  assert.equal(replies.length,0);assert.deepEqual(fs.readdirSync(root),['Makefile'],'Stop during preflight cannot start a later build')
  ide.handlers.get('retro:build-only')(event,{path:root,toolkitPath:toolkit})
  ide.handlers.get('retro:build-only')(event,{path:root,toolkitPath:'/missing-toolkit'})
  ide.checks.shift()(null);await new Promise(setImmediate)
  assert.equal(ide.isBuildRunning(),false,'A rejected newer request cannot leave preflight stuck')
  const config=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
  for(const dependency of ['libgtk-3-0','libnss3','make','nodejs','npm','python3','python3-pil','git'])assert.ok(config.build.deb.depends.includes(dependency),dependency)
  assert.ok(config.build.deb.depends.some(item=>item.includes('java17-runtime-headless')))
  console.log('Environment: missing/old tools, fixed package allowlist, duplicate installs, cancellation, post-install recheck, DEB dependencies and IDE/AI preflight before project mutation passed.')
} finally { fs.rmSync(temporary,{recursive:true,force:true}) }
