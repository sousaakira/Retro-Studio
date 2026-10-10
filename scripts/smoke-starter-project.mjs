// #61: the playable starter template -> a new project whose gates pass and, with --sgdk, a clean ROM build.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {copyProjectTemplate,prepareNewProject} from '../electron/retro/starterProject.js'
import {installNewProjectRuntime,recordNewProjectToolchain} from '../electron/retro/newProject.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {validateWorldForBuild,worldConfigurationStatus,saveWorldConfigurationWithMaps} from '../electron/retro/worldConfiguration.js'
import {cutsceneAdapterStatus,saveCutsceneAdapter} from '../electron/retro/cutsceneAdapter.js'
import {validateCameraForBuild} from '../electron/retro/cameraConfiguration.js'
import {validateAudioForBuild,audioConfigurationStatus} from '../electron/retro/audioConfiguration.js'
import {validateProgressForBuild} from '../electron/retro/progressConfiguration.js'
import {validateCutsceneAdapterForBuild} from '../electron/retro/cutsceneAdapter.js'
import {runtimeInstallationStatus} from '../electron/retro/runtimeInstaller.js'
import {toolchainStatus} from '../electron/retro/toolchain.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),examples=path.join(repository,'assets/toolkit/examples'),template=path.join(examples,'sgdk-starter')
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-starter-'))
const copy=(source,target)=>fs.cpSync(source,target,{recursive:true,filter:file=>!file.includes(path.sep+'out'+path.sep)&&!file.endsWith(path.sep+'out')})
const files=directory=>fs.readdirSync(directory,{recursive:true,withFileTypes:true}).filter(item=>item.isFile()).map(item=>path.relative(directory,path.join(item.parentPath??item.path,item.name))).sort()
// #45 (achado na IDE real): um modelo que foi compilado ou aberto no lugar não leva a ROM nem
 // os registros dele para o jogo novo, mesmo com a cópia simples que a IDE usa.
{const templates=path.join(temporary,'templates'),made=path.join(temporary,'made');fs.mkdirSync(path.join(templates,'base','out'),{recursive:true});fs.mkdirSync(path.join(templates,'base','.retrostudio'));fs.mkdirSync(path.join(templates,'game','.retro-studio','builds'),{recursive:true})
  fs.writeFileSync(path.join(templates,'base','out','rom.bin'),'ROM DE OUTRO BUILD');fs.writeFileSync(path.join(templates,'base','.retrostudio','x.json'),'{}');fs.writeFileSync(path.join(templates,'game','.retro-studio','builds','latest.json'),'{}')
  fs.writeFileSync(path.join(templates,'base','Makefile'),'all:\n');fs.writeFileSync(path.join(templates,'game','template.json'),JSON.stringify({format:'retro-studio.template',version:1,base:'base'}));fs.mkdirSync(made)
  copyProjectTemplate(path.join(templates,'game'),made,(source,target)=>fs.cpSync(source,target,{recursive:true}))
  assert.deepEqual(fs.readdirSync(made).sort(),['Makefile'])}
// #45 (achado na IDE real): o personagem do jogo inicial precisa abrir no Charset Maker, que exige
// em cada movimento o recorte (region) dentro da folha e quadros inteiros dentro dela.
{const character=JSON.parse(fs.readFileSync(path.join(template,'starter','character.json'),'utf8')),project=JSON.parse(character.characterProject)
 const sheet=fs.readFileSync(path.join(template,'res','hero_source.png')),sheetWidth=sheet.readUInt32BE(16),sheetHeight=sheet.readUInt32BE(20)
 assert.equal(project.source.path,'res/hero_source.png');assert.equal(project.animations.length,4)
 for(const animation of project.animations){
  const region=animation.region;assert.ok(region&&[region.x,region.y,region.width,region.height].every(Number.isFinite),'recorte de '+animation.name)
  assert.ok(region.x>=0&&region.y>=0&&region.x+region.width<=sheetWidth&&region.y+region.height<=sheetHeight,'recorte de '+animation.name+' dentro da folha')
  for(const frame of animation.frames)assert.ok([frame.x,frame.y,frame.width,frame.height].every(Number.isInteger)&&frame.x+frame.width<=sheetWidth&&frame.y+frame.height<=sheetHeight,'quadro de '+animation.name)
 }}
// Same steps as retro:create-project, without Electron.
async function create(name,modules){
 const project=path.join(temporary,name);fs.mkdirSync(project)
 const descriptor=copyProjectTemplate(template,project,copy)
 installNewProjectRuntime(project,modules,descriptor?.requires);installCutsceneRuntime(project)
 const config=JSON.parse(fs.readFileSync(path.join(template,'retro-studio.json'),'utf8'))
 fs.writeFileSync(path.join(project,'retro-studio.json'),JSON.stringify({name,template:'sgdk-starter',resourcePath:'res',assets:[],mapExport:config.mapExport,retroStudio:config.retroStudio},null,2))
 return {project,descriptor,prepared:await prepareNewProject(project)}
}
try{
 // The committed template is what the builder writes: authored sources only, nothing generated.
 const rebuilt=path.join(temporary,'rebuilt')
 const builder=spawnSync(process.execPath,[path.join(repository,'scripts/build-starter-template.mjs'),'--out',rebuilt],{encoding:'utf8'});assert.equal(builder.status,0,builder.stderr)
 assert.deepEqual(files(template),files(rebuilt),'template file list matches the builder')
 // PNG files are compared by decoded pixels and palette: another Pillow or zlib version
 // may compress the same image into different bytes. Everything else is byte-exact.
 const pixels=directory=>{const run=spawnSync('python3',['-c','import sys,hashlib\nfrom PIL import Image\nfor name in sys.argv[2:]:\n im=Image.open(sys.argv[1]+"/"+name)\n print(name,im.mode,im.size,hashlib.sha256(im.tobytes()+bytes(im.getpalette() or [])+repr(im.info.get("transparency")).encode()).hexdigest())',directory,...files(directory).filter(file=>file.endsWith('.png'))],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);return run.stdout}
 assert.equal(pixels(template),pixels(rebuilt),'template images are up to date (run node scripts/build-starter-template.mjs)')
 for(const file of files(template).filter(file=>!file.endsWith('.png')))assert.ok(fs.readFileSync(path.join(template,file)).equals(fs.readFileSync(path.join(rebuilt,file))),'template is up to date: '+file+' (run node scripts/build-starter-template.mjs)')
 for(const file of files(template))assert.ok(!/^(src\/generated|res\/generated|\.retrostudio|out|src\/retro_runtime)\//.test(file),'no generated or installed file in the template: '+file)
 const source=fs.readFileSync(path.join(template,'src/main.c'),'utf8')
 assert.doesNotMatch(source+fs.readFileSync(path.join(template,'README.md'),'utf8'),/alice|tempo\b/i,'the example carries no logic or names of other games')
 for(const text of ['retroMovementTick','retroCharacterTick','retroWorldExitThrough','retroWorldCheckpoint','retroCameraTick','retroAudioRoomMusic','retroAudioPlayEffect'])assert.ok(source.includes(text),'starter uses '+text)
 // Creation: skeleton underneath, starter on top, then the export pass.
 const {project,descriptor,prepared}=await create('game')
 assert.deepEqual(descriptor,{format:'retro-studio.template',version:1,base:'sgdk-skeleton',prepare:'starter',requires:['world-sgdk','movement','character-sprite','camera','audio','debug']})
 assert.deepEqual(prepared.steps.map(step=>step.name+':'+step.done),['personagem:true','salas e mapas:true','câmera:true','áudio:true'],JSON.stringify(prepared.steps));assert.equal(prepared.complete,true)
 for(const file of ['Makefile','tools/export-map.py','src/boot/rom_head.c','src/main.c','src/hero_animations.h','res/hero_sprites.png','charsets/hero.charset.json','src/generated/world_config.h','src/generated/world_maps.h',
  'src/generated/camera_config.h','src/generated/audio_config.h','src/generated/audio_sgdk.h','res/audio_resources.res','src/retro_runtime/retro_audio.c','src/retrostudio/cutscene_runner.c','README.md'])assert.ok(fs.existsSync(path.join(project,file)),file)
 for(const file of ['template.json','starter','.retrostudio-template-prepare'])assert.equal(fs.existsSync(path.join(project,file)),false,file+' is template plumbing, not part of the game')
 assert.equal(fs.readFileSync(path.join(project,'src/main.c'),'utf8'),source);assert.match(fs.readFileSync(path.join(project,'res/resources.res'),'utf8'),/SPRITE HERO "hero_sprites\.png"/)
 // Every build gate accepts the fresh project; optional systems it does not use stay unconfigured.
 assert.equal(validateWorldForBuild(project).configured,true);assert.equal(validateCameraForBuild(project).configured,true);assert.equal(validateAudioForBuild(project).configured,true)
 assert.deepEqual(validateProgressForBuild(project),{configured:false});assert.deepEqual(validateCutsceneAdapterForBuild(project),{configured:false})
 assert.equal(audioConfigurationStatus(project).report.errors,0);assert.equal(runtimeInstallationStatus(project).upToDate,true)
 // The IDE rewrites retro-studio.json when the project is opened (asset list): the maps stay current.
 {const file=path.join(project,'retro-studio.json'),config=JSON.parse(fs.readFileSync(file,'utf8'))
  config.assets=[{id:'a1',name:'hall.png',type:'background',path:'res/hall.png'}];config.lastOpened='2026-10-10';fs.writeFileSync(file,JSON.stringify(config,null,2))
  assert.equal(validateWorldForBuild(project).configured,true,'opening the project never makes the exported maps stale')
  config.mapExport.playerFrame.width=24;fs.writeFileSync(file,JSON.stringify(config,null,2));assert.throws(()=>validateWorldForBuild(project),/mudaram/,'what the exporter reads still counts')
  config.mapExport.playerFrame.width=16;fs.writeFileSync(file,JSON.stringify(config,null,2));assert.equal(validateWorldForBuild(project).configured,true)}
 // #45 (achado na IDE real): editar e exportar um personagem não deixa os mapas "desatualizados":
 // o projeto do personagem e a folha que nenhum mapa cita não são entradas da exportação de mapas.
 {const charset=path.join(project,'charsets/hero.charset.json'),sheet=path.join(project,'res/hero_sprites.png'),keptCharset=fs.readFileSync(charset),keptSheet=fs.readFileSync(sheet)
  fs.writeFileSync(charset,keptCharset.toString('utf8').replace('"fps": 8','"fps": 4'));fs.writeFileSync(sheet,Buffer.concat([keptSheet,Buffer.from([0])]))
  assert.equal(validateWorldForBuild(project).configured,true,'personagem editado e reexportado: mapas continuam em dia')
  // Uma imagem que um mapa cita continua contando.
  const used=fs.readdirSync(path.join(project,'res')).find(name=>/\.png$/.test(name)&&fs.readFileSync(path.join(project,'maps',fs.readdirSync(path.join(project,'maps')).find(map=>map.endsWith('.tmx'))),'utf8').includes(name))
  assert.ok(used,'o projeto inicial tem um mapa que cita uma imagem de res/')
  const usedFile=path.join(project,'res',used),keptUsed=fs.readFileSync(usedFile);fs.writeFileSync(usedFile,Buffer.concat([keptUsed,Buffer.from([0])]))
  assert.throws(()=>validateWorldForBuild(project),/mudaram/,'imagem usada por um mapa mudou: mapas desatualizados')
  fs.writeFileSync(usedFile,keptUsed);fs.writeFileSync(charset,keptCharset);fs.writeFileSync(sheet,keptSheet);assert.equal(validateWorldForBuild(project).configured,true)}
 // A selection smaller than what the template needs still gets the required modules.
 {const small=await create('small',['progress']);assert.equal(small.prepared.complete,true,JSON.stringify(small.prepared.steps));assert.ok(fs.existsSync(path.join(small.project,'src/retro_runtime/retro_world_sgdk.c'))&&fs.existsSync(path.join(small.project,'src/retro_runtime/retro_progress.c')))}
 // Rooms with cutscene triggers: refused until the triggers are exported, accepted afterwards.
 {const trigger=await create('triggers'),map=path.join(trigger.project,'maps/cave.tmx'),tmx=fs.readFileSync(map,'utf8')
  assert.ok(tmx.includes('</objectgroup>'));fs.writeFileSync(map,tmx.replace('</objectgroup>','<object id="90" type="cutscene_trigger" x="200" y="120" width="16" height="56"><properties><property name="cutscene" value="hello"/></properties></object></objectgroup>'))
  const world=JSON.parse(fs.readFileSync(path.join(trigger.project,'world/world.json'),'utf8'))
  await assert.rejects(saveWorldConfigurationWithMaps(trigger.project,{config:world,revision:worldConfigurationStatus(trigger.project).revision}),/Cenas precisam|cutscene/i)
  fs.writeFileSync(path.join(trigger.project,'cutscenes/hello.cutscene.json'),JSON.stringify({format:'retro-studio.cutscene',version:1,id:'hello',title:'Oi',steps:[{type:'wait',frames:1}]}))
  assert.equal(saveCutsceneAdapter(trigger.project,{revision:cutsceneAdapterStatus(trigger.project).revision}).success,true)
  assert.equal((await saveWorldConfigurationWithMaps(trigger.project,{config:world,revision:worldConfigurationStatus(trigger.project).revision})).mapsExported,2,'the staged map export sees that triggers are exported')
  assert.equal(validateWorldForBuild(trigger.project).configured,true)}
 // A machine without Python still gets a project: the map step is reported, the rest is done.
 const saved=process.env.PATH
 try{
  process.env.PATH=path.join(temporary,'empty-path');fs.mkdirSync(process.env.PATH)
  const limited=await create('no-python')
  assert.deepEqual(limited.prepared.steps.map(step=>step.name+':'+step.done),['personagem:true','salas e mapas:false','câmera:true','áudio:true']);assert.equal(limited.prepared.complete,false)
  assert.ok(limited.prepared.steps[1].reason);assert.ok(fs.existsSync(path.join(limited.project,'world/world.json')),'the authored world stays for a later export')
 }finally{process.env.PATH=saved}
 const toolkit=argument('--toolkit'),sdk=argument('--sgdk')
 if(toolkit){
  assert.deepEqual(recordNewProjectToolchain(project,toolkit),{recorded:true})
  const status=toolchainStatus(project,{toolkit});assert.deepEqual(status.issues.filter(item=>item.severity!=='info'),[],JSON.stringify(status.issues))
  assert.ok(status.record.runtime.modules.audio&&status.record.runtime.modules['world-sgdk'])
 }
 if(sdk){
  const options={cwd:project,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024}
  const clean=spawnSync('make',['clean','GDK='+sdk,'NODE='+process.execPath],options);assert.equal(clean.status,0,clean.stdout+clean.stderr)
  const build=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],options)
  assert.equal(build.status,0,(build.stdout+build.stderr).slice(-5000))
  const rom=fs.readFileSync(path.join(project,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  for(const gate of [validateWorldForBuild,validateCameraForBuild,validateAudioForBuild])assert.equal(gate(project).configured,true,'the build leaves every export current')
  if(argument('--keep-rom'))fs.copyFileSync(path.join(project,'out/rom.bin'),argument('--keep-rom'))
  console.log('PASS starter project: clean build with SGDK -> ROM ('+rom.length+' bytes)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Starter project: template matches its builder, no generated files stored, creation over the skeleton, export pass, build gates, missing-Python fallback passed.')
