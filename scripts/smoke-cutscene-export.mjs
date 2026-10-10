// #46: saved-source generation, ownership, rollback and incremental publication.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import vm from 'node:vm'
import path from 'node:path'
import { prepareCutsceneExport, publishCutsceneExport } from '../electron/retro/cutsceneExport.js'
import { defaultCutsceneConfig, newCutscene, compileProject } from '../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'retro-cutscene-export-'))
const write=(name,value)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n')}
const read=name=>fs.readFileSync(path.join(root,name),'utf8')
try {
 let handler,calls=0
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
 const ipcSource=main.slice(main.indexOf("  ipcMain.handle('tilemap:export-cutscenes'"),main.indexOf("  ipcMain.handle('tilemap:close-window'"))
 const ipcContext={path,cutsceneProjectPath:()=>root,prepareCutsceneExport:()=>{calls++;return {success:true}},publishCutsceneExport:()=>{calls++;return {success:true}},ipcMain:{handle(name,callback){assert.equal(name,'tilemap:export-cutscenes');handler=callback}}}
 vm.createContext(ipcContext);vm.runInContext(ipcSource,ipcContext)
 assert.throws(()=>handler({}, {projectPath:root+'/other',phase:'publish'}),/workspace/)
 assert.throws(()=>handler({}, {projectPath:root,phase:'overwrite'}),/Invalid/)
 assert.equal(calls,0)
 assert.equal(handler({}, {projectPath:root,phase:'publish'}).success,true)
 assert.equal(calls,1)
 const config=defaultCutsceneConfig(),scene=newCutscene('intro')
 write('cutscenes/cutscene-config.json',config);write('cutscenes/intro.cutscene.json',scene)
 assert.equal(prepareCutsceneExport(root).success,true)
 const first=publishCutsceneExport(root);assert.equal(first.success,true)
 const original=[read('src/cutscene_ids.h'),read('src/cutscene_data.h'),read('.retrostudio/cutscene-export.json')]
 const info=JSON.parse(original[2]);assert.equal(info.sources.length,2);assert.equal(info.files.length,2)
 const originalRead=fs.readFileSync
 let raced=false
 fs.readFileSync=(name,...args)=>{
  if(name===path.join(root,'cutscenes/cutscene-config.json') && !raced){raced=true;fs.writeFileSync(path.join(root,'src/cutscene_ids.h'),'manual-race')}
  return originalRead(name,...args)
 }
 try{assert.throws(()=>publishCutsceneExport(root),/changed outside/)}finally{fs.readFileSync=originalRead}
 assert.equal(read('src/cutscene_ids.h'),'manual-race');write('src/cutscene_ids.h',original[0])
 const repeated=publishCutsceneExport(root);assert.deepEqual(repeated.changed,[]);assert.equal(repeated.transactionId,null)
 scene.title='Updated';scene.steps=[{type:'wait',frames:12}];write('cutscenes/intro.cutscene.json',scene)
 let count=0
 assert.throws(()=>publishCutsceneExport(root,{beforePublish(){if(++count===2)throw Error('injected failure')}}),/injected failure/)
 assert.equal(read('src/cutscene_ids.h'),original[0]);assert.equal(read('src/cutscene_data.h'),original[1]);assert.equal(read('.retrostudio/cutscene-export.json'),original[2])
 assert.equal(publishCutsceneExport(root).success,true)
 const beforeSourceChange=read('src/cutscene_data.h')
 scene.steps=[{type:'wait',frames:20}];write('cutscenes/intro.cutscene.json',scene)
 let sourceEdited=false
 assert.throws(()=>publishCutsceneExport(root,{beforePublish(){if(!sourceEdited){sourceEdited=true;scene.title='External';write('cutscenes/intro.cutscene.json',scene)}}}),/source changed/)
 assert.equal(read('src/cutscene_data.h'),beforeSourceChange)
 assert.equal(JSON.parse(read('cutscenes/intro.cutscene.json')).title,'External')
 assert.equal(publishCutsceneExport(root).success,true)
 const beforeInvalid=read('src/cutscene_data.h')
 scene.steps=[{type:'set_flag',flag:'unknown'}];write('cutscenes/intro.cutscene.json',scene)
 assert.equal(publishCutsceneExport(root).success,false);assert.equal(read('src/cutscene_data.h'),beforeInvalid)
 scene.steps=[];write('cutscenes/intro.cutscene.json',scene)
 assert.equal(publishCutsceneExport(root).success,true)
 config.output={ids:'src/generated/ids.h',data:'src/generated/scenes.h'};write('cutscenes/cutscene-config.json',config)
 assert.equal(publishCutsceneExport(root).success,true)
 assert.equal(fs.existsSync(path.join(root,'src/cutscene_ids.h')),false)
 write('src/generated/ids.h','/* manual */')
 assert.throws(()=>publishCutsceneExport(root),/changed outside/);assert.equal(read('src/generated/ids.h'),'/* manual */')

 const legacy=fs.mkdtempSync(path.join(root,'legacy-'))
 fs.mkdirSync(path.join(legacy,'cutscenes'));fs.mkdirSync(path.join(legacy,'src'))
 const legacyConfig=defaultCutsceneConfig(),legacyScene=newCutscene('old')
 fs.writeFileSync(path.join(legacy,'cutscenes/cutscene-config.json'),JSON.stringify(legacyConfig))
 fs.writeFileSync(path.join(legacy,'cutscenes/old.cutscene.json'),JSON.stringify(legacyScene))
 const generated=compileProject([{path:'cutscenes/old.cutscene.json',scene:legacyScene}],legacyConfig)
 fs.writeFileSync(path.join(legacy,'src/cutscene_ids.h'),generated.idsHeader)
 fs.writeFileSync(path.join(legacy,'src/cutscene_data.h'),generated.dataHeader)
 assert.equal(prepareCutsceneExport(legacy).success,true)
 legacyScene.title='Changed';fs.writeFileSync(path.join(legacy,'cutscenes/old.cutscene.json'),JSON.stringify(legacyScene))
 assert.equal(publishCutsceneExport(legacy).success,true)
 fs.unlinkSync(path.join(legacy,'.retrostudio/cutscene-export.json'))
 fs.writeFileSync(path.join(legacy,'src/cutscene_ids.h'),'/* manual */')
 assert.throws(()=>prepareCutsceneExport(legacy),/Unmanaged/)
 assert.equal(fs.readFileSync(path.join(legacy,'src/cutscene_ids.h'),'utf8'),'/* manual */')
 config.output={ids:'../escape.h',data:'src/generated/scenes.h'};write('cutscenes/cutscene-config.json',config)
 assert.throws(()=>publishCutsceneExport(root))
 const malformed=fs.mkdtempSync(path.join(root,'malformed-'))
 fs.mkdirSync(path.join(malformed,'cutscenes'))
 fs.writeFileSync(path.join(malformed,'cutscenes/cutscene-config.json'),JSON.stringify(defaultCutsceneConfig()))
 fs.writeFileSync(path.join(malformed,'cutscenes/broken.cutscene.json'),'{invalid')
 assert.equal(prepareCutsceneExport(malformed).success,true,'no headers to adopt: allow repairing scene JSON')
 fs.writeFileSync(path.join(malformed,'cutscenes/cutscene-config.json'),'{invalid')
 assert.equal(prepareCutsceneExport(malformed).success,true,'invalid config may be repaired without adopting headers')
 const linked=fs.mkdtempSync(path.join(root,'linked-'));fs.symlinkSync(legacy,path.join(linked,'cutscenes'),'dir')
 assert.throws(()=>publishCutsceneExport(linked),/regular directory/)
 console.log('Cutscene publication: compilation, provenance, no-op, rollback, path reconciliation, exact legacy adoption and confinement passed.')
} finally {fs.rmSync(root,{recursive:true,force:true})}
